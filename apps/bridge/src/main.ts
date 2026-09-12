import { loadBridgeRuntimeConfig } from './runtime-config.ts';
import { runBridge } from './runtime.ts';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

try {
  const config = await loadBridgeRuntimeConfig(process.env);
  console.info(
    `PFC_BRIDGE_STARTED pollIntervalMs=${config.pollIntervalMs} capabilityIntervalMs=30000`,
  );
  await runBridge(config, controller.signal);
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_]+)?$/.test(message)
    ? message
    : 'BRIDGE_RUNTIME_FAILED';
  console.error(`PFC_BRIDGE_STOPPED code=${code}`);
  process.exitCode = 1;
}
