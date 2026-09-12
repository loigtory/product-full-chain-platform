import type {
  ActorContext,
  AuthorizationPort,
  TimelineEventDto,
  TimelinePageResponse,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type { RequirementRepositoryPort } from '../requirements/repository-port.ts';

function toDto(
  item: import('../requirements/repository-port.ts').SequencedTimelineEvent,
): TimelineEventDto {
  return {
    eventId: item.event.id,
    sequence: item.sequence,
    type: item.event.eventType,
    requirementId: item.event.requirementId,
    aggregateVersion: item.event.aggregateVersion,
    occurredAt: item.event.occurredAt,
    beforeSummary: item.event.beforeSummary,
    afterSummary: item.event.afterSummary,
  };
}

export class TimelineApplicationService {
  private readonly authorization: RequirementAuthorizationService;

  constructor(
    private readonly input: {
      repository: RequirementRepositoryPort;
      authorizationPort: AuthorizationPort;
      now?: () => string;
    },
  ) {
    this.authorization = new RequirementAuthorizationService(
      input.authorizationPort,
    );
  }

  async listTimeline(
    actor: ActorContext,
    requirementId: string,
    input: { cursor: number | null; limit: number },
  ): Promise<TimelinePageResponse> {
    await this.authorize(actor, requirementId);
    const page = await this.input.repository.listTimelineEvents({
      requirementId,
      cursor: input.cursor,
      afterSequence: null,
      limit: input.limit,
    });
    return {
      items: page.items.map(toDto),
      nextCursor: page.nextCursor === null ? null : String(page.nextCursor),
      partial: false,
      checkedAt: this.now(),
    };
  }

  async replayTimeline(
    actor: ActorContext,
    requirementId: string,
    lastEventSequence: number,
    limit = 100,
  ): Promise<
    Readonly<{
      resetRequired: boolean;
      items: readonly TimelineEventDto[];
    }>
  > {
    await this.authorize(actor, requirementId);
    if (
      lastEventSequence > 0 &&
      !(await this.input.repository.hasTimelineEvent({
        requirementId,
        sequence: lastEventSequence,
      }))
    ) {
      return { resetRequired: true, items: [] };
    }
    const page = await this.input.repository.listTimelineEvents({
      requirementId,
      cursor: null,
      afterSequence: lastEventSequence,
      limit,
    });
    return { resetRequired: false, items: page.items.map(toDto) };
  }

  private now(): string {
    return this.input.now?.() ?? new Date().toISOString();
  }

  private async authorize(
    actor: ActorContext,
    requirementId: string,
  ): Promise<void> {
    const metadata =
      await this.input.repository.findRequirementAccessMetadata(requirementId);
    if (!metadata) {
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement was not found.');
    }
    const decision = await this.authorization.authorize(actor, {
      requirementId,
      action: 'VIEW_REQUIREMENT',
      sensitivity: metadata.sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Timeline access was denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }
}
