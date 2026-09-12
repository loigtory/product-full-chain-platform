import type {
  ArtifactDto,
  ArtifactVersionContentDto,
  ArtifactVersionDto,
} from '@pfc/contracts';

export type ArtifactRepositoryMutationResult = Readonly<{
  status: 'CREATED' | 'REPLAYED' | 'CONFLICT' | 'VERSION_CONFLICT';
  artifact: ArtifactDto | null;
}>;

type EvidenceInput = Readonly<{
  actorId: string;
  route: string;
  idempotencyKey: string;
  requestHash: string;
  idempotencyId: string;
  eventId: string;
  outboxId: string;
  auditId: string;
  requestId: string;
}>;

export interface ArtifactRepositoryPort {
  findArtifactById(artifactId: string): Promise<ArtifactDto | null>;
  listArtifacts(requirementId: string): Promise<readonly ArtifactDto[]>;
  createArtifact(
    input: EvidenceInput & {
      artifact: Omit<ArtifactDto, 'currentVersionId' | 'versions'>;
      version: ArtifactVersionDto;
      content?: ArtifactVersionContentDto;
    },
  ): Promise<ArtifactRepositoryMutationResult>;
  appendVersion(
    input: EvidenceInput & {
      artifactId: string;
      requirementId: string;
      expectedRowVersion: number;
      version: ArtifactVersionDto;
      content?: ArtifactVersionContentDto;
    },
  ): Promise<ArtifactRepositoryMutationResult>;
}
