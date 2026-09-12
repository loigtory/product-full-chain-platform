import {
  EXPERIENCE_SCHEMA,
  loadExperienceRuntimeConfig,
} from '../apps/server/src/local-experience.ts';
import { createDatabase } from '../packages/persistence/src/index.ts';
import {
  assertExperienceSchemaReady,
  assertLocalExperienceDatabaseTarget,
  readExperienceCounts,
} from './local-experience-database.ts';

const config = loadExperienceRuntimeConfig(process.env);
if (!config.enabled) throw new Error('EXPERIENCE_MODE_REQUIRED');
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');

const database = createDatabase({ connectionString, maxConnections: 1 });

try {
  await assertLocalExperienceDatabaseTarget(database);
  await assertExperienceSchemaReady(database);
  const counts = await readExperienceCounts(database);
  if (
    counts.requirements < 3 ||
    counts.questions < 3 ||
    counts.gateRuns < 3 ||
    counts.materialBaselines < 3 ||
    counts.materialRefs < 2 ||
    counts.materialImpacts < 1
  ) {
    throw new Error('EXPERIENCE_SEED_INCOMPLETE');
  }
  console.log(
    `EXPERIENCE_VERIFY_PASS database=pfc_local schema=${EXPERIENCE_SCHEMA} requirements=${counts.requirements} questions=${counts.questions} gateRuns=${counts.gateRuns} materialBaselines=${counts.materialBaselines} materialRefs=${counts.materialRefs} materialImpacts=${counts.materialImpacts}`,
  );
} finally {
  await database.destroy();
}
