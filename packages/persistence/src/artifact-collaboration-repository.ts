import type {
  ArtifactReviewDto,
  ArtifactVersionContentDto,
  MutationEvidence,
  MutationPersistenceResult,
  TraceLinkDto,
  TraceSubjectDto,
  TraceSubjectType,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

type ScopedDatabase = ReturnType<LifecycleKysely['withSchema']>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapContent(row: {
  artifact_version_id: string;
  media_type: ArtifactVersionContentDto['mediaType'];
  availability: ArtifactVersionContentDto['availability'];
  content_text: string | null;
  content_hash: string;
  byte_size: number;
  line_count: number;
  created_at: Date | string;
}): ArtifactVersionContentDto {
  return {
    schemaVersion: 'artifact-version-content/1',
    artifactVersionId: row.artifact_version_id,
    mediaType: row.media_type,
    availability: row.availability,
    content: row.content_text,
    contentHash: row.content_hash,
    byteSize: row.byte_size,
    lineCount: row.line_count,
    createdAt: timestamp(row.created_at),
  };
}

function mapReview(row: {
  id: string;
  artifact_id: string;
  artifact_version_id: string;
  artifact_content_hash: string;
  conclusion: ArtifactReviewDto['conclusion'];
  responsibility: ArtifactReviewDto['responsibility'];
  comment: string | null;
  reviewed_by: string;
  supersedes_review_id: string | null;
  created_at: Date | string;
}): ArtifactReviewDto {
  return {
    schemaVersion: 'artifact-review/1',
    id: row.id,
    artifactId: row.artifact_id,
    artifactVersionId: row.artifact_version_id,
    artifactContentHash: row.artifact_content_hash,
    conclusion: row.conclusion,
    responsibility: row.responsibility,
    comment: row.comment,
    reviewedBy: row.reviewed_by,
    supersedesReviewId: row.supersedes_review_id,
    createdAt: timestamp(row.created_at),
  };
}

function mapTraceSubject(row: {
  id: string;
  requirement_id: string;
  subject_type: TraceSubjectDto['subjectType'];
  native_id: string;
  native_version: string;
  content_hash: string;
  authority_artifact_version_id: string | null;
  locator: string;
  validity: TraceSubjectDto['validity'];
  created_at: Date | string;
}): TraceSubjectDto {
  return {
    schemaVersion: 'trace-subject/1',
    id: row.id,
    requirementId: row.requirement_id,
    subjectType: row.subject_type,
    nativeId: row.native_id,
    nativeVersion: row.native_version,
    contentHash: row.content_hash,
    authorityArtifactVersionId: row.authority_artifact_version_id,
    locator: row.locator,
    validity: row.validity,
    createdAt: timestamp(row.created_at),
  };
}

function mapTraceLink(row: {
  id: string;
  requirement_id: string;
  source_subject_id: string;
  target_subject_id: string;
  relation_type: TraceLinkDto['relationType'];
  validity: TraceLinkDto['validity'];
  created_by: string;
  created_at: Date | string;
  invalidated_at: Date | string | null;
  invalidation_reason: string | null;
}): TraceLinkDto {
  return {
    schemaVersion: 'trace-link/1',
    id: row.id,
    requirementId: row.requirement_id,
    sourceSubjectId: row.source_subject_id,
    targetSubjectId: row.target_subject_id,
    relationType: row.relation_type,
    validity: row.validity,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    invalidatedAt: row.invalidated_at ? timestamp(row.invalidated_at) : null,
    invalidationReason: row.invalidation_reason,
  };
}

export interface ArtifactCollaborationRepositoryPort {
  saveVersionContent(
    content: ArtifactVersionContentDto,
  ): Promise<ArtifactVersionContentDto>;
  findVersionContent(input: {
    artifactId: string;
    versionId: string;
  }): Promise<ArtifactVersionContentDto | null>;
  findVersionContext(versionId: string): Promise<ArtifactVersionContext | null>;
  createReview(input: {
    review: ArtifactReviewDto;
    evidence: MutationEvidence;
    expectedArtifactRowVersion?: number;
  }): Promise<MutationPersistenceResult<ArtifactReviewDto>>;
  listReviews(versionId: string): Promise<readonly ArtifactReviewDto[]>;
  createTraceSubject(input: {
    subject: TraceSubjectDto;
    evidence: MutationEvidence;
  }): Promise<MutationPersistenceResult<TraceSubjectDto>>;
  createTraceLink(input: {
    link: TraceLinkDto;
    evidence: MutationEvidence;
    expectedRequirementRowVersion?: number;
  }): Promise<MutationPersistenceResult<TraceLinkDto>>;
  invalidateTraceLink(input: {
    linkId: string;
    requirementId: string;
    reason: string;
    invalidatedAt: string;
    evidence: MutationEvidence;
    expectedRequirementRowVersion: number;
  }): Promise<MutationPersistenceResult<TraceLinkDto>>;
  findTraceSubject(subjectId: string): Promise<TraceSubjectDto | null>;
  findTraceSubjectByNative(input: {
    requirementId: string;
    subjectType: TraceSubjectType;
    nativeId: string;
  }): Promise<TraceSubjectDto | null>;
  findTraceLink(linkId: string): Promise<TraceLinkDto | null>;
  findRequirementRowVersion(requirementId: string): Promise<number | null>;
  listTraceGraph(input: {
    requirementId: string;
    subjectId: string;
    direction: 'INCOMING' | 'OUTGOING' | 'BOTH';
  }): Promise<{
    subjects: readonly TraceSubjectDto[];
    links: readonly TraceLinkDto[];
  }>;
}

export type ArtifactVersionContext = Readonly<{
  artifactId: string;
  requirementId: string;
  artifactRowVersion: number;
  currentVersionId: string;
  versionId: string;
  contentHash: string;
  sensitivity: 'INTERNAL' | 'RESTRICTED' | 'PUBLIC';
}>;

export class PostgresArtifactCollaborationRepository implements ArtifactCollaborationRepositoryPort {
  private readonly db: ScopedDatabase;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async saveVersionContent(
    content: ArtifactVersionContentDto,
  ): Promise<ArtifactVersionContentDto> {
    const row = await this.db
      .insertInto('artifact_version_contents')
      .values({
        artifact_version_id: content.artifactVersionId,
        media_type: content.mediaType,
        availability: content.availability,
        content_text: content.content,
        content_hash: content.contentHash,
        byte_size: content.byteSize,
        line_count: content.lineCount,
        created_at: content.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapContent(row);
  }

  async findVersionContent(input: {
    artifactId: string;
    versionId: string;
  }): Promise<ArtifactVersionContentDto | null> {
    const row = await this.db
      .selectFrom('artifact_version_contents')
      .innerJoin(
        'artifact_versions',
        'artifact_versions.id',
        'artifact_version_contents.artifact_version_id',
      )
      .selectAll('artifact_version_contents')
      .where('artifact_versions.artifact_id', '=', input.artifactId)
      .where('artifact_versions.id', '=', input.versionId)
      .executeTakeFirst();
    return row ? mapContent(row) : null;
  }

  async findVersionContext(
    versionId: string,
  ): Promise<ArtifactVersionContext | null> {
    const row = await this.db
      .selectFrom('artifact_versions')
      .innerJoin('artifacts', 'artifacts.id', 'artifact_versions.artifact_id')
      .select([
        'artifacts.id as artifact_id',
        'artifacts.requirement_id',
        'artifacts.row_version',
        'artifacts.current_version_id',
        'artifact_versions.id as version_id',
        'artifact_versions.content_hash',
        'artifact_versions.sensitivity',
      ])
      .where('artifact_versions.id', '=', versionId)
      .executeTakeFirst();
    if (!row || !row.current_version_id) return null;
    return {
      artifactId: row.artifact_id,
      requirementId: row.requirement_id,
      artifactRowVersion: row.row_version,
      currentVersionId: row.current_version_id,
      versionId: row.version_id,
      contentHash: row.content_hash,
      sensitivity: row.sensitivity,
    };
  }

  async createReview(input: {
    review: ArtifactReviewDto;
    evidence: MutationEvidence;
    expectedArtifactRowVersion?: number;
  }): Promise<MutationPersistenceResult<ArtifactReviewDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.evidence);
      if (claim.status !== 'NEW') {
        const row = claim.resultReference
          ? await transaction
              .selectFrom('artifact_reviews')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return { status: claim.status, value: row ? mapReview(row) : null };
      }
      const review = input.review;
      if (input.expectedArtifactRowVersion !== undefined) {
        const artifact = await transaction
          .selectFrom('artifacts')
          .select(['row_version'])
          .where('id', '=', review.artifactId)
          .forUpdate()
          .executeTakeFirst();
        if (
          !artifact ||
          artifact.row_version !== input.expectedArtifactRowVersion
        ) {
          throw new Error('ARTIFACT_REVIEW_VERSION_STALE');
        }
      }
      const row = await transaction
        .insertInto('artifact_reviews')
        .values({
          id: review.id,
          artifact_id: review.artifactId,
          artifact_version_id: review.artifactVersionId,
          artifact_content_hash: review.artifactContentHash,
          conclusion: review.conclusion,
          responsibility: review.responsibility,
          comment: review.comment,
          reviewed_by: review.reviewedBy,
          supersedes_review_id: review.supersedesReviewId,
          created_at: review.createdAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.evidence);
      return { status: 'CREATED', value: mapReview(row) };
    });
  }

  async listReviews(versionId: string): Promise<readonly ArtifactReviewDto[]> {
    const rows = await this.db
      .selectFrom('artifact_reviews')
      .selectAll()
      .where('artifact_version_id', '=', versionId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map(mapReview);
  }

  async createTraceSubject(input: {
    subject: TraceSubjectDto;
    evidence: MutationEvidence;
  }): Promise<MutationPersistenceResult<TraceSubjectDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.evidence);
      if (claim.status !== 'NEW') {
        const row = claim.resultReference
          ? await transaction
              .selectFrom('trace_subjects')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return {
          status: claim.status,
          value: row ? mapTraceSubject(row) : null,
        };
      }
      const subject = input.subject;
      const row = await transaction
        .insertInto('trace_subjects')
        .values({
          id: subject.id,
          requirement_id: subject.requirementId,
          subject_type: subject.subjectType,
          native_id: subject.nativeId,
          native_version: subject.nativeVersion,
          content_hash: subject.contentHash,
          authority_artifact_version_id: subject.authorityArtifactVersionId,
          locator: subject.locator,
          validity: subject.validity,
          created_at: subject.createdAt,
          invalidated_at: null,
          invalidation_reason: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.evidence);
      return { status: 'CREATED', value: mapTraceSubject(row) };
    });
  }

  async createTraceLink(input: {
    link: TraceLinkDto;
    evidence: MutationEvidence;
    expectedRequirementRowVersion?: number;
  }): Promise<MutationPersistenceResult<TraceLinkDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.evidence);
      if (claim.status !== 'NEW') {
        const row = claim.resultReference
          ? await transaction
              .selectFrom('trace_links')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return { status: claim.status, value: row ? mapTraceLink(row) : null };
      }
      const link = input.link;
      if (input.expectedRequirementRowVersion !== undefined) {
        const requirement = await transaction
          .selectFrom('requirements')
          .select('row_version')
          .where('id', '=', link.requirementId)
          .forUpdate()
          .executeTakeFirst();
        if (
          !requirement ||
          requirement.row_version !== input.expectedRequirementRowVersion
        ) {
          throw new Error('VERSION_CONFLICT');
        }
      }
      const row = await transaction
        .insertInto('trace_links')
        .values({
          id: link.id,
          requirement_id: link.requirementId,
          source_subject_id: link.sourceSubjectId,
          target_subject_id: link.targetSubjectId,
          relation_type: link.relationType,
          validity: link.validity,
          created_by: link.createdBy,
          created_at: link.createdAt,
          invalidated_at: link.invalidatedAt,
          invalidation_reason: link.invalidationReason,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.evidence);
      return { status: 'CREATED', value: mapTraceLink(row) };
    });
  }

  async invalidateTraceLink(input: {
    linkId: string;
    requirementId: string;
    reason: string;
    invalidatedAt: string;
    evidence: MutationEvidence;
    expectedRequirementRowVersion: number;
  }): Promise<MutationPersistenceResult<TraceLinkDto>> {
    return this.db.transaction().execute(async (transaction) => {
      const claim = await claimMutation(transaction, input.evidence);
      if (claim.status !== 'NEW') {
        const row = claim.resultReference
          ? await transaction
              .selectFrom('trace_links')
              .selectAll()
              .where('id', '=', claim.resultReference)
              .executeTakeFirst()
          : undefined;
        return { status: claim.status, value: row ? mapTraceLink(row) : null };
      }
      const requirement = await transaction
        .selectFrom('requirements')
        .select('row_version')
        .where('id', '=', input.requirementId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !requirement ||
        requirement.row_version !== input.expectedRequirementRowVersion
      ) {
        throw new Error('VERSION_CONFLICT');
      }
      const current = await transaction
        .selectFrom('trace_links')
        .selectAll()
        .where('id', '=', input.linkId)
        .where('requirement_id', '=', input.requirementId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new Error('NOT_FOUND');
      if (current.validity !== 'VALID') throw new Error('TRACE_FACT_IMMUTABLE');
      const row = await transaction
        .updateTable('trace_links')
        .set({
          validity: 'INVALIDATED',
          invalidated_at: input.invalidatedAt,
          invalidation_reason: input.reason,
        })
        .where('id', '=', input.linkId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.evidence);
      return { status: 'CREATED', value: mapTraceLink(row) };
    });
  }

  async findTraceSubject(subjectId: string): Promise<TraceSubjectDto | null> {
    const row = await this.db
      .selectFrom('trace_subjects')
      .selectAll()
      .where('id', '=', subjectId)
      .executeTakeFirst();
    return row ? mapTraceSubject(row) : null;
  }

  async findTraceSubjectByNative(input: {
    requirementId: string;
    subjectType: TraceSubjectType;
    nativeId: string;
  }): Promise<TraceSubjectDto | null> {
    const row = await this.db
      .selectFrom('trace_subjects')
      .selectAll()
      .where('requirement_id', '=', input.requirementId)
      .where('subject_type', '=', input.subjectType)
      .where('native_id', '=', input.nativeId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return row ? mapTraceSubject(row) : null;
  }

  async findTraceLink(linkId: string): Promise<TraceLinkDto | null> {
    const row = await this.db
      .selectFrom('trace_links')
      .selectAll()
      .where('id', '=', linkId)
      .executeTakeFirst();
    return row ? mapTraceLink(row) : null;
  }

  async findRequirementRowVersion(
    requirementId: string,
  ): Promise<number | null> {
    const row = await this.db
      .selectFrom('requirements')
      .select('row_version')
      .where('id', '=', requirementId)
      .executeTakeFirst();
    return row?.row_version ?? null;
  }

  async listTraceGraph(input: {
    requirementId: string;
    subjectId: string;
    direction: 'INCOMING' | 'OUTGOING' | 'BOTH';
  }): Promise<{
    subjects: readonly TraceSubjectDto[];
    links: readonly TraceLinkDto[];
  }> {
    let query = this.db
      .selectFrom('trace_links')
      .selectAll()
      .where('requirement_id', '=', input.requirementId);
    query =
      input.direction === 'INCOMING'
        ? query.where('target_subject_id', '=', input.subjectId)
        : input.direction === 'OUTGOING'
          ? query.where('source_subject_id', '=', input.subjectId)
          : query.where((expression) =>
              expression.or([
                expression('source_subject_id', '=', input.subjectId),
                expression('target_subject_id', '=', input.subjectId),
              ]),
            );
    const linkRows = await query.orderBy('created_at', 'asc').execute();
    const subjectIds = Array.from(
      new Set([
        input.subjectId,
        ...linkRows.flatMap((row) => [
          row.source_subject_id,
          row.target_subject_id,
        ]),
      ]),
    );
    const subjectRows = await this.db
      .selectFrom('trace_subjects')
      .selectAll()
      .where('requirement_id', '=', input.requirementId)
      .where('id', 'in', subjectIds)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return {
      subjects: subjectRows.map(mapTraceSubject),
      links: linkRows.map(mapTraceLink),
    };
  }
}
