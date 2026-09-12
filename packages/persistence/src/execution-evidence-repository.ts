import type {
  ExecutionEvidenceDto,
  ExecutionEvidenceSourceType,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function dto(row: {
  id: string;
  requirement_id: string;
  baseline_id: string;
  source_type: ExecutionEvidenceDto['sourceType'];
  source_id: string;
  outcome: ExecutionEvidenceDto['outcome'];
  safe_summary: string;
  content_hash: string;
  sensitivity: ExecutionEvidenceDto['sensitivity'];
  artifact_version_id: string | null;
  gate_run_id: string | null;
  retention_class: ExecutionEvidenceDto['retentionClass'];
  created_at: Date | string;
}): ExecutionEvidenceDto {
  return {
    schemaVersion: 'execution-evidence/1',
    id: row.id,
    requirementId: row.requirement_id,
    baselineId: row.baseline_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    outcome: row.outcome,
    safeSummary: row.safe_summary,
    contentHash: row.content_hash,
    sensitivity: row.sensitivity,
    artifactVersionId: row.artifact_version_id,
    gateRunId: row.gate_run_id,
    retentionClass: row.retention_class,
    createdAt: timestamp(row.created_at),
  };
}

export class PostgresExecutionEvidenceRepository {
  private readonly db;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async create(evidence: ExecutionEvidenceDto): Promise<ExecutionEvidenceDto> {
    const row = await this.db
      .insertInto('execution_evidence')
      .values({
        id: evidence.id,
        requirement_id: evidence.requirementId,
        baseline_id: evidence.baselineId,
        source_type: evidence.sourceType,
        source_id: evidence.sourceId,
        outcome: evidence.outcome,
        safe_summary: evidence.safeSummary,
        content_hash: evidence.contentHash,
        sensitivity: evidence.sensitivity,
        artifact_version_id: evidence.artifactVersionId,
        gate_run_id: evidence.gateRunId,
        retention_class: evidence.retentionClass,
        created_at: evidence.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return dto(row);
  }

  async list(input: {
    requirementId: string;
    sourceType?: ExecutionEvidenceSourceType;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: readonly ExecutionEvidenceDto[];
    nextCursor: string | null;
  }> {
    let query = this.db
      .selectFrom('execution_evidence')
      .selectAll()
      .where('requirement_id', '=', input.requirementId);
    if (input.sourceType) {
      query = query.where('source_type', '=', input.sourceType);
    }
    if (input.cursor) query = query.where('id', '>', input.cursor);
    const rows = await query
      .orderBy('id')
      .limit(input.limit + 1)
      .execute();
    const selected = rows.slice(0, input.limit);
    return {
      items: selected.map(dto),
      nextCursor:
        rows.length > input.limit ? (selected.at(-1)?.id ?? null) : null,
    };
  }
}
