import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, GitCompare, RefreshCw } from 'lucide-react';

import type {
  ArtifactDiffDto,
  ArtifactDto,
  ArtifactReviewDto,
  ArtifactVersionContentDto,
  CreateArtifactReviewRequest,
  CurrentActorDto,
} from '@pfc/contracts';
import {
  ArtifactDiffView,
  ArtifactVersionRail,
  ArtifactWorkspaceShell,
  Badge,
  Button,
  SegmentedControl,
} from '@pfc/ui';

import { PlatformPageShell } from '../platform/PlatformPageShell.tsx';
import { PlatformApiError } from '../platform/api-client.ts';
import { ArtifactContentPanel } from './ArtifactContentPanel.tsx';
import { ArtifactReviewPanel } from './ArtifactReviewPanel.tsx';
import { ArtifactTracePanel } from './ArtifactTracePanel.tsx';
import { artifactCollaborationApi, type ArtifactTraceGraphDto } from './api.ts';
import './artifact-workspace.css';

type CanvasMode = 'CONTENT' | 'DIFF';
type ContextMode = 'REVIEW' | 'TRACE';

export function ArtifactWorkspacePage({
  actor,
  artifactId,
  jobsEnabled = false,
  onLogout,
  requirementId,
}: {
  actor: CurrentActorDto;
  artifactId: string;
  jobsEnabled?: boolean;
  onLogout: () => void;
  requirementId: string;
}) {
  const [artifact, setArtifact] = useState<ArtifactDto | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [content, setContent] = useState<ArtifactVersionContentDto | null>(
    null,
  );
  const [reviews, setReviews] = useState<readonly ArtifactReviewDto[]>([]);
  const [traceGraph, setTraceGraph] = useState<ArtifactTraceGraphDto | null>(
    null,
  );
  const [diff, setDiff] = useState<ArtifactDiffDto | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('CONTENT');
  const [contextMode, setContextMode] = useState<ContextMode>('REVIEW');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [newVersionLabel, setNewVersionLabel] = useState('');

  const loadArtifact = useCallback(async () => {
    const result = await artifactCollaborationApi.getArtifact(artifactId);
    setArtifact(result);
    setSelectedVersionId((current) => current || result.currentVersionId);
    return result;
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    void artifactCollaborationApi
      .getArtifact(artifactId)
      .then((result) => {
        if (!active) return;
        setArtifact(result);
        setSelectedVersionId(result.currentVersionId);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : '制品读取失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  const selectedVersion = artifact?.versions.find(
    (version) => version.id === selectedVersionId,
  );

  useEffect(() => {
    if (!artifact || !selectedVersionId) return;
    let active = true;
    const version = artifact.versions.find(
      ({ id }) => id === selectedVersionId,
    )!;
    const contentRequest = artifactCollaborationApi
      .getContent(artifact.id, selectedVersionId)
      .catch((reason: unknown) => {
        if (
          reason instanceof PlatformApiError &&
          reason.code === 'ARTIFACT_CONTENT_UNAVAILABLE'
        ) {
          return {
            schemaVersion: 'artifact-version-content/1' as const,
            artifactVersionId: selectedVersionId,
            mediaType: 'text/plain' as const,
            availability: 'NOT_ARCHIVED' as const,
            content: null,
            contentHash: version.contentHash,
            byteSize: 0,
            lineCount: 0,
            createdAt: version.createdAt,
          };
        }
        throw reason;
      });
    void Promise.all([
      contentRequest,
      artifactCollaborationApi.listReviews(selectedVersionId),
      artifactCollaborationApi.getTraceGraphForVersion(
        requirementId,
        selectedVersionId,
      ),
    ])
      .then(([nextContent, nextReviews, nextTraceGraph]) => {
        if (!active) return;
        setContent(nextContent);
        setReviews(nextReviews);
        setTraceGraph(nextTraceGraph);
        setDraft(nextContent.content ?? '');
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '协作信息读取失败。',
          );
      });
    return () => {
      active = false;
    };
  }, [artifact, requirementId, selectedVersionId]);

  const comparison = useMemo(() => {
    if (!artifact || artifact.versions.length < 2) return null;
    const selectedIndex = artifact.versions.findIndex(
      (version) => version.id === selectedVersionId,
    );
    if (selectedVersionId !== artifact.currentVersionId) {
      return {
        from: artifact.versions[selectedIndex]!,
        to: artifact.versions.find(
          (version) => version.id === artifact.currentVersionId,
        )!,
      };
    }
    return {
      from: artifact.versions[Math.max(0, selectedIndex - 1)]!,
      to: artifact.versions[selectedIndex]!,
    };
  }, [artifact, selectedVersionId]);

  useEffect(() => {
    if (canvasMode !== 'DIFF' || !artifact || !comparison) return;
    let active = true;
    void artifactCollaborationApi
      .getDiff(artifact.id, comparison.from.id, comparison.to.id)
      .then((result) => {
        if (active) setDiff(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '版本差异读取失败。',
          );
      });
    return () => {
      active = false;
    };
  }, [artifact, canvasMode, comparison]);

  async function saveVersion() {
    if (!artifact || !selectedVersion || !content) return;
    setBusy(true);
    setError(null);
    try {
      await artifactCollaborationApi.appendVersion(
        artifact.id,
        artifact.rowVersion,
        {
          versionLabel: newVersionLabel.trim(),
          sourceType: selectedVersion.sourceType,
          sourceRef: selectedVersion.sourceRef,
          sensitivity: selectedVersion.sensitivity,
          mediaType: content.mediaType,
          content: draft,
        },
      );
      setEditing(false);
      setNewVersionLabel('');
      const next = await loadArtifact();
      setSelectedVersionId(next.currentVersionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新版本保存失败。');
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(request: CreateArtifactReviewRequest) {
    if (!artifact || !selectedVersion) return;
    setBusy(true);
    setError(null);
    try {
      await artifactCollaborationApi.review(
        selectedVersion.id,
        artifact.rowVersion,
        request,
      );
      setReviews(
        await artifactCollaborationApi.listReviews(selectedVersion.id),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评审提交失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformPageShell
      active="requirements"
      actor={actor}
      description="在不可变版本上完成正文核对、版本对比、评审与追溯。"
      jobsEnabled={jobsEnabled}
      onLogout={onLogout}
      title={artifact?.title ?? '制品协作'}
      actions={
        <Button
          icon={<RefreshCw aria-hidden="true" size={16} />}
          onClick={() => {
            setError(null);
            void loadArtifact();
          }}
          variant="secondary"
        >
          刷新
        </Button>
      }
    >
      <div className="artifact-workspace-page">
        <a
          className="artifact-workspace-page__back"
          href={`/requirements/${encodeURIComponent(requirementId)}/artifacts`}
        >
          返回产物目录
        </a>
        {error ? (
          <p className="module-message error" role="alert">
            {error}
          </p>
        ) : null}
        {loading || !artifact || !selectedVersion ? (
          <p className="module-loading">正在读取制品协作空间...</p>
        ) : (
          <>
            <div className="artifact-workspace-page__identity">
              <span>{artifact.artifactType}</span>
              <Badge variant="info">{artifact.stage}</Badge>
              <span>{artifact.capId}</span>
              <span>{selectedVersion.sensitivity}</span>
              <code
                className="pfc-artifact-code"
                title={selectedVersion.contentHash}
              >
                {selectedVersion.contentHash}
              </code>
            </div>
            <div className="artifact-workspace-page__toolbar">
              <SegmentedControl
                ariaLabel="正文展示方式"
                onChange={setCanvasMode}
                options={[
                  {
                    icon: <FileText aria-hidden="true" size={15} />,
                    label: '正文',
                    value: 'CONTENT',
                  },
                  {
                    icon: <GitCompare aria-hidden="true" size={15} />,
                    label: 'Diff',
                    value: 'DIFF',
                  },
                ]}
                value={canvasMode}
              />
              <span>
                {selectedVersion.versionLabel} · {selectedVersion.sourceRef}
              </span>
            </div>
            <ArtifactWorkspaceShell
              ariaLabel="制品协作工作区"
              versions={
                <ArtifactVersionRail
                  currentVersionId={artifact.currentVersionId}
                  onSelect={(versionId) => {
                    setError(null);
                    setEditing(false);
                    setSelectedVersionId(versionId);
                  }}
                  selectedVersionId={selectedVersionId}
                  versions={artifact.versions
                    .slice()
                    .reverse()
                    .map((version) => ({
                      id: version.id,
                      label: version.versionLabel,
                      meta:
                        version.createdBy === actor.actorId
                          ? actor.displayName
                          : version.createdBy,
                      createdAt: new Date(version.createdAt).toLocaleString(
                        'zh-CN',
                      ),
                    }))}
                />
              }
              canvas={
                canvasMode === 'CONTENT' ? (
                  <ArtifactContentPanel
                    busy={busy}
                    content={content}
                    draft={draft}
                    editing={editing}
                    onCancel={() => setEditing(false)}
                    onDraftChange={setDraft}
                    onEdit={() => setEditing(true)}
                    onSave={() => void saveVersion()}
                    onVersionLabelChange={setNewVersionLabel}
                    versionLabel={newVersionLabel}
                  />
                ) : comparison && diff ? (
                  <ArtifactDiffView
                    changes={diff.changes}
                    fromLabel={comparison.from.versionLabel}
                    toLabel={comparison.to.versionLabel}
                    truncated={diff.truncated}
                  />
                ) : (
                  <p className="artifact-workspace-empty">
                    至少需要两个版本才能比较差异。
                  </p>
                )
              }
              context={
                <section className="artifact-workspace-context">
                  <header>
                    <SegmentedControl
                      ariaLabel="协作信息"
                      onChange={setContextMode}
                      options={[
                        { label: '评审', value: 'REVIEW' },
                        { label: '追溯', value: 'TRACE' },
                      ]}
                      value={contextMode}
                    />
                  </header>
                  <div className="artifact-workspace-context__body">
                    {contextMode === 'REVIEW' ? (
                      <ArtifactReviewPanel
                        busy={busy}
                        currentActorId={actor.actorId}
                        currentActorName={actor.displayName}
                        onSubmit={submitReview}
                        reviews={reviews}
                      />
                    ) : (
                      <ArtifactTracePanel graph={traceGraph} />
                    )}
                  </div>
                </section>
              }
            />
          </>
        )}
      </div>
    </PlatformPageShell>
  );
}
