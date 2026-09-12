import type { SkillReleaseDto } from '@pfc/contracts';

export interface SkillRepositoryPort {
  listActive(): Promise<readonly SkillReleaseDto[]>;
  findRelease(
    skillKey: string,
    version: string,
  ): Promise<SkillReleaseDto | null>;
}
