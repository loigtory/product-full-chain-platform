import { performance } from 'node:perf_hooks';

import {
  CodexMcpReadSession,
  JsonlAppServerRpc,
} from '../packages/codex-adapter/src/index.ts';

const binary = process.env.PFC_CODEX_BINARY?.trim();
const [serverName, toolName] = process.argv.slice(2);
if (!binary) throw new Error('PFC_CODEX_BINARY_REQUIRED');
if (!serverName || !toolName)
  throw new Error('MCP_CAPABILITY_ARGUMENTS_REQUIRED');

const rpc = new JsonlAppServerRpc({
  binary,
  cwd: process.cwd(),
  requestTimeoutMs: 30_000,
});
const session = new CodexMcpReadSession(rpc, {
  workspacePath: process.cwd(),
});

try {
  const inventory = await session.listInventory();
  const server = inventory.servers.find((item) => item.name === serverName);
  const tool = server?.tools.find((item) => item.name === toolName);
  if (
    inventory.state !== 'AVAILABLE' ||
    server?.runtimeStatus !== 'CONNECTED' ||
    !tool ||
    tool.readOnlyHint !== true
  ) {
    throw new Error('MCP_READ_ONLY_CAPABILITY_UNAVAILABLE');
  }

  const startedAt = performance.now();
  const result = await session.call({
    serverName,
    toolName,
    input: {},
    expectedInputSchemaHash: tool.inputSchemaHash,
    expectedConfigFingerprint: inventory.configFingerprint,
    timeoutMs: 10_000,
    maxOutputBytes: 65_536,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  if (result.isError) throw new Error('MCP_TOOL_REPORTED_ERROR');
  if (result.truncated || result.outputBytes > 65_536) {
    throw new Error('MCP_OUTPUT_LIMIT_EXCEEDED');
  }
  console.log(
    JSON.stringify({
      status: 'PASS',
      capability: `${serverName}/${toolName}`,
      readOnlyHint: tool.readOnlyHint,
      inputSchemaHash: tool.inputSchemaHash,
      configFingerprint: inventory.configFingerprint,
      outputHash: result.outputHash,
      outputBytes: result.outputBytes,
      durationMs,
      truncated: result.truncated,
      isError: result.isError,
    }),
  );
} finally {
  await session.close().catch(() => undefined);
}
