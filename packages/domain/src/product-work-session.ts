import { createHash } from 'node:crypto';

import {
  ACTION_PROPOSAL_KINDS,
  TRACE_RELATION_TYPES,
  type ActionProposalChangeSet,
  type ActionProposalDisplayDiffDto,
  type ActionProposalDto,
  type ActionProposalResultRefDto,
  type ActionProposalStatus,
  type ActionProposalTargetDto,
  type ActorRole,
  type LifecycleStage,
  type ProductWorkSessionDto,
  type ProductWorkSessionStatus,
  type ProductWorkTurnDto,
  type ProductWorkTurnStatus,
  type ProductWorkTurnUsageSummaryDto,
  type WorkSessionControlAction,
} from '@pfc/contracts';

import { DomainRuleViolation } from './errors.ts';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const terminalTurnStatuses = new Set<ProductWorkTurnStatus>([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const sessionTransitions: Readonly<
  Record<ProductWorkSessionStatus, readonly ProductWorkSessionStatus[]>
> = {
  ACTIVE: ['BLOCKED', 'COMPLETED', 'ARCHIVED'],
  BLOCKED: ['ACTIVE', 'ARCHIVED'],
  COMPLETED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
};

const turnTransitions: Readonly<
  Record<ProductWorkTurnStatus, readonly ProductWorkTurnStatus[]>
> = {
  RECEIVED: ['QUEUED'],
  QUEUED: ['RUNNING', 'CANCELLING'],
  RUNNING: [
    'WAITING_INPUT',
    'PROPOSING',
    'COMPLETED',
    'FAILED',
    'CANCELLING',
    'UNKNOWN',
  ],
  WAITING_INPUT: ['QUEUED', 'CANCELLING'],
  PROPOSING: ['COMPLETED', 'FAILED', 'UNKNOWN'],
  CANCELLING: ['CANCELLED', 'UNKNOWN'],
  UNKNOWN: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const proposalTransitions: Readonly<
  Record<ActionProposalStatus, readonly ActionProposalStatus[]>
> = {
  DRAFT: ['PENDING_CONFIRMATION'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'REJECTED', 'EXPIRED', 'STALE'],
  CONFIRMED: ['APPLYING'],
  APPLYING: ['APPLIED', 'FAILED', 'STALE', 'UNKNOWN'],
  UNKNOWN: ['APPLIED', 'FAILED', 'STALE', 'UNKNOWN'],
  APPLIED: [],
  REJECTED: [],
  EXPIRED: [],
  STALE: [],
  FAILED: [],
};

function identifier(value: string, code: string): string {
  const normalized = value.trim();
  if (!identifierPattern.test(normalized)) throw new Error(code);
  return normalized;
}

function timestamp(value: string, code: string): string {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(code);
  return value;
}

function nonNegativeVersion(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(code);
  return value;
}

function boundedText(
  value: string,
  code: string,
  maximum: number,
  allowEmpty = false,
): string {
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    throw new Error(code);
  }
  return normalized;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonDepthAndArrays(
  value: unknown,
  depth = 1,
): Readonly<{ depth: number; largestArray: number }> {
  if (Array.isArray(value)) {
    return value.reduce<{ depth: number; largestArray: number }>(
      (result, item) => {
        const child = jsonDepthAndArrays(item, depth + 1);
        return {
          depth: Math.max(result.depth, child.depth),
          largestArray: Math.max(result.largestArray, child.largestArray),
        };
      },
      { depth, largestArray: value.length },
    );
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<{
      depth: number;
      largestArray: number;
    }>(
      (result, item) => {
        const child = jsonDepthAndArrays(item, depth + 1);
        return {
          depth: Math.max(result.depth, child.depth),
          largestArray: Math.max(result.largestArray, child.largestArray),
        };
      },
      { depth, largestArray: 0 },
    );
  }
  return { depth, largestArray: 0 };
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required = allowed,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.includes(key)) &&
    required.every((key) => keys.includes(key))
  );
}

function validateChangeSet(changeSet: ActionProposalChangeSet): void {
  const value = changeSet as unknown as Record<string, unknown>;
  const serialized = canonicalJson(value);
  const shape = jsonDepthAndArrays(value);
  if (
    Buffer.byteLength(serialized, 'utf8') > 65_536 ||
    shape.depth > 8 ||
    shape.largestArray > 100 ||
    !ACTION_PROPOSAL_KINDS.includes(value.kind as never)
  ) {
    throw new Error('INVALID_ACTION_PROPOSAL_CHANGE_SET');
  }

  const stringField = (key: string, maximum = 8_000) =>
    typeof value[key] === 'string' &&
    (value[key] as string).trim().length > 0 &&
    (value[key] as string).trim().length <= maximum;
  let valid = false;
  switch (value.kind) {
    case 'COMPLETE_G0_REGISTRATION':
      valid =
        exactKeys(
          value,
          [
            'kind',
            'sourceType',
            'sourceDescription',
            'businessOwnerId',
            'materialPurpose',
            'sensitivity',
          ],
          [
            'kind',
            'sourceType',
            'businessOwnerId',
            'materialPurpose',
            'sensitivity',
          ],
        ) &&
        stringField('sourceType', 80) &&
        (!('sourceDescription' in value) || stringField('sourceDescription')) &&
        stringField('businessOwnerId', 200) &&
        stringField('materialPurpose', 80) &&
        stringField('sensitivity', 20);
      break;
    case 'ANSWER_QUESTION':
      valid =
        exactKeys(value, ['kind', 'questionId', 'answer']) &&
        stringField('questionId', 200) &&
        stringField('answer');
      break;
    case 'CONFIRM_QUESTION':
      valid =
        exactKeys(value, [
          'kind',
          'questionId',
          'confirmationRole',
          'reason',
        ]) &&
        stringField('questionId', 200) &&
        stringField('confirmationRole', 80) &&
        stringField('reason', 1_000);
      break;
    case 'REGISTER_ARTIFACT':
      valid =
        exactKeys(value, ['kind', 'capId', 'stage', 'artifactType', 'title']) &&
        stringField('capId', 80) &&
        stringField('stage', 8) &&
        stringField('artifactType', 80) &&
        stringField('title', 200);
      break;
    case 'APPEND_ARTIFACT_VERSION':
      valid =
        exactKeys(value, [
          'kind',
          'artifactId',
          'versionLabel',
          'sourceType',
          'sourceRef',
          'contentHash',
          'sensitivity',
        ]) &&
        stringField('artifactId', 200) &&
        stringField('versionLabel', 80) &&
        stringField('sourceType', 80) &&
        stringField('sourceRef', 500) &&
        typeof value.contentHash === 'string' &&
        hashPattern.test(value.contentHash) &&
        stringField('sensitivity', 20);
      break;
    case 'CREATE_AGENT_RUN': {
      const accessMode = value.accessMode;
      const writeScope = value.writeScope;
      valid =
        exactKeys(
          value,
          [
            'kind',
            'baselineId',
            'workspaceId',
            'skillKey',
            'skillVersion',
            'operation',
            'accessMode',
            'writeScope',
          ],
          [
            'kind',
            'baselineId',
            'workspaceId',
            'skillKey',
            'skillVersion',
            'operation',
            'accessMode',
          ],
        ) &&
        stringField('baselineId', 200) &&
        stringField('workspaceId', 200) &&
        stringField('skillKey', 200) &&
        stringField('skillVersion', 80) &&
        ['ARTIFACT_CHECK', 'CONTROLLED_ARTIFACT_EDIT'].includes(
          String(value.operation),
        ) &&
        ['READ_ONLY', 'WORKSPACE_WRITE'].includes(String(accessMode)) &&
        ((accessMode === 'READ_ONLY' && writeScope === undefined) ||
          (accessMode === 'WORKSPACE_WRITE' &&
            writeScope !== null &&
            typeof writeScope === 'object'));
      break;
    }
    case 'REGISTER_TRACE_LINK':
      valid =
        exactKeys(value, [
          'kind',
          'sourceSubjectId',
          'targetSubjectId',
          'relationType',
        ]) &&
        stringField('sourceSubjectId', 200) &&
        stringField('targetSubjectId', 200) &&
        TRACE_RELATION_TYPES.includes(value.relationType as never);
      break;
    case 'READ_MCP': {
      const materialRefIds = value.materialRefIds;
      valid =
        exactKeys(value, [
          'kind',
          'logicalCapabilityId',
          'input',
          'sensitivity',
          'materialRefIds',
        ]) &&
        stringField('logicalCapabilityId', 200) &&
        value.input !== null &&
        typeof value.input === 'object' &&
        !Array.isArray(value.input) &&
        ['PUBLIC', 'INTERNAL', 'RESTRICTED'].includes(
          String(value.sensitivity),
        ) &&
        Array.isArray(materialRefIds) &&
        materialRefIds.length <= 50 &&
        new Set(materialRefIds).size === materialRefIds.length &&
        materialRefIds.every(
          (item) => typeof item === 'string' && item.length <= 200,
        );
      break;
    }
  }
  if (!valid) throw new Error('INVALID_ACTION_PROPOSAL_CHANGE_SET');
}

function normalizeDiff(
  displayDiff: readonly ActionProposalDisplayDiffDto[],
): readonly ActionProposalDisplayDiffDto[] {
  if (displayDiff.length > 100) throw new Error('INVALID_ACTION_PROPOSAL_DIFF');
  return displayDiff.map((item) => {
    const field = boundedText(item.field, 'INVALID_ACTION_PROPOSAL_DIFF', 160);
    const scalars = [item.before, item.after];
    if (
      scalars.some(
        (value) =>
          !['string', 'number', 'boolean'].includes(typeof value) &&
          value !== null,
      ) ||
      scalars.some((value) => typeof value === 'string' && value.length > 8_000)
    ) {
      throw new Error('INVALID_ACTION_PROPOSAL_DIFF');
    }
    return { ...item, field };
  });
}

export function createProductWorkSession(input: {
  id: string;
  teamId: string;
  requirementId: string;
  openedRequirementVersion: number;
  currentRequirementVersion: number;
  openedBaselineId: string | null;
  openedStage: LifecycleStage;
  ownerId: string;
  createdBy: string;
  title?: string | null;
  createdAt: string;
}): ProductWorkSessionDto {
  const createdAt = timestamp(
    input.createdAt,
    'INVALID_WORK_SESSION_TIMESTAMP',
  );
  const openedRequirementVersion = nonNegativeVersion(
    input.openedRequirementVersion,
    'INVALID_WORK_SESSION_VERSION',
  );
  const currentRequirementVersion = nonNegativeVersion(
    input.currentRequirementVersion,
    'INVALID_WORK_SESSION_VERSION',
  );
  if (currentRequirementVersion < openedRequirementVersion) {
    throw new Error('INVALID_WORK_SESSION_VERSION');
  }
  return {
    schemaVersion: 'product-work-session/1',
    id: identifier(input.id, 'INVALID_WORK_SESSION_ID'),
    teamId: identifier(input.teamId, 'INVALID_WORK_SESSION_TEAM_ID'),
    requirementId: identifier(
      input.requirementId,
      'INVALID_WORK_SESSION_REQUIREMENT_ID',
    ),
    openedRequirementVersion,
    currentRequirementVersion,
    openedBaselineId: input.openedBaselineId
      ? identifier(input.openedBaselineId, 'INVALID_WORK_SESSION_BASELINE_ID')
      : null,
    openedStage: input.openedStage,
    status: 'ACTIVE',
    controlSurface: 'WEB',
    activeTurnId: null,
    lastSequence: 0,
    ownerId: identifier(input.ownerId, 'INVALID_WORK_SESSION_OWNER_ID'),
    title: input.title
      ? boundedText(input.title, 'INVALID_WORK_SESSION_TITLE', 120)
      : null,
    blockReason: null,
    rowVersion: 0,
    createdBy: identifier(input.createdBy, 'INVALID_WORK_SESSION_ACTOR_ID'),
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

export function transitionProductWorkSession(
  session: ProductWorkSessionDto,
  nextStatus: ProductWorkSessionStatus,
  input: {
    occurredAt: string;
    controlAction?: WorkSessionControlAction;
    accessRevalidated?: boolean;
    currentRequirementVersion?: number;
    blockReason?: string;
  },
): ProductWorkSessionDto {
  if (!sessionTransitions[session.status].includes(nextStatus)) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'INVALID_WORK_SESSION_TRANSITION',
    );
  }
  if (
    session.status === 'ARCHIVED' &&
    (nextStatus !== 'ACTIVE' ||
      input.controlAction !== 'RESUME' ||
      !input.accessRevalidated ||
      input.currentRequirementVersion !== session.currentRequirementVersion)
  ) {
    throw new DomainRuleViolation(
      'WORK_SESSION_BLOCKED',
      'WORK_SESSION_RESUME_REVALIDATION_REQUIRED',
    );
  }
  if (['COMPLETED', 'ARCHIVED'].includes(nextStatus) && session.activeTurnId) {
    throw new DomainRuleViolation(
      'WORK_SESSION_BLOCKED',
      'WORK_SESSION_ACTIVE_TURN',
    );
  }
  if (nextStatus === 'BLOCKED' && !input.blockReason?.trim()) {
    throw new Error('WORK_SESSION_BLOCK_REASON_REQUIRED');
  }
  const occurredAt = timestamp(
    input.occurredAt,
    'INVALID_WORK_SESSION_TIMESTAMP',
  );
  return {
    ...session,
    status: nextStatus,
    blockReason: nextStatus === 'BLOCKED' ? input.blockReason!.trim() : null,
    currentRequirementVersion:
      input.currentRequirementVersion === undefined
        ? session.currentRequirementVersion
        : nonNegativeVersion(
            input.currentRequirementVersion,
            'INVALID_WORK_SESSION_VERSION',
          ),
    rowVersion: session.rowVersion + 1,
    updatedAt: occurredAt,
    archivedAt: nextStatus === 'ARCHIVED' ? occurredAt : session.archivedAt,
  };
}

export function createProductWorkTurn(input: {
  id: string;
  sessionId: string;
  sequence: number;
  intentKind: string;
  inputText: string;
  skillReleaseId: string;
  createdBy: string;
  createdAt: string;
  contentRetentionUntil?: string | null;
}): ProductWorkTurnDto {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error('INVALID_WORK_TURN_SEQUENCE');
  }
  const createdAt = timestamp(input.createdAt, 'INVALID_WORK_TURN_TIMESTAMP');
  const retention = input.contentRetentionUntil
    ? timestamp(
        input.contentRetentionUntil,
        'INVALID_WORK_TURN_RETENTION_TIMESTAMP',
      )
    : null;
  if (retention && Date.parse(retention) <= Date.parse(createdAt)) {
    throw new Error('INVALID_WORK_TURN_RETENTION_TIMESTAMP');
  }
  return {
    schemaVersion: 'product-work-turn/1',
    id: identifier(input.id, 'INVALID_WORK_TURN_ID'),
    sessionId: identifier(input.sessionId, 'INVALID_WORK_TURN_SESSION_ID'),
    sequence: input.sequence,
    intentKind: boundedText(
      input.intentKind,
      'INVALID_WORK_TURN_INTENT_KIND',
      80,
    ),
    inputText: boundedText(input.inputText, 'INVALID_WORK_TURN_INPUT', 8_000),
    visibleResponse: null,
    status: 'RECEIVED',
    skillReleaseId: identifier(
      input.skillReleaseId,
      'INVALID_WORK_TURN_SKILL_RELEASE_ID',
    ),
    bridgeId: null,
    externalIds: { threadId: null, turnId: null },
    usageSummary: null,
    failureReason: null,
    recoveryAction: null,
    contentRetentionUntil: retention,
    redactedAt: null,
    rowVersion: 0,
    createdBy: identifier(input.createdBy, 'INVALID_WORK_TURN_ACTOR_ID'),
    createdAt,
    updatedAt: createdAt,
    terminalAt: null,
  };
}

export function transitionProductWorkTurn(
  turn: ProductWorkTurnDto,
  nextStatus: ProductWorkTurnStatus,
  input: {
    occurredAt: string;
    visibleResponse?: string;
    bridgeId?: string;
    externalIds?: Partial<ProductWorkTurnDto['externalIds']>;
    usageSummary?: ProductWorkTurnUsageSummaryDto;
    failureReason?: string;
    recoveryAction?: string;
    verificationOnly?: boolean;
  },
): ProductWorkTurnDto {
  if (!turnTransitions[turn.status].includes(nextStatus)) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'INVALID_WORK_TURN_TRANSITION',
    );
  }
  if (turn.status === 'UNKNOWN' && !input.verificationOnly) {
    throw new DomainRuleViolation(
      'RESULT_UNKNOWN',
      'WORK_TURN_VERIFICATION_REQUIRED',
    );
  }
  if (
    ['FAILED', 'UNKNOWN'].includes(nextStatus) &&
    !input.failureReason?.trim()
  ) {
    throw new Error('WORK_TURN_FAILURE_REASON_REQUIRED');
  }
  const visibleResponse = input.visibleResponse
    ? boundedText(
        input.visibleResponse,
        'INVALID_WORK_TURN_VISIBLE_RESPONSE',
        32_000,
      )
    : turn.visibleResponse;
  const occurredAt = timestamp(input.occurredAt, 'INVALID_WORK_TURN_TIMESTAMP');
  return {
    ...turn,
    status: nextStatus,
    visibleResponse,
    bridgeId: input.bridgeId
      ? identifier(input.bridgeId, 'INVALID_WORK_TURN_BRIDGE_ID')
      : turn.bridgeId,
    externalIds: {
      threadId: input.externalIds?.threadId ?? turn.externalIds.threadId,
      turnId: input.externalIds?.turnId ?? turn.externalIds.turnId,
    },
    usageSummary: input.usageSummary ?? turn.usageSummary,
    failureReason: input.failureReason?.trim() ?? turn.failureReason,
    recoveryAction: input.recoveryAction?.trim() ?? turn.recoveryAction,
    rowVersion: turn.rowVersion + 1,
    updatedAt: occurredAt,
    terminalAt: terminalTurnStatuses.has(nextStatus)
      ? occurredAt
      : turn.terminalAt,
  };
}

export function createActionProposal(input: {
  id: string;
  sessionId: string;
  turnId: string;
  kind: ActionProposalDto['kind'];
  target: ActionProposalTargetDto;
  changeSet: ActionProposalChangeSet;
  displayDiff: readonly ActionProposalDisplayDiffDto[];
  confirmationRequirement: ActorRole;
  createdAt: string;
}): ActionProposalDto {
  if (input.kind !== input.changeSet.kind) {
    throw new Error('INVALID_ACTION_PROPOSAL_CHANGE_SET');
  }
  validateChangeSet(input.changeSet);
  const target = {
    ...input.target,
    aggregateId: identifier(
      input.target.aggregateId,
      'INVALID_ACTION_PROPOSAL_TARGET_ID',
    ),
    rowVersion: nonNegativeVersion(
      input.target.rowVersion,
      'INVALID_ACTION_PROPOSAL_TARGET_VERSION',
    ),
  };
  const scopeHash = `sha256:${createHash('sha256')
    .update(
      canonicalJson({ kind: input.kind, target, changeSet: input.changeSet }),
    )
    .digest('hex')}`;
  const createdAt = timestamp(
    input.createdAt,
    'INVALID_ACTION_PROPOSAL_TIMESTAMP',
  );
  return {
    schemaVersion: 'product-action-proposal/1',
    id: identifier(input.id, 'INVALID_ACTION_PROPOSAL_ID'),
    sessionId: identifier(
      input.sessionId,
      'INVALID_ACTION_PROPOSAL_SESSION_ID',
    ),
    turnId: identifier(input.turnId, 'INVALID_ACTION_PROPOSAL_TURN_ID'),
    kind: input.kind,
    target,
    changeSet: input.changeSet,
    displayDiff: normalizeDiff(input.displayDiff),
    scopeHash,
    confirmationRequirement: input.confirmationRequirement,
    status: 'PENDING_CONFIRMATION',
    confirmedBy: null,
    confirmedAt: null,
    reasonCode: null,
    resultRef: null,
    failureReason: null,
    rowVersion: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

export function transitionActionProposal(
  proposal: ActionProposalDto,
  nextStatus: ActionProposalStatus,
  input: {
    occurredAt: string;
    actorId?: string;
    reasonCode?: string;
    resultRef?: ActionProposalResultRefDto;
    failureReason?: string;
    readbackOnly?: boolean;
  },
): ActionProposalDto {
  if (!proposalTransitions[proposal.status].includes(nextStatus)) {
    throw new DomainRuleViolation(
      'INVALID_STATE_TRANSITION',
      'INVALID_ACTION_PROPOSAL_TRANSITION',
    );
  }
  if (proposal.status === 'UNKNOWN' && !input.readbackOnly) {
    throw new DomainRuleViolation(
      'RESULT_UNKNOWN',
      'PROPOSAL_READBACK_REQUIRED',
    );
  }
  if (nextStatus === 'APPLIED' && !input.resultRef) {
    throw new Error('ACTION_PROPOSAL_RESULT_REQUIRED');
  }
  if (
    ['FAILED', 'UNKNOWN'].includes(nextStatus) &&
    !input.failureReason?.trim()
  ) {
    throw new Error('ACTION_PROPOSAL_FAILURE_REASON_REQUIRED');
  }
  const occurredAt = timestamp(
    input.occurredAt,
    'INVALID_ACTION_PROPOSAL_TIMESTAMP',
  );
  return {
    ...proposal,
    status: nextStatus,
    confirmedBy:
      nextStatus === 'CONFIRMED' && input.actorId
        ? identifier(input.actorId, 'INVALID_ACTION_PROPOSAL_ACTOR_ID')
        : proposal.confirmedBy,
    confirmedAt: nextStatus === 'CONFIRMED' ? occurredAt : proposal.confirmedAt,
    reasonCode: input.reasonCode?.trim() ?? proposal.reasonCode,
    resultRef: input.resultRef ?? proposal.resultRef,
    failureReason: input.failureReason?.trim() ?? proposal.failureReason,
    rowVersion: proposal.rowVersion + 1,
    updatedAt: occurredAt,
  };
}

export function decideActionProposal(
  proposal: ActionProposalDto,
  input: {
    decision: 'CONFIRM' | 'REJECT';
    actorId: string;
    decidedAt: string;
    expectedRowVersion: number;
    currentTargetVersion: number;
    scopeHash: string;
    reasonCode: string;
  },
): ActionProposalDto {
  if (
    proposal.status !== 'PENDING_CONFIRMATION' ||
    input.expectedRowVersion !== proposal.rowVersion
  ) {
    throw new DomainRuleViolation(
      'VERSION_CONFLICT',
      'ACTION_PROPOSAL_VERSION_CONFLICT',
      { currentVersion: proposal.rowVersion },
    );
  }
  if (
    !hashPattern.test(input.scopeHash) ||
    input.scopeHash !== proposal.scopeHash
  ) {
    throw new DomainRuleViolation(
      'PROPOSAL_SCOPE_MISMATCH',
      'PROPOSAL_SCOPE_MISMATCH',
    );
  }
  if (input.decision === 'REJECT') {
    return transitionActionProposal(proposal, 'REJECTED', {
      occurredAt: input.decidedAt,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });
  }
  if (input.currentTargetVersion !== proposal.target.rowVersion) {
    return transitionActionProposal(proposal, 'STALE', {
      occurredAt: input.decidedAt,
      actorId: input.actorId,
      reasonCode: 'TARGET_VERSION_CHANGED',
    });
  }
  return transitionActionProposal(proposal, 'CONFIRMED', {
    occurredAt: input.decidedAt,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
  });
}
