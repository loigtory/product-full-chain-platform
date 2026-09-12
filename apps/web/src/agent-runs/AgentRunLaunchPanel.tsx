import { useState, type FormEvent } from 'react';
import { Bot, ChevronDown, ShieldCheck } from 'lucide-react';

import type {
  AgentRunAccessMode,
  AgentRunLaunchOptionsDto,
  AgentRunOperation,
} from '@pfc/contracts';
import { Badge, Button, EmptyState, SegmentedControl } from '@pfc/ui';

import { createUiIdempotencyKey } from '../idempotency.ts';
import { agentRunsApi, type AgentRunLaunchApi } from './api.ts';
import { formatAgentRunTimestamp } from './model.ts';
import './agent-run-launch.css';

export { type AgentRunLaunchApi } from './api.ts';

export function AgentRunLaunchPanel({
  api = agentRunsApi,
  onCreated = (runId) =>
    window.location.assign(`/jobs/${encodeURIComponent(runId)}`),
  requirementId,
}: {
  api?: AgentRunLaunchApi;
  onCreated?: (runId: string) => void;
  requirementId: string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AgentRunLaunchOptionsDto | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [skillReleaseId, setSkillReleaseId] = useState('');
  const [accessMode, setAccessMode] = useState<AgentRunAccessMode>('READ_ONLY');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (options) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getLaunchOptions(requirementId);
      const firstWorkspace = next.workspaces.find((workspace) =>
        workspace.skillReleaseIds.some((releaseId) =>
          next.skills.some((skill) => skill.id === releaseId),
        ),
      );
      setOptions(next);
      setWorkspaceId(firstWorkspace?.id ?? '');
      setSkillReleaseId(
        firstWorkspace?.skillReleaseIds.find((releaseId) =>
          next.skills.some((skill) => skill.id === releaseId),
        ) ?? '',
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '只读作业选项读取失败。',
      );
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options || !workspaceId || !skillReleaseId) return;
    const workspace = options.workspaces.find(
      (item) => item.id === workspaceId,
    );
    const skill = options.skills.find(
      (item) =>
        item.id === skillReleaseId &&
        workspace?.skillReleaseIds.includes(item.id) &&
        item.enabledScopes.includes(
          accessMode === 'WORKSPACE_WRITE'
            ? 'CONTROLLED_ARTIFACT_EDIT'
            : 'ARTIFACT_CHECK',
        ),
    );
    if (
      !skill ||
      (accessMode === 'WORKSPACE_WRITE' && workspace?.accessLevel !== 'WRITE')
    ) {
      return;
    }
    const workspaceWrite = accessMode === 'WORKSPACE_WRITE';
    const operation: AgentRunOperation = workspaceWrite
      ? 'CONTROLLED_ARTIFACT_EDIT'
      : 'ARTIFACT_CHECK';
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createRun(
        requirementId,
        {
          baselineId: options.baselineId,
          workspaceId,
          skillKey: skill.skillKey,
          skillVersion: skill.version,
          operation,
          accessMode,
          ...(workspaceWrite
            ? {
                writeScope: {
                  allowedRelativePaths: [options.artifactSourceRef],
                  allowedActions: ['EDIT_FILES'] as const,
                  maxChangedFiles: 1,
                  maxChangedBytes: 65_536,
                },
              }
            : {}),
        },
        createUiIdempotencyKey('CREATE', 'AGENT_RUN'),
      );
      onCreated(result.run.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '受控作业启动失败。');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedWorkspace = options?.workspaces.find(
    (item) => item.id === workspaceId,
  );
  const operation: AgentRunOperation =
    accessMode === 'WORKSPACE_WRITE'
      ? 'CONTROLLED_ARTIFACT_EDIT'
      : 'ARTIFACT_CHECK';
  const availableSkills =
    options?.skills.filter(
      (skill) =>
        selectedWorkspace?.skillReleaseIds.includes(skill.id) &&
        skill.enabledScopes.includes(operation),
    ) ?? [];
  const availableWorkspaces =
    options?.workspaces.filter(
      (workspace) =>
        (accessMode === 'READ_ONLY' || workspace.accessLevel === 'WRITE') &&
        workspace.skillReleaseIds.some((releaseId) =>
          options.skills.some(
            (skill) =>
              skill.id === releaseId && skill.enabledScopes.includes(operation),
          ),
        ),
    ) ?? [];
  const ready = Boolean(availableWorkspaces.length && availableSkills.length);

  function changeAccessMode(next: AgentRunAccessMode) {
    setAccessMode(next);
    if (!options) return;
    const nextOperation: AgentRunOperation =
      next === 'WORKSPACE_WRITE'
        ? 'CONTROLLED_ARTIFACT_EDIT'
        : 'ARTIFACT_CHECK';
    const nextWorkspace = options.workspaces.find(
      (workspace) =>
        (next === 'READ_ONLY' || workspace.accessLevel === 'WRITE') &&
        workspace.skillReleaseIds.some((releaseId) =>
          options.skills.some(
            (skill) =>
              skill.id === releaseId &&
              skill.enabledScopes.includes(nextOperation),
          ),
        ),
    );
    const nextSkill = options.skills.find(
      (skill) =>
        nextWorkspace?.skillReleaseIds.includes(skill.id) &&
        skill.enabledScopes.includes(nextOperation),
    );
    setWorkspaceId(nextWorkspace?.id ?? '');
    setSkillReleaseId(nextSkill?.id ?? '');
  }

  return (
    <section className="detail-section agent-run-launch-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">M2 · 受控智能体作业</p>
          <h2>智能体产物作业</h2>
        </div>
        <Button
          aria-expanded={open}
          icon={<Bot aria-hidden="true" size={16} strokeWidth={1.8} />}
          onClick={() => void reveal()}
          variant="secondary"
        >
          运行只读检查
          <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
        </Button>
      </div>
      {open ? (
        <div className="agent-run-launch-body">
          {loading ? (
            <p role="status">正在读取 Bridge、工作区和 Skill...</p>
          ) : error ? (
            <p className="agent-run-launch-error" role="alert">
              {error}
            </p>
          ) : !options ? (
            <EmptyState
              description="需要最近 90 秒内的 Bridge capability snapshot，以及已通过评估的固定 SkillRelease。"
              icon={
                <ShieldCheck aria-hidden="true" size={22} strokeWidth={1.8} />
              }
              title="当前无法启动"
            />
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <SegmentedControl
                ariaLabel="作业访问模式"
                className="agent-run-launch-mode"
                onChange={changeAccessMode}
                options={[
                  { label: '只读检查', value: 'READ_ONLY' },
                  { label: '受控写入', value: 'WORKSPACE_WRITE' },
                ]}
                value={accessMode}
              />
              {!ready ? (
                <EmptyState
                  description="当前模式需要匹配的工作区访问级别、Bridge 能力快照和已评估固定 SkillRelease。"
                  icon={
                    <ShieldCheck
                      aria-hidden="true"
                      size={22}
                      strokeWidth={1.8}
                    />
                  }
                  title="当前模式不可启动"
                />
              ) : (
                <>
                  <div className="agent-run-launch-fields">
                    <label>
                      <span>需求基线</span>
                      <code>{options!.baselineId}</code>
                    </label>
                    <label>
                      <span>已验证工作区</span>
                      <select
                        onChange={(event) => {
                          const nextWorkspace = options!.workspaces.find(
                            (workspace) => workspace.id === event.target.value,
                          );
                          setWorkspaceId(event.target.value);
                          setSkillReleaseId(
                            nextWorkspace?.skillReleaseIds.find((releaseId) =>
                              options!.skills.some(
                                (skill) =>
                                  skill.id === releaseId &&
                                  skill.enabledScopes.includes(operation),
                              ),
                            ) ?? '',
                          );
                        }}
                        value={workspaceId}
                      >
                        {availableWorkspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>固定 Skill</span>
                      <select
                        onChange={(event) =>
                          setSkillReleaseId(event.target.value)
                        }
                        value={skillReleaseId}
                      >
                        {availableSkills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {accessMode === 'WORKSPACE_WRITE' ? (
                    <div
                      className="agent-run-launch-scope"
                      aria-label="固定写入范围"
                    >
                      <span>登记产物</span>
                      <code>{options.artifactSourceRef}</code>
                      <small>
                        仅编辑 1 个文件，上限 65536 字节，禁止网络访问
                      </small>
                    </div>
                  ) : null}
                  {selectedWorkspace ? (
                    <div className="agent-run-launch-evidence">
                      <Badge variant="success">Bridge 已验证</Badge>
                      <span>{selectedWorkspace.repositoryLabel}</span>
                      <code>{selectedWorkspace.gitBaseline}</code>
                      <small>
                        {formatAgentRunTimestamp(
                          selectedWorkspace.lastVerifiedAt,
                        )}
                      </small>
                    </div>
                  ) : null}
                  <footer>
                    <span>
                      {accessMode === 'WORKSPACE_WRITE'
                        ? '写入只发生在隔离胶囊，批准后仍不会回写注册源工作区。'
                        : '固定只读模式，不修改文件，不调用外部系统。'}
                    </span>
                    <Button loading={submitting} type="submit">
                      {accessMode === 'WORKSPACE_WRITE'
                        ? '启动受控写入'
                        : '启动只读检查'}
                    </Button>
                  </footer>
                </>
              )}
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
