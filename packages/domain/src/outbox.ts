import type { EventSummary } from '@pfc/contracts';

import { DomainRuleViolation } from './errors.ts';
import type { OutboxEvent } from './types.ts';

const sensitiveSummaryField =
  /(body|content|idea|answer|prompt|password|secret|credential|token|cookie|authorization)/i;
const maximumSummaryFields = 32;
const maximumSummaryStringLength = 500;

function requireNonBlank(value: string, field: string): void {
  if (!value.trim()) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${field} must not be blank.`,
      { field },
    );
  }
}

export function assertSafeEventSummary(summary: EventSummary): void {
  const entries = Object.entries(summary);
  if (entries.length > maximumSummaryFields) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Event summary contains too many fields.',
      { maximumFields: maximumSummaryFields },
    );
  }

  for (const [field, value] of entries) {
    if (!field.trim() || sensitiveSummaryField.test(field)) {
      throw new DomainRuleViolation(
        'SENSITIVE_SUMMARY_FIELD',
        'Event summaries cannot contain body, answer, or credential fields.',
        { field },
      );
    }
    const valueIsScalar =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
    if (
      !valueIsScalar ||
      (typeof value === 'string' &&
        value.length > maximumSummaryStringLength) ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Event summary values must be bounded JSON scalars.',
        { field },
      );
    }
  }
}

export function createOutboxEvent(input: {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  summary: EventSummary;
}): OutboxEvent {
  requireNonBlank(input.id, 'id');
  requireNonBlank(input.type, 'type');
  requireNonBlank(input.aggregateType, 'aggregateType');
  requireNonBlank(input.aggregateId, 'aggregateId');

  assertSafeEventSummary(input.summary);

  return {
    ...input,
    summary: Object.freeze({ ...input.summary }),
    status: 'PENDING',
  };
}
