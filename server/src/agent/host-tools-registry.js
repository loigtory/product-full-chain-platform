'use strict';
// 56 号：host 模式可执行工具注册表（EXEC 工具热插拔的白名单）。
// 安全基线：只有本注册表内 status='READY' 的工具允许被 stage_capabilities 配置注入；
// 核心 5 个 pfc_* 工具恒在（exec-control 的批准执行语义），终端类工具先注册 schema，
// status='PENDING_HOST_SUPPORT'（真实终端对话流接入属后续范围），默认不注入。
const string = { type: 'string' };

const CORE_TOOLS = {
  pfc_read_file: {
    status: 'READY',
    kind: 'tool',
    description: 'Read a relative UTF-8 file inside the approved workspace.',
    inputSchema: {
      type: 'object',
      properties: { path: string },
      required: ['path'],
      additionalProperties: false,
    },
  },
  pfc_write_file: {
    status: 'READY',
    kind: 'tool',
    description:
      'Write an approved relative UTF-8 file only when its SHA256 matches expectedHash (null for a new file).',
    inputSchema: {
      type: 'object',
      properties: {
        path: string,
        content: string,
        expectedHash: { type: ['string', 'null'] },
      },
      required: ['path', 'content', 'expectedHash'],
      additionalProperties: false,
    },
  },
  pfc_run_checks: {
    status: 'READY',
    kind: 'tool',
    description: 'Run the frozen node test command. No custom command or arguments.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  pfc_git_status: {
    status: 'READY',
    kind: 'tool',
    description: 'Read the frozen workspace Git status. No custom arguments.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  pfc_git_diff: {
    status: 'READY',
    kind: 'tool',
    description: 'Read the frozen workspace Git diff. No custom arguments.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
};

// 终端类工具：配置可声明，但真实 host 会话流接入（57 号）前不会注入执行器。
const PENDING_TOOLS = {
  codex_cli: {
    status: 'PENDING_HOST_SUPPORT',
    kind: 'tool',
    description: 'Codex CLI 会话（终端流实时镜像接入待 57 号）。',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  zed_terminal: {
    status: 'PENDING_HOST_SUPPORT',
    kind: 'tool',
    description: 'Zed 开发终端会话（终端流实时镜像接入待 57 号）。',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  vscode_terminal: {
    status: 'PENDING_HOST_SUPPORT',
    kind: 'tool',
    description: 'VSCode 开发终端会话（终端流实时镜像接入待 57 号）。',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
};

const REGISTRY = { ...CORE_TOOLS, ...PENDING_TOOLS };

// 配置名 → 注册工具名映射（兼容 seed 清单里的 "codex-cli" 写法）
const ALIASES = {
  'codex-cli': 'codex_cli',
  codex: 'codex_cli',
  zed: 'zed_terminal',
  vscode: 'vscode_terminal',
  'vs-code': 'vscode_terminal',
};

function normalize(name) {
  const key = ALIASES[name] || name;
  return REGISTRY[key] ? key : null;
}

// 白名单过滤：只返回 registry 中 status='READY' 且未重复的工具定义
function resolveHostTools(names = []) {
  const seen = new Set();
  const tools = [];
  for (const name of names) {
    const key = normalize(String(name));
    if (!key || seen.has(key)) continue;
    const entry = REGISTRY[key];
    if (entry.status !== 'READY') continue;
    seen.add(key);
    tools.push({
      type: 'function',
      name: key,
      description: entry.description,
      inputSchema: entry.inputSchema,
    });
  }
  return tools;
}

function coreToolNames() {
  return Object.keys(CORE_TOOLS);
}

function statusOf(name) {
  const key = normalize(String(name));
  return key ? REGISTRY[key].status : 'UNKNOWN';
}

module.exports = { CORE_TOOLS, PENDING_TOOLS, REGISTRY, resolveHostTools, coreToolNames, statusOf, normalize };
