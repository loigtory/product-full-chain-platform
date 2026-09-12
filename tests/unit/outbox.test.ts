import { describe, expect, it } from 'vitest';

import {
  DomainRuleViolation,
  createOutboxEvent,
} from '../../packages/domain/src/index.ts';

describe('outbox event boundary', () => {
  it('creates an event from a bounded summary', () => {
    expect(
      createOutboxEvent({
        id: 'CODEx_TEST_T1_OUTBOX',
        type: 'requirement.created',
        aggregateType: 'requirement',
        aggregateId: 'CODEx_TEST_T1_REQ',
        aggregateVersion: 0,
        occurredAt: '2026-09-04T10:00:00.000Z',
        summary: { stage: 'G0', incomplete: true },
      }),
    ).toMatchObject({
      status: 'PENDING',
      summary: { stage: 'G0', incomplete: true },
    });
  });

  it.each(['originalIdea', 'rawAnswer', 'password', 'accessToken'])(
    'rejects sensitive or body-like summary field %s',
    (field) => {
      expect(() =>
        createOutboxEvent({
          id: 'CODEx_TEST_T1_OUTBOX_REJECTED',
          type: 'requirement.created',
          aggregateType: 'requirement',
          aggregateId: 'CODEx_TEST_T1_REQ',
          aggregateVersion: 0,
          occurredAt: '2026-09-04T10:00:00.000Z',
          summary: { [field]: 'must not leave the aggregate' },
        }),
      ).toThrowError(
        expect.objectContaining<Partial<DomainRuleViolation>>({
          code: 'SENSITIVE_SUMMARY_FIELD',
        }),
      );
    },
  );

  it('rejects nested or unbounded summary values at runtime', () => {
    expect(() =>
      createOutboxEvent({
        id: 'CODEx_TEST_T1_OUTBOX_NESTED',
        type: 'requirement.created',
        aggregateType: 'requirement',
        aggregateId: 'CODEx_TEST_T1_REQ',
        aggregateVersion: 0,
        occurredAt: '2026-09-04T10:00:00.000Z',
        summary: { stage: { value: 'G0' } } as never,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });
});
