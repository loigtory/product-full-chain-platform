import type {
  ProductWorkSessionSnapshotDto,
  ProductWorkTurnDto,
} from '@pfc/contracts';
import { EvidenceBar } from '@pfc/ui';

function compact(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value.length > 24
    ? `${value.slice(0, 10)}...${value.slice(-7)}`
    : value;
}

export function WorkspaceEvidence({
  latestTurn,
  snapshot,
}: {
  latestTurn: ProductWorkTurnDto | null;
  snapshot: ProductWorkSessionSnapshotDto;
}) {
  const evidence = snapshot.workspaceEvidence;
  const verified = evidence.evidenceStatus === 'VERIFIED';
  const gitVerified = Boolean(
    ['VERIFIED', 'EXPIRED'].includes(evidence.evidenceStatus) &&
    evidence.verificationStatus === 'VERIFIED' &&
    evidence.bindingGitBaseline &&
    evidence.capabilityGitBaseline &&
    evidence.bindingGitBaseline.toLowerCase() ===
      evidence.capabilityGitBaseline.toLowerCase(),
  );
  const codexConnected = verified && evidence.codexAppServer === 'AVAILABLE';
  const bridgeConnected =
    verified &&
    evidence.bridgeStatus === 'ONLINE' &&
    evidence.capabilityFreshness === 'CURRENT';
  const linkedRunId = snapshot.linkedAgentRunIds[0];
  const primaryExecutionId = linkedRunId ?? latestTurn?.id;
  const evidenceProblem =
    evidence.evidenceStatus === 'EXPIRED'
      ? '证据已过期'
      : evidence.evidenceStatus === 'MISMATCHED'
        ? '工作区不匹配'
        : '未核验';
  const gitValue = gitVerified
    ? compact(
        evidence.capabilityGitBaseline ?? evidence.bindingGitBaseline,
        'Git 基线未提供',
      )
    : evidence.evidenceStatus === 'EXPIRED'
      ? 'Git 证据已过期'
      : evidence.evidenceStatus === 'MISMATCHED'
        ? 'Git 基线不一致'
        : 'Git 基线未核验';
  const mcpValue =
    evidence.mcp.status === 'AVAILABLE'
      ? `MCP 可用 · ${evidence.mcp.registeredReadCapabilityCount}`
      : evidence.mcp.status === 'DRIFTED'
        ? 'MCP 配置漂移'
        : evidence.mcp.status === 'UNAVAILABLE'
          ? 'MCP 未接入'
          : 'MCP 未核验';

  return (
    <EvidenceBar
      ariaLabel="作业证据与工具状态"
      items={[
        {
          available: Boolean(primaryExecutionId),
          label: linkedRunId ? 'runId' : '回合',
          value: compact(primaryExecutionId, '尚未执行'),
        },
        {
          available: Boolean(latestTurn?.skillReleaseId),
          label: 'Skill',
          value: compact(latestTurn?.skillReleaseId, 'Skill 未绑定'),
        },
        {
          available: codexConnected,
          label: 'Codex',
          value: codexConnected ? 'Codex 已连接' : `Codex ${evidenceProblem}`,
        },
        {
          available: bridgeConnected,
          label: 'Bridge',
          value: bridgeConnected
            ? 'Bridge 已连接'
            : `Bridge ${evidenceProblem}`,
        },
        {
          available: evidence.mcp.status === 'AVAILABLE',
          label: 'MCP',
          value: mcpValue,
        },
        {
          available: verified && evidence.zedCli === 'AVAILABLE',
          label: 'Zed',
          value:
            verified && evidence.zedCli === 'AVAILABLE'
              ? 'Zed 已连接'
              : verified && evidence.zedCli === 'UNAVAILABLE'
                ? 'Zed 未接入'
                : `Zed ${evidenceProblem}`,
        },
        { available: gitVerified, label: 'Git', value: gitValue },
        {
          available: snapshot.session.lastSequence > 0,
          label: '审计',
          value: `事件 ${snapshot.session.lastSequence}`,
        },
      ]}
    />
  );
}
