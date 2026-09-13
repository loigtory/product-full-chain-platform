'use strict';
const tables = [
  'test_suites',
  'test_cases',
  'delivery_baselines',
  'test_batches',
  'test_results',
  'defects',
  'defect_events',
  'product_acceptances',
  'verification_refs',
];
const triggers = [
  'test_suites_immutable',
  'test_cases_immutable',
  'delivery_baselines_immutable',
  'test_results_immutable',
  'defect_events_immutable',
  'product_acceptances_immutable',
  'verification_refs_immutable',
  'test_batches_header',
  'defects_header',
  'verification_version_immutable',
  'verification_reference_owner',
  'verification_baseline_kind',
];
const error = () =>
  Object.assign(new Error('MIGRATION_NOT_READY'), {
    code: 'MIGRATION_NOT_READY',
  });
async function assertReady(db, client) {
  const columns = (
    await client.query(
      'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1',
      [db.schema],
    )
  ).rows;
  const required = {
    reqs: [
      'current_test_suite_id',
      'current_delivery_baseline_id',
      'verification_epoch',
    ],
    test_suites: [
      'group_id',
      'parent_id',
      'version',
      'status',
      'gaps',
      'fingerprint',
    ],
    test_cases: ['suite_id', 'case_id', 'ordinal', 'content'],
    delivery_baselines: [
      'suite_id',
      'group_id',
      'dev_version_id',
      'business_confirmation_id',
      'design_confirmation_id',
      'verification_epoch',
      'snapshot',
      'subject',
      'fingerprint',
    ],
    test_batches: [
      'baseline_id',
      'suite_id',
      'state',
      'source',
      'report_version_id',
      'finalized_at',
      'cancel_reason',
    ],
    test_results: [
      'batch_id',
      'suite_id',
      'case_id',
      'sequence',
      'previous_result_id',
      'status',
      'source',
      'actual',
      'executed_at',
      'registered_by',
    ],
    defects: [
      'source_result_id',
      'case_id',
      'state',
      'resolved_dev_version_id',
    ],
    defect_events: [
      'defect_id',
      'sequence',
      'state',
      'result_id',
      'dev_version_id',
      'member_id',
    ],
    product_acceptances: [
      'baseline_id',
      'batch_id',
      'report_version_id',
      'decision',
      'checks',
      'snapshot',
      'member_id',
    ],
    verification_refs: [
      'material_version_id',
      'baseline_id',
      'result_id',
      'defect_event_id',
      'acceptance_id',
      'source_data',
    ],
  };
  for (const [table, fields] of Object.entries(required))
    for (const field of fields)
      if (
        !columns.some((c) => c.table_name === table && c.column_name === field)
      )
        throw error();
  const constraints = (
    await client.query(
      'SELECT c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1',
      [db.schema],
    )
  ).rows;
  for (const table of tables)
    for (const type of ['p', 'f', 'c', 'u'])
      if (
        !constraints.some(
          (c) => c.relname === table && c.contype === type && c.convalidated,
        )
      )
        throw error();
  for (const [table, fields] of [
    ['test_results', ['batch_id', 'suite_id']],
    ['test_results', ['suite_id', 'case_id']],
    ['delivery_baselines', ['suite_id', 'group_id']],
    ['product_acceptances', ['batch_id', 'baseline_id']],
  ])
    if (
      !constraints.some(
        (c) =>
          c.relname === table &&
          c.contype === 'f' &&
          c.convalidated &&
          fields.every((f) => c.definition.includes(f)),
      )
    )
      throw error();
  const stage = constraints.find(
    (c) => c.relname === 'messages' && c.conname === 'messages_stage_check',
  );
  if (
    !stage?.convalidated ||
    !['test', 'accept', 'release'].every((x) =>
      stage.definition.includes("'" + x + "'"),
    )
  )
    throw error();
  const rows = (
    await client.query(
      'SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal',
      [db.schema],
    )
  ).rows;
  for (const name of triggers)
    if (!rows.some((t) => t.tgname === name && t.tgenabled === 'O'))
      throw error();
}
module.exports = { tables, triggers, assertReady };
