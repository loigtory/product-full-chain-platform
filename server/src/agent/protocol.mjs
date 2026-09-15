import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';

const VERSION = '0.154.0';
const requiredDisabled = [
  'apps',
  'plugins',
  'hooks',
  'multi_agent',
  'browser_use',
  'computer_use',
  'skill_mcp_dependency_install',
];
const error = (code) => Object.assign(new Error(code), { code });

// Instance-only overrides. Effective config must still be checked after layering.
// mode 'text' = 纯文本对话（全禁工具，C2）；'exec' = 真实工具执行（elevated Windows 沙箱，C3）。
export function instanceArguments(disabledMcpNames = [], mode = 'text') {
  if (
    !Array.isArray(disabledMcpNames) ||
    disabledMcpNames.length > 100 ||
    disabledMcpNames.some((name) => !/^[A-Za-z0-9_-]{1,100}$/.test(name))
  )
    throw error('MCP_NAME_INVALID');
  // preflight 只读预检模式：instance 参数与 text 对齐（全禁工具、只读），供连接探测/取指纹。
  if (!['preflight', 'text', 'exec'].includes(mode)) throw error('INSTANCE_MODE_INVALID');
  const values = [
    ...requiredDisabled.map((name) => `features.${name}=false`),
    'features.multi_agent_v2=false',
    'features.enable_mcp_apps=false',
    'features.in_app_browser=false',
    'features.shell_snapshot=false',
    'features.unbounded_connection_retries=false',
    'mcp_servers={}',
    ...disabledMcpNames.map((name) => `mcp_servers.${name}.enabled=false`),
    'web_search="disabled"',
    mode === 'exec'
      ? 'sandbox_mode="workspace-write"'
      : 'sandbox_mode="read-only"',
    'approval_policy="on-request"',
    'analytics.enabled=false',
  ];
  if (mode === 'exec') {
    // 执行链路：unified exec 由 code-mode host 承载，exec_command 需要 code_mode
    // 会话；elevated Windows 沙箱负责受限读强制；实例级 workspace-write 与
    // turn 级 policy 双重限定。
    values.push('features.code_mode=true');
    values.push('features.code_mode_host=true');
    values.push('windows.sandbox="elevated"');
    values.push('features.shell_tool=true');
    values.push('features.unified_exec=true');
    values.push('features.apply_patch_freeform=true');
  } else {
    values.push('features.code_mode=false');
    values.push('features.code_mode_host=false');
  }
  return ['app-server', '--stdio', ...values.flatMap((value) => ['-c', value])];
}

export function disabledMcpNamesFromJson(json) {
  let configured;
  try {
    configured = JSON.parse(json);
  } catch {
    throw error('MCP_CONFIG_LIST_INVALID');
  }
  if (
    !Array.isArray(configured) ||
    configured.length > 100 ||
    configured.some((item) => !item || typeof item.name !== 'string')
  )
    throw error('MCP_CONFIG_LIST_INVALID');
  const names = [...new Set(configured.map((item) => item.name))].sort();
  instanceArguments(names);
  return names;
}

// `mcp list --json` is a configuration listing command, not an MCP client session.
// Capture it privately; only validated names are used as disable arguments.
export function readConfiguredMcpNames(binary, cwd) {
  const listing = spawnSync(
    binary,
    ['mcp', 'list', '--json', ...instanceArguments().slice(2)],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (listing.status !== 0) throw error('MCP_CONFIG_LIST_FAILED');
  return disabledMcpNamesFromJson(listing.stdout);
}

export function summarizePreflight(input, mode = 'preflight') {
  const config = input.config?.config ?? {};
  const features = config.features ?? {};
  const provider = config.model_provider ?? 'openai';
  const sandboxModeOk =
    mode === 'exec'
      ? config.sandbox_mode === 'workspace-write'
      : config.sandbox_mode === 'read-only';
  // Bind a later provider decision to this exact connection without persisting URLs or keys.
  const connectionFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        provider,
        model: config.model ?? null,
        endpoint: config.model_providers?.[provider]?.base_url ?? null,
        accountMode: input.account?.account?.type ?? null,
      }),
    )
    .digest('hex');
  const pinnedConnection =
    typeof input.expectedConnectionFingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(input.expectedConnectionFingerprint) &&
    input.expectedConnectionFingerprint === connectionFingerprint;
  const isolated =
    requiredDisabled.every((key) => features[key] === false) &&
    Object.values(config.mcp_servers ?? {}).every(
      (server) => server?.enabled === false,
    ) &&
    config.web_search === 'disabled' &&
    sandboxModeOk;
  const result = {
    status: 'READ_ONLY_PRECHECK_READY',
    expectedVersion: VERSION,
    actualVersion: /^\d+\.\d+\.\d+$/.test(input.version ?? '')
      ? input.version
      : 'UNKNOWN',
    initialized: typeof input.initialize?.userAgent === 'string',
    accountMode: ['chatgpt', 'apiKey'].includes(input.account?.account?.type)
      ? input.account.account.type
      : 'UNAVAILABLE',
    model:
      typeof config.model === 'string' &&
      /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(config.model)
        ? config.model
        : null,
    providerConfirmed:
      pinnedConnection || (config.model_provider ?? 'openai') === 'openai',
    instanceIsolation: isolated ? 'CONFIG_VERIFIED' : 'NOT_VERIFIED',
    toolSandbox: 'NOT_VERIFIED',
    realTools: false,
    modelTurns: 0,
    connectionFingerprint,
    isolationChecks: {
      disabledFeatures: Object.fromEntries(
        requiredDisabled.map((key) => [key, features[key] === false]),
      ),
      enabledMcpServers: Object.values(config.mcp_servers ?? {}).filter(
        (server) => server?.enabled !== false,
      ).length,
      readOnly: config.sandbox_mode === 'read-only',
      workspaceWrite:
        mode === 'exec' && config.sandbox_mode === 'workspace-write',
      webSearchDisabled: config.web_search === 'disabled',
    },
  };
  if (input.version !== VERSION || !result.initialized)
    result.status = 'PROTOCOL_VERSION_MISMATCH';
  else if (
    input.expectedConnectionFingerprint !== undefined &&
    !pinnedConnection
  )
    result.status = 'CONNECTION_CHANGED';
  else if (!result.providerConfirmed) result.status = 'PROVIDER_NOT_CONFIRMED';
  else if (
    !pinnedConnection &&
    config.model_providers?.openai?.base_url &&
    config.model_providers.openai.base_url !== 'https://api.openai.com/v1'
  )
    result.status = 'PROVIDER_ENDPOINT_NOT_CONFIRMED';
  else if (!isolated) result.status = 'INSTANCE_ISOLATION_UNVERIFIED';
  else {
    result.instanceIsolation = 'CONFIG_VERIFIED';
    if (result.accountMode === 'UNAVAILABLE') result.status = 'AUTH_REQUIRED';
  }
  return result;
}

// ToolsV2 omits view_image from the typed DTO. Require effective provenance;
// merely finding false in any lower-priority layer is insufficient.
export function imageToolDisabled(response) {
  if (response.config?.tools?.view_image === false) return true;
  const origin = response.origins?.['tools.view_image'];
  if (
    origin?.name?.type !== 'sessionFlags' ||
    typeof origin.version !== 'string'
  )
    return false;
  return (
    Array.isArray(response.layers) &&
    response.layers.some(
      (layer) =>
        layer.name?.type === 'sessionFlags' &&
        layer.version === origin.version &&
        !layer.disabledReason &&
        layer.config?.tools?.view_image === false,
    )
  );
}

// Deliberately only exposes non-generating preflight requests. It cannot start a turn.
class PreflightRpc {
  constructor(binary, cwd, disabledMcpNames = [], options = {}) {
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.closed = false;
    this.stderrBytes = 0;
    this.mode = options.mode ?? 'preflight';
    this.onNotification = options.onNotification ?? (() => {});
    const args = instanceArguments(disabledMcpNames, this.mode);
    if (this.mode === 'text') {
      for (const value of [
        'features.shell_tool=false',
        'features.unified_exec=false',
        'features.apply_patch_freeform=false',
        'tools.view_image=false',
        'features.memories=false',
        'memories.use_memories=false',
        'memories.generate_memories=false',
        'project_doc_max_bytes=0',
      ])
        args.push('-c', value);
    }
    this.child = spawn(binary, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => {
        this.closed = true;
        this.rejectAll(error('APP_SERVER_EXITED'));
        resolve({ code, signal });
      });
      this.child.once('error', () => {
        this.closed = true;
        this.rejectAll(error('APP_SERVER_SPAWN_FAILED'));
        resolve({ error: 'APP_SERVER_SPAWN_FAILED' });
      });
    });
    this.child.stdin.on('error', () =>
      this.rejectAll(error('APP_SERVER_WRITE_FAILED')),
    );
    this.child.stderr.on('data', (chunk) => {
      this.stderrBytes += chunk.length;
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.receive(chunk));
  }

  rejectAll(reason) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  receive(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) {
      this.rejectAll(error('APP_SERVER_RESPONSE_TOO_LARGE'));
      this.child.kill();
      return;
    }
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.rejectAll(error('APP_SERVER_INVALID_JSON'));
        this.child.kill();
        return;
      }
      if (
        message &&
        Object.hasOwn(message, 'id') &&
        typeof message.method === 'string'
      ) {
        // No approval, login, tool or external callback is permitted during this probe.
        this.write({
          id: message.id,
          error: { code: -32601, message: 'PFC_PREFLIGHT_REQUEST_DENIED' },
        });
      } else if (message && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(
            error(
              `APP_SERVER_RPC_FAILED_${pending.method.replaceAll('/', '_')}`,
            ),
          );
        else pending.resolve(message.result);
      } else if (message && typeof message.method === 'string') {
        try {
          this.onNotification(message);
        } catch {
          this.rejectAll(error('APP_SERVER_EVENT_REJECTED'));
          this.child.kill();
        }
      }
    }
  }

  write(message) {
    if (this.closed || this.child.stdin.destroyed)
      throw error('APP_SERVER_CLOSED');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params) {
    if (
      !['initialize', 'config/read', 'account/read', 'model/list', 'account/rateLimits/read'].includes(method) &&
      !(
        ['text', 'exec'].includes(this.mode) &&
        [
          'skills/list',
          'thread/start',
          'turn/start',
          'turn/interrupt',
        ].includes(method)
      )
    )
      return Promise.reject(error('PREFLIGHT_METHOD_NOT_ALLOWED'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(error('APP_SERVER_REQUEST_TIMEOUT'));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.write({ id, method, params });
      } catch (reason) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(reason);
      }
    });
  }

  async close() {
    this.rejectAll(error('APP_SERVER_CLOSED'));
    this.child.stdin.end();
    let timer;
    await Promise.race([
      this.exited,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          this.child.kill();
          resolve();
        }, 3000);
      }),
    ]);
    clearTimeout(timer);
    return this.exited;
  }
}

export async function openProtocol({
  binary,
  expectedSha256,
  cwd,
  expectedConnectionFingerprint,
  mode = 'preflight',
  onNotification,
}) {
  if (
    !binary ||
    !cwd ||
    !path.isAbsolute(binary) ||
    !path.isAbsolute(cwd) ||
    path.basename(binary).toLowerCase() !== 'codex.exe' ||
    !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') ||
    !['preflight', 'text', 'exec'].includes(mode) ||
    (mode !== 'preflight' &&
      !/^[a-f0-9]{64}$/.test(expectedConnectionFingerprint ?? ''))
  )
    throw error('PREFLIGHT_CONFIG_REQUIRED');
  const actualHash = createHash('sha256')
    .update(readFileSync(binary))
    .digest('hex');
  if (actualHash !== expectedSha256) throw error('CODEX_BINARY_CHANGED');
  const allowedRoot = realpathSync(
    path.resolve('.local/ai-tools-integration-20260914'),
  );
  const actualCwd = realpathSync(cwd);
  const relative = path.relative(allowedRoot, actualCwd);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw error('PREFLIGHT_WORKSPACE_NOT_AUTHORIZED');
  const versionResult = spawnSync(binary, ['--version'], {
    cwd: actualCwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 10000,
  });
  if (versionResult.status !== 0) throw error('CODEX_VERSION_CHECK_FAILED');
  const version = versionResult.stdout.match(
    /codex-cli\s+(\d+\.\d+\.\d+)/,
  )?.[1];
  if (version !== VERSION) throw error('PROTOCOL_VERSION_MISMATCH');
  const disabledMcpNames = readConfiguredMcpNames(binary, actualCwd);
  const rpc = new PreflightRpc(binary, actualCwd, disabledMcpNames, {
    mode,
    onNotification,
  });
  const processes = [];
  const close = async () => {
    const exit = await rpc.close();
    processes.push({
      pid: rpc.child.pid,
      closed: rpc.closed,
      exitCode: exit.code ?? null,
    });
  };
  let result;
  try {
    const initialize = await rpc.request('initialize', {
      clientInfo: { name: 'pfc_preflight', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.write({ method: 'initialized', params: {} });
    const config = await rpc.request('config/read', {
      includeLayers: mode === 'text',
      cwd: actualCwd,
    });
    const account = await rpc.request('account/read', { refreshToken: false });
    result = summarizePreflight(
      {
        version,
        initialize,
        config,
        account,
        expectedConnectionFingerprint,
      },
      mode,
    );
    if (result.status === 'READ_ONLY_PRECHECK_READY') {
      const models = await rpc.request('model/list', { limit: 100 });
      const selected = result.model
        ? models?.data?.find((model) => model.model === result.model)
        : models?.data?.find((model) => model.isDefault);
      result.selectedModel =
        typeof selected?.model === 'string' &&
        /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(selected.model)
          ? selected.model
          : null;
      if (!result.selectedModel) result.status = 'MODEL_UNAVAILABLE';
      result.modelListed = !!result.selectedModel;
    }
    if (result.status !== 'READ_ONLY_PRECHECK_READY')
      throw Object.assign(error(result.status), { preflight: result });
    if (mode === 'text') {
      const cfg = config.config;
      result.textIsolation = {
        shellDisabled: cfg.features?.shell_tool === false,
        execDisabled: cfg.features?.unified_exec === false,
        imageToolDisabled: imageToolDisabled(config),
        memoriesDisabled: cfg.features?.memories === false,
        memoryInputDisabled: cfg.memories?.use_memories === false,
        memoryOutputDisabled: cfg.memories?.generate_memories === false,
        projectInstructionsDisabled: cfg.project_doc_max_bytes === 0,
      };
      if (Object.values(result.textIsolation).some((value) => value !== true))
        throw error('TEXT_CONTEXT_ISOLATION_UNVERIFIED');
    }
    return {
      rpc,
      summary: result,
      cwd: actualCwd,
      close: async () => {
        await close();
        result.binarySha256 = actualHash;
        result.process = processes.at(-1);
        result.processes = processes;
        result.stderrBytes = rpc.stderrBytes;
        return result;
      },
    };
  } catch (reason) {
    await close();
    if (result) {
      result.binarySha256 = actualHash;
      result.process = processes.at(-1);
      result.processes = processes;
      result.stderrBytes = rpc.stderrBytes;
    }
    reason.preflight = result;
    throw reason;
  }
}

export async function preflight(input) {
  try {
    const connection = await openProtocol(input);
    return await connection.close();
  } catch (reason) {
    if (reason.preflight) return reason.preflight;
    throw reason;
  }
}
