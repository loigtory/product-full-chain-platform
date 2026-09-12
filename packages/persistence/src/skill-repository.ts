import { SKILL_RELEASE_SCOPES, type SkillReleaseDto } from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mapRelease(
  row: Awaited<ReturnType<ScopedDatabase['selectFrom']>> extends never
    ? never
    : {
        id: string;
        skill_key: string;
        display_name: string;
        description: string;
        source_type: SkillReleaseDto['sourceType'];
        logical_source: string;
        version: string;
        content_hash: string;
        license: string | null;
        compatible_harnesses: unknown;
        required_capabilities: unknown;
        risk_level: SkillReleaseDto['riskLevel'];
        owner: string;
        evaluation_status: SkillReleaseDto['evaluationStatus'];
        enabled_scopes: unknown;
        context_cost: number | null;
        status: SkillReleaseDto['status'];
        created_at: Date | string;
      },
): SkillReleaseDto {
  return {
    id: row.id,
    skillKey: row.skill_key,
    displayName: row.display_name,
    description: row.description,
    sourceType: row.source_type,
    logicalSource: row.logical_source,
    version: row.version,
    contentHash: row.content_hash,
    license: row.license,
    compatibleHarnesses: stringList(row.compatible_harnesses),
    requiredCapabilities: stringList(row.required_capabilities),
    riskLevel: row.risk_level,
    owner: row.owner,
    evaluationStatus: row.evaluation_status,
    enabledScopes: stringList(row.enabled_scopes),
    contextCost: row.context_cost,
    status: row.status,
    createdAt: timestamp(row.created_at),
  };
}

export class PostgresSkillRepository {
  private readonly db: ScopedDatabase;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async registerRelease(input: {
    id: string;
    skillKey: string;
    displayName: string;
    description: string;
    logicalSource: string;
    version: string;
    contentHash: string;
    compatibleHarnesses: readonly string[];
    requiredCapabilities?: readonly string[];
    riskLevel?: SkillReleaseDto['riskLevel'];
    enabledScopes?: readonly string[];
    owner: string;
    now: string;
  }): Promise<SkillReleaseDto> {
    if (
      !input.compatibleHarnesses.length ||
      input.compatibleHarnesses.some(
        (harness) => !/^codex-app-server\/\d+\.\d+$/.test(harness),
      )
    ) {
      throw new Error('SKILL_COMPATIBLE_HARNESS_INVALID');
    }
    const requiredCapabilities = input.requiredCapabilities ?? [
      'READ_WORKSPACE',
    ];
    const enabledScopes = input.enabledScopes ?? ['ARTIFACT_CHECK'];
    if (
      !requiredCapabilities.length ||
      requiredCapabilities.some(
        (capability) => !/^[A-Z][A-Z0-9_]{2,63}$/.test(capability),
      )
    ) {
      throw new Error('SKILL_REQUIRED_CAPABILITY_INVALID');
    }
    if (
      !enabledScopes.length ||
      enabledScopes.some(
        (scope) => !SKILL_RELEASE_SCOPES.includes(scope as never),
      )
    ) {
      throw new Error('SKILL_ENABLED_SCOPE_INVALID');
    }
    const row = await this.db
      .insertInto('skill_releases')
      .values({
        id: input.id,
        skill_key: input.skillKey,
        display_name: input.displayName,
        description: input.description,
        source_type: 'LOCAL_ALLOWLIST',
        logical_source: input.logicalSource,
        version: input.version,
        content_hash: input.contentHash,
        license: null,
        compatible_harnesses: JSON.stringify(input.compatibleHarnesses),
        required_capabilities: JSON.stringify(requiredCapabilities),
        risk_level: input.riskLevel ?? 'LOW',
        owner: input.owner,
        evaluation_status: 'PASSED',
        enabled_scopes: JSON.stringify(enabledScopes),
        context_cost: null,
        status: 'ACTIVE',
        created_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapRelease(row);
  }

  async listActive(): Promise<readonly SkillReleaseDto[]> {
    const rows = await this.db
      .selectFrom('skill_releases')
      .selectAll()
      .where('status', '=', 'ACTIVE')
      .orderBy('skill_key')
      .orderBy('version', 'desc')
      .execute();
    return rows.map(mapRelease);
  }

  async findRelease(
    skillKey: string,
    version: string,
  ): Promise<SkillReleaseDto | null> {
    const row = await this.db
      .selectFrom('skill_releases')
      .selectAll()
      .where('skill_key', '=', skillKey)
      .where('version', '=', version)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return row ? mapRelease(row) : null;
  }
}
