export type PlatformNavigationPage =
  | 'WORKBENCH'
  | 'GATE_CENTER'
  | 'MATERIAL_LIBRARY'
  | 'AGENT_RUNS'
  | 'TEAM_ADMIN';

const stableNavigationOptions = [
  { label: '需求管理', value: 'WORKBENCH' },
  { label: '门禁中心', value: 'GATE_CENTER' },
  { label: '材料库', value: 'MATERIAL_LIBRARY' },
  { label: '团队空间', value: 'TEAM_ADMIN' },
] as const;

const agentRunsOption = { label: '作业', value: 'AGENT_RUNS' } as const;

export function platformNavigationOptions(jobsEnabled: boolean) {
  return jobsEnabled
    ? [
        ...stableNavigationOptions.slice(0, 3),
        agentRunsOption,
        stableNavigationOptions[3],
      ]
    : stableNavigationOptions;
}
