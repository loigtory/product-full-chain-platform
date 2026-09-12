import pg from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();
let runId = process.argv[2]?.trim();

if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
if (!runId) throw new Error('RUN_ID_REQUIRED');

const client = new pg.Client({ connectionString });
await client.connect();

try {
  if (runId === 'latest') {
    const latest = await client.query<{ id: string }>(
      `select id
         from pfc.agent_runs
        where id like 'CODEx_TEST_M2_R1_REAL_20260906_agent-run-%'
        order by created_at desc
        limit 1`,
    );
    runId = latest.rows[0]?.id;
    if (!runId) throw new Error('M2_RUN_NOT_FOUND');
  }
  const events = await client.query<{
    sequence: number;
    event_type: string;
    has_thread_id: boolean;
    has_turn_id: boolean;
    has_text: boolean;
  }>(
    `select sequence,
            event_type,
            summary ? 'threadId' as has_thread_id,
            summary ? 'turnId' as has_turn_id,
            summary ? 'text' as has_text
       from pfc.agent_run_events
      where run_id = $1
      order by sequence`,
    [runId],
  );
  const commands = await client.query<{
    id: string;
    status: string;
    attempt: number;
    lease_expired: boolean;
    result_status: string | null;
    reason_code: string | null;
  }>(
    `select id,
            status,
            attempt,
            lease_until < clock_timestamp() as lease_expired,
            result_summary ->> 'status' as result_status,
            result_summary ->> 'reasonCode' as reason_code
       from pfc.agent_run_commands
      where run_id = $1
      order by created_at`,
    [runId],
  );
  const run = await client.query<{
    status: string;
    failure_reason: string | null;
    has_thread_id: boolean;
    has_turn_id: boolean;
    has_result_summary: boolean;
    result_summary_length: number | null;
    result_matches_last_agent_message: boolean;
    row_version: number;
  }>(
    `select status,
            failure_reason,
            codex_thread_id is not null as has_thread_id,
            codex_turn_id is not null as has_turn_id,
            result_summary is not null as has_result_summary,
            length(result_summary) as result_summary_length,
            result_summary = coalesce(
              (
                select event.summary ->> 'text'
                  from pfc.agent_run_events event
                 where event.run_id = agent_runs.id
                   and event.event_type = 'AGENT_MESSAGE'
                   and event.summary ? 'text'
                 order by event.sequence desc
                 limit 1
              ),
              ''
            ) as result_matches_last_agent_message,
            row_version
       from pfc.agent_runs
      where id = $1`,
    [runId],
  );

  const sequences = events.rows.map((event) => event.sequence);
  const sequencesContinuous = sequences.every(
    (sequence, index) => index === 0 || sequence === sequences[index - 1] + 1,
  );
  console.log(
    JSON.stringify(
      {
        runId,
        run: run.rows[0] ?? null,
        eventCount: events.rowCount,
        sequencesContinuous,
        events: events.rows,
        commands: commands.rows,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
