import { describe, expect, it, vi } from 'vitest';

import { runBridgeRuntimeLoop } from '../../apps/bridge/src/runtime-loop.ts';

describe('AI-UX-R1 E4.2 bounded Bridge runtime loop', () => {
  it.each(['IDLE', 'HANDLED'] as const)(
    'waits after a successful %s cycle',
    async (result) => {
      const controller = new AbortController();
      const delays: number[] = [];
      const runCycle = vi.fn(async () => result);

      await runBridgeRuntimeLoop({
        signal: controller.signal,
        pollIntervalMs: 1_000,
        runCycle,
        reportCapabilities: vi.fn(async () => undefined),
        delay: vi.fn(async (milliseconds) => {
          delays.push(milliseconds);
          controller.abort();
        }),
        now: () => Date.parse('2026-09-08T02:00:00.000Z'),
      });

      expect(runCycle).toHaveBeenCalledTimes(1);
      expect(delays).toEqual([1_000]);
    },
  );

  it('backs off repeated retryable failures and resets after success', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const outcomes: Array<Error | 'HANDLED'> = [
      new TypeError('fetch failed'),
      new Error('BRIDGE_GATEWAY_HTTP_503'),
      'HANDLED',
    ];

    await runBridgeRuntimeLoop({
      signal: controller.signal,
      pollIntervalMs: 1_000,
      runCycle: vi.fn(async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome ?? 'IDLE';
      }),
      reportCapabilities: vi.fn(async () => undefined),
      delay: vi.fn(async (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 3) controller.abort();
      }),
      now: () => Date.parse('2026-09-08T02:00:00.000Z'),
    });

    expect(delays).toEqual([1_000, 2_000, 1_000]);
  });
});
