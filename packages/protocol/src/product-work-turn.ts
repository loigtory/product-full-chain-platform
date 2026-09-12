export const PRODUCT_WORK_TURN_PROTOCOL_VERSION =
  'product-work-turn/1' as const;
export const PRODUCT_WORK_TURN_COMMAND_VERSION =
  'product-work-turn-command/1' as const;
export const PRODUCT_WORK_TURN_CONTEXT_VERSION =
  'product-work-turn-context/1' as const;
export const PRODUCT_WORK_TURN_EVENT_VERSION =
  'product-work-turn-event/1' as const;

export const PRODUCT_WORK_TURN_COMMAND_TYPES = [
  'START_PRODUCT_WORK_TURN',
  'INTERRUPT_PRODUCT_WORK_TURN',
  'VERIFY_PRODUCT_WORK_TURN',
] as const;

export const PRODUCT_WORK_TURN_EVENT_TYPES = [
  'TURN_STARTED',
  'TURN_MESSAGE_AVAILABLE',
  'TURN_PROPOSAL_AVAILABLE',
  'TURN_COMPLETED',
  'TURN_CANCELLED',
  'TURN_FAILED',
  'TURN_UNKNOWN',
] as const;

export type ProductWorkTurnCommandType =
  (typeof PRODUCT_WORK_TURN_COMMAND_TYPES)[number];
export type ProductWorkTurnEventType =
  (typeof PRODUCT_WORK_TURN_EVENT_TYPES)[number];

type ProductWorkTurnCommandBase = Readonly<{
  schemaVersion: typeof PRODUCT_WORK_TURN_COMMAND_VERSION;
  commandId: string;
  leaseUntil: string;
  attempt: number;
  afterSequence: number;
}>;

export type StartProductWorkTurnPayload = Readonly<{
  sessionId: string;
  turnId: string;
  turnVersion: number;
  requirementId: string;
  openedRequirementVersion: number;
  baselineId: string;
  contextBindingIds: readonly string[];
  contextHash: string;
  skillReleaseId: string;
  skillContentHash: string;
}>;

export type ProductWorkTurnControlPayload = Readonly<{
  sessionId: string;
  turnId: string;
  turnVersion: number;
}>;

export type ProductWorkTurnCommand = ProductWorkTurnCommandBase &
  (
    | Readonly<{
        commandType: 'START_PRODUCT_WORK_TURN';
        payload: StartProductWorkTurnPayload;
      }>
    | Readonly<{
        commandType: 'INTERRUPT_PRODUCT_WORK_TURN' | 'VERIFY_PRODUCT_WORK_TURN';
        payload: ProductWorkTurnControlPayload;
      }>
  );

export type ProductWorkTurnContext = Readonly<{
  schemaVersion: typeof PRODUCT_WORK_TURN_CONTEXT_VERSION;
  protocolVersion: typeof PRODUCT_WORK_TURN_PROTOCOL_VERSION;
  commandId: string;
  sessionId: string;
  turnId: string;
  contextHash: string;
  userMessage: string;
  contextItems: readonly Readonly<{
    bindingId: string;
    contextType: string;
    targetId: string;
    targetVersion: number | null;
    contentHash: string;
    sensitivity: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
    content: string;
  }>[];
  skill: Readonly<{
    releaseId: string;
    contentHash: string;
  }>;
}>;

type ProductWorkTurnEventBase = Readonly<{
  schemaVersion: typeof PRODUCT_WORK_TURN_EVENT_VERSION;
  sourceEventId: string;
  expectedSequence: number;
  occurredAt: string;
}>;

export type ProductWorkTurnEvent = ProductWorkTurnEventBase &
  (
    | Readonly<{
        eventType: 'TURN_STARTED';
        payload: Readonly<{ threadId: string; turnId: string }>;
      }>
    | Readonly<{
        eventType: 'TURN_MESSAGE_AVAILABLE';
        payload: Readonly<{ message: string }>;
      }>
    | Readonly<{
        eventType: 'TURN_PROPOSAL_AVAILABLE';
        payload: Readonly<{ proposal: Readonly<Record<string, unknown>> }>;
      }>
    | Readonly<{
        eventType: 'TURN_COMPLETED';
        payload: Readonly<{ status: 'COMPLETED' }>;
      }>
    | Readonly<{
        eventType: 'TURN_CANCELLED';
        payload: Readonly<{ status: 'CANCELLED' }>;
      }>
    | Readonly<{
        eventType: 'TURN_FAILED' | 'TURN_UNKNOWN';
        payload: Readonly<{ reasonCode: string }>;
      }>
  );

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(code);
  }
}

function boundedString(value: unknown, code: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(code);
  }
  return value;
}

function integer(value: unknown, code: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new Error(code);
  }
  return Number(value);
}

function timestamp(value: unknown, code: string): string {
  const result = boundedString(value, code);
  if (Number.isNaN(Date.parse(result))) throw new Error(code);
  return result;
}

function contentHash(value: unknown, code: string): string {
  const result = boundedString(value, code, 80);
  if (!/^sha256:[a-f\d]{64}$/i.test(result)) throw new Error(code);
  return result;
}

function identifierArray(value: unknown, code: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 50 ||
    new Set(value).size !== value.length
  ) {
    throw new Error(code);
  }
  value.forEach((item) => boundedString(item, code));
  return value as readonly string[];
}

function parseStartPayload(value: Record<string, unknown>): void {
  exactFields(
    value,
    [
      'sessionId',
      'turnId',
      'turnVersion',
      'requirementId',
      'openedRequirementVersion',
      'baselineId',
      'contextBindingIds',
      'contextHash',
      'skillReleaseId',
      'skillContentHash',
    ],
    'PRODUCT_WORK_TURN_COMMAND_PAYLOAD_FIELDS_INVALID',
  );
  boundedString(value.sessionId, 'PRODUCT_WORK_TURN_SESSION_ID_INVALID');
  boundedString(value.turnId, 'PRODUCT_WORK_TURN_ID_INVALID');
  integer(value.turnVersion, 'PRODUCT_WORK_TURN_VERSION_INVALID');
  boundedString(
    value.requirementId,
    'PRODUCT_WORK_TURN_REQUIREMENT_ID_INVALID',
  );
  integer(
    value.openedRequirementVersion,
    'PRODUCT_WORK_TURN_REQUIREMENT_VERSION_INVALID',
  );
  boundedString(value.baselineId, 'PRODUCT_WORK_TURN_BASELINE_ID_INVALID');
  identifierArray(
    value.contextBindingIds,
    'PRODUCT_WORK_TURN_CONTEXT_BINDINGS_INVALID',
  );
  contentHash(value.contextHash, 'PRODUCT_WORK_TURN_CONTEXT_HASH_INVALID');
  boundedString(
    value.skillReleaseId,
    'PRODUCT_WORK_TURN_SKILL_RELEASE_ID_INVALID',
  );
  contentHash(
    value.skillContentHash,
    'PRODUCT_WORK_TURN_SKILL_CONTENT_HASH_INVALID',
  );
}

function parseControlPayload(value: Record<string, unknown>): void {
  exactFields(
    value,
    ['sessionId', 'turnId', 'turnVersion'],
    'PRODUCT_WORK_TURN_COMMAND_PAYLOAD_FIELDS_INVALID',
  );
  boundedString(value.sessionId, 'PRODUCT_WORK_TURN_SESSION_ID_INVALID');
  boundedString(value.turnId, 'PRODUCT_WORK_TURN_ID_INVALID');
  integer(value.turnVersion, 'PRODUCT_WORK_TURN_VERSION_INVALID');
}

export function parseProductWorkTurnCommand(
  value: unknown,
): ProductWorkTurnCommand {
  if (!record(value)) throw new Error('PRODUCT_WORK_TURN_COMMAND_INVALID');
  exactFields(
    value,
    [
      'schemaVersion',
      'commandId',
      'commandType',
      'leaseUntil',
      'attempt',
      'afterSequence',
      'payload',
    ],
    'PRODUCT_WORK_TURN_COMMAND_FIELDS_INVALID',
  );
  if (value.schemaVersion !== PRODUCT_WORK_TURN_COMMAND_VERSION) {
    throw new Error('PRODUCT_WORK_TURN_COMMAND_VERSION_UNSUPPORTED');
  }
  if (
    !PRODUCT_WORK_TURN_COMMAND_TYPES.includes(
      value.commandType as ProductWorkTurnCommandType,
    )
  ) {
    throw new Error('PRODUCT_WORK_TURN_COMMAND_TYPE_UNSUPPORTED');
  }
  boundedString(value.commandId, 'PRODUCT_WORK_TURN_COMMAND_ID_INVALID');
  timestamp(value.leaseUntil, 'PRODUCT_WORK_TURN_COMMAND_LEASE_INVALID');
  integer(value.attempt, 'PRODUCT_WORK_TURN_COMMAND_ATTEMPT_INVALID', 1);
  integer(value.afterSequence, 'PRODUCT_WORK_TURN_EVENT_SEQUENCE_INVALID');
  if (!record(value.payload)) {
    throw new Error('PRODUCT_WORK_TURN_COMMAND_PAYLOAD_INVALID');
  }
  if (value.commandType === 'START_PRODUCT_WORK_TURN') {
    parseStartPayload(value.payload);
  } else {
    parseControlPayload(value.payload);
  }
  return value as unknown as ProductWorkTurnCommand;
}

export function parseProductWorkTurnContext(
  value: unknown,
): ProductWorkTurnContext {
  if (!record(value)) throw new Error('PRODUCT_WORK_TURN_CONTEXT_INVALID');
  exactFields(
    value,
    [
      'schemaVersion',
      'protocolVersion',
      'commandId',
      'sessionId',
      'turnId',
      'contextHash',
      'userMessage',
      'contextItems',
      'skill',
    ],
    'PRODUCT_WORK_TURN_CONTEXT_FIELDS_INVALID',
  );
  if (
    value.schemaVersion !== PRODUCT_WORK_TURN_CONTEXT_VERSION ||
    value.protocolVersion !== PRODUCT_WORK_TURN_PROTOCOL_VERSION
  ) {
    throw new Error('PRODUCT_WORK_TURN_CONTEXT_VERSION_UNSUPPORTED');
  }
  boundedString(value.commandId, 'PRODUCT_WORK_TURN_COMMAND_ID_INVALID');
  boundedString(value.sessionId, 'PRODUCT_WORK_TURN_SESSION_ID_INVALID');
  boundedString(value.turnId, 'PRODUCT_WORK_TURN_ID_INVALID');
  contentHash(value.contextHash, 'PRODUCT_WORK_TURN_CONTEXT_HASH_INVALID');
  const userMessage = boundedString(
    value.userMessage,
    'PRODUCT_WORK_TURN_MESSAGE_INVALID',
    8_000,
  );
  if (
    !Array.isArray(value.contextItems) ||
    value.contextItems.length < 1 ||
    value.contextItems.length > 50
  ) {
    throw new Error('PRODUCT_WORK_TURN_CONTEXT_ITEMS_INVALID');
  }
  let contentBytes = Buffer.byteLength(userMessage, 'utf8');
  const bindingIds = new Set<string>();
  for (const item of value.contextItems) {
    if (!record(item))
      throw new Error('PRODUCT_WORK_TURN_CONTEXT_ITEM_INVALID');
    exactFields(
      item,
      [
        'bindingId',
        'contextType',
        'targetId',
        'targetVersion',
        'contentHash',
        'sensitivity',
        'content',
      ],
      'PRODUCT_WORK_TURN_CONTEXT_ITEM_FIELDS_INVALID',
    );
    const bindingId = boundedString(
      item.bindingId,
      'PRODUCT_WORK_TURN_CONTEXT_BINDING_ID_INVALID',
    );
    if (bindingIds.has(bindingId)) {
      throw new Error('PRODUCT_WORK_TURN_CONTEXT_BINDING_DUPLICATE');
    }
    bindingIds.add(bindingId);
    boundedString(
      item.contextType,
      'PRODUCT_WORK_TURN_CONTEXT_TYPE_INVALID',
      80,
    );
    boundedString(item.targetId, 'PRODUCT_WORK_TURN_CONTEXT_TARGET_INVALID');
    if (item.targetVersion !== null) {
      integer(item.targetVersion, 'PRODUCT_WORK_TURN_CONTEXT_VERSION_INVALID');
    }
    contentHash(item.contentHash, 'PRODUCT_WORK_TURN_CONTENT_HASH_INVALID');
    if (
      !['PUBLIC', 'INTERNAL', 'RESTRICTED'].includes(String(item.sensitivity))
    ) {
      throw new Error('PRODUCT_WORK_TURN_SENSITIVITY_INVALID');
    }
    const content = boundedString(
      item.content,
      'PRODUCT_WORK_TURN_CONTEXT_CONTENT_INVALID',
      262_144,
    );
    contentBytes += Buffer.byteLength(content, 'utf8');
  }
  if (contentBytes > 262_144) {
    throw new Error('PRODUCT_WORK_TURN_CONTEXT_SIZE_EXCEEDED');
  }
  if (!record(value.skill)) throw new Error('PRODUCT_WORK_TURN_SKILL_INVALID');
  exactFields(
    value.skill,
    ['releaseId', 'contentHash'],
    'PRODUCT_WORK_TURN_SKILL_FIELDS_INVALID',
  );
  boundedString(
    value.skill.releaseId,
    'PRODUCT_WORK_TURN_SKILL_RELEASE_ID_INVALID',
  );
  contentHash(
    value.skill.contentHash,
    'PRODUCT_WORK_TURN_SKILL_CONTENT_HASH_INVALID',
  );
  return value as unknown as ProductWorkTurnContext;
}

function parseEventPayload(
  eventType: ProductWorkTurnEventType,
  value: Record<string, unknown>,
): void {
  if (eventType === 'TURN_STARTED') {
    exactFields(
      value,
      ['threadId', 'turnId'],
      'PRODUCT_WORK_TURN_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    boundedString(value.threadId, 'PRODUCT_WORK_TURN_EXTERNAL_ID_INVALID');
    boundedString(value.turnId, 'PRODUCT_WORK_TURN_EXTERNAL_ID_INVALID');
    return;
  }
  if (eventType === 'TURN_MESSAGE_AVAILABLE') {
    exactFields(
      value,
      ['message'],
      'PRODUCT_WORK_TURN_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    boundedString(
      value.message,
      'PRODUCT_WORK_TURN_EVENT_MESSAGE_INVALID',
      8_192,
    );
    return;
  }
  if (eventType === 'TURN_PROPOSAL_AVAILABLE') {
    exactFields(
      value,
      ['proposal'],
      'PRODUCT_WORK_TURN_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    if (!record(value.proposal)) {
      throw new Error('PRODUCT_WORK_TURN_EVENT_PROPOSAL_INVALID');
    }
    return;
  }
  if (eventType === 'TURN_COMPLETED' || eventType === 'TURN_CANCELLED') {
    exactFields(
      value,
      ['status'],
      'PRODUCT_WORK_TURN_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    const expected = eventType === 'TURN_COMPLETED' ? 'COMPLETED' : 'CANCELLED';
    if (value.status !== expected) {
      throw new Error('PRODUCT_WORK_TURN_EVENT_STATUS_INVALID');
    }
    return;
  }
  exactFields(
    value,
    ['reasonCode'],
    'PRODUCT_WORK_TURN_EVENT_PAYLOAD_FIELDS_INVALID',
  );
  boundedString(value.reasonCode, 'PRODUCT_WORK_TURN_EVENT_REASON_INVALID');
}

export function parseProductWorkTurnEvent(
  value: unknown,
): ProductWorkTurnEvent {
  if (!record(value)) throw new Error('PRODUCT_WORK_TURN_EVENT_INVALID');
  exactFields(
    value,
    [
      'schemaVersion',
      'sourceEventId',
      'eventType',
      'expectedSequence',
      'occurredAt',
      'payload',
    ],
    'PRODUCT_WORK_TURN_EVENT_FIELDS_INVALID',
  );
  if (value.schemaVersion !== PRODUCT_WORK_TURN_EVENT_VERSION) {
    throw new Error('PRODUCT_WORK_TURN_EVENT_VERSION_UNSUPPORTED');
  }
  if (
    !PRODUCT_WORK_TURN_EVENT_TYPES.includes(
      value.eventType as ProductWorkTurnEventType,
    )
  ) {
    throw new Error('PRODUCT_WORK_TURN_EVENT_TYPE_UNSUPPORTED');
  }
  boundedString(
    value.sourceEventId,
    'PRODUCT_WORK_TURN_SOURCE_EVENT_ID_INVALID',
  );
  integer(
    value.expectedSequence,
    'PRODUCT_WORK_TURN_EVENT_SEQUENCE_INVALID',
    1,
  );
  timestamp(value.occurredAt, 'PRODUCT_WORK_TURN_EVENT_TIMESTAMP_INVALID');
  if (!record(value.payload)) {
    throw new Error('PRODUCT_WORK_TURN_EVENT_PAYLOAD_INVALID');
  }
  parseEventPayload(value.eventType as ProductWorkTurnEventType, value.payload);
  return value as unknown as ProductWorkTurnEvent;
}
