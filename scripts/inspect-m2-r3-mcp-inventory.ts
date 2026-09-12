import {
  CodexMcpReadSession,
  JsonlAppServerRpc,
} from '../packages/codex-adapter/src/index.ts';

const binary = process.env.PFC_CODEX_BINARY?.trim();
if (!binary) throw new Error('PFC_CODEX_BINARY_REQUIRED');

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
  console.log(
    JSON.stringify(
      {
        state: inventory.state,
        configFingerprint: inventory.configFingerprint,
        servers: inventory.servers.map((server) => ({
          name: server.name,
          runtimeStatus: server.runtimeStatus,
          authStatus: server.authStatus,
          tools: server.tools.map((tool) => ({
            name: tool.name,
            inputSchemaHash: tool.inputSchemaHash,
            readOnlyHint: tool.readOnlyHint,
          })),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await session.close().catch(() => undefined);
}
