import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ActorContext } from '@pfc/contracts';
import {
  CodexProductWorkTurnSession,
  JsonlAppServerRpc,
} from '@pfc/codex-adapter';
import { createScopedActionAuthorization } from '@pfc/domain';
import {
  PostgresAuthorizationPort,
  PostgresBridgeRuntimeRepository,
  PostgresScopedAuthorizationRepository,
  PostgresWorkSessionRepository,
  createAIUXScopedAuthorizationTables,
  createAIUXWorkSessionTables,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2AgentRunTables,
  createM2ApprovalControlTables,
  dropLifecycleSchema,
} from '@pfc/persistence';
import { createAIWorkSessionTestData } from '@pfc/test-data';

import { RequirementAuthorizationService } from '../apps/server/src/access/authorization-service.ts';
import { buildServer } from '../apps/server/src/app.ts';
import { ProductWorkTurnBridgeApplicationService } from '../apps/server/src/work-sessions/bridge-application-service.ts';
import { WorkSessionApplicationService } from '../apps/server/src/work-sessions/application-service.ts';
import { HttpProductWorkTurnGateway } from '../apps/bridge/src/http-product-work-turn-gateway.ts';
import { LocalBridgeRegistry } from '../apps/bridge/src/local-registry.ts';
import { ProductWorkTurnWorker } from '../apps/bridge/src/product-work-turn-worker.ts';

function required(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value.trim();
}

function outputPath(argv: readonly string[]): string | null {
  const index = argv.indexOf('--output');
  return index === -1 ? null : path.resolve(argv[index + 1] ?? '');
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function jsonRecord(value: unknown, code: string): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(code);
  }
  return parsed as Record<string, unknown>;
}

const reportPath = outputPath(process.argv.slice(2));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const runId = `LIVE_${suffix}`;
const fixture = createAIWorkSessionTestData(runId);
const database = createDatabase({
  connectionString: required(process.env.DATABASE_URL, 'DATABASE_URL_REQUIRED'),
});
const repository = new PostgresWorkSessionRepository(
  database,
  fixture.schemaName,
);
const credential = `CODEx_TEST_AIUX_CREDENTIAL_${suffix}_LOCAL_ONLY`;
const skillPath = path.resolve(
  'skills',
  'pfc-ai-product-work-session',
  'SKILL.md',
);
const skillHash = sha256(await readFile(skillPath));
const syntheticWorkspace = path.resolve(
  '.local',
  'aiux-r1-c',
  `CODEx_TEST_${suffix}`,
);
const codexBinary = required(
  process.env.PFC_CODEX_BINARY,
  'PFC_CODEX_BINARY_REQUIRED',
);
let logicalNow = Date.parse(fixture.turnAt) + 10_000;
const now = () => {
  logicalNow += 1_000;
  return new Date(logicalNow).toISOString();
};
let idSequence = 0;
const idFactory = (prefix: string) =>
  `${fixture.prefix}${prefix.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${++idSequence}`;
const actor: ActorContext = {
  actorId: fixture.accounts.productManager.id,
  roles: ['PRODUCT_MANAGER'],
  teamIds: [fixture.teamId],
  authenticationStatus: 'AUTHENTICATED',
};
let server: ReturnType<typeof buildServer> | null = null;
let worker: ProductWorkTurnWorker | null = null;
let failure: unknown;
let report: Readonly<Record<string, unknown>>;

try {
  await mkdir(syntheticWorkspace, { recursive: true });
  await dropLifecycleSchema(database, fixture.schemaName);
  await createLifecycleSchema(database, fixture.schemaName);
  await createM1CollaborationTables(database, fixture.schemaName);
  await createM2AgentRunTables(database, fixture.schemaName);
  await createM2ApprovalControlTables(database, fixture.schemaName);
  await createAIUXScopedAuthorizationTables(database, fixture.schemaName);
  await createAIUXWorkSessionTables(database, fixture.schemaName);
  await fixture.seedPrerequisites(database);
  const scoped = database.withSchema(fixture.schemaName);
  await scoped
    .updateTable('skill_releases')
    .set({ content_hash: skillHash })
    .where('id', '=', fixture.skillReleaseId)
    .executeTakeFirstOrThrow();
  const capabilityRow = await scoped
    .selectFrom('bridge_capability_snapshots')
    .select(['id', 'capabilities'])
    .where('bridge_id', '=', fixture.bridgeId)
    .orderBy('captured_at', 'desc')
    .executeTakeFirstOrThrow();
  const capability = jsonRecord(
    capabilityRow.capabilities,
    'AIUX_ACCEPTANCE_CAPABILITY_INVALID',
  );
  if (!Array.isArray(capability.skills)) {
    throw new Error('AIUX_ACCEPTANCE_CAPABILITY_SKILLS_INVALID');
  }
  let advertisedSkillUpdated = false;
  const skills = capability.skills.map((value) => {
    const skill = jsonRecord(value, 'AIUX_ACCEPTANCE_CAPABILITY_SKILL_INVALID');
    if (skill.releaseId !== fixture.skillReleaseId) return skill;
    advertisedSkillUpdated = true;
    return { ...skill, contentHash: skillHash };
  });
  if (!advertisedSkillUpdated) {
    throw new Error('AIUX_ACCEPTANCE_CAPABILITY_SKILL_MISSING');
  }
  await scoped
    .updateTable('bridge_capability_snapshots')
    .set({ capabilities: JSON.stringify({ ...capability, skills }) })
    .where('id', '=', capabilityRow.id)
    .executeTakeFirstOrThrow();
  await scoped
    .updateTable('bridge_registrations')
    .set({
      credential_digest: sha256(credential),
      last_heartbeat_at: now(),
      updated_at: now(),
    })
    .where('id', '=', fixture.bridgeId)
    .executeTakeFirstOrThrow();
  const scopedAuthorizations = new PostgresScopedAuthorizationRepository(
    database,
    fixture.schemaName,
  );
  await scopedAuthorizations.grant(
    createScopedActionAuthorization({
      authorizationId: fixture.authorizationId,
      actorId: actor.actorId,
      requirementId: fixture.requirementId,
      target: 'APPROVED_AI',
      purpose: 'product-work-session',
      materialRefIds: [fixture.materialRefId],
      grantedBy: fixture.accounts.productOwner.id,
      grantorRoles: ['PRODUCT_OWNER'],
      grantedAt: fixture.now,
      validUntil: fixture.grantExpiresAt,
    }),
  );

  const authorization = new RequirementAuthorizationService(
    new PostgresAuthorizationPort(database, fixture.schemaName, {
      includeScopedTransmission: true,
      now,
    }),
  );
  const workSessions = new WorkSessionApplicationService({
    repository,
    scopedAuthorizations,
    authorization,
    now,
    idFactory,
  });
  const bridgeRuntime = new PostgresBridgeRuntimeRepository(
    database,
    fixture.schemaName,
  );
  const productBridge = new ProductWorkTurnBridgeApplicationService({
    auth: bridgeRuntime,
    repository,
    now,
    idFactory,
  });
  server = buildServer({ productWorkTurnBridgeService: productBridge });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const gateway = new HttpProductWorkTurnGateway({
    baseUrl: address,
    bridgeId: fixture.bridgeId,
    credential,
    now,
  });
  const registry = new LocalBridgeRegistry({
    workspaceRoot: path.resolve('.'),
    skillRoot: path.resolve('skills'),
    workspaces: [],
    skills: [
      {
        releaseId: fixture.skillReleaseId,
        name: 'pfc-ai-product-work-session',
        path: skillPath,
        enabled: true,
      },
    ],
  });
  let sessionTimeoutMs = 120_000;
  let startedSignal: (() => void) | null = null;
  let started = new Promise<void>((resolve) => {
    startedSignal = resolve;
  });
  worker = new ProductWorkTurnWorker({
    bridgeId: fixture.bridgeId,
    workspacePath: syntheticWorkspace,
    gateway,
    registry,
    now,
    idFactory,
    runnerFactory: async (input, onEvent) => {
      const rpc = new JsonlAppServerRpc({
        binary: codexBinary,
        cwd: process.cwd(),
        requestTimeoutMs: 120_000,
      });
      return CodexProductWorkTurnSession.start(
        rpc,
        { ...input, timeoutMs: sessionTimeoutMs },
        async (event) => {
          await onEvent(event);
          if (event.eventType === 'TURN_STARTED') startedSignal?.();
        },
      );
    },
  });

  const created = await workSessions.create({
    actor,
    requirementId: fixture.requirementId,
    request: {
      schemaVersion: 'create-product-work-session/1',
      teamId: fixture.teamId,
      controlSurface: 'WEB',
      title: 'AIUX 真实合成验收',
    },
  });
  const readiness = await workSessions.readiness(actor, created.session.id);
  if (
    readiness.transmissionStatus !== 'READY' ||
    readiness.bridgeStatus !== 'AVAILABLE' ||
    readiness.recommendedSkillReleaseId !== fixture.skillReleaseId ||
    !readiness.recommendedContextIds.includes(fixture.materialRefId) ||
    readiness.blockers.length > 0
  ) {
    throw new Error('AIUX_ACCEPTANCE_READINESS_NOT_READY');
  }

  async function submit(label: string, message: string) {
    const session = await repository.findSession(created.session.id);
    if (!session) throw new Error('AIUX_ACCEPTANCE_SESSION_MISSING');
    return workSessions.submitTurn({
      actor,
      sessionId: session.id,
      expectedSessionVersion: session.rowVersion,
      idempotencyKey: `${fixture.prefix}${label}`,
      request: {
        schemaVersion: 'create-product-work-turn/1',
        intentKind: 'ANALYZE_REQUIREMENT',
        message,
        contextBindingIds: [fixture.materialRefId],
        skillReleaseId: fixture.skillReleaseId,
      },
    });
  }

  async function commandReason(turnId: string): Promise<string> {
    const row = await scoped
      .selectFrom('product_work_turn_commands')
      .select('result_summary')
      .where('turn_id', '=', turnId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const value = row?.result_summary;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'NO_COMMAND_REASON';
    }
    const reason = (value as Record<string, unknown>).reasonCode;
    return typeof reason === 'string' ? reason : 'NO_COMMAND_REASON';
  }

  const happy = await submit(
    'HAPPY',
    '请基于当前完全合成的材料，指出产品经理下一步应确认的一个事项。',
  );
  const happyStartResult = await worker.runOnce();
  if (happyStartResult !== 'STARTED') {
    throw new Error(
      `AIUX_ACCEPTANCE_HAPPY_NOT_STARTED:${happyStartResult}:${await commandReason(happy.turn.id)}`,
    );
  }
  await worker.drain();
  const happyReadback = await repository.findTurn(happy.turn.id);
  if (happyReadback?.status !== 'COMPLETED' || !happyReadback.visibleResponse) {
    throw new Error(
      [
        'AIUX_ACCEPTANCE_HAPPY_NOT_COMPLETED',
        happyReadback?.status ?? 'MISSING',
        happyReadback?.failureReason ?? 'NO_FAILURE_REASON',
        happyReadback?.visibleResponse
          ? 'HAS_VISIBLE_RESPONSE'
          : 'NO_VISIBLE_RESPONSE',
      ].join(':'),
    );
  }

  started = new Promise<void>((resolve) => {
    startedSignal = resolve;
  });
  const cancellation = await submit(
    'CANCEL',
    '请详细分析这份完全合成材料的澄清路径，并只输出平台要求的 JSON。',
  );
  const cancellationStartResult = await worker.runOnce();
  if (cancellationStartResult !== 'STARTED') {
    throw new Error(
      `AIUX_ACCEPTANCE_CANCEL_NOT_STARTED:${cancellationStartResult}`,
    );
  }
  await Promise.race([
    started,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error('AIUX_ACCEPTANCE_CANCEL_START_TIMEOUT')),
        20_000,
      ),
    ),
  ]);
  const running = await repository.findTurn(cancellation.turn.id);
  if (running?.status !== 'RUNNING') {
    throw new Error('AIUX_ACCEPTANCE_CANCEL_TURN_NOT_RUNNING');
  }
  await workSessions.controlTurn({
    actor,
    turnId: running.id,
    action: 'CANCEL',
    expectedTurnVersion: running.rowVersion,
    idempotencyKey: `${fixture.prefix}CANCEL_CONTROL`,
  });
  const cancellationControlResult = await worker.runOnce();
  if (cancellationControlResult !== 'CONTROLLED') {
    throw new Error(
      `AIUX_ACCEPTANCE_CANCEL_NOT_CONTROLLED:${cancellationControlResult}`,
    );
  }
  await worker.drain();
  const cancellationReadback = await repository.findTurn(cancellation.turn.id);
  if (cancellationReadback?.status !== 'CANCELLED') {
    throw new Error('AIUX_ACCEPTANCE_CANCEL_NOT_VERIFIED');
  }

  sessionTimeoutMs = 1_000;
  started = new Promise<void>((resolve) => {
    startedSignal = resolve;
  });
  const unknown = await submit(
    'UNKNOWN',
    '请形成一份完整的多角度产品分析。此处仅含完全合成的本地材料。',
  );
  const unknownStartResult = await worker.runOnce();
  if (unknownStartResult !== 'STARTED') {
    throw new Error(
      `AIUX_ACCEPTANCE_UNKNOWN_NOT_STARTED:${unknownStartResult}`,
    );
  }
  await worker.drain();
  const unknownReadback = await repository.findTurn(unknown.turn.id);
  const sessionReadback = await repository.findSession(created.session.id);
  if (
    unknownReadback?.status !== 'UNKNOWN' ||
    sessionReadback?.status !== 'BLOCKED'
  ) {
    throw new Error('AIUX_ACCEPTANCE_UNKNOWN_NOT_PERSISTED');
  }

  const events = await repository.listEvents(created.session.id, 0, 200);
  report = {
    runId: `CODEx_TEST_AIUX_${runId}`,
    status: 'PASS',
    environment: 'LOCAL_ISOLATED_POSTGRESQL',
    dataSource: 'DETERMINISTIC_SYNTHETIC',
    protocolVersion: 'product-work-turn/1',
    readiness: {
      transmissionStatus: readiness.transmissionStatus,
      bridgeStatus: readiness.bridgeStatus,
      recommendedContextCount: readiness.recommendedContextIds.length,
      recommendedSkillReleaseId: readiness.recommendedSkillReleaseId,
      blockerCount: readiness.blockers.length,
    },
    skill: {
      name: 'pfc-ai-product-work-session',
      contentHash: skillHash,
    },
    scenarios: {
      completed: {
        turnStatus: happyReadback.status,
        visibleResponsePresent: true,
        externalThreadHash: shortHash(
          happyReadback.externalIds.threadId ?? 'missing',
        ),
      },
      cancelled: { turnStatus: cancellationReadback.status },
      unknown: {
        turnStatus: unknownReadback.status,
        sessionStatus: sessionReadback.status,
        recoveryAction: unknownReadback.recoveryAction,
      },
    },
    eventTypes: [...new Set(events.items.map((event) => event.type))],
    createdIds: {
      sessionId: created.session.id,
      turnIds: [happy.turn.id, cancellation.turn.id, unknown.turn.id],
    },
    cleanup: {
      appServers: 'CLOSED_BY_WORKER',
      loopbackServer: 'CLOSED_IN_FINALLY',
      schema: 'DROPPED_IN_FINALLY',
    },
    sensitiveData: 'NONE_SYNTHETIC_ONLY',
  };
} catch (error) {
  failure = error;
  report = {
    runId: `CODEx_TEST_AIUX_${runId}`,
    status: 'FAIL',
    failureCode:
      error instanceof Error && /^[A-Z][A-Z0-9_:=-]*/.test(error.message)
        ? error.message.slice(0, 160)
        : 'AIUX_ACCEPTANCE_UNCLASSIFIED',
    cleanup: 'ATTEMPTED_IN_FINALLY',
  };
} finally {
  await worker?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await dropLifecycleSchema(database, fixture.schemaName).catch(
    () => undefined,
  );
  await rm(syntheticWorkspace, { recursive: true, force: true });
  const remaining = await database
    .selectFrom('information_schema.tables')
    .select('table_name')
    .where('table_schema', '=', fixture.schemaName)
    .execute();
  report = { ...report!, schemaRemainingTableCount: remaining.length };
  await database.destroy();
}

if (reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report!, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report!));
if (failure) throw failure;
