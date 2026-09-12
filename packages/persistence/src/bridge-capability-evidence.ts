export type StoredBridgeCapabilityEvidence = Readonly<{
  codexAppServer: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
  workspaces: readonly Readonly<{
    workspaceId: string;
    gitBaseline: string;
  }>[];
  skills: readonly Readonly<{
    releaseId: string;
    contentHash: string;
  }>[];
}>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseStoredBridgeCapability(
  value: unknown,
): StoredBridgeCapabilityEvidence | null {
  if (
    !record(value) ||
    value.snapshotVersion !== 'pfc-bridge-capabilities/1' ||
    !record(value.runtime) ||
    !['AVAILABLE', 'UNAVAILABLE', 'UNVERIFIED'].includes(
      String(value.runtime.codexAppServer),
    ) ||
    !Array.isArray(value.workspaces) ||
    !Array.isArray(value.skills)
  ) {
    return null;
  }
  const workspaces: Array<{ workspaceId: string; gitBaseline: string }> = [];
  const workspaceIds = new Set<string>();
  for (const item of value.workspaces) {
    if (
      !record(item) ||
      typeof item.workspaceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(item.workspaceId) ||
      typeof item.gitBaseline !== 'string' ||
      !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(item.gitBaseline) ||
      workspaceIds.has(item.workspaceId)
    ) {
      return null;
    }
    workspaceIds.add(item.workspaceId);
    workspaces.push({
      workspaceId: item.workspaceId,
      gitBaseline: item.gitBaseline.toLowerCase(),
    });
  }
  const skills: Array<{ releaseId: string; contentHash: string }> = [];
  const releaseIds = new Set<string>();
  for (const item of value.skills) {
    if (
      !record(item) ||
      typeof item.releaseId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(item.releaseId) ||
      typeof item.contentHash !== 'string' ||
      !/^sha256:[a-f\d]{64}$/i.test(item.contentHash) ||
      releaseIds.has(item.releaseId)
    ) {
      return null;
    }
    releaseIds.add(item.releaseId);
    skills.push({
      releaseId: item.releaseId,
      contentHash: item.contentHash.toLowerCase(),
    });
  }
  return {
    codexAppServer: value.runtime
      .codexAppServer as StoredBridgeCapabilityEvidence['codexAppServer'],
    workspaces,
    skills,
  };
}

export function capabilityCoversBindings(
  capability: StoredBridgeCapabilityEvidence | null,
  bindingIds: readonly string[],
): boolean {
  if (!capability || capability.workspaces.length !== bindingIds.length) {
    return false;
  }
  const reported = new Set(
    capability.workspaces.map((workspace) => workspace.workspaceId),
  );
  return bindingIds.every((bindingId) => reported.has(bindingId));
}

export function capabilityAllowsRun(
  capability: StoredBridgeCapabilityEvidence | null,
  input: {
    workspaceId: string;
    gitBaseline: string;
    skillReleaseId: string;
    skillContentHash: string;
  },
): boolean {
  if (capability?.codexAppServer !== 'AVAILABLE') return false;
  const workspace = capability.workspaces.find(
    (item) => item.workspaceId === input.workspaceId,
  );
  const skill = capability.skills.find(
    (item) => item.releaseId === input.skillReleaseId,
  );
  return (
    workspace?.gitBaseline === input.gitBaseline.toLowerCase() &&
    skill?.contentHash === input.skillContentHash.toLowerCase()
  );
}

export function codexHarnessCompatible(
  compatibleHarnesses: readonly string[],
  codexVersion: string | null,
): boolean {
  const version = /^(\d+)\.(\d+)\.\d+$/.exec(codexVersion ?? '');
  if (!version) return false;
  return compatibleHarnesses.includes(
    `codex-app-server/${version[1]}.${version[2]}`,
  );
}
