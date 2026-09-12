import { sql } from 'kysely';

import type { LifecycleKysely } from './database.ts';

function assertSchemaName(schemaName: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName)) {
    throw new Error('INVALID_ARTIFACT_EVIDENCE_SCHEMA_NAME');
  }
}

export async function enableArtifactGateEvidence(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertSchemaName(schemaName);
  await sql`alter table ${sql.id(schemaName, 'gate_run_evidence')} drop constraint if exists ${sql.id('gate_run_evidence_ref_baseline_fk')}`.execute(
    database,
  );
  await sql`
    create or replace function ${sql.id(schemaName, 'enforce_gate_evidence_reference')}()
    returns trigger language plpgsql set search_path = ${sql.id(schemaName)}, pg_temp as $function$
    begin
      if exists (
        select 1 from material_refs
        where id = new.evidence_ref_id and baseline_id = new.baseline_id
      ) then
        return new;
      end if;
      if exists (
        select 1
        from artifact_versions version
        join artifacts artifact on artifact.id = version.artifact_id
        join material_baselines baseline
          on baseline.id = new.baseline_id
         and baseline.requirement_id = artifact.requirement_id
        where version.id = new.evidence_ref_id
          and artifact.status = 'ACTIVE'
          and version.created_at >= baseline.confirmed_at
      ) then
        return new;
      end if;
      raise exception using
        errcode = '23503',
        message = 'GATE_EVIDENCE_REFERENCE_INVALID';
    end;
    $function$
  `.execute(database);
  await sql`drop trigger if exists ${sql.id('enforce_gate_evidence_reference')} on ${sql.id(schemaName, 'gate_run_evidence')}`.execute(
    database,
  );
  await sql`create trigger ${sql.id('enforce_gate_evidence_reference')} before insert or update on ${sql.id(schemaName, 'gate_run_evidence')} for each row execute function ${sql.id(schemaName, 'enforce_gate_evidence_reference')}()`.execute(
    database,
  );
}

export async function disableArtifactGateEvidence(
  database: LifecycleKysely,
  schemaName: string,
): Promise<void> {
  assertSchemaName(schemaName);
  await sql`drop trigger if exists ${sql.id('enforce_gate_evidence_reference')} on ${sql.id(schemaName, 'gate_run_evidence')}`.execute(
    database,
  );
  await sql`drop function if exists ${sql.id(schemaName, 'enforce_gate_evidence_reference')}()`.execute(
    database,
  );
  await sql`alter table ${sql.id(schemaName, 'gate_run_evidence')} add constraint ${sql.id('gate_run_evidence_ref_baseline_fk')} foreign key (${sql.id('evidence_ref_id')}, ${sql.id('baseline_id')}) references ${sql.id(schemaName, 'material_refs')} (${sql.id('id')}, ${sql.id('baseline_id')}) on delete restrict`.execute(
    database,
  );
}
