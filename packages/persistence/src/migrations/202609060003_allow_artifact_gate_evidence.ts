import type { LifecycleKysely } from '../database.ts';
import {
  disableArtifactGateEvidence,
  enableArtifactGateEvidence,
} from '../artifact-evidence-bridge.ts';

const protectedSchema = 'pfc';

export async function up(database: LifecycleKysely): Promise<void> {
  await enableArtifactGateEvidence(database, protectedSchema);
}

export async function down(database: LifecycleKysely): Promise<void> {
  await disableArtifactGateEvidence(database, protectedSchema);
}
