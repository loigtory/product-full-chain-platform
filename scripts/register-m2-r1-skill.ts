import path from 'node:path';

import { PostgresSkillRepository, createDatabase } from '@pfc/persistence';

import { loadM2R1SkillManifest } from './m2-r1-skill-manifest.ts';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`SKILL_ARGUMENT_REQUIRED name=${name}`);
  return value;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const target = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/pfc_local'
) {
  throw new Error('LOCAL_SKILL_TARGET_INVALID');
}

const manifest = await loadM2R1SkillManifest(
  path.resolve(import.meta.dirname, '..'),
  argument('--owner'),
);
const database = createDatabase({ connectionString, maxConnections: 1 });

try {
  const repository = new PostgresSkillRepository(database, 'pfc');
  const existing = await repository.findRelease(
    manifest.skillKey,
    manifest.version,
  );
  if (existing) {
    if (existing.contentHash !== manifest.contentHash) {
      throw new Error('SKILL_RELEASE_CONTENT_DRIFT');
    }
    console.log(
      `LOCAL_SKILL_ALREADY_REGISTERED id=${existing.id} version=${existing.version}`,
    );
  } else {
    const release = await repository.registerRelease({
      id: manifest.id,
      skillKey: manifest.skillKey,
      displayName: manifest.displayName,
      description: manifest.description,
      logicalSource: manifest.logicalSource,
      version: manifest.version,
      contentHash: manifest.contentHash,
      compatibleHarnesses: manifest.compatibleHarnesses,
      owner: manifest.owner,
      now: new Date().toISOString(),
    });
    console.log(
      `LOCAL_SKILL_REGISTERED id=${release.id} version=${release.version}`,
    );
  }
} finally {
  await database.destroy();
}
