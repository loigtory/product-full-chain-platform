import type {
  AgentAuditEntryDto,
  AgentRunDto,
  SensitivityLevel,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { PostgresAgentRunRepository } from './agent-run-repository.ts';

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function safeSummary(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null ||
        ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );
}

export class PostgresAgentAuditRepository {
  private readonly db;
  private readonly runs: PostgresAgentRunRepository;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
    this.runs = new PostgresAgentRunRepository(database, schemaName);
  }

  findRun(runId: string): Promise<AgentRunDto | null> {
    return this.runs.findRun(runId);
  }

  findRunSensitivity(runId: string): Promise<SensitivityLevel | null> {
    return this.runs.findRunSensitivity(runId);
  }

  async listRunAudit(
    runId: string,
    limit: number,
  ): Promise<readonly AgentAuditEntryDto[]> {
    const approvals = await this.db
      .selectFrom('approval_requests')
      .select('id')
      .where('run_id', '=', runId)
      .execute();
    const targetIds = [runId, ...approvals.map((item) => item.id)];
    const rows = await this.db
      .selectFrom('audit_events')
      .selectAll()
      .where('target_id', 'in', targetIds)
      .orderBy('occurred_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 100))
      .execute();
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      decision: row.decision,
      reason: row.reason,
      scopeSummary: safeSummary(row.scope_summary),
      occurredAt: timestamp(row.occurred_at),
    }));
  }
}
