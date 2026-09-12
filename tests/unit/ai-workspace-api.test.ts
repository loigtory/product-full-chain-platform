// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { workSessionsApi } from '../../apps/web/src/work-sessions/api.ts';
import {
  clearCsrfToken,
  setCsrfToken,
} from '../../apps/web/src/identity/session-store.ts';

class FakeEventSource {
  static current: FakeEventSource | null = null;
  readonly listeners = new Map<string, Set<EventListener>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeEventSource.current = this;
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

afterEach(() => {
  vi.useRealTimers();
  clearCsrfToken();
  vi.unstubAllGlobals();
  FakeEventSource.current = null;
});

describe('AI workspace Web API adapter', () => {
  it('sends CSRF, row version, idempotency and exact proposal scope', async () => {
    setCsrfToken('CODEx_TEST_AIUX_UI_CSRF');
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(JSON.stringify({ replayed: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await workSessionsApi.submitTurn({
      contextTargetIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
      intentKind: 'PRODUCT_DISCOVERY',
      message: '核对生效口径。',
      rowVersion: 3,
      sessionId: 'CODEx_TEST_AIUX_UI_SESSION',
      skillReleaseId: 'CODEx_TEST_AIUX_UI_SKILL',
    });
    await workSessionsApi.decideProposal({
      decision: 'CONFIRM',
      proposalId: 'CODEx_TEST_AIUX_UI_PROPOSAL',
      reasonCode: 'PRODUCT_OWNER_CONFIRMED',
      rowVersion: 2,
      scopeHash: `sha256:${'a'.repeat(64)}`,
    });
    await workSessionsApi.getReadiness('CODEx_TEST_AIUX_UI_SESSION');
    await workSessionsApi.grantTransmissionAuthorization({
      beneficiaryActorId: 'CODEx_TEST_AIUX_UI_ACTOR',
      materialRefIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
      sessionId: 'CODEx_TEST_AIUX_UI_SESSION',
      validForMinutes: 15,
    });
    await workSessionsApi.revokeTransmissionAuthorization({
      authorizationId: 'CODEx_TEST_AIUX_UI_AUTH',
      rowVersion: 0,
    });

    const turnCall = fetchMock.mock.calls[0]!;
    const turnInit = turnCall[1]!;
    const turnHeaders = new Headers(turnInit.headers);
    expect(turnCall[0]).toBe(
      '/api/v1/work-sessions/CODEx_TEST_AIUX_UI_SESSION/turns',
    );
    expect(turnHeaders.get('X-CSRF-Token')).toBe('CODEx_TEST_AIUX_UI_CSRF');
    expect(turnHeaders.get('If-Match')).toBe('"3"');
    expect(turnHeaders.get('Idempotency-Key')).toMatch(
      /^PFC_AIUX_SUBMIT_PRODUCT_WORK_TURN_/,
    );
    expect(JSON.parse(String(turnInit.body))).toMatchObject({
      contextBindingIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
      skillReleaseId: 'CODEx_TEST_AIUX_UI_SKILL',
    });

    const proposalCall = fetchMock.mock.calls[1]!;
    const proposalInit = proposalCall[1]!;
    const proposalHeaders = new Headers(proposalInit.headers);
    expect(proposalHeaders.get('If-Match')).toBe('"2"');
    expect(proposalHeaders.get('Idempotency-Key')).toMatch(
      /^PFC_AIUX_DECIDE_ACTION_PROPOSAL_/,
    );
    expect(JSON.parse(String(proposalInit.body))).toEqual({
      schemaVersion: 'action-proposal-decision/1',
      decision: 'CONFIRM',
      scopeHash: `sha256:${'a'.repeat(64)}`,
      reasonCode: 'PRODUCT_OWNER_CONFIRMED',
    });

    expect(fetchMock.mock.calls[2]![0]).toBe(
      '/api/v1/work-sessions/CODEx_TEST_AIUX_UI_SESSION/readiness',
    );
    const grantCall = fetchMock.mock.calls[3]!;
    const grantInit = grantCall[1]!;
    expect(grantCall[0]).toBe(
      '/api/v1/work-sessions/CODEx_TEST_AIUX_UI_SESSION/transmission-authorizations',
    );
    expect(new Headers(grantInit.headers).get('Idempotency-Key')).toMatch(
      /^PFC_AIUX_GRANT_PRODUCT_WORK_TRANSMISSION_/,
    );
    expect(JSON.parse(String(grantInit.body))).toEqual({
      schemaVersion: 'create-product-work-transmission-authorization/1',
      beneficiaryActorId: 'CODEx_TEST_AIUX_UI_ACTOR',
      materialRefIds: ['CODEx_TEST_AIUX_UI_MATERIAL'],
      validForMinutes: 15,
    });
    const revokeCall = fetchMock.mock.calls[4]!;
    const revokeInit = revokeCall[1]!;
    expect(revokeCall[0]).toBe(
      '/api/v1/transmission-authorizations/CODEx_TEST_AIUX_UI_AUTH/revocations',
    );
    expect(new Headers(revokeInit.headers).get('If-Match')).toBe('"0"');
    expect(JSON.parse(String(revokeInit.body))).toEqual({
      schemaVersion: 'revoke-product-work-transmission-authorization/1',
    });
  });

  it('replays named server events and releases EventSource listeners', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onSignal = vi.fn();
    const unsubscribe = workSessionsApi.subscribe(
      'CODEx_TEST_AIUX_UI_SESSION',
      6,
      onSignal,
    );
    const source = FakeEventSource.current!;

    expect(source.url).toBe(
      '/api/v1/work-sessions/CODEx_TEST_AIUX_UI_SESSION/events?after=6',
    );
    source.emit('TURN_COMPLETED', { sequence: 7 });
    expect(onSignal).toHaveBeenCalledWith({
      type: 'TURN_COMPLETED',
      sequence: 7,
    });

    unsubscribe();
    expect(source.close).toHaveBeenCalledTimes(1);
    source.emit('TURN_COMPLETED', { sequence: 8 });
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('distinguishes connecting, synchronized, retrying and offline states', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const onState = vi.fn();
    const unsubscribe = workSessionsApi.subscribe(
      'CODEx_TEST_AIUX_UI_SESSION',
      6,
      vi.fn(),
      undefined,
      onState,
    );
    const source = FakeEventSource.current!;

    expect(onState).toHaveBeenLastCalledWith('CONNECTING');
    source.onopen?.();
    expect(onState).toHaveBeenLastCalledWith('SYNCED');
    source.onerror?.();
    expect(onState).toHaveBeenLastCalledWith('RETRYING');
    vi.advanceTimersByTime(45_000);
    expect(onState).toHaveBeenLastCalledWith('OFFLINE');
    source.onopen?.();
    expect(onState).toHaveBeenLastCalledWith('SYNCED');

    unsubscribe();
    vi.useRealTimers();
  });
});
