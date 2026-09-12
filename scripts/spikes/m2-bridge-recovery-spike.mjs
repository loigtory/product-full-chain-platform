import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

function parseOutputPath(argv) {
  const index = argv.indexOf('--output');
  return index === -1 ? null : resolve(argv[index + 1] ?? '');
}

async function persist(path, state) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function recover(path) {
  const state = JSON.parse(await readFile(path, 'utf8'));
  for (const command of state.commands) {
    if (command.status === 'RUNNING' && command.sideEffectObserved) {
      command.status = 'UNKNOWN';
      command.recoveryReason = 'DISCONNECTED_AFTER_SIDE_EFFECT_BEFORE_ACK';
    }
  }
  return state;
}

function appendEvent(state, event) {
  if (state.events.some((current) => current.eventId === event.eventId)) {
    return 'DUPLICATE_IGNORED';
  }
  const expectedSequence = state.events.length + 1;
  if (event.sequence !== expectedSequence) return 'RESYNC_REQUIRED';
  state.events.push(event);
  return 'APPENDED';
}

function dispatch(state, commandId) {
  const command = state.commands.find(
    (current) => current.commandId === commandId,
  );
  if (!command || command.status !== 'PENDING') return 'DISPATCH_DENIED';
  command.status = 'RUNNING';
  command.leaseId = randomUUID();
  command.attempts += 1;
  return 'DISPATCHED';
}

async function cleanup(root) {
  const resolvedRoot = resolve(root);
  if (
    !resolvedRoot.startsWith(`${resolve(tmpdir())}${sep}`) ||
    !basename(resolvedRoot).startsWith('CODEx_TEST_M2_RECOVERY_')
  ) {
    throw new Error('TEMP_WORKSPACE_BOUNDARY_INVALID');
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const root = await mkdtemp(join(tmpdir(), 'CODEx_TEST_M2_RECOVERY_'));
  const journalPath = join(root, 'journal.json');
  try {
    const commandId = 'CODEx_TEST_M2_RECOVERY_COMMAND';
    const state = {
      commands: [
        {
          commandId,
          status: 'PENDING',
          attempts: 0,
          leaseId: null,
          sideEffectObserved: false,
        },
      ],
      events: [],
    };
    const initialDispatch = dispatch(state, commandId);
    state.commands[0].sideEffectObserved = true;
    await persist(journalPath, state);

    const recovered = await recover(journalPath);
    const redispatch = dispatch(recovered, commandId);
    const firstEvent = appendEvent(recovered, {
      eventId: 'CODEx_TEST_EVENT_1',
      sequence: 1,
    });
    const duplicateEvent = appendEvent(recovered, {
      eventId: 'CODEx_TEST_EVENT_1',
      sequence: 1,
    });
    const sequenceGap = appendEvent(recovered, {
      eventId: 'CODEx_TEST_EVENT_3',
      sequence: 3,
    });
    const replayedEvent = appendEvent(recovered, {
      eventId: 'CODEx_TEST_EVENT_2',
      sequence: 2,
    });
    const result = {
      runId: 'CODEx_TEST_M2_BRIDGE_RECOVERY_R1',
      initialDispatch,
      recoveredCommandStatus: recovered.commands[0].status,
      redispatch,
      attemptCount: recovered.commands[0].attempts,
      firstEvent,
      duplicateEvent,
      sequenceGap,
      replayedEvent,
      exactlyOnceClaim: 'NOT_CLAIMED',
      recoveryPolicy: 'AMBIGUOUS_SIDE_EFFECT_BECOMES_UNKNOWN',
      workspaceCleanup: 'PENDING',
    };
    const passed =
      initialDispatch === 'DISPATCHED' &&
      result.recoveredCommandStatus === 'UNKNOWN' &&
      redispatch === 'DISPATCH_DENIED' &&
      result.attemptCount === 1 &&
      duplicateEvent === 'DUPLICATE_IGNORED' &&
      sequenceGap === 'RESYNC_REQUIRED' &&
      replayedEvent === 'APPENDED';
    if (!passed)
      throw new Error(`RECOVERY_INVARIANT_FAILED:${JSON.stringify(result)}`);
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );
    }
    console.log(JSON.stringify(result));
  } finally {
    await cleanup(root);
    console.log('PFC_SPIKE_TEMP_CLEANED');
  }
}

await main();
