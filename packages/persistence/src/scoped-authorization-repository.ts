import type { ScopedActionAuthorization } from '@pfc/contracts';
import { revokeScopedActionAuthorization } from '@pfc/domain';

import type { LifecycleKysely } from './database.ts';

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class PostgresScopedAuthorizationRepository {
  private readonly db: ReturnType<LifecycleKysely['withSchema']>;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async grant(authorization: ScopedActionAuthorization): Promise<void> {
    if (
      authorization.status !== 'GRANTED' ||
      authorization.materialRefIds.length === 0
    ) {
      throw new Error('INVALID_SCOPED_AUTHORIZATION_GRANT');
    }
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('scoped_action_authorizations')
        .values({
          id: authorization.authorizationId,
          actor_id: authorization.actorId,
          requirement_id: authorization.requirementId,
          action: 'TRANSMIT_MATERIAL',
          target: authorization.target,
          purpose: authorization.purpose,
          scope_hash: authorization.scopeHash,
          status: authorization.status,
          valid_from: authorization.validFrom,
          valid_until: authorization.validUntil,
          granted_by: authorization.grantedBy,
          granted_at: authorization.grantedAt,
          revoked_by: authorization.revokedBy,
          revoked_at: authorization.revokedAt,
          row_version: authorization.rowVersion,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('scoped_action_authorization_material_refs')
        .values(
          authorization.materialRefIds.map((materialRefId) => ({
            authorization_id: authorization.authorizationId,
            material_ref_id: materialRefId,
          })),
        )
        .execute();
    });
  }

  async find(
    authorizationId: string,
  ): Promise<ScopedActionAuthorization | null> {
    const row = await this.db
      .selectFrom('scoped_action_authorizations')
      .selectAll()
      .where('id', '=', authorizationId)
      .executeTakeFirst();
    if (!row) return null;
    const materialRefs = await this.db
      .selectFrom('scoped_action_authorization_material_refs')
      .select('material_ref_id')
      .where('authorization_id', '=', authorizationId)
      .orderBy('material_ref_id')
      .execute();
    return {
      authorizationId: row.id,
      actorId: row.actor_id,
      requirementId: row.requirement_id,
      action: row.action,
      target: row.target,
      purpose: row.purpose,
      materialRefIds: materialRefs.map((item) => item.material_ref_id),
      scopeHash: row.scope_hash,
      status: row.status,
      validFrom: timestamp(row.valid_from),
      validUntil: timestamp(row.valid_until),
      grantedBy: row.granted_by,
      grantedAt: timestamp(row.granted_at),
      revokedBy: row.revoked_by,
      revokedAt: row.revoked_at ? timestamp(row.revoked_at) : null,
      rowVersion: row.row_version,
    };
  }

  async listCurrent(input: {
    actorId: string;
    requirementId: string;
    at: string;
  }): Promise<readonly ScopedActionAuthorization[]> {
    const rows = await this.db
      .selectFrom('scoped_action_authorizations')
      .select('id')
      .where('actor_id', '=', input.actorId)
      .where('requirement_id', '=', input.requirementId)
      .where('status', '=', 'GRANTED')
      .where('valid_from', '<=', new Date(input.at))
      .where('valid_until', '>=', new Date(input.at))
      .orderBy('valid_until')
      .execute();
    return (await Promise.all(rows.map((row) => this.find(row.id)))).filter(
      (item): item is ScopedActionAuthorization => item !== null,
    );
  }

  async revoke(input: {
    authorizationId: string;
    expectedRowVersion: number;
    revokedBy: string;
    revokedAt: string;
  }): Promise<ScopedActionAuthorization> {
    const current = await this.find(input.authorizationId);
    if (!current) throw new Error('SCOPED_AUTHORIZATION_NOT_FOUND');
    if (current.rowVersion !== input.expectedRowVersion) {
      throw new Error('SCOPED_AUTHORIZATION_VERSION_CONFLICT');
    }
    const revoked = revokeScopedActionAuthorization(current, input);
    const result = await this.db
      .updateTable('scoped_action_authorizations')
      .set({
        status: revoked.status,
        revoked_by: revoked.revokedBy,
        revoked_at: revoked.revokedAt,
        row_version: revoked.rowVersion,
      })
      .where('id', '=', input.authorizationId)
      .where('row_version', '=', input.expectedRowVersion)
      .executeTakeFirstOrThrow();
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error('SCOPED_AUTHORIZATION_VERSION_CONFLICT');
    }
    return revoked;
  }
}
