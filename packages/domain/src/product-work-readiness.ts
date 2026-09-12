import type {
  ProductWorkReadinessBlockerCode,
  ProductWorkReadinessBridgeStatus,
  ProductWorkReadinessTransmissionStatus,
} from '@pfc/contracts';

export type ProductWorkReadinessDecision = Readonly<{
  recommendedContextIds: readonly string[];
  recommendedSkillReleaseId: string | null;
  blockers: readonly ProductWorkReadinessBlockerCode[];
}>;

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

export function deriveProductWorkReadiness(input: {
  baselineId: string | null;
  contextIds: readonly string[];
  compatibleSkillReleaseIds: readonly string[];
  previousContextIds: readonly string[];
  previousSkillReleaseId: string | null;
  baselineUnchanged: boolean;
  bridgeStatus: ProductWorkReadinessBridgeStatus;
  transmissionStatus: ProductWorkReadinessTransmissionStatus;
}): ProductWorkReadinessDecision {
  const contextIds = uniqueSorted(input.contextIds);
  const skillIds = uniqueSorted(input.compatibleSkillReleaseIds);
  const blockers: ProductWorkReadinessBlockerCode[] = [];

  let recommendedContextIds: readonly string[] = [];
  if (!input.baselineId) {
    blockers.push('NO_CURRENT_BASELINE');
  } else if (contextIds.length === 0) {
    blockers.push('NO_VALID_CONTEXT');
  } else if (contextIds.length > 50) {
    blockers.push('CONTEXT_SELECTION_REQUIRED');
  } else {
    const previous = input.baselineUnchanged
      ? uniqueSorted(
          input.previousContextIds.filter((contextId) =>
            contextIds.includes(contextId),
          ),
        )
      : [];
    recommendedContextIds = previous.length > 0 ? previous : contextIds;
  }

  let recommendedSkillReleaseId: string | null = null;
  if (input.bridgeStatus === 'UNAVAILABLE') {
    blockers.push('BRIDGE_UNAVAILABLE');
  } else if (input.bridgeStatus === 'UNVERIFIED') {
    blockers.push('BRIDGE_UNVERIFIED');
  }
  if (skillIds.length === 0) {
    blockers.push('NO_COMPATIBLE_SKILL');
  } else if (
    input.previousSkillReleaseId &&
    skillIds.includes(input.previousSkillReleaseId)
  ) {
    recommendedSkillReleaseId = input.previousSkillReleaseId;
  } else if (skillIds.length === 1) {
    recommendedSkillReleaseId = skillIds[0]!;
  } else {
    blockers.push('SKILL_SELECTION_REQUIRED');
  }

  if (
    input.baselineId &&
    contextIds.length > 0 &&
    input.transmissionStatus === 'AUTHORIZATION_REQUIRED'
  ) {
    blockers.push('TRANSMISSION_AUTHORIZATION_REQUIRED');
  } else if (
    input.baselineId &&
    contextIds.length > 0 &&
    input.transmissionStatus === 'DENIED'
  ) {
    blockers.push('TRANSMISSION_DENIED');
  } else if (
    input.baselineId &&
    contextIds.length > 0 &&
    input.transmissionStatus === 'UNKNOWN'
  ) {
    blockers.push('TRANSMISSION_STATUS_UNKNOWN');
  }

  return {
    recommendedContextIds,
    recommendedSkillReleaseId,
    blockers,
  };
}
