import {
  EXPERIENCE_SCHEMA,
  loadExperienceRuntimeConfig,
} from '../apps/server/src/local-experience.ts';
import {
  createDatabase,
  createLifecycleSchema,
} from '../packages/persistence/src/index.ts';
import {
  createLocalExperienceFixture,
  seedLocalExperienceDatabase,
} from '../packages/test-data/src/index.ts';
import {
  assertExperienceResetScope,
  assertLocalExperienceDatabaseTarget,
  dropExperienceSchema,
  readExperienceCounts,
} from './local-experience-database.ts';

const config = loadExperienceRuntimeConfig(process.env);
if (!config.enabled) throw new Error('EXPERIENCE_MODE_REQUIRED');
if (!process.argv.includes('--reset')) {
  throw new Error('EXPERIENCE_RESET_CONFIRMATION_REQUIRED');
}
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');

const database = createDatabase({ connectionString, maxConnections: 1 });
let resetStarted = false;

try {
  await assertLocalExperienceDatabaseTarget(database);
  await assertExperienceResetScope(database);
  resetStarted = true;
  await dropExperienceSchema(database);
  await createLifecycleSchema(database, EXPERIENCE_SCHEMA);
  const fixture = createLocalExperienceFixture();
  await seedLocalExperienceDatabase(database, EXPERIENCE_SCHEMA, fixture);
  const counts = await readExperienceCounts(database);
  console.log(
    `EXPERIENCE_SETUP_PASS database=pfc_local schema=${EXPERIENCE_SCHEMA} requirements=${counts.requirements} questions=${counts.questions} gateRuns=${counts.gateRuns} materialBaselines=${counts.materialBaselines} materialRefs=${counts.materialRefs} materialImpacts=${counts.materialImpacts}`,
  );
} catch (error) {
  if (resetStarted) await dropExperienceSchema(database);
  throw error;
} finally {
  await database.destroy();
}
