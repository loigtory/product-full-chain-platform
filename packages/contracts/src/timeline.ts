import type { EventSummary } from './lifecycle.ts';

export type TimelineEventDto = Readonly<{
  eventId: string;
  sequence: number;
  type: string;
  requirementId: string;
  aggregateVersion: number;
  occurredAt: string;
  beforeSummary: EventSummary | null;
  afterSummary: EventSummary;
}>;

export type TimelinePageResponse = Readonly<{
  items: readonly TimelineEventDto[];
  nextCursor: string | null;
  partial: boolean;
  checkedAt: string;
}>;
