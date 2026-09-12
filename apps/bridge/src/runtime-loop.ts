const CAPABILITY_REPORT_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10_000;
const TELEMETRY_REPORT_INTERVAL_MS = 60_000;

export type BridgeRuntimeLoopMetrics = Readonly<{
  cycles: number;
  handledCycles: number;
  idleCycles: number;
  retryableFailures: number;
  effectivePollIntervalMs: number;
}>;

export function bridgeRuntimeErrorIsRetryable(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /^BRIDGE_GATEWAY_HTTP_(?:429|5\d{2})$/.test(message);
}

export function capabilityReportIsDue(
  lastReportedAt: string | null,
  now: number,
): boolean {
  if (!lastReportedAt) return true;
  const lastReportedTime = Date.parse(lastReportedAt);
  return (
    !Number.isFinite(lastReportedTime) ||
    now - lastReportedTime >= CAPABILITY_REPORT_INTERVAL_MS
  );
}

export function bridgeRetryDelayMs(
  pollIntervalMs: number,
  consecutiveFailures: number,
): number {
  return Math.min(
    pollIntervalMs * 2 ** Math.max(0, consecutiveFailures - 1),
    MAX_RETRY_DELAY_MS,
  );
}

export async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

export async function runBridgeRuntimeLoop(
  input: Readonly<{
    signal: AbortSignal;
    pollIntervalMs: number;
    runCycle: () => Promise<'IDLE' | 'HANDLED'>;
    reportCapabilities: (capturedAt: string) => Promise<void>;
    delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    onTelemetry?: (metrics: BridgeRuntimeLoopMetrics) => void;
    isRetryable?: (error: unknown) => boolean;
  }>,
): Promise<void> {
  const delay = input.delay ?? abortableDelay;
  const now = input.now ?? Date.now;
  const isRetryable = input.isRetryable ?? bridgeRuntimeErrorIsRetryable;
  let lastCapabilityReportAt: string | null = null;
  let nextTelemetryAt = now() + TELEMETRY_REPORT_INTERVAL_MS;
  let consecutiveFailures = 0;
  let cycles = 0;
  let handledCycles = 0;
  let idleCycles = 0;
  let retryableFailures = 0;

  while (!input.signal.aborted) {
    let waitMs = input.pollIntervalMs;
    try {
      const cycleStartedAt = now();
      if (capabilityReportIsDue(lastCapabilityReportAt, cycleStartedAt)) {
        const capturedAt = new Date(cycleStartedAt).toISOString();
        await input.reportCapabilities(capturedAt);
        lastCapabilityReportAt = capturedAt;
      }
      const result = await input.runCycle();
      cycles += 1;
      if (result === 'IDLE') idleCycles += 1;
      else handledCycles += 1;
      consecutiveFailures = 0;
    } catch (error) {
      if (input.signal.aborted) break;
      if (!isRetryable(error)) throw error;
      consecutiveFailures += 1;
      retryableFailures += 1;
      waitMs = bridgeRetryDelayMs(input.pollIntervalMs, consecutiveFailures);
    }

    const completedAt = now();
    if (input.onTelemetry && completedAt >= nextTelemetryAt) {
      input.onTelemetry({
        cycles,
        handledCycles,
        idleCycles,
        retryableFailures,
        effectivePollIntervalMs: waitMs,
      });
      nextTelemetryAt = completedAt + TELEMETRY_REPORT_INTERVAL_MS;
    }
    await delay(waitMs, input.signal);
  }
}
