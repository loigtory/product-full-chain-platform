'use strict';
const tables = [
  'release_plans',
  'release_reviews',
  'release_attempts',
  'release_result_events',
  'release_observations',
  'release_metric_events',
  'release_followups',
  'release_followup_events',
  'final_acceptances',
  'release_returns',
  'release_refs',
];
const triggers = tables
  .flatMap((t) =>
    ['release_plans', 'release_observations'].includes(t)
      ? [t + '_guard', t + '_no_delete']
      : [t + '_immutable'],
  )
  .concat('release_reports_guard', 'release_refs_owner');
async function assertReady(db, c = db.pool) {
  const bad = () => {
    throw Object.assign(Error('MIGRATION_NOT_READY'), {
      code: 'MIGRATION_NOT_READY',
    });
  };
  const constraints = (
    await c.query(
      'SELECT c.relname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1',
      [db.schema],
    )
  ).rows;
  for (const t of tables)
    for (const type of ['p', 'f', 'u', 'c'])
      if (
        !constraints.some(
          (k) => k.relname === t && k.contype === type && k.convalidated,
        )
      )
        bad();
  for (const t of tables)
    if (
      !constraints.some(
        (k) =>
          k.relname === t &&
          k.contype === 'f' &&
          k.definition.includes('tenant_id, req_id'),
      )
    )
      bad();
  const releaseColumns = (
    await c.query(
      'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1',
      [db.schema],
    )
  ).rows;
  const required = {
    release_plans: [
      'version',
      'content',
      'snapshot',
      'fingerprint',
      'release_epoch',
      'review_state',
      'baseline_id',
    ],
    release_reviews: ['plan_id', 'decision', 'comment'],
    release_attempts: ['plan_id', 'review_id', 'kind'],
    release_result_events: [
      'plan_id',
      'attempt_id',
      'previous_event_id',
      'content',
      'status',
      'report_version_id',
    ],
    release_observations: [
      'plan_id',
      'attempt_id',
      'result_id',
      'started_at',
      'ends_at',
      'state',
    ],
    release_metric_events: [
      'observation_id',
      'stream_key',
      'event_sequence',
      'previous_event_id',
      'content',
    ],
    release_followups: ['observation_id', 'content'],
    release_followup_events: [
      'observation_id',
      'followup_id',
      'event_sequence',
      'previous_event_id',
      'content',
    ],
    final_acceptances: [
      'observation_id',
      'decision',
      'content',
      'snapshot',
      'report_version_id',
    ],
    release_returns: ['plan_id', 'return_stage', 'comment', 'release_epoch'],
    release_refs: ['material_version_id', 'source_data'],
  };
  for (const t of tables)
    for (const column of [
      'id',
      'tenant_id',
      'req_id',
      'public_id',
      'created_by',
      'created_name',
      'created_at',
      ...required[t],
    ])
      if (
        !releaseColumns.some(
          (v) => v.table_name === t && v.column_name === column,
        )
      )
        bad();
  const cols = (
    await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='reqs'",
      [db.schema],
    )
  ).rows;
  for (const name of [
    'release_metric_chain_unique',
    'release_metric_chain_owner',
    'release_followup_chain_unique',
    'release_followup_chain_owner',
  ]) {
    const row = (
      await c.query(
        'SELECT convalidated FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname=$1 AND k.conname=$2',
        [db.schema, name],
      )
    ).rows[0];
    if (!row?.convalidated) bad();
  }
  for (const name of [
    'release_epoch',
    'current_release_plan_id',
    'current_release_id',
    'current_observation_id',
  ])
    if (!cols.some((v) => v.column_name === name)) bad();
  const ts = (
    await c.query(
      'SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal',
      [db.schema],
    )
  ).rows;
  for (const name of triggers)
    if (!ts.some((t) => t.tgname === name && t.tgenabled === 'O')) bad();
  if (
    !constraints.some(
      (k) =>
        k.relname === 'messages' &&
        k.contype === 'c' &&
        k.definition.includes('observe'),
    )
  )
    bad();
}
module.exports = { tables, triggers, assertReady };
