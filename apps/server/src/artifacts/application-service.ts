import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  AppendArtifactVersionRequest,
  ArtifactDto,
  ArtifactVersionContentDto,
  ArtifactVersionDto,
  RegisterArtifactRequest,
} from '@pfc/contracts';
import {
  appendArtifactVersion,
  createArtifactCatalogEntry,
  createArtifactVersionContent,
  DomainRuleViolation,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type { ArtifactRepositoryPort } from './repository-port.ts';

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function prepareVersion(
  request: AppendArtifactVersionRequest,
  input: { versionId: string; actorId: string; occurredAt: string },
): { version: ArtifactVersionDto; content?: ArtifactVersionContentDto } {
  const hasContent = typeof request.content === 'string';
  if (hasContent && (!request.mediaType || request.contentHash !== undefined)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Text versions require mediaType and server-computed contentHash.',
    );
  }
  if (
    !hasContent &&
    (!request.contentHash || request.mediaType !== undefined)
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Reference versions require contentHash and no mediaType.',
    );
  }
  const contentHash = hasContent
    ? `sha256:${createHash('sha256').update(request.content!).digest('hex')}`
    : request.contentHash!;
  const version: ArtifactVersionDto = {
    id: input.versionId,
    artifactId: '',
    versionLabel: request.versionLabel,
    sourceType: request.sourceType,
    sourceRef: request.sourceRef,
    contentHash,
    sensitivity: request.sensitivity,
    createdBy: input.actorId,
    createdAt: input.occurredAt,
  };
  if (!hasContent) return { version };
  try {
    return {
      version,
      content: createArtifactVersionContent({
        artifactVersionId: input.versionId,
        mediaType: request.mediaType!,
        content: request.content!,
        contentHash,
        createdAt: input.occurredAt,
      }),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'ARTIFACT_CONTENT_TOO_LARGE',
        'ARTIFACT_CONTENT_TOO_MANY_LINES',
      ].includes(error.message)
    ) {
      throw new DomainRuleViolation(
        'ARTIFACT_CONTENT_TOO_LARGE',
        'Artifact content exceeds the archive limit.',
      );
    }
    throw error;
  }
}

export class ArtifactApplicationService {
  constructor(
    private readonly repository: ArtifactRepositoryPort,
    private readonly authorization: RequirementAuthorizationService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly idFactory: (prefix: string) => string = (prefix) =>
      `${prefix}-${randomUUID()}`,
  ) {}

  private async assertAccess(
    actor: ActorContext,
    requirementId: string,
    action: 'VIEW_ARTIFACT' | 'REGISTER_ARTIFACT' | 'APPEND_ARTIFACT_VERSION',
  ): Promise<void> {
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity: 'RESTRICTED',
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Artifact access denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  async list(
    actor: ActorContext,
    requirementId: string,
  ): Promise<readonly ArtifactDto[]> {
    await this.assertAccess(actor, requirementId, 'VIEW_ARTIFACT');
    return this.repository.listArtifacts(requirementId);
  }

  async create(input: {
    actor: ActorContext;
    requirementId: string;
    request: RegisterArtifactRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ replayed: boolean; artifact: ArtifactDto }> {
    await this.assertAccess(
      input.actor,
      input.requirementId,
      'REGISTER_ARTIFACT',
    );
    const occurredAt = this.now();
    const artifactId = this.idFactory('artifact');
    const versionId = this.idFactory('artifact-version');
    const prepared = prepareVersion(input.request, {
      versionId,
      actorId: input.actor.actorId,
      occurredAt,
    });
    const entry = createArtifactCatalogEntry({
      id: artifactId,
      requirementId: input.requirementId,
      capId: input.request.capId,
      stage: input.request.stage,
      artifactType: input.request.artifactType,
      title: input.request.title,
      status: 'ACTIVE',
      version: {
        ...prepared.version,
      },
      createdAt: occurredAt,
    });
    const version: ArtifactVersionDto = {
      ...entry.versions[0]!,
      artifactId,
    };
    const route = `/api/v1/requirements/${input.requirementId}/artifacts`;
    const result = await this.repository.createArtifact({
      artifact: {
        id: entry.id,
        requirementId: entry.requirementId,
        capId: entry.capId,
        stage: entry.stage,
        artifactType: entry.artifactType,
        title: entry.title,
        status: entry.status,
        rowVersion: entry.rowVersion,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
      version,
      content: prepared.content,
      actorId: input.actor.actorId,
      route,
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash(input.request),
      idempotencyId: this.idFactory('idempotency'),
      eventId: this.idFactory('timeline'),
      outboxId: this.idFactory('outbox'),
      auditId: this.idFactory('audit'),
      requestId: input.requestId,
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (!result.artifact) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Artifact result is unknown.',
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      artifact: result.artifact,
    };
  }

  async appendVersion(input: {
    actor: ActorContext;
    artifactId: string;
    request: AppendArtifactVersionRequest;
    expectedRowVersion: number;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ replayed: boolean; artifact: ArtifactDto }> {
    const current = await this.repository.findArtifactById(input.artifactId);
    if (!current)
      throw new DomainRuleViolation('NOT_FOUND', 'Artifact not found.');
    await this.assertAccess(
      input.actor,
      current.requirementId,
      'APPEND_ARTIFACT_VERSION',
    );
    const versionId = this.idFactory('artifact-version');
    const occurredAt = this.now();
    const prepared = prepareVersion(input.request, {
      versionId,
      actorId: input.actor.actorId,
      occurredAt,
    });
    const candidate = {
      id: prepared.version.id,
      versionLabel: prepared.version.versionLabel,
      sourceType: prepared.version.sourceType,
      sourceRef: prepared.version.sourceRef,
      contentHash: prepared.version.contentHash,
      sensitivity: prepared.version.sensitivity,
      createdBy: prepared.version.createdBy,
      createdAt: prepared.version.createdAt,
    };
    appendArtifactVersion(
      {
        id: current.id,
        requirementId: current.requirementId,
        capId: current.capId,
        stage: current.stage,
        artifactType: current.artifactType,
        title: current.title,
        status: current.status,
        currentVersionId: current.currentVersionId,
        rowVersion: current.rowVersion,
        versions: current.versions.map((version) => ({
          id: version.id,
          versionLabel: version.versionLabel,
          sourceType: version.sourceType,
          sourceRef: version.sourceRef,
          contentHash: version.contentHash,
          sensitivity: version.sensitivity,
          createdBy: version.createdBy,
          createdAt: version.createdAt,
        })),
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      },
      candidate,
    );
    const result = await this.repository.appendVersion({
      artifactId: current.id,
      requirementId: current.requirementId,
      expectedRowVersion: input.expectedRowVersion,
      version: { ...candidate, artifactId: current.id },
      content: prepared.content,
      actorId: input.actor.actorId,
      route: `/api/v1/artifacts/${current.id}/versions`,
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash({
        expectedRowVersion: input.expectedRowVersion,
        request: input.request,
      }),
      idempotencyId: this.idFactory('idempotency'),
      eventId: this.idFactory('timeline'),
      outboxId: this.idFactory('outbox'),
      auditId: this.idFactory('audit'),
      requestId: input.requestId,
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (result.status === 'VERSION_CONFLICT') {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Artifact version conflict.',
        {
          currentVersion: current.rowVersion,
        },
      );
    }
    if (!result.artifact) {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'Artifact result is unknown.',
      );
    }
    return {
      replayed: result.status === 'REPLAYED',
      artifact: result.artifact,
    };
  }
}
