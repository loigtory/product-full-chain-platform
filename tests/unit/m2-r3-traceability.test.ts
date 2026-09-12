import { describe, expect, it } from 'vitest';

import {
  createTraceLink,
  createTraceSubject,
} from '../../packages/domain/src/traceability.ts';

const hash = `sha256:${'a'.repeat(64)}`;

describe('M2 R3 traceability rules', () => {
  it('requires CAP, Unit and AC nodes to bind an authoritative artifact version', () => {
    expect(() =>
      createTraceSubject({
        id: 'CODEx_TEST_M2R3_SUBJECT_UNIT',
        requirementId: 'CODEx_TEST_M2R3_REQUIREMENT_001',
        subjectType: 'UNIT',
        nativeId: 'UNIT-PFC-02-03',
        nativeVersion: 'V0.1/R3',
        contentHash: hash,
        authorityArtifactVersionId: null,
        locator: 'unit:UNIT-PFC-02-03',
        createdAt: '2026-09-09T01:00:00.000Z',
      }),
    ).toThrowError('TRACE_AUTHORITY_VERSION_REQUIRED');
  });

  it('rejects links across requirements', () => {
    const source = createTraceSubject({
      id: 'CODEx_TEST_M2R3_SUBJECT_REQUIREMENT',
      requirementId: 'CODEx_TEST_M2R3_REQUIREMENT_001',
      subjectType: 'REQUIREMENT',
      nativeId: 'CODEx_TEST_M2R3_REQUIREMENT_001',
      nativeVersion: '1',
      contentHash: hash,
      authorityArtifactVersionId: null,
      locator: 'requirement:CODEx_TEST_M2R3_REQUIREMENT_001',
      createdAt: '2026-09-09T01:00:00.000Z',
    });
    const target = createTraceSubject({
      id: 'CODEx_TEST_M2R3_SUBJECT_ARTIFACT',
      requirementId: 'CODEx_TEST_M2R3_REQUIREMENT_002',
      subjectType: 'ARTIFACT_VERSION',
      nativeId: 'CODEx_TEST_M2R3_VERSION_001',
      nativeVersion: 'V0.1',
      contentHash: hash,
      authorityArtifactVersionId: null,
      locator: 'artifact-version:CODEx_TEST_M2R3_VERSION_001',
      createdAt: '2026-09-09T01:00:00.000Z',
    });

    expect(() =>
      createTraceLink({
        id: 'CODEx_TEST_M2R3_LINK_001',
        requirementId: source.requirementId,
        source,
        target,
        relationType: 'SATISFIES',
        createdBy: 'CODEx_TEST_M2R3_ACCOUNT_001',
        createdAt: '2026-09-09T01:00:00.000Z',
      }),
    ).toThrowError('TRACE_CROSS_REQUIREMENT_FORBIDDEN');
  });
});
