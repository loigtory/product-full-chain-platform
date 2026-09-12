import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Copy, Plus, RefreshCw, UserPlus } from 'lucide-react';

import {
  ACTOR_ROLES,
  type ActorRole,
  type CurrentActorDto,
  type TeamDto,
  type TeamMemberDto,
  type WorkspaceDto,
} from '@pfc/contracts';
import { Button } from '@pfc/ui';

import { PlatformPageShell } from '../platform/PlatformPageShell.tsx';
import { teamAdminApi } from './api.ts';
import {
  WorkspaceRegistrationForm,
  type WorkspaceRegistrationInput,
} from './WorkspaceRegistrationForm.tsx';
import './team-admin.css';

type View = 'MEMBERS' | 'WORKSPACES' | 'ASSIGNMENTS';

export function TeamAdminPage({
  actor,
  jobsEnabled = false,
  onLogout,
}: {
  actor: CurrentActorDto;
  jobsEnabled?: boolean;
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>('MEMBERS');
  const [teams, setTeams] = useState<readonly TeamDto[]>([]);
  const [members, setMembers] = useState<readonly TeamMemberDto[]>([]);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceDto[]>([]);
  const [teamId, setTeamId] = useState(actor.currentTeamId ?? '');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const currentTeam = useMemo(
    () => teams.find((team) => team.id === teamId),
    [teamId, teams],
  );

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [nextTeams, nextWorkspaces] = await Promise.all([
        teamAdminApi.listTeams(),
        teamAdminApi.listWorkspaces(),
      ]);
      setTeams(nextTeams);
      setWorkspaces(nextWorkspaces);
      const selected = teamId || nextTeams[0]?.id || '';
      setTeamId(selected);
      setMembers(selected ? await teamAdminApi.listMembers(selected) : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '团队数据加载失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([teamAdminApi.listTeams(), teamAdminApi.listWorkspaces()])
      .then(([nextTeams, nextWorkspaces]) => {
        if (!active) return;
        setTeams(nextTeams);
        setWorkspaces(nextWorkspaces);
        const selected = actor.currentTeamId || nextTeams[0]?.id || '';
        setTeamId(selected);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '团队数据加载失败。',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actor.currentTeamId]);

  useEffect(() => {
    if (!teamId) return;
    void teamAdminApi
      .listMembers(teamId)
      .then(setMembers)
      .catch(() => undefined);
  }, [teamId]);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const team = await teamAdminApi.createTeam(
      String(form.get('teamName') ?? ''),
    );
    event.currentTarget.reset();
    setTeams((current) => [...current, team]);
    setTeamId(team.id);
    setMessage('团队已创建，当前账户已成为团队管理员。');
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await teamAdminApi.inviteMember(
      teamId,
      String(form.get('loginName') ?? ''),
      String(form.get('role')) as ActorRole,
    );
    event.currentTarget.reset();
    setInviteToken(result.invitationToken);
    setMessage('邀请已创建。令牌仅在本次页面展示，请通过受控渠道交付。');
  }

  async function createWorkspace(input: WorkspaceRegistrationInput) {
    const workspace = await teamAdminApi.createWorkspace({
      teamId,
      ...input,
    });
    setWorkspaces((current) => [...current, workspace]);
    setMessage('工作区已登记，当前状态为待 Bridge 验证。');
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await teamAdminApi.assignRequirement({
      requirementId: String(form.get('requirementId') ?? ''),
      teamId,
      accountId: String(form.get('accountId') ?? ''),
      responsibility: String(form.get('responsibility') ?? ''),
    });
    setMessage('需求责任分工已写入本地 PostgreSQL。');
  }

  async function bind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await teamAdminApi.bindWorkspace({
      requirementId: String(form.get('requirementId') ?? ''),
      teamId,
      workspaceId: String(form.get('workspaceId') ?? ''),
      allowedRelativePath: String(form.get('allowedRelativePath') ?? ''),
      accessLevel: String(form.get('accessLevel')) as 'READ' | 'WRITE',
    });
    setMessage('需求工作区边界已保存。');
  }

  return (
    <PlatformPageShell
      active="team"
      actor={actor}
      description="维护成员角色、需求责任边界和逻辑仓库工作区。"
      jobsEnabled={jobsEnabled}
      onLogout={onLogout}
      title="团队空间"
      actions={
        <Button
          aria-label="刷新团队数据"
          icon={<RefreshCw aria-hidden="true" size={16} />}
          onClick={() => void reload()}
          variant="secondary"
        >
          刷新
        </Button>
      }
    >
      <section className="team-context-bar">
        <label>
          <span>当前团队</span>
          <select
            onChange={(event) => setTeamId(event.target.value)}
            value={teamId}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={(event) => void createTeam(event)}>
          <input
            aria-label="新团队名称"
            name="teamName"
            placeholder="新团队名称"
            required
          />
          <Button
            icon={<Plus aria-hidden="true" size={16} />}
            type="submit"
            variant="secondary"
          >
            新建团队
          </Button>
        </form>
      </section>
      <nav aria-label="团队管理视图" className="team-tabs">
        {(
          [
            ['MEMBERS', '成员与角色'],
            ['WORKSPACES', '仓库工作区'],
            ['ASSIGNMENTS', '需求分工'],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-current={view === value ? 'page' : undefined}
            key={value}
            onClick={() => setView(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      {error ? (
        <p className="module-message error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="module-message" role="status">
          {message}
        </p>
      ) : null}
      {loading ? <p className="module-loading">正在读取团队数据...</p> : null}

      {!loading && view === 'MEMBERS' ? (
        <div className="admin-grid">
          <section className="admin-table-section">
            <header>
              <div>
                <h2>成员与角色</h2>
                <p>
                  {currentTeam?.name ?? '未选择团队'} · {members.length} 位成员
                </p>
              </div>
            </header>
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>账号</th>
                  <th>角色</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.accountId}>
                    <td>{member.displayName}</td>
                    <td>{member.loginName}</td>
                    <td>{member.role}</td>
                    <td>
                      <span className="status-dot">{member.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <form className="admin-form" onSubmit={(event) => void invite(event)}>
            <header>
              <UserPlus aria-hidden="true" size={19} />
              <div>
                <h2>邀请成员</h2>
                <p>账号接受邀请后才会成为有效成员。</p>
              </div>
            </header>
            <label>
              <span>登录账号</span>
              <input name="loginName" placeholder="product.manager" required />
            </label>
            <label>
              <span>团队角色</span>
              <select defaultValue="PRODUCT_MANAGER" name="role">
                {ACTOR_ROLES.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <Button type="submit">创建邀请</Button>
            {inviteToken ? (
              <div className="invite-token">
                <span>一次性邀请令牌</span>
                <code>{inviteToken}</code>
                <button
                  aria-label="复制邀请令牌"
                  onClick={() =>
                    void navigator.clipboard.writeText(inviteToken)
                  }
                  title="复制邀请令牌"
                  type="button"
                >
                  <Copy aria-hidden="true" size={15} />
                </button>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}

      {!loading && view === 'WORKSPACES' ? (
        <div className="admin-grid">
          <section className="admin-table-section">
            <header>
              <div>
                <h2>逻辑工作区</h2>
                <p>仅登记仓库标识；M2 Bridge 接入前不读取本机文件。</p>
              </div>
            </header>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>仓库标识</th>
                  <th>验证状态</th>
                </tr>
              </thead>
              <tbody>
                {workspaces
                  .filter((item) => item.teamId === teamId)
                  .map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.repositoryLabel}</td>
                      <td>
                        <span className="status-dot muted">
                          {item.verificationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
          <WorkspaceRegistrationForm onCreate={createWorkspace} />
        </div>
      ) : null}

      {!loading && view === 'ASSIGNMENTS' ? (
        <div className="admin-grid equal">
          <form className="admin-form" onSubmit={(event) => void assign(event)}>
            <header>
              <div>
                <h2>维护需求分工</h2>
                <p>责任人必须是当前团队有效成员。</p>
              </div>
            </header>
            <label>
              <span>需求编号</span>
              <input name="requirementId" required />
            </label>
            <label>
              <span>责任人</span>
              <select name="accountId" required>
                {members.map((member) => (
                  <option key={member.accountId} value={member.accountId}>
                    {member.displayName} · {member.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>职责</span>
              <input
                name="responsibility"
                placeholder="PRODUCT_OWNER"
                required
              />
            </label>
            <Button type="submit">保存分工</Button>
          </form>
          <form className="admin-form" onSubmit={(event) => void bind(event)}>
            <header>
              <div>
                <h2>绑定需求工作区</h2>
                <p>相对目录禁止绝对路径和上级目录跳转。</p>
              </div>
            </header>
            <label>
              <span>需求编号</span>
              <input name="requirementId" required />
            </label>
            <label>
              <span>工作区</span>
              <select name="workspaceId" required>
                {workspaces
                  .filter((item) => item.teamId === teamId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>允许的相对目录</span>
              <input
                name="allowedRelativePath"
                placeholder="docs/requirements"
                required
              />
            </label>
            <label>
              <span>访问级别</span>
              <select name="accessLevel">
                <option value="READ">只读</option>
                <option value="WRITE">读写</option>
              </select>
            </label>
            <Button type="submit">保存边界</Button>
          </form>
        </div>
      ) : null}
    </PlatformPageShell>
  );
}
