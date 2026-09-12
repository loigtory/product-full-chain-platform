import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabase, PostgresSkillRepository } from '@pfc/persistence';
import { createM2LocalAcceptanceData } from '@pfc/test-data';

import { GitWorkspaceInspector } from '../apps/bridge/src/git-workspace-inspector.ts';
import { hashPassword } from '../apps/server/src/identity/security.ts';
import {
  loadM2R1SkillManifest,
  M2_R1_SKILL_KEY,
  M2_R1_SKILL_VERSION,
} from './m2-r1-skill-manifest.ts';
import {
  assertNewFileTarget,
  localAcceptancePaths,
  removeOwnedFiles,
  writeNewPrivateJson,
} from './m2-local-acceptance/local-files.ts';
import { seedM2LocalAcceptanceDatabase } from './m2-local-acceptance/setup-database.ts';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`M2_ACCEPTANCE_ARGUMENT_REQUIRED name=${name}`);
  return value;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M2_ACCEPTANCE_DATABASE_TARGET_INVALID');
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const workspacePath = path.resolve(argument('--workspace'));
const runId = argument('--run-id');
const paths = localAcceptancePaths(projectRoot);
await Promise.all([
  assertNewFileTarget(paths.loginFile),
  assertNewFileTarget(paths.registryFile),
  assertNewFileTarget(paths.credentialFile),
]);

const inspector = new GitWorkspaceInspector();
const [repositoryFingerprint, gitBaseline, artifactSource, skillManifest] =
  await Promise.all([
    inspector.repositoryFingerprint(workspacePath),
    inspector.currentGitBaseline(workspacePath),
    readFile(
      path.resolve(
        workspacePath,
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md',
      ),
      'utf8',
    ),
    loadM2R1SkillManifest(projectRoot, '产品平台组'),
  ]);
const artifactContentHash = `sha256:${createHash('sha256').update(artifactSource).digest('hex')}`;
const data = createM2LocalAcceptanceData({
  runId,
  now: new Date().toISOString(),
  repositoryFingerprint,
  artifactContentHash,
});
const password = randomBytes(18).toString('base64url');
const derivation = await hashPassword(password);
const database = createDatabase({ connectionString, maxConnections: 1 });
const writtenFiles: string[] = [];

try {
  const release = await new PostgresSkillRepository(
    database,
    'pfc',
  ).findRelease(M2_R1_SKILL_KEY, M2_R1_SKILL_VERSION);
  if (
    !release ||
    release.id !== skillManifest.id ||
    release.contentHash !== skillManifest.contentHash ||
    release.evaluationStatus !== 'PASSED' ||
    release.status !== 'ACTIVE'
  ) {
    throw new Error('M2_ACCEPTANCE_SKILL_RELEASE_INVALID');
  }

  await writeNewPrivateJson(paths.loginFile, {
    runId: data.runId,
    loginName: data.account.loginName,
    password,
    accountId: data.account.id,
    teamId: data.team.id,
    requirementId: data.requirement.id,
    baselineId: data.baseline.id,
    workspaceId: data.workspace.id,
  });
  writtenFiles.push(paths.loginFile);
  await writeNewPrivateJson(paths.registryFile, {
    workspaceRoot: workspacePath,
    skillRoot: path.resolve(projectRoot, 'skills'),
    workspaces: [
      {
        id: data.workspace.id,
        path: workspacePath,
        verified: true,
        repositoryFingerprint,
        allowedRelativePath: data.requirementWorkspace.allowedRelativePath,
      },
    ],
    skills: [
      {
        releaseId: release.id,
        name: release.skillKey,
        path: skillManifest.sourcePath,
        enabled: true,
      },
    ],
  });
  writtenFiles.push(paths.registryFile);

  const readback = await seedM2LocalAcceptanceDatabase({
    database,
    data,
    password: derivation,
    skillReleaseId: release.id,
  });
  console.log(
    JSON.stringify({
      status: 'M2_LOCAL_ACCEPTANCE_READY',
      runId: data.runId,
      loginName: data.account.loginName,
      credential: 'stored',
      gitBaseline,
      createdIds: {
        accountId: data.account.id,
        teamId: data.team.id,
        requirementId: readback.requirement_id,
        baselineId: readback.baseline_id,
        workspaceId: readback.workspace_id,
        artifactId: data.artifact.id,
        artifactVersionId: readback.current_version_id,
      },
      workspaceVerificationStatus: readback.verification_status,
      retained: true,
    }),
  );
} catch (error) {
  await removeOwnedFiles(writtenFiles);
  throw error;
} finally {
  await database.destroy();
}
