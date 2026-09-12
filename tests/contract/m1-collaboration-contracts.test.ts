import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ACCOUNT_STATUSES,
  ARTIFACT_SOURCE_TYPES,
  ARTIFACT_STATUSES,
  MEMBERSHIP_STATUSES,
  WORKSPACE_ACCESS_LEVELS,
  type CurrentActorDto,
  type TeamDto,
} from '../../packages/contracts/src/index.ts';

describe('M1 collaboration contracts', () => {
  it('publishes bounded status vocabularies', () => {
    expect(ACCOUNT_STATUSES).toEqual(['ACTIVE', 'DISABLED']);
    expect(MEMBERSHIP_STATUSES).toEqual(['INVITED', 'ACTIVE', 'SUSPENDED']);
    expect(WORKSPACE_ACCESS_LEVELS).toEqual(['READ', 'WRITE']);
    expect(ARTIFACT_STATUSES).toEqual(['ACTIVE', 'ARCHIVED']);
    expect(ARTIFACT_SOURCE_TYPES).toEqual([
      'WORKSPACE_RELATIVE',
      'CONTROLLED_REFERENCE',
    ]);
  });

  it('does not expose password or session-token fields in actor/team DTOs', () => {
    expectTypeOf<CurrentActorDto>().not.toHaveProperty('passwordHash');
    expectTypeOf<CurrentActorDto>().not.toHaveProperty('sessionToken');
    expectTypeOf<TeamDto>().not.toHaveProperty('repositoryPath');
  });
});
