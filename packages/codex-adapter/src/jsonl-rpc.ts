import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface AppServerRpc {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (message: unknown) => void): () => void;
  onServerRequest?(
    listener: (message: AppServerRequestEnvelope) => void | Promise<void>,
  ): () => void;
  respond?(id: string | number, result: unknown): void;
  close(): Promise<void>;
}

export type AppServerRequestEnvelope = Readonly<{
  id: string | number;
  method: string;
  params: unknown;
}>;

export class JsonlAppServerRpc implements AppServerRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly listeners = new Set<(message: unknown) => void>();
  private readonly requestListeners = new Set<
    (message: AppServerRequestEnvelope) => void | Promise<void>
  >();
  private stderr = '';

  constructor(input: {
    binary: string;
    cwd: string;
    requestTimeoutMs?: number;
  }) {
    const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;
    this.child = spawn(input.binary, ['app-server', '--stdio'], {
      cwd: input.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-2_000);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      this.handleLine(line);
    });
    this.child.once('exit', (code, signal) => {
      const error = new Error(
        `APP_SERVER_EXITED code=${code ?? 'null'} signal=${signal ?? 'null'}`,
      );
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      this.pending.clear();
    });
    this.requestTimeoutMs = requestTimeoutMs;
  }

  private readonly requestTimeoutMs: number;

  private write(message: unknown): void {
    if (!this.child.stdin.writable) throw new Error('APP_SERVER_NOT_WRITABLE');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (
      typeof message.id === 'number' &&
      ('result' in message || 'error' in message)
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const errorCode =
          typeof message.error === 'object' &&
          message.error !== null &&
          'code' in message.error &&
          typeof message.error.code === 'number'
            ? String(message.error.code)
            : 'unknown';
        pending.reject(
          new Error(
            `APP_SERVER_REQUEST_FAILED:${pending.method}:code=${errorCode}`,
          ),
        );
      } else pending.resolve(message.result);
      return;
    }
    if (
      (typeof message.id === 'number' || typeof message.id === 'string') &&
      typeof message.method === 'string'
    ) {
      const envelope = {
        id: message.id,
        method: message.method,
        params: message.params,
      };
      if (this.requestListeners.size > 0) {
        for (const listener of this.requestListeners) {
          void Promise.resolve(listener(envelope)).catch(() => {
            this.write({
              id: message.id,
              error: { code: -32001, message: 'PFC_REQUEST_HANDLER_FAILED' },
            });
          });
        }
      } else if (
        message.method === 'item/commandExecution/requestApproval' ||
        message.method === 'item/fileChange/requestApproval'
      ) {
        this.write({ id: message.id, result: { decision: 'decline' } });
      } else if (message.method === 'item/permissions/requestApproval') {
        this.write({
          id: message.id,
          result: { permissions: {}, scope: 'turn', strictAutoReview: true },
        });
      } else {
        this.write({
          id: message.id,
          error: { code: -32601, message: 'PFC_REQUEST_NOT_ALLOWED' },
        });
      }
      return;
    }
    if (typeof message.method === 'string') {
      for (const listener of this.listeners) listener(message);
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`APP_SERVER_REQUEST_TIMEOUT:${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });
      this.write(
        params === undefined ? { id, method } : { id, method, params },
      );
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  onNotification(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onServerRequest(
    listener: (message: AppServerRequestEnvelope) => void | Promise<void>,
  ): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result });
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise<void>((resolveExit) => {
      this.child.once('exit', () => resolveExit());
    });
    this.child.stdin.end();
    let forceTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      exited,
      new Promise<void>((resolveTimeout) => {
        forceTimer = setTimeout(() => {
          void terminateOwnedProcessTree(this.child).finally(resolveTimeout);
        }, 5_000);
      }),
    ]);
    clearTimeout(forceTimer);
  }
}

async function terminateOwnedProcessTree(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    killer.once('error', () => {
      child.kill();
      resolve();
    });
    killer.once('exit', () => resolve());
  });
}
