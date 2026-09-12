import type { ColumnType } from 'kysely';

import type {
  ArtifactContentAvailability,
  ArtifactContentMediaType,
  ArtifactReviewConclusion,
  ArtifactReviewResponsibility,
  TraceRelationType,
  TraceSubjectType,
  TraceValidity,
} from '@pfc/contracts';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface ArtifactVersionContentTable {
  artifact_version_id: string;
  media_type: ArtifactContentMediaType;
  availability: ArtifactContentAvailability;
  content_text: string | null;
  content_hash: string;
  byte_size: number;
  line_count: number;
  created_at: Timestamp;
}

export interface ArtifactReviewTable {
  id: string;
  artifact_id: string;
  artifact_version_id: string;
  artifact_content_hash: string;
  conclusion: ArtifactReviewConclusion;
  responsibility: ArtifactReviewResponsibility;
  comment: string | null;
  reviewed_by: string;
  supersedes_review_id: string | null;
  created_at: Timestamp;
}

export interface TraceSubjectTable {
  id: string;
  requirement_id: string;
  subject_type: TraceSubjectType;
  native_id: string;
  native_version: string;
  content_hash: string;
  authority_artifact_version_id: string | null;
  locator: string;
  validity: TraceValidity;
  created_at: Timestamp;
  invalidated_at: Timestamp | null;
  invalidation_reason: string | null;
}

export interface TraceLinkTable {
  id: string;
  requirement_id: string;
  source_subject_id: string;
  target_subject_id: string;
  relation_type: TraceRelationType;
  validity: TraceValidity;
  created_by: string;
  created_at: Timestamp;
  invalidated_at: Timestamp | null;
  invalidation_reason: string | null;
}

export interface M2R3DatabaseTables {
  artifact_version_contents: ArtifactVersionContentTable;
  artifact_reviews: ArtifactReviewTable;
  trace_subjects: TraceSubjectTable;
  trace_links: TraceLinkTable;
}
