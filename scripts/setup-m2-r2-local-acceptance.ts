import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDatabase, PostgresSkillRepository } from '@pfc/persistence';
import { createM2R2TestData } from '@pfc/test-data';

import { GitWorkspaceInspector } from '../apps/bridge/src/git-workspace-inspector.ts';
import { hashPassword } from '../apps/server/src/identity/security.ts';
import {
  loadM2R2SkillManifest,
  M2_R2_SKILL_KEY,
  M2_R2_SKILL_VERSION,
} from './m2-r2-skill-manifest.ts';
import {
  assertNewPrivateTarget,
  m2R2AcceptancePaths,
  removeOwnedFiles,
  writeNewPrivateJson,
} from './m2-r2-local-acceptance/local-files.ts';
import { seedM2R2LocalAcceptanceDatabase } from './m2-r2-local-acceptance/setup-database.ts';

const authorizedRunId = 'R2_REAL_20260907_A';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`M2_R2_ARGUMENT_REQUIRED name=${name}`);
  return value;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('M2_R2_ACCEPTANCE_DATABASE_TARGET_INVALID');
}
const runId = argument('--run-id').toUpperCase();
if (runId !== authorizedRunId) {
  throw new Error('M2_R2_ACCEPTANCE_RUN_ID_NOT_AUTHORIZED');
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const workspacePath = path.resolve(argument('--workspace'));
const paths = m2R2AcceptancePaths(projectRoot);
await Promise.all([
  assertNewPrivateTarget(paths.accountsFile),
  assertNewPrivateTarget(paths.registryFile),
  assertNewPrivateTarget(paths.credentialFile),
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
    loadM2R2SkillManifest(projectRoot, '产品平台组'),
  ]);
const artifactContentHash = `sha256:${createHash('sha256').update(artifactSource).digest('hex')}`;
const data = createM2R2TestData({
  runId,
  now: new Date().toISOString(),
  repositoryFingerprint,
  artifactContentHash,
});
const requesterPassword = randomBytes(18).toString('base64url');
const approverPassword = randomBytes(18).toString('base64url');
const [requesterDerivation, approverDerivation] = await Promise.all([
  hashPassword(requesterPassword),
  hashPassword(approverPassword),
]);
const database = createDatabase({ connectionString, maxConnections: 1 });
const writtenFiles: string[] = [];

try {
  const release = await new PostgresSkillRepository(
    database,
    'pfc',
  ).findRelease(M2_R2_SKILL_KEY, M2_R2_SKILL_VERSION);
  if (
    !release ||
    release.id !== skillManifest.id ||
    release.contentHash !== skillManifest.contentHash ||
    release.evaluationStatus !== 'PASSED' ||
    release.status !== 'ACTIVE'
  ) {
    throw new Error('M2_R2_ACCEPTANCE_SKILL_RELEASE_INVALID');
  }

  await writeNewPrivateJson(paths.accountsFile, {
    runId: data.runId,
    requirementId: data.requirement.id,
    baselineId: data.baseline.id,
    workspaceId: data.workspace.id,
    teamId: data.team.id,
    requester: {
      accountId: data.requester.id,
      loginName: data.requester.loginName,
      password: requesterPassword,
    },
    approver: {
      accountId: data.approver.id,
      loginName: data.approver.loginName,
      password: approverPassword,
    },
  });
  writtenFiles.push(paths.accountsFile);
  await writeNewPrivateJson(paths.registryFile, {
    workspaceRoot: workspacePath,
    skillRoot: path.resolve(projectRoot, 'skills'),
    workspaces: [
      {
        id: data.workspace.id,
        path: workspacePath,
        verified: true,
        repositoryFingerprint,
        allowedRelativePath: data.workspace.allowedRelativePath,
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

  const readback = await seedM2R2LocalAcceptanceDatabase({
    database,
    data,
    requesterPassword: requesterDerivation,
    approverPassword: approverDerivation,
    skillReleaseId: release.id,
  });
  console.log(
    JSON.stringify({
      status: 'M2_R2_LOCAL_ACCEPTANCE_READY',
      runId: data.runId,
      accounts: {
        requester: {
          loginName: data.requester.loginName,
          credential: 'stored',
        },
        approver: { loginName: data.approver.loginName, credential: 'stored' },
      },
      gitBaseline,
      createdIds: {
        requesterId: data.requester.id,
        approverId: data.approver.id,
        teamId: data.team.id,
        requirementId: readback.requirement.requirement_id,
        baselineId: readback.requirement.baseline_id,
        workspaceId: readback.requirement.workspace_id,
        artifactId: data.artifact.id,
        artifactVersionId: readback.requirement.current_version_id,
      },
      workspaceVerificationStatus: readback.requirement.verification_status,
      retained: true,
    }),
  );
} catch (error) {
  await removeOwnedFiles(writtenFiles);
  throw error;
} finally {
  await database.destroy();
}
