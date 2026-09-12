import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CodexAppServerAdapter,
  CodexMcpReadSession,
  CodexWorkspaceWriteSession,
  CodexProductWorkTurnSession,
  JsonlAppServerRpc,
} from '../../../packages/codex-adapter/src/index.ts';
import type { BridgeMcpCapabilitySnapshot } from '../../../packages/protocol/src/index.ts';
import { createBridgeCapabilitySnapshot } from './capability-snapshot.ts';
import { FileArtifactInspector } from './file-artifact-inspector.ts';
import { GitWorkspaceInspector } from './git-workspace-inspector.ts';
import { HttpBridgeGateway } from './http-gateway.ts';
import { HttpProductWorkTurnGateway } from './http-product-work-turn-gateway.ts';
import { HttpMcpReadGateway } from './http-mcp-read-gateway.ts';
import { LocalBridgeRegistry, type RegistryConfig } from './local-registry.ts';
import type { BridgeRuntimeConfig } from './runtime-config.ts';
import { LocalToolCapabilityInspector } from './tool-capability-inspector.ts';
import { RunCapsuleManager } from './run-capsule.ts';
import { BridgeSessionPool } from './session-pool.ts';
import { BridgeWorker } from './worker.ts';
import { ProductWorkTurnWorker } from './product-work-turn-worker.ts';
import { McpReadWorker } from './mcp-read-worker.ts';
import { runBridgeRuntimeLoop } from './runtime-loop.ts';

export {
  bridgeRuntimeErrorIsRetryable,
  capabilityReportIsDue,
} from './runtime-loop.ts';

export async function runBridge(
  config: BridgeRuntimeConfig,
  signal: AbortSignal,
): Promise<void> {
  const registryConfig = JSON.parse(
    await readFile(config.registryFile, 'utf8'),
  ) as RegistryConfig;
  const registry = new LocalBridgeRegistry(registryConfig);
  const gateway = new HttpBridgeGateway({
    baseUrl: config.serverUrl,
    bridgeId: config.bridgeId,
    credential: config.credential,
  });
  const productWorkTurnGateway = new HttpProductWorkTurnGateway({
    baseUrl: config.serverUrl,
    bridgeId: config.bridgeId,
    credential: config.credential,
  });
  const mcpReadGateway = new HttpMcpReadGateway({
    baseUrl: config.serverUrl,
    bridgeId: config.bridgeId,
    credential: config.credential,
  });
  const workspaceInspector = new GitWorkspaceInspector();
  const artifactInspector = new FileArtifactInspector();
  const toolInspector = new LocalToolCapabilityInspector();
  const codexAppServer = await toolInspector.codexAppServer(config.codexBinary);
  const sessionPool = new BridgeSessionPool({ maxActiveSessions: 3 });
  const capsuleManager = new RunCapsuleManager({
    capsuleRoot: path.resolve(process.cwd(), '.local', 'run-capsules'),
  });
  const worker = new BridgeWorker({
    bridgeId: config.bridgeId,
    gateway,
    registry,
    workspaceInspector,
    artifactInspector,
    capsuleManager,
    sessionPool,
    runnerFactory: () => {
      const rpc = new JsonlAppServerRpc({
        binary: config.codexBinary,
        cwd: process.cwd(),
      });
      return new CodexAppServerAdapter(rpc, {
        requestTimeoutMs: config.runTimeoutMs,
      });
    },
    workspaceWriteSessionFactory: async (input, onEvent, onApproval) => {
      const rpc = new JsonlAppServerRpc({
        binary: config.codexBinary,
        cwd: input.workspacePath,
        requestTimeoutMs: config.runTimeoutMs,
      });
      return CodexWorkspaceWriteSession.start(rpc, input, onEvent, onApproval);
    },
  });
  const productWorkTurnWorker = new ProductWorkTurnWorker({
    bridgeId: config.bridgeId,
    workspacePath: process.cwd(),
    gateway: productWorkTurnGateway,
    registry,
    runnerFactory: async (input, onEvent) => {
      const rpc = new JsonlAppServerRpc({
        binary: config.codexBinary,
        cwd: input.workspacePath,
        requestTimeoutMs: config.runTimeoutMs,
      });
      return CodexProductWorkTurnSession.start(
        rpc,
        { ...input, timeoutMs: Math.min(config.runTimeoutMs, 120_000) },
        onEvent,
      );
    },
  });
  const mcpReadWorker = new McpReadWorker({
    bridgeId: config.bridgeId,
    gateway: mcpReadGateway,
    runnerFactory: () => {
      const rpc = new JsonlAppServerRpc({
        binary: config.codexBinary,
        cwd: process.cwd(),
        requestTimeoutMs: config.runTimeoutMs,
      });
      return new CodexMcpReadSession(rpc, {
        workspacePath: process.cwd(),
      });
    },
  });

  try {
    await runBridgeRuntimeLoop({
      signal,
      pollIntervalMs: config.pollIntervalMs,
      reportCapabilities: async (capturedAt) => {
        const unavailableMcp: BridgeMcpCapabilitySnapshot = {
          state:
            codexAppServer === 'UNAVAILABLE'
              ? ('UNAVAILABLE' as const)
              : ('UNVERIFIED' as const),
          configFingerprint: `sha256:${createHash('sha256')
            .update(`MCP_INVENTORY_${codexAppServer}`)
            .digest('hex')}`,
          servers: [],
        };
        let mcp: BridgeMcpCapabilitySnapshot = unavailableMcp;
        if (codexAppServer === 'AVAILABLE') {
          const rpc = new JsonlAppServerRpc({
            binary: config.codexBinary,
            cwd: process.cwd(),
            requestTimeoutMs: Math.min(config.runTimeoutMs, 30_000),
          });
          const session = new CodexMcpReadSession(rpc, {
            workspacePath: process.cwd(),
          });
          try {
            mcp = await session.listInventory();
          } catch {
            mcp = unavailableMcp;
          } finally {
            await session.close().catch(() => undefined);
          }
        }
        await gateway.reportCapabilities({
          bridgeId: config.bridgeId,
          snapshot: await createBridgeCapabilitySnapshot({
            registry,
            workspaceInspector,
            capturedAt,
            nodeVersion: process.version,
            codexAppServer,
            zedCli: 'UNVERIFIED',
            productWorkTurn: {
              state:
                codexAppServer === 'AVAILABLE' ? 'AVAILABLE' : codexAppServer,
              protocolVersion: 'product-work-turn/1',
            },
            mcp,
          }),
        });
      },
      runCycle: async () => {
        const [agentRunResult, productWorkTurnResult, mcpReadResult] =
          await Promise.all([
            worker.runOnce(),
            productWorkTurnWorker.runOnce(),
            mcpReadWorker.runOnce(),
          ]);
        return agentRunResult === 'IDLE' &&
          productWorkTurnResult === 'IDLE' &&
          mcpReadResult === 'IDLE'
          ? 'IDLE'
          : 'HANDLED';
      },
      onTelemetry: (metrics) => {
        console.info(
          `PFC_BRIDGE_RUNTIME cycles=${metrics.cycles} handled=${metrics.handledCycles} idle=${metrics.idleCycles} retries=${metrics.retryableFailures} waitMs=${metrics.effectivePollIntervalMs}`,
        );
      },
    });
  } finally {
    await sessionPool.revoke();
    await productWorkTurnWorker.close();
    await worker.drain();
  }
}
