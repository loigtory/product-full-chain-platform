import type {
  ArtifactDto,
  ArtifactVersionContentDto,
  ArtifactEvidencePort,
  ArtifactEvidenceRequest,
  ArtifactVersionDto,
  CapabilityResult,
  EvidenceDescriptor,
} from '@pfc/contracts';
import type { Transaction } from 'kysely';

import type { LifecycleDatabase, LifecycleKysely } from './database.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;
type ScopedTransaction = Transaction<LifecycleDatabase>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapVersion(row: {
  id: string;
  artifact_id: string;
  version_label: string;
  source_type: ArtifactVersionDto['sourceType'];
  source_ref: string;
  content_hash: string;
  sensitivity: ArtifactVersionDto['sensitivity'];
  created_by: string;
  created_at: Date | string;
}): ArtifactVersionDto {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    versionLabel: row.version_label,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    contentHash: row.content_hash,
    sensitivity: row.sensitivity,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
  };
}

export type ArtifactMutationResult = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'CONFLICT' | 'VERSION_CONFLICT';
  artifact: ArtifactDto | null;
}>;

export class PostgresArtifactRepository implements ArtifactEvidencePort {
  private readonly db: ScopedDatabase;

  constructor(
    database: LifecycleKysely,
    schemaName = 'pfc',
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.db = database.withSchema(schemaName);
  }

  async listEvidence(
    request: ArtifactEvidenceRequest,
  ): Promise<CapabilityResult<readonly EvidenceDescriptor[]>> {
    const checkedAt = this.now();
    if (request.evidenceRefIds.length === 0) {
      return {
        status: 'AVAILABLE',
        source: 'POSTGRESQL',
        capabilityVersion: 'pfc-artifact-evidence/v1',
        checkedAt,
        data: [],
      };
    }
    const rows = await this.db
      .selectFrom('artifact_versions')
      .innerJoin('artifacts', 'artifacts.id', 'artifact_versions.artifact_id')
      .innerJoin('requirements', 'requirements.id', 'artifacts.requirement_id')
      .innerJoin(
        'material_baselines',
        'material_baselines.id',
        'requirements.current_baseline_id',
      )
      .select([
        'artifact_versions.id as evidence_ref_id',
        'artifact_versions.sensitivity',
      ])
      .where('artifacts.requirement_id', '=', request.requirementId)
      .where('artifacts.status', '=', 'ACTIVE')
      .where('requirements.current_baseline_id', '=', request.baselineId)
      .where('material_baselines.requirement_id', '=', request.requirementId)
      .where('material_baselines.status', '=', 'CURRENT')
      .whereRef(
        'artifact_versions.created_at',
        '>=',
        'material_baselines.confirmed_at',
      )
      .where('artifact_versions.id', 'in', [...request.evidenceRefIds])
      .orderBy('artifact_versions.created_at')
      .execute();
    return {
      status: 'AVAILABLE',
      source: 'POSTGRESQL',
      capabilityVersion: 'pfc-artifact-evidence/v1',
      checkedAt,
      data: rows.map((row) => ({
        evidenceRefId: row.evidence_ref_id,
        baselineId: request.baselineId,
        referenceType: 'ARTIFACT_VERSION',
        sensitivity: row.sensitivity,
        validity: 'VALID',
      })),
    };
  }

  private async findArtifactUsing(
    database: ScopedDatabase | ScopedTransaction,
    artifactId: string,
  ): Promise<ArtifactDto | null> {
    const row = await database
      .selectFrom('artifacts')
      .selectAll()
      .where('id', '=', artifactId)
      .executeTakeFirst();
    if (!row || !row.current_version_id) return null;
    const versions = await database
      .selectFrom('artifact_versions')
      .selectAll()
      .where('artifact_id', '=', artifactId)
      .orderBy('created_at')
      .execute();
    return {
      id: row.id,
      requirementId: row.requirement_id,
      capId: row.cap_id,
      stage: row.stage,
      artifactType: row.artifact_type,
      title: row.title,
      status: row.status,
      currentVersionId: row.current_version_id,
      rowVersion: row.row_version,
      versions: versions.map(mapVersion),
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }

  async findArtifactById(artifactId: string): Promise<ArtifactDto | null> {
    return this.findArtifactUsing(this.db, artifactId);
  }

  async listArtifacts(requirementId: string): Promise<readonly ArtifactDto[]> {
    const rows = await this.db
      .selectFrom('artifacts')
      .select('id')
      .where('requirement_id', '=', requirementId)
      .orderBy('stage')
      .orderBy('artifact_type')
      .execute();
    return (
      await Promise.all(
        rows.map(({ id }) => this.findArtifactUsing(this.db, id)),
      )
    ).filter((item): item is ArtifactDto => item !== null);
  }

  private async idempotencyStatus(
    transaction: ScopedTransaction,
    input: {
      actorId: string;
      route: string;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<{
    status: 'NEW' | 'REPLAYED' | 'CONFLICT';
    resultReference: string | null;
  }> {
    const existing = await transaction
      .selectFrom('idempotency_records')
      .select(['request_hash', 'result_reference'])
      .where('actor_id', '=', input.actorId)
      .where('route', '=', input.route)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    if (!existing) return { status: 'NEW', resultReference: null };
    return {
      status:
        existing.request_hash === input.requestHash ? 'REPLAYED' : 'CONFLICT',
      resultReference: existing.result_reference,
    };
  }

  private async appendEvidence(input: {
    transaction: ScopedTransaction;
    actorId: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
    idempotencyId: string;
    artifactId: string;
    requirementId: string;
    artifactVersion: number;
    eventId: string;
    outboxId: string;
    auditId: string;
    eventType: string;
    requestId: string;
    occurredAt: string;
  }): Promise<void> {
    const summary = {
      artifactId: input.artifactId,
      requirementId: input.requirementId,
      rowVersion: input.artifactVersion,
    };
    await input.transaction
      .insertInto('timeline_events')
      .values({
        id: input.eventId,
        requirement_id: input.requirementId,
        aggregate_type: 'artifact',
        aggregate_id: input.artifactId,
        event_type: input.eventType,
        actor_id: input.actorId,
        before_summary: null,
        after_summary: summary,
        aggregate_version: input.artifactVersion,
        occurred_at: input.occurredAt,
      })
      .execute();
    await input.transaction
      .insertInto('outbox_events')
      .values({
        id: input.outboxId,
        event_type: input.eventType,
        aggregate_type: 'artifact',
        aggregate_id: input.artifactId,
        aggregate_version: input.artifactVersion,
        payload_summary: summary,
        status: 'PENDING',
        occurred_at: input.occurredAt,
        published_at: null,
      })
      .execute();
    await input.transaction
      .insertInto('audit_events')
      .values({
        id: input.auditId,
        actor_id: input.actorId,
        action: input.eventType,
        target_type: 'artifact',
        target_id: input.artifactId,
        decision: 'ALLOW',
        reason: null,
        scope_summary: summary,
        request_id: input.requestId,
        occurred_at: input.occurredAt,
      })
      .execute();
    await input.transaction
      .insertInto('idempotency_records')
      .values({
        id: input.idempotencyId,
        actor_id: input.actorId,
        route: input.route,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        result_reference: input.artifactId,
        response_summary: {
          status: 'CREATED',
          rowVersion: input.artifactVersion,
        },
      })
      .execute();
  }

  async createArtifact(input: {
    artifact: Omit<ArtifactDto, 'currentVersionId' | 'versions'>;
    version: ArtifactVersionDto;
    content?: ArtifactVersionContentDto;
    actorId: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
    idempotencyId: string;
    eventId: string;
    outboxId: string;
    auditId: string;
    requestId: string;
  }): Promise<ArtifactMutationResult> {
    return this.db.transaction().execute(async (transaction) => {
      const idempotency = await this.idempotencyStatus(transaction, input);
      if (idempotency.status !== 'NEW') {
        return {
          status: idempotency.status,
          artifact:
            idempotency.status === 'REPLAYED' && idempotency.resultReference
              ? await this.findArtifactUsing(
                  transaction,
                  idempotency.resultReference,
                )
              : null,
        };
      }
      await transaction
        .insertInto('artifacts')
        .values({
          id: input.artifact.id,
          requirement_id: input.artifact.requirementId,
          cap_id: input.artifact.capId,
          stage: input.artifact.stage,
          artifact_type: input.artifact.artifactType,
          title: input.artifact.title,
          status: input.artifact.status,
          current_version_id: null,
          row_version: 0,
          created_at: input.artifact.createdAt,
          updated_at: input.artifact.updatedAt,
        })
        .execute();
      await transaction
        .insertInto('artifact_versions')
        .values({
          id: input.version.id,
          artifact_id: input.artifact.id,
          version_label: input.version.versionLabel,
          source_type: input.version.sourceType,
          source_ref: input.version.sourceRef,
          content_hash: input.version.contentHash,
          sensitivity: input.version.sensitivity,
          created_by: input.version.createdBy,
          created_at: input.version.createdAt,
        })
        .execute();
      if (input.content) {
        await transaction
          .insertInto('artifact_version_contents')
          .values({
            artifact_version_id: input.content.artifactVersionId,
            media_type: input.content.mediaType,
            availability: input.content.availability,
            content_text: input.content.content,
            content_hash: input.content.contentHash,
            byte_size: input.content.byteSize,
            line_count: input.content.lineCount,
            created_at: input.content.createdAt,
          })
          .execute();
      }
      await transaction
        .updateTable('artifacts')
        .set({ current_version_id: input.version.id })
        .where('id', '=', input.artifact.id)
        .execute();
      await this.appendEvidence({
        ...input,
        transaction,
        artifactId: input.artifact.id,
        requirementId: input.artifact.requirementId,
        artifactVersion: 0,
        eventType: 'artifact.created',
        occurredAt: input.artifact.createdAt,
      });
      return {
        status: 'CREATED',
        artifact: await this.findArtifactUsing(transaction, input.artifact.id),
      };
    });
  }

  async appendVersion(input: {
    artifactId: string;
    requirementId: string;
    expectedRowVersion: number;
    version: ArtifactVersionDto;
    content?: ArtifactVersionContentDto;
    actorId: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
    idempotencyId: string;
    eventId: string;
    outboxId: string;
    auditId: string;
    requestId: string;
  }): Promise<ArtifactMutationResult> {
    return this.db.transaction().execute(async (transaction) => {
      const idempotency = await this.idempotencyStatus(transaction, input);
      if (idempotency.status !== 'NEW') {
        return {
          status: idempotency.status,
          artifact:
            idempotency.status === 'REPLAYED' && idempotency.resultReference
              ? await this.findArtifactUsing(
                  transaction,
                  idempotency.resultReference,
                )
              : null,
        };
      }
      const current = await transaction
        .selectFrom('artifacts')
        .select(['row_version', 'requirement_id'])
        .where('id', '=', input.artifactId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current ||
        current.requirement_id !== input.requirementId ||
        current.row_version !== input.expectedRowVersion
      ) {
        return { status: 'VERSION_CONFLICT', artifact: null };
      }
      await transaction
        .insertInto('artifact_versions')
        .values({
          id: input.version.id,
          artifact_id: input.artifactId,
          version_label: input.version.versionLabel,
          source_type: input.version.sourceType,
          source_ref: input.version.sourceRef,
          content_hash: input.version.contentHash,
          sensitivity: input.version.sensitivity,
          created_by: input.version.createdBy,
          created_at: input.version.createdAt,
        })
        .execute();
      if (input.content) {
        await transaction
          .insertInto('artifact_version_contents')
          .values({
            artifact_version_id: input.content.artifactVersionId,
            media_type: input.content.mediaType,
            availability: input.content.availability,
            content_text: input.content.content,
            content_hash: input.content.contentHash,
            byte_size: input.content.byteSize,
            line_count: input.content.lineCount,
            created_at: input.content.createdAt,
          })
          .execute();
      }
      const nextVersion = input.expectedRowVersion + 1;
      const updated = await transaction
        .updateTable('artifacts')
        .set({
          current_version_id: input.version.id,
          row_version: nextVersion,
          updated_at: input.version.createdAt,
        })
        .where('id', '=', input.artifactId)
        .where('requirement_id', '=', input.requirementId)
        .where('row_version', '=', input.expectedRowVersion)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1)
        throw new Error('ARTIFACT_VERSION_UPDATE_LOST');
      await this.appendEvidence({
        ...input,
        transaction,
        artifactVersion: nextVersion,
        eventType: 'artifact.version-added',
        occurredAt: input.version.createdAt,
      });
      return {
        status: 'CREATED',
        artifact: await this.findArtifactUsing(transaction, input.artifactId),
      };
    });
  }
}
