import { describe, expect, it } from 'vitest';

import {
  bridgeRuntimeErrorIsRetryable,
  capabilityReportIsDue,
} from '../../apps/bridge/src/runtime.ts';

describe('M2 Bridge runtime', () => {
  it('refreshes capability evidence before the server freshness window expires', () => {
    const now = Date.parse('2026-09-06T06:00:30.000Z');

    expect(capabilityReportIsDue(null, now)).toBe(true);
    expect(capabilityReportIsDue('2026-09-06T06:00:01.000Z', now)).toBe(false);
    expect(capabilityReportIsDue('2026-09-06T06:00:00.000Z', now)).toBe(true);
  });
});

describe('M2 Bridge runtime recovery', () => {
  it.each([
    [new TypeError('fetch failed'), true],
    [new Error('BRIDGE_GATEWAY_HTTP_429'), true],
    [new Error('BRIDGE_GATEWAY_HTTP_503'), true],
    [new Error('BRIDGE_GATEWAY_HTTP_400'), false],
    [new Error('BRIDGE_GATEWAY_HTTP_401'), false],
    [new Error('BRIDGE_COMMAND_INVALID'), false],
  ])('classifies %s retryable=%s', (error, expected) => {
    expect(bridgeRuntimeErrorIsRetryable(error)).toBe(expected);
  });
});
