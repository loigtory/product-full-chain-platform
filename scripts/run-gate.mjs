import { spawnSync } from 'node:child_process';

const gate = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const npmCli = process.env.npm_execpath;

const quick = [
  'check:config',
  'check:codex-protocol',
  'check:delivery-governance',
  'check:ui-design',
  'check:lint',
  'check:format',
  'check:types',
  'test:unit',
];
const core = [
  ...quick,
  'db:migrate:plan',
  'test:integration',
  'db:test-cleanup-check',
  'build',
  'db:check',
];
const gates = {
  quick,
  core,
  full: [
    ...core,
    'test:permission',
    'test:concurrency',
    'test:recovery',
    'check:security',
    'test:security',
    'test:performance',
    'test:e2e:pc',
    'audit:dependencies',
  ],
};

if (!(gate in gates)) {
  throw new Error(`UNKNOWN_GATE: ${gate ?? '<missing>'}`);
}

if (dryRun) {
  console.log(`GATE_PLAN gate=${gate} commands=${gates[gate].join(',')}`);
  console.log('GATE_STATUS READY_TO_RUN');
  process.exit(0);
}

if (!npmCli) {
  throw new Error('NPM_EXEC_PATH_REQUIRED');
}

for (const script of gates[gate]) {
  console.log(`GATE_STEP_START ${script}`);
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`GATE_PASS ${gate}`);
