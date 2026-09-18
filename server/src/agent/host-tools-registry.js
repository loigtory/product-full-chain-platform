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

// 终端类工具：zed/vscode 真实 IDE 会话接入（57 号后续）前保持 PENDING；
// codex_cli 已提升 READY——语义为"在冻结计划批准的命令范围内执行命令向量"
// （cwd=授权工作区，deny 优先 + 计划精确匹配 + 超时进程树终止，由 command-runner 保证）。
// 60 号：zed/vscode 已提升 READY（EXTRA_READY_TOOLS）；PENDING 语义暂无承载工具。
const PENDING_TOOLS = {};


// 57 号：codex_cli 作为 READY 命令执行工具（配置里启用 codex-cli/codex 即注入）
const EXTRA_READY_TOOLS = {
  codex_cli: {
    status: 'READY',
    kind: 'tool',
    description:
      '在冻结计划批准的命令范围内执行命令向量（cwd=授权工作区；deny 优先、计划精确匹配、超时终止）。',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 32,
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  // 60 号：zed/vscode 终端提升 READY——语义与 codex_cli 一致（受控命令执行器），
  // 供「阶段能力」按团队偏好切换开发终端来源；IDE 专属会话流的实时跟踪为后续 UI 里程碑。
  zed_terminal: {
    status: 'READY',
    kind: 'tool',
    description:
      'Zed 终端：在冻结计划批准的命令范围内执行命令向量（与 codex_cli 同语义的受控执行器）。',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 32,
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  vscode_terminal: {
    status: 'READY',
    kind: 'tool',
    description:
      'VSCode 终端：在冻结计划批准的命令范围内执行命令向量（与 codex_cli 同语义的受控执行器）。',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 32,
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
};

const REGISTRY = { ...CORE_TOOLS, ...EXTRA_READY_TOOLS, ...PENDING_TOOLS };

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
  // 58-C：EXEC host 会话的命令执行统一走 terminal 工具（codex_cli，携带计划内命令向量），
  // 移除 core 固定命令工具（pfc_run_checks/pfc_git_status/pfc_git_diff），避免模型误选后与精确向量不匹配。
  return Object.keys(CORE_TOOLS).filter(
    (n) => !['pfc_run_checks', 'pfc_git_status', 'pfc_git_diff'].includes(n),
  );
}

function statusOf(name) {
  const key = normalize(String(name));
  return key ? REGISTRY[key].status : 'UNKNOWN';
}

module.exports = { CORE_TOOLS, EXTRA_READY_TOOLS, PENDING_TOOLS, REGISTRY, resolveHostTools, coreToolNames, statusOf, normalize };
