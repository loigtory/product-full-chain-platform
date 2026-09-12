import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PC_PLAYWRIGHT_PROJECTS = [
  'pc-1280x720',
  'pc-1440x900',
  'pc-1920x1080',
] as const;

type RunProject = (project: string) => number;

export function runPcPlaywrightProjects(runProject: RunProject): number {
  let failed = false;
  for (const project of PC_PLAYWRIGHT_PROJECTS) {
    console.log(`PLAYWRIGHT_PROJECT_START project=${project}`);
    const status = runProject(project);
    console.log(
      `PLAYWRIGHT_PROJECT_${status === 0 ? 'PASS' : 'FAIL'} project=${project} status=${status}`,
    );
    if (status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

function runProject(project: string): number {
  const cli = path.resolve('node_modules', 'playwright', 'cli.js');
  const result = spawnSync(
    process.execPath,
    [cli, 'test', `--project=${project}`],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    },
  );
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runPcPlaywrightProjects(runProject);
}
