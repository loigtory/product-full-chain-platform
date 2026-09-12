import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';

const requestTimeoutMs = 120_000;

function parseOutputPath(argv) {
  const index = argv.indexOf('--output');
  return index === -1 ? null : resolve(argv[index + 1] ?? '');
}

function resolveCodexBinary() {
  const explicit = process.env.PFC_CODEX_BINARY?.trim();
  if (explicit) return explicit;
  const appData = process.env.APPDATA?.trim();
  if (!appData) throw new Error('APPDATA_REQUIRED');
  return join(
    appData,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe',
  );
}

function safeError(value) {
  return String(value)
    .replaceAll(process.env.USERPROFILE ?? '<user-profile>', '<user-profile>')
    .replace(/(?:token|cookie|authorization)=?[^\s]*/gi, '<redacted>')
    .slice(0, 1_000);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

class AppServerClient {
  constructor(binary) {
    this.binary = binary;
    this.child = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.stderr = '';
  }

  async start() {
    this.child = spawn(this.binary, ['app-server', '--stdio'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
    });
    this.child.once('exit', (code, signal) => {
      const error = new Error(
        `APP_SERVER_EXITED code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${safeError(this.stderr)}`,
      );
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.handleLine(line));

    const initialized = await this.request('initialize', {
      clientInfo: {
        name: 'pfc-m2-spike',
        title: 'PFC M2 integration spike',
        version: '0.1.0',
      },
    });
    this.notify('initialized');
    return {
      platformFamily: initialized.platformFamily,
      platformOs: initialized.platformOs,
      userAgent: initialized.userAgent,
    };
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.stderr = `${this.stderr}\nNON_JSON_STDOUT:${line}`.slice(-4_000);
      return;
    }
    if ('id' in message && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(safeError(JSON.stringify(message.error))));
      else pending.resolve(message.result);
      return;
    }
    if ('id' in message && message.method) {
      this.respondToServerRequest(message);
      return;
    }
    if (message.method) {
      this.notifications.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    }
  }

  respondToServerRequest(message) {
    if (
      message.method === 'item/commandExecution/requestApproval' ||
      message.method === 'item/fileChange/requestApproval'
    ) {
      this.write({ id: message.id, result: { decision: 'decline' } });
      return;
    }
    this.write({
      id: message.id,
      error: { code: -32601, message: 'PFC_SPIKE_REQUEST_NOT_ALLOWED' },
    });
  }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('APP_SERVER_NOT_WRITABLE');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = this.nextRequestId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`APP_SERVER_REQUEST_TIMEOUT:${method}`));
      }, requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });
      this.write({ id, method, params });
    });
  }

  notify(method, params) {
    this.write(params === undefined ? { method } : { method, params });
  }

  waitFor(predicate, label) {
    const existing = this.notifications.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveWait, rejectWait) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item.timer !== timer);
        rejectWait(new Error(`APP_SERVER_NOTIFICATION_TIMEOUT:${label}`));
      }, requestTimeoutMs);
      this.waiters.push({ predicate, resolve: resolveWait, timer });
    });
  }

  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.stdin.end();
    const child = this.child;
    let closeTimer;
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => {
        closeTimer = setTimeout(() => {
          child.kill();
          resolveTimeout();
        }, 5_000);
      }),
    ]);
    clearTimeout(closeTimer);
  }
}

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'CODEx_TEST_M2_APP_SERVER_'));
  const skillDirectory = join(root, '.pfc-skills', 'pfc-readonly-spike');
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(root, 'README.md'),
    '# Synthetic PFC M2 workspace\n\nNo customer or production data.\n',
    'utf8',
  );
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    [
      '---',
      'name: pfc-readonly-spike',
      'description: Validate the PFC read-only App Server integration.',
      '---',
      '',
      'Do not call tools or modify files. Reply with PFC_APP_SERVER_SPIKE_OK.',
      '',
    ].join('\n'),
    'utf8',
  );
  return { root, skillPath: join(skillDirectory, 'SKILL.md') };
}

async function cleanupWorkspace(root) {
  const resolvedRoot = resolve(root);
  const resolvedTemp = `${resolve(tmpdir())}${sep}`;
  if (
    !resolvedRoot.startsWith(resolvedTemp) ||
    !basename(resolvedRoot).startsWith('CODEx_TEST_M2_APP_SERVER_')
  ) {
    throw new Error('TEMP_WORKSPACE_BOUNDARY_INVALID');
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const workspace = await createWorkspace();
  const binary = resolveCodexBinary();
  let firstClient;
  let secondClient;
  let threadId;
  try {
    firstClient = new AppServerClient(binary);
    const initialize = await firstClient.start();
    const threadStart = await firstClient.request('thread/start', {
      cwd: workspace.root,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: false,
    });
    threadId = threadStart.thread.id;
    const firstTurn = await firstClient.request('turn/start', {
      threadId,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      clientUserMessageId: randomUUID(),
      input: [
        {
          type: 'text',
          text: '$pfc-readonly-spike Run the registered synthetic integration check.',
        },
        {
          type: 'skill',
          name: 'pfc-readonly-spike',
          path: workspace.skillPath,
        },
      ],
    });
    const firstCompleted = await firstClient.waitFor(
      (event) =>
        event.method === 'turn/completed' &&
        event.params?.turn?.id === firstTurn.turn.id,
      'first-turn-completed',
    );
    const expectedMarker = firstClient.notifications
      .filter((event) =>
        ['item/agentMessage/delta', 'item/completed'].includes(event.method),
      )
      .some((event) =>
        JSON.stringify(event).includes('PFC_APP_SERVER_SPIKE_OK'),
      );
    await firstClient.close();

    secondClient = new AppServerClient(binary);
    await secondClient.start();
    const resumed = await secondClient.request('thread/resume', {
      threadId,
      cwd: workspace.root,
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    const interruptStartedPromise = secondClient.waitFor(
      (event) =>
        event.method === 'turn/started' && event.params?.threadId === threadId,
      'interrupt-turn-started',
    );
    const interruptTurnPromise = secondClient.request('turn/start', {
      threadId,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      clientUserMessageId: randomUUID(),
      input: [
        {
          type: 'text',
          text: 'Run this no-write local command and wait for it to finish: node -e "setTimeout(() => console.log(\'PFC_DELAY_DONE\'), 30000)"',
        },
      ],
    });
    const interruptStarted = await interruptStartedPromise;
    const interruptTurnId = interruptStarted.params?.turn?.id;
    if (!interruptTurnId) throw new Error('INTERRUPT_TURN_ID_MISSING');
    let interruptDisposition = 'REQUEST_ACCEPTED';
    try {
      await secondClient.request('turn/interrupt', {
        threadId,
        turnId: interruptTurnId,
      });
    } catch (error) {
      if (String(error).includes('no active turn to interrupt')) {
        interruptDisposition = 'RACE_ALREADY_TERMINAL';
      } else {
        throw error;
      }
    }
    const interruptTurn = await interruptTurnPromise;
    const interrupted = await secondClient.waitFor(
      (event) =>
        event.method === 'turn/completed' &&
        event.params?.turn?.id === interruptTurn.turn.id,
      'interrupted-turn-completed',
    );
    let threadCleanup = 'DEFERRED';
    try {
      await secondClient.request('thread/delete', { threadId });
      threadCleanup = 'DELETED';
    } catch {
      threadCleanup = 'DELETE_FAILED';
    }

    const result = {
      runId: 'CODEx_TEST_M2_APP_SERVER_R1',
      codexBinaryVersion: initialize.userAgent,
      platformFamily: initialize.platformFamily,
      platformOs: initialize.platformOs,
      threadIdHash: digest(threadId),
      firstTurnStatus: firstCompleted.params?.turn?.status ?? 'UNKNOWN',
      expectedMarker,
      resumedSameThread: resumed.thread?.id === threadId,
      interruptedTurnStatus: interrupted.params?.turn?.status ?? 'UNKNOWN',
      interruptDisposition,
      cancellationVerified: interrupted.params?.turn?.status === 'interrupted',
      normalizedEventMethods: [
        ...new Set(
          [...firstClient.notifications, ...secondClient.notifications].map(
            (event) => event.method,
          ),
        ),
      ].sort(),
      serverRequestCount:
        firstClient.notifications.filter((event) => event.id).length +
        secondClient.notifications.filter((event) => event.id).length,
      threadCleanup,
      workspaceCleanup: 'PENDING',
    };
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
    await firstClient?.close();
    await secondClient?.close();
    await cleanupWorkspace(workspace.root);
    console.log('PFC_SPIKE_TEMP_CLEANED');
  }
}

await main();
