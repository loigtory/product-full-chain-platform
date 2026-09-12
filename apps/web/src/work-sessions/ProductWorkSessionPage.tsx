import { useRef, useState } from 'react';

import type { CurrentActorDto } from '@pfc/contracts';
import { AgentWorkspaceShell, Button } from '@pfc/ui';

import type { WorkSessionsApi } from './api.ts';
import { workSessionsApi } from './api.ts';
import { ProductWorkspaceHeader } from './ProductWorkspaceHeader.tsx';
import { ProposalCanvas } from './ProposalCanvas.tsx';
import { RequirementContextPanel } from './RequirementContextPanel.tsx';
import {
  RequirementLifecycle,
  RequirementWorkspaceContext,
} from './RequirementWorkspaceContext.tsx';
import { useProductWorkSession } from './useProductWorkSession.ts';
import { WorkConversation } from './WorkConversation.tsx';
import { WorkReadinessPanel } from './WorkReadinessPanel.tsx';
import { WorkspaceEvidence } from './WorkspaceEvidence.tsx';

export function ProductWorkSessionPage({
  actor,
  api = workSessionsApi,
  jobsEnabled,
  onLogout,
  requirementId,
}: {
  actor: CurrentActorDto;
  api?: WorkSessionsApi;
  jobsEnabled: boolean;
  onLogout: () => void;
  requirementId: string;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const work = useProductWorkSession({
    actorId: actor.actorId,
    api,
    requirementId,
    teamId: actor.currentTeamId,
  });

  if (work.loading) {
    return (
      <main className="pfc-ai-workspace-loading" role="status">
        <div>
          <h1>正在恢复产品作业</h1>
          <p>正在读取会话、上下文、提案与执行证据。</p>
        </div>
      </main>
    );
  }

  if (work.empty) {
    return (
      <main className="pfc-ai-workspace-empty">
        <div>
          <h1>还没有产品 Agent 会话</h1>
          <p>创建会话后，仍需绑定真实上下文和固定 Skill 才能提交作业。</p>
          {work.error ? <p role="alert">{work.error}</p> : null}
          <Button
            loading={work.busyAction === 'create-session'}
            onClick={() => void work.createSession()}
          >
            创建工作会话
          </Button>
        </div>
      </main>
    );
  }

  if (!work.snapshot) {
    return (
      <main className="pfc-ai-workspace-empty">
        <div>
          <h1>工作空间无法打开</h1>
          <p role="alert">{work.error ?? '没有可读取的服务端会话快照。'}</p>
        </div>
      </main>
    );
  }

  if (!work.readiness) {
    return (
      <main className="pfc-ai-workspace-empty">
        <div>
          <h1>作业范围无法确认</h1>
          <p role="alert">{work.error ?? '没有可读取的服务端就绪状态。'}</p>
        </div>
      </main>
    );
  }

  const canGrant = actor.roles.some((role) =>
    ['PRODUCT_OWNER', 'TEAM_ADMIN'].includes(role),
  );
  const selectedSkill = work.readiness.skillOptions.find(
    (skill) => skill.releaseId === work.selectedSkillReleaseId,
  );
  const submissionScope = work.canSubmit
    ? `${work.selectedContextIds.length} 项上下文 · ${selectedSkill?.displayName ?? '已选 Skill'}`
    : actor.actorId !== work.snapshot.session.ownerId
      ? '仅会话负责人可提交回合'
      : (work.readiness.blockers.find(
          (blocker) =>
            !(
              blocker.code === 'SKILL_SELECTION_REQUIRED' &&
              work.selectedSkillReleaseId
            ) &&
            !(
              blocker.code === 'CONTEXT_SELECTION_REQUIRED' &&
              work.selectedContextIds.length > 0 &&
              work.selectedContextIds.length <= 50
            ),
        )?.message ?? '请先核对本回合作业范围');

  return (
    <AgentWorkspaceShell
      artifact={
        <ProposalCanvas
          busyAction={work.busyAction}
          onConfirm={() => void work.decideProposal('CONFIRM')}
          onReject={() => void work.decideProposal('REJECT')}
          snapshot={work.snapshot}
        />
      }
      className="pfc-reference-theme"
      context={<RequirementContextPanel snapshot={work.snapshot} />}
      contextHeader={
        <RequirementWorkspaceContext
          actorName={actor.displayName}
          onContextOpen={() => setContextOpen(true)}
          onFocusComposer={() => composerRef.current?.focus()}
          snapshot={work.snapshot}
        />
      }
      contextOpen={contextOpen}
      data-jobs-enabled={jobsEnabled}
      evidence={
        <WorkspaceEvidence
          latestTurn={work.latestTurn}
          snapshot={work.snapshot}
        />
      }
      globalHeader={
        <ProductWorkspaceHeader
          actor={actor}
          onLogout={onLogout}
          onRefresh={work.refresh ? () => void work.refresh?.() : undefined}
          refreshing={work.busyAction === 'refresh'}
        />
      }
      lifecycle={<RequirementLifecycle snapshot={work.snapshot} />}
      onContextDismiss={() => setContextOpen(false)}
      stream={
        <WorkConversation
          busyAction={work.busyAction}
          canSubmit={work.canSubmit}
          composerRef={composerRef}
          error={work.error}
          latestTurn={work.latestTurn}
          mcpRequests={work.mcpRequests}
          executionEvidence={work.executionEvidence}
          onCancel={() => void work.controlTurn('CANCEL')}
          onSubmit={(message) => void work.submitTurn(message)}
          onVerify={() => void work.controlTurn('VERIFY')}
          readinessPanel={
            <WorkReadinessPanel
              busyAction={work.busyAction}
              canGrant={canGrant}
              canSubmit={work.canSubmit}
              onGrant={() => void work.grantTransmissionAuthorization()}
              onRevoke={() => void work.revokeTransmissionAuthorization()}
              onSkillChange={work.selectSkill}
              onToggleContext={work.toggleContext}
              readiness={work.readiness}
              selectedContextIds={work.selectedContextIds}
              selectedSkillReleaseId={work.selectedSkillReleaseId}
            />
          }
          snapshot={work.snapshot}
          streamState={work.streamState}
          submissionScope={submissionScope}
        />
      }
    />
  );
}
