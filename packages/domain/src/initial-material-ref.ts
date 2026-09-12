import { DomainRuleViolation } from './errors.ts';
import type { EvidenceRef, MaterialBaseline, Requirement } from './types.ts';

export function createInitialMaterialRef(input: {
  id: string;
  requirement: Requirement;
  baseline: MaterialBaseline;
  contentHash: string;
}): EvidenceRef {
  if (
    !input.id.trim() ||
    input.baseline.requirementId !== input.requirement.id ||
    input.requirement.currentBaselineId !== input.baseline.id ||
    input.baseline.status !== 'CURRENT' ||
    input.baseline.versionNumber !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(input.contentHash)
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Initial material reference binding is invalid.',
    );
  }

  return {
    id: input.id,
    baselineId: input.baseline.id,
    referenceType: 'ORIGINAL_IDEA',
    source: input.requirement.originalIdea,
    version: '1',
    contentHash: input.contentHash,
    location: `pfc://requirements/${encodeURIComponent(input.requirement.id)}/original-idea`,
    sensitivity: input.baseline.sensitivity,
    validity: 'VALID',
    createdAt: input.baseline.createdAt,
  };
}
