import { describe, expect, it, vi } from 'vitest';

import {
  PC_PLAYWRIGHT_PROJECTS,
  runPcPlaywrightProjects,
} from '../../scripts/run-playwright-projects.ts';

describe('AI-UX-R1 E4.2 Playwright project isolation', () => {
  it('runs every required PC width in an isolated child and passes only if all pass', () => {
    const runProject = vi.fn((project: string) => (project ? 0 : 1));

    expect(runPcPlaywrightProjects(runProject)).toBe(0);
    expect(runProject.mock.calls.map(([project]) => project)).toEqual(
      PC_PLAYWRIGHT_PROJECTS,
    );
  });

  it('still runs every width and fails closed when one child fails', () => {
    const runProject = vi.fn((project: string) =>
      project === 'pc-1440x900' ? 1 : 0,
    );

    expect(runPcPlaywrightProjects(runProject)).toBe(1);
    expect(runProject).toHaveBeenCalledTimes(3);
  });
});
