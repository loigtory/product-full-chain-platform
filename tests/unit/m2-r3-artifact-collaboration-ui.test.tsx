// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactWorkspacePage } from '../../apps/web/src/artifact-workspace/ArtifactWorkspacePage.tsx';
import { artifactCollaborationApi } from '../../apps/web/src/artifact-workspace/api.ts';
import { PlatformApiError } from '../../apps/web/src/platform/api-client.ts';
import type { CurrentActorDto } from '../../packages/contracts/src/index.ts';
import {
  ArtifactDiffView,
  ArtifactReviewTimeline,
  ArtifactTraceList,
  ArtifactVersionRail,
} from '../../packages/ui/src/index.ts';

const actor: CurrentActorDto = {
  actorId: 'CODEx_TEST_M2R3_UI_ACCOUNT',
  loginName: 'codex.m2r3.ui',
  displayName: '陈立',
  roles: ['PRODUCT_OWNER'],
  teams: [
    {
      id: 'CODEx_TEST_M2R3_UI_TEAM',
      name: '产品平台组',
      role: 'PRODUCT_OWNER',
      status: 'ACTIVE',
    },
  ],
  currentTeamId: 'CODEx_TEST_M2R3_UI_TEAM',
  csrfToken: 'CODEx_TEST_M2R3_UI_CSRF',
};

const artifact = {
  id: 'CODEx_TEST_M2R3_UI_ARTIFACT',
  requirementId: 'CODEx_TEST_M2R3_UI_REQ',
  capId: 'CAP-PFC-02',
  stage: 'G3' as const,
  artifactType: 'PRD',
  title: '渠道结算需求规格',
  status: 'ACTIVE' as const,
  currentVersionId: 'CODEx_TEST_M2R3_UI_V2',
  rowVersion: 2,
  versions: [
    {
      id: 'CODEx_TEST_M2R3_UI_V1',
      artifactId: 'CODEx_TEST_M2R3_UI_ARTIFACT',
      versionLabel: 'V0.1',
      sourceType: 'WORKSPACE_RELATIVE' as const,
      sourceRef: 'docs/channel-settlement.md',
      contentHash: `sha256:${'1'.repeat(64)}`,
      sensitivity: 'INTERNAL' as const,
      createdBy: actor.actorId,
      createdAt: '2026-09-09T01:00:00.000Z',
    },
    {
      id: 'CODEx_TEST_M2R3_UI_V2',
      artifactId: 'CODEx_TEST_M2R3_UI_ARTIFACT',
      versionLabel: 'V0.2',
      sourceType: 'WORKSPACE_RELATIVE' as const,
      sourceRef: 'docs/channel-settlement.md',
      contentHash: `sha256:${'2'.repeat(64)}`,
      sensitivity: 'INTERNAL' as const,
      createdBy: actor.actorId,
      createdAt: '2026-09-09T02:00:00.000Z',
    },
  ],
  createdAt: '2026-09-09T01:00:00.000Z',
  updatedAt: '2026-09-09T02:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M2 R3 shared artifact collaboration patterns', () => {
  it('keeps version, diff, review, and trace states accessible', () => {
    const onSelect = vi.fn();
    render(
      <>
        <ArtifactVersionRail
          currentVersionId="V2"
          onSelect={onSelect}
          selectedVersionId="V1"
          versions={[
            { id: 'V1', label: 'V0.1', meta: '陈立', createdAt: '09/09 09:00' },
            { id: 'V2', label: 'V0.2', meta: '陈立', createdAt: '09/09 10:00' },
          ]}
        />
        <ArtifactDiffView
          changes={[
            { kind: 'REMOVED', lines: ['旧结算口径'] },
            { kind: 'ADDED', lines: ['新结算口径'] },
          ]}
          fromLabel="V0.1"
          toLabel="V0.2"
        />
        <ArtifactReviewTimeline
          items={[
            {
              id: 'REVIEW_1',
              conclusion: 'APPROVED',
              responsibility: 'PRODUCT',
              comment: '产品口径已确认',
              reviewer: '陈立',
              createdAt: '09/09 10:30',
            },
          ]}
        />
        <ArtifactTraceList
          items={[
            {
              id: 'TRACE_1',
              direction: 'INCOMING',
              relation: 'DERIVED_FROM',
              subject: '来源材料',
              locator: 'docs/source.md#L12',
              validity: 'VALID',
            },
          ]}
        />
      </>,
    );

    expect(
      screen.getByRole('button', { name: /V0.1/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText('当前版本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /V0.2/ }));
    expect(onSelect).toHaveBeenCalledWith('V2');
    expect(screen.getByText('旧结算口径')).toBeTruthy();
    expect(screen.getByText('产品口径已确认')).toBeTruthy();
    expect(screen.getByText('来源材料')).toBeTruthy();
  });
});

describe('M2 R3 artifact workspace page', () => {
  it('loads a versioned artifact and moves between content, diff, review, and trace views', async () => {
    vi.spyOn(artifactCollaborationApi, 'getArtifact').mockResolvedValue(
      artifact,
    );
    vi.spyOn(artifactCollaborationApi, 'getContent').mockImplementation(
      async (_artifactId, versionId) => ({
        schemaVersion: 'artifact-version-content/1',
        artifactVersionId: versionId,
        mediaType: 'text/markdown',
        availability: 'AVAILABLE',
        content:
          versionId === 'CODEx_TEST_M2R3_UI_V2'
            ? '# 结算口径\n以审批通过的费率版本为准。'
            : '# 结算口径\n待确认。',
        contentHash: artifact.versions.find((item) => item.id === versionId)!
          .contentHash,
        byteSize: 42,
        lineCount: 2,
        createdAt: '2026-09-09T02:00:00.000Z',
      }),
    );
    vi.spyOn(artifactCollaborationApi, 'getDiff').mockResolvedValue({
      schemaVersion: 'artifact-diff/1',
      artifactId: artifact.id,
      fromVersionId: artifact.versions[0]!.id,
      fromContentHash: artifact.versions[0]!.contentHash,
      toVersionId: artifact.versions[1]!.id,
      toContentHash: artifact.versions[1]!.contentHash,
      ignoreWhitespace: false,
      changes: [
        { kind: 'REMOVED', lines: ['待确认。'] },
        { kind: 'ADDED', lines: ['以审批通过的费率版本为准。'] },
      ],
      totalChangedLineCount: 2,
      returnedChangedLineCount: 2,
      totalHunkCount: 1,
      returnedHunkCount: 1,
      truncated: false,
    });
    vi.spyOn(artifactCollaborationApi, 'listReviews').mockResolvedValue([
      {
        schemaVersion: 'artifact-review/1',
        id: 'CODEx_TEST_M2R3_UI_REVIEW',
        artifactId: artifact.id,
        artifactVersionId: artifact.currentVersionId,
        artifactContentHash: artifact.versions[1]!.contentHash,
        conclusion: 'APPROVED',
        responsibility: 'PRODUCT',
        comment: '产品口径已确认',
        reviewedBy: actor.actorId,
        supersedesReviewId: null,
        createdAt: '2026-09-09T02:30:00.000Z',
      },
    ]);
    vi.spyOn(
      artifactCollaborationApi,
      'getTraceGraphForVersion',
    ).mockResolvedValue({
      subject: {
        schemaVersion: 'trace-subject/1',
        id: 'CODEx_TEST_M2R3_UI_SUBJECT',
        requirementId: artifact.requirementId,
        subjectType: 'ARTIFACT_VERSION',
        nativeId: artifact.currentVersionId,
        nativeVersion: 'V0.2',
        contentHash: artifact.versions[1]!.contentHash,
        authorityArtifactVersionId: artifact.currentVersionId,
        locator: 'artifact://CODEx_TEST_M2R3_UI_ARTIFACT/V0.2',
        validity: 'VALID',
        createdAt: '2026-09-09T02:00:00.000Z',
      },
      subjects: [
        {
          schemaVersion: 'trace-subject/1',
          id: 'CODEx_TEST_M2R3_UI_SOURCE',
          requirementId: artifact.requirementId,
          subjectType: 'EVIDENCE',
          nativeId: 'CODEx_TEST_M2R3_UI_MATERIAL',
          nativeVersion: 'V1',
          contentHash: `sha256:${'3'.repeat(64)}`,
          authorityArtifactVersionId: artifact.currentVersionId,
          locator: 'docs/source.md#L12',
          validity: 'VALID',
          createdAt: '2026-09-09T01:30:00.000Z',
        },
      ],
      links: [
        {
          schemaVersion: 'trace-link/1',
          id: 'CODEx_TEST_M2R3_UI_TRACE',
          requirementId: artifact.requirementId,
          sourceSubjectId: 'CODEx_TEST_M2R3_UI_SOURCE',
          targetSubjectId: 'CODEx_TEST_M2R3_UI_SUBJECT',
          relationType: 'EVIDENCED_BY',
          validity: 'VALID',
          createdBy: actor.actorId,
          createdAt: '2026-09-09T02:00:00.000Z',
          invalidatedAt: null,
          invalidationReason: null,
        },
      ],
    });

    render(
      <ArtifactWorkspacePage
        actor={actor}
        artifactId={artifact.id}
        onLogout={vi.fn()}
        requirementId={artifact.requirementId}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: artifact.title }),
    ).toBeTruthy();
    expect(await screen.findByText('以审批通过的费率版本为准。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /V0.1/ }));
    await screen.findByText('待确认。');
    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(await screen.findByText('待确认。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '评审' }));
    expect(await screen.findByText('产品口径已确认')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '追溯' }));
    expect(await screen.findByText('来源材料')).toBeTruthy();
  });

  it('saves edited text as a new immutable version', async () => {
    vi.spyOn(artifactCollaborationApi, 'getArtifact').mockResolvedValue(
      artifact,
    );
    vi.spyOn(artifactCollaborationApi, 'getContent').mockResolvedValue({
      schemaVersion: 'artifact-version-content/1',
      artifactVersionId: artifact.currentVersionId,
      mediaType: 'text/markdown',
      availability: 'AVAILABLE',
      content: '# 结算口径',
      contentHash: artifact.versions[1]!.contentHash,
      byteSize: 16,
      lineCount: 1,
      createdAt: '2026-09-09T02:00:00.000Z',
    });
    vi.spyOn(artifactCollaborationApi, 'listReviews').mockResolvedValue([]);
    vi.spyOn(
      artifactCollaborationApi,
      'getTraceGraphForVersion',
    ).mockResolvedValue(null);
    const append = vi
      .spyOn(artifactCollaborationApi, 'appendVersion')
      .mockResolvedValue({ replayed: false, artifact });

    render(
      <ArtifactWorkspacePage
        actor={actor}
        artifactId={artifact.id}
        onLogout={vi.fn()}
        requirementId={artifact.requirementId}
      />,
    );
    await screen.findByRole('heading', { name: artifact.title });
    await screen.findByText('# 结算口径');
    fireEvent.click(screen.getByRole('button', { name: '编辑正文' }));
    fireEvent.change(screen.getByLabelText('新版本号'), {
      target: { value: 'V0.3' },
    });
    fireEvent.change(screen.getByLabelText('制品正文'), {
      target: { value: '# 结算口径\n新规则。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));

    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0]![2]).toMatchObject({
      versionLabel: 'V0.3',
      mediaType: 'text/markdown',
      content: '# 结算口径\n新规则。',
    });
    expect(append.mock.calls[0]![2]).not.toHaveProperty('contentHash');
  });

  it('keeps review and trace usable when a legacy version has no archived body', async () => {
    vi.spyOn(artifactCollaborationApi, 'getArtifact').mockResolvedValue(
      artifact,
    );
    vi.spyOn(artifactCollaborationApi, 'getContent').mockRejectedValue(
      new PlatformApiError(
        'ARTIFACT_CONTENT_UNAVAILABLE',
        'Artifact version content is not archived.',
        409,
      ),
    );
    vi.spyOn(artifactCollaborationApi, 'listReviews').mockResolvedValue([]);
    vi.spyOn(
      artifactCollaborationApi,
      'getTraceGraphForVersion',
    ).mockResolvedValue(null);

    render(
      <ArtifactWorkspacePage
        actor={actor}
        artifactId={artifact.id}
        onLogout={vi.fn()}
        requirementId={artifact.requirementId}
      />,
    );

    expect(
      await screen.findByText('该版本只有受控引用，没有可在线读取的正文。'),
    ).toBeTruthy();
    await act(async () => undefined);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '评审' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '追溯' })).toBeTruthy();
  });
});
