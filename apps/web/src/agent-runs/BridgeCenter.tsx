import { useEffect, useState } from 'react';
import { Ban, Cable, Copy, KeyRound } from 'lucide-react';

import type {
  BridgeListResponse,
  BridgeRegistrationDto,
  CreateBridgePairingResponse,
} from '@pfc/contracts';
import { Badge, Button, ConfirmDialog, EmptyState, WorkPanel } from '@pfc/ui';

export interface BridgeCenterApi {
  listBridges(teamId: string): Promise<BridgeListResponse>;
  createBridgePairing(teamId: string): Promise<CreateBridgePairingResponse>;
  revokeBridge(
    bridgeId: string,
    reasonCode: string,
    expectedActiveRunCount: number,
  ): Promise<{
    replayed: boolean;
    status: 'REVOKED';
    affectedRunCount: number;
  }>;
}

function statusVariant(status: BridgeRegistrationDto['status']) {
  if (status === 'ONLINE') return 'success' as const;
  if (status === 'DEGRADED') return 'warning' as const;
  if (status === 'REVOKED') return 'danger' as const;
  return 'neutral' as const;
}

const statusLabels: Record<BridgeRegistrationDto['status'], string> = {
  ONLINE: '在线',
  OFFLINE: '离线',
  DEGRADED: '降级',
  REVOKED: '已撤销',
};

function capabilityLabel(value: string | undefined) {
  if (value === 'AVAILABLE') return '可用';
  if (value === 'UNAVAILABLE') return '不可用';
  return '待核验';
}

export function BridgeCenter({
  api,
  activeRunCounts = {},
  canPair,
  teamId,
}: {
  api: BridgeCenterApi;
  activeRunCounts?: Readonly<Record<string, number>>;
  canPair: boolean;
  teamId: string | null;
}) {
  const [items, setItems] = useState<readonly BridgeRegistrationDto[]>([]);
  const [loading, setLoading] = useState(Boolean(teamId));
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState<CreateBridgePairingResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeTarget, setRevokeTarget] =
    useState<BridgeRegistrationDto | null>(null);

  async function refreshBridges() {
    if (!teamId) return;
    const response = await api.listBridges(teamId);
    setItems(response.items);
  }

  useEffect(() => {
    if (!teamId) return;
    let active = true;
    void api
      .listBridges(teamId)
      .then((response) => {
        if (active) {
          setItems(response.items);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'Bridge 状态读取失败。',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, teamId]);

  async function createPairing() {
    if (!teamId) return;
    setCreating(true);
    setPairing(null);
    setError(null);
    try {
      setPairing(await api.createBridgePairing(teamId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '配对码生成失败。');
    } finally {
      setCreating(false);
    }
  }

  async function revokeBridge() {
    if (!revokeTarget) return;
    setRevoking(true);
    setError(null);
    try {
      await api.revokeBridge(
        revokeTarget.id,
        'TEAM_ADMIN_REVOKED',
        activeRunCounts[revokeTarget.id] ?? 0,
      );
      setRevokeTarget(null);
      await refreshBridges();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Bridge 撤销失败。');
    } finally {
      setRevoking(false);
    }
  }

  if (!teamId) {
    return (
      <EmptyState
        description="加入有效团队后才能查看团队 Bridge。"
        icon={<Cable size={24} strokeWidth={1.8} />}
        title="尚未选择团队"
      />
    );
  }

  return (
    <WorkPanel
      actions={
        canPair ? (
          <Button
            icon={<KeyRound aria-hidden="true" size={16} strokeWidth={1.8} />}
            loading={creating}
            onClick={() => void createPairing()}
            size="sm"
          >
            生成配对码
          </Button>
        ) : null
      }
      className="bridge-center"
      description="只展示脱敏能力、逻辑工作区和固定版本；凭据永不回显。"
      title="本地 Bridge"
    >
      {error ? (
        <p className="bridge-center__error" role="alert">
          {error}
        </p>
      ) : null}
      {pairing?.pairingCode ? (
        <div className="bridge-pairing-notice" role="status">
          <div>
            <strong>一次性配对码</strong>
            <span>
              有效至 {new Date(pairing.expiresAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <code>{pairing.pairingCode}</code>
          <Button
            aria-label="复制配对码"
            icon={<Copy aria-hidden="true" size={16} strokeWidth={1.8} />}
            onClick={() =>
              void navigator.clipboard.writeText(pairing.pairingCode!)
            }
            size="icon"
            title="复制配对码"
            variant="secondary"
          />
        </div>
      ) : null}
      {loading ? (
        <p className="agent-runs-state" role="status">
          正在读取 Bridge 状态...
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          action={
            canPair ? (
              <Button onClick={() => void createPairing()} size="sm">
                生成配对码
              </Button>
            ) : null
          }
          description="配对本机 Bridge 并完成能力快照后，工作区才可用于真实作业。"
          icon={<Cable size={24} strokeWidth={1.8} />}
          title="暂无已配对 Bridge"
        />
      ) : (
        <div className="bridge-center__table">
          <table>
            <thead>
              <tr>
                <th>Bridge</th>
                <th>运行时</th>
                <th>能力快照</th>
                <th>工作区</th>
                <th>状态</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {items.map((bridge) => (
                <tr key={bridge.id}>
                  <td>
                    <strong>{bridge.id}</strong>
                    <small>{bridge.protocolVersion}</small>
                  </td>
                  <td>
                    <span>Codex {bridge.codexVersion ?? '待核验'}</span>
                    <small>Node {bridge.nodeVersion}</small>
                  </td>
                  <td>
                    <span>
                      App Server{' '}
                      {capabilityLabel(bridge.capability?.codexAppServer)}
                    </span>
                    <small>
                      Zed {capabilityLabel(bridge.capability?.zedCli)} · Skill{' '}
                      {bridge.capability?.skillCount ?? 0}
                    </small>
                  </td>
                  <td>
                    <span>{bridge.workspaces.length} 个已绑定</span>
                    <small>
                      {bridge.workspaces[0]?.repositoryLabel ?? '尚无工作区'}
                    </small>
                  </td>
                  <td>
                    <Badge variant={statusVariant(bridge.status)}>
                      {statusLabels[bridge.status]}
                    </Badge>
                    <small>
                      {bridge.lastHeartbeatAt
                        ? new Date(bridge.lastHeartbeatAt).toLocaleString(
                            'zh-CN',
                          )
                        : '从未心跳'}
                    </small>
                  </td>
                  <td>
                    {canPair && bridge.status !== 'REVOKED' ? (
                      <Button
                        icon={
                          <Ban aria-hidden="true" size={15} strokeWidth={1.8} />
                        }
                        onClick={() => setRevokeTarget(bridge)}
                        size="sm"
                        variant="ghost"
                      >
                        撤销 Bridge
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revokeTarget ? (
        <ConfirmDialog
          actions={
            <>
              <Button
                disabled={revoking}
                onClick={() => setRevokeTarget(null)}
                variant="secondary"
              >
                返回
              </Button>
              <Button
                loading={revoking}
                onClick={() => void revokeBridge()}
                variant="danger"
              >
                确认撤销
              </Button>
            </>
          }
          onDismiss={() => setRevokeTarget(null)}
          title="确认撤销 Bridge"
        >
          <p>
            当前关联 {activeRunCounts[revokeTarget.id] ?? 0}{' '}
            条在途运行；撤销会停止领取新命令并触发在途运行取消或未知态核验。
          </p>
        </ConfirmDialog>
      ) : null}
    </WorkPanel>
  );
}
