import { randomUUID } from 'node:crypto';

import type {
  ActorContext,
  ArtifactDiffDto,
  CreateArtifactReviewRequest,
  CreateTraceLinkRequest,
  RequirementAction,
  TraceSubjectType,
} from '@pfc/contracts';
import {
  createArtifactReview,
  createTraceLink,
  DomainRuleViolation,
} from '@pfc/domain';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import { createMutationEvidence } from '../mutation-evidence.ts';
import type { ArtifactRepositoryPort } from '../artifacts/repository-port.ts';
import { createArtifactTextDiff } from './artifact-diff.ts';
import type { ArtifactCollaborationRepositoryPort } from './repository-port.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

export class ArtifactCollaborationApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly input: {
      artifacts: ArtifactRepositoryPort;
      repository: ArtifactCollaborationRepositoryPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
      idFactory?: (prefix: string) => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  private async assertAccess(
    actor: ActorContext,
    requirementId: string,
    action: RequirementAction,
    sensitivity: 'INTERNAL' | 'RESTRICTED' | 'PUBLIC' = 'RESTRICTED',
  ): Promise<void> {
    const decision = await this.input.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity,
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'Artifact collaboration access denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  async getArtifact(actor: ActorContext, artifactId: string) {
    const artifact = await this.input.artifacts.findArtifactById(artifactId);
    if (!artifact)
      throw new DomainRuleViolation('NOT_FOUND', 'Artifact not found.');
    await this.assertAccess(actor, artifact.requirementId, 'VIEW_ARTIFACT');
    return artifact;
  }

  async getContent(input: {
    actor: ActorContext;
    artifactId: string;
    versionId: string;
  }) {
    const artifact = await this.getArtifact(input.actor, input.artifactId);
    if (!artifact.versions.some(({ id }) => id === input.versionId)) {
      throw new DomainRuleViolation('NOT_FOUND', 'Artifact version not found.');
    }
    const content = await this.input.repository.findVersionContent(input);
    if (
      !content ||
      content.availability !== 'AVAILABLE' ||
      content.content === null
    ) {
      throw new DomainRuleViolation(
        'ARTIFACT_CONTENT_UNAVAILABLE',
        'Artifact version content is not archived.',
      );
    }
    return content;
  }

  async diff(input: {
    actor: ActorContext;
    artifactId: string;
    fromVersionId: string;
    toVersionId: string;
    ignoreWhitespace: boolean;
  }): Promise<ArtifactDiffDto> {
    const [from, to] = await Promise.all([
      this.getContent({
        actor: input.actor,
        artifactId: input.artifactId,
        versionId: input.fromVersionId,
      }),
      this.getContent({
        actor: input.actor,
        artifactId: input.artifactId,
        versionId: input.toVersionId,
      }),
    ]);
    try {
      return createArtifactTextDiff({
        artifactId: input.artifactId,
        from: {
          versionId: from.artifactVersionId,
          contentHash: from.contentHash,
          content: from.content!,
        },
        to: {
          versionId: to.artifactVersionId,
          contentHash: to.contentHash,
          content: to.content!,
        },
        ignoreWhitespace: input.ignoreWhitespace,
      });
    } catch (error) {
      if (errorMessage(error) === 'ARTIFACT_DIFF_TIMEOUT') {
        throw new DomainRuleViolation(
          'ARTIFACT_DIFF_LIMIT_EXCEEDED',
          'Artifact diff exceeded its computation budget.',
        );
      }
      throw error;
    }
  }

  async listReviews(actor: ActorContext, versionId: string) {
    const context = await this.input.repository.findVersionContext(versionId);
    if (!context)
      throw new DomainRuleViolation('NOT_FOUND', 'Artifact version not found.');
    await this.assertAccess(
      actor,
      context.requirementId,
      'VIEW_ARTIFACT',
      context.sensitivity,
    );
    return this.input.repository.listReviews(versionId);
  }

  async review(input: {
    actor: ActorContext;
    versionId: string;
    request: CreateArtifactReviewRequest;
    expectedArtifactRowVersion: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    const context = await this.input.repository.findVersionContext(
      input.versionId,
    );
    if (!context)
      throw new DomainRuleViolation('NOT_FOUND', 'Artifact version not found.');
    await this.assertAccess(
      input.actor,
      context.requirementId,
      'REVIEW_ARTIFACT',
      context.sensitivity,
    );
    if (context.artifactRowVersion !== input.expectedArtifactRowVersion) {
      throw new DomainRuleViolation(
        'ARTIFACT_REVIEW_VERSION_STALE',
        'Artifact has changed since the review loaded.',
        { currentVersion: context.artifactRowVersion },
      );
    }
    const occurredAt = this.now();
    const review = createArtifactReview({
      id: this.idFactory('artifact-review'),
      artifactId: context.artifactId,
      artifactVersionId: context.versionId,
      artifactContentHash: context.contentHash,
      conclusion: input.request.conclusion,
      responsibility: input.request.responsibility,
      comment: input.request.comment ?? null,
      reviewedBy: input.actor.actorId,
      supersedesReviewId: input.request.supersedesReviewId ?? null,
      createdAt: occurredAt,
    });
    try {
      const result = await this.input.repository.createReview({
        review,
        expectedArtifactRowVersion: input.expectedArtifactRowVersion,
        evidence: createMutationEvidence({
          actorId: input.actor.actorId,
          route: `/api/v1/artifact-versions/${context.versionId}/reviews`,
          idempotencyKey: input.idempotencyKey,
          request: {
            ...input.request,
            expectedArtifactRowVersion: input.expectedArtifactRowVersion,
          },
          requestId: input.requestId,
          eventType: 'artifact.reviewed',
          aggregateType: 'artifact-review',
          aggregateId: review.id,
          aggregateVersion: 0,
          requirementId: context.requirementId,
          occurredAt,
          idFactory: this.idFactory,
        }),
      });
      if (result.status === 'CONFLICT') {
        throw new DomainRuleViolation(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency conflict.',
        );
      }
      if (!result.value)
        throw new DomainRuleViolation(
          'RESULT_UNKNOWN',
          'Review result is unknown.',
        );
      return { replayed: result.status === 'REPLAYED', review: result.value };
    } catch (error) {
      if (errorMessage(error).includes('ARTIFACT_REVIEW_VERSION_STALE')) {
        throw new DomainRuleViolation(
          'ARTIFACT_REVIEW_VERSION_STALE',
          'Artifact has changed since the review loaded.',
        );
      }
      throw error;
    }
  }

  async traceGraph(input: {
    actor: ActorContext;
    requirementId: string;
    subjectId?: string;
    subjectType?: TraceSubjectType;
    nativeId?: string;
    direction: 'INCOMING' | 'OUTGOING' | 'BOTH';
  }) {
    await this.assertAccess(input.actor, input.requirementId, 'VIEW_ARTIFACT');
    const subject = input.subjectId
      ? await this.input.repository.findTraceSubject(input.subjectId)
      : input.subjectType && input.nativeId
        ? await this.input.repository.findTraceSubjectByNative({
            requirementId: input.requirementId,
            subjectType: input.subjectType,
            nativeId: input.nativeId,
          })
        : null;
    if (!subject && !input.subjectId) return null;
    if (!subject || subject.requirementId !== input.requirementId) {
      throw new DomainRuleViolation(
        'TRACE_SUBJECT_UNVERIFIED',
        'Trace subject is not verified.',
      );
    }
    const graph = await this.input.repository.listTraceGraph({
      requirementId: input.requirementId,
      subjectId: subject.id,
      direction: input.direction,
    });
    return { subject, ...graph };
  }

  async createTraceLink(input: {
    actor: ActorContext;
    requirementId: string;
    request: CreateTraceLinkRequest;
    expectedRequirementRowVersion: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    await this.assertAccess(
      input.actor,
      input.requirementId,
      'MANAGE_TRACEABILITY',
    );
    const requirementRowVersion =
      await this.input.repository.findRequirementRowVersion(
        input.requirementId,
      );
    if (requirementRowVersion === null)
      throw new DomainRuleViolation('NOT_FOUND', 'Requirement not found.');
    if (requirementRowVersion !== input.expectedRequirementRowVersion) {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Requirement has changed.',
        {
          currentVersion: requirementRowVersion,
        },
      );
    }
    const [source, target] = await Promise.all([
      this.input.repository.findTraceSubject(input.request.sourceSubjectId),
      this.input.repository.findTraceSubject(input.request.targetSubjectId),
    ]);
    if (!source || !target) {
      throw new DomainRuleViolation(
        'TRACE_SUBJECT_UNVERIFIED',
        'Trace subject is not verified.',
      );
    }
    let link;
    try {
      link = createTraceLink({
        id: this.idFactory('trace-link'),
        requirementId: input.requirementId,
        source,
        target,
        relationType: input.request.relationType,
        createdBy: input.actor.actorId,
        createdAt: this.now(),
      });
    } catch (error) {
      if (errorMessage(error).includes('TRACE_CROSS_REQUIREMENT_FORBIDDEN')) {
        throw new DomainRuleViolation(
          'TRACE_CROSS_REQUIREMENT_FORBIDDEN',
          'Cross-requirement traces are forbidden.',
        );
      }
      throw error;
    }
    try {
      const result = await this.input.repository.createTraceLink({
        link,
        expectedRequirementRowVersion: input.expectedRequirementRowVersion,
        evidence: createMutationEvidence({
          actorId: input.actor.actorId,
          route: `/api/v1/requirements/${input.requirementId}/trace-links`,
          idempotencyKey: input.idempotencyKey,
          request: {
            ...input.request,
            expectedRequirementRowVersion: input.expectedRequirementRowVersion,
          },
          requestId: input.requestId,
          eventType: 'trace.link-created',
          aggregateType: 'trace-link',
          aggregateId: link.id,
          aggregateVersion: 0,
          requirementId: input.requirementId,
          occurredAt: link.createdAt,
          idFactory: this.idFactory,
        }),
      });
      if (result.status === 'CONFLICT')
        throw new DomainRuleViolation(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency conflict.',
        );
      if (!result.value)
        throw new DomainRuleViolation(
          'RESULT_UNKNOWN',
          'Trace result is unknown.',
        );
      return { replayed: result.status === 'REPLAYED', link: result.value };
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('trace_links_valid_unique')) {
        throw new DomainRuleViolation(
          'TRACE_LINK_ALREADY_EXISTS',
          'Trace link already exists.',
        );
      }
      if (message.includes('VERSION_CONFLICT')) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Requirement has changed.',
        );
      }
      throw error;
    }
  }

  async invalidateTraceLink(input: {
    actor: ActorContext;
    linkId: string;
    reason: string;
    expectedRequirementRowVersion: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    const current = await this.input.repository.findTraceLink(input.linkId);
    if (!current)
      throw new DomainRuleViolation('NOT_FOUND', 'Trace link not found.');
    await this.assertAccess(
      input.actor,
      current.requirementId,
      'MANAGE_TRACEABILITY',
    );
    const reason = input.reason.trim();
    if (!reason || reason.length > 240) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Invalidation reason is required.',
      );
    }
    const occurredAt = this.now();
    try {
      const result = await this.input.repository.invalidateTraceLink({
        linkId: current.id,
        requirementId: current.requirementId,
        reason,
        invalidatedAt: occurredAt,
        expectedRequirementRowVersion: input.expectedRequirementRowVersion,
        evidence: createMutationEvidence({
          actorId: input.actor.actorId,
          route: `/api/v1/trace-links/${current.id}/invalidations`,
          idempotencyKey: input.idempotencyKey,
          request: {
            reason,
            expectedRequirementRowVersion: input.expectedRequirementRowVersion,
          },
          requestId: input.requestId,
          eventType: 'trace.link-invalidated',
          aggregateType: 'trace-link',
          aggregateId: current.id,
          aggregateVersion: 1,
          requirementId: current.requirementId,
          occurredAt,
          idFactory: this.idFactory,
        }),
      });
      if (result.status === 'CONFLICT')
        throw new DomainRuleViolation(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency conflict.',
        );
      if (!result.value)
        throw new DomainRuleViolation(
          'RESULT_UNKNOWN',
          'Trace invalidation result is unknown.',
        );
      return { replayed: result.status === 'REPLAYED', link: result.value };
    } catch (error) {
      if (errorMessage(error).includes('VERSION_CONFLICT')) {
        throw new DomainRuleViolation(
          'VERSION_CONFLICT',
          'Requirement has changed.',
        );
      }
      throw error;
    }
  }
}
