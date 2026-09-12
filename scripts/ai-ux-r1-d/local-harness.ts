import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
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
  PostgresIdentityRepository,
  PostgresScopedAuthorizationRepository,
  PostgresSkillRepository,
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

import { HttpProductWorkTurnGateway } from '../../apps/bridge/src/http-product-work-turn-gateway.ts';
import { LocalBridgeRegistry } from '../../apps/bridge/src/local-registry.ts';
import { ProductWorkTurnWorker } from '../../apps/bridge/src/product-work-turn-worker.ts';
import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { IdentityApplicationService } from '../../apps/server/src/identity/application-service.ts';
import { hashPassword } from '../../apps/server/src/identity/security.ts';
import { SkillApplicationService } from '../../apps/server/src/skills/index.ts';
import { WorkSessionApplicationService } from '../../apps/server/src/work-sessions/application-service.ts';
import { ProductWorkTurnBridgeApplicationService } from '../../apps/server/src/work-sessions/bridge-application-service.ts';

function required(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value.trim();
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export interface AIUXBrowserHarness {
  apiUrl: string;
  close(): Promise<{
    api: 'CLOSED';
    appServers: 'CLOSED';
    schemaRemainingTableCount: number;
    syntheticWorkspace: 'REMOVED';
  }>;
  evidence: Readonly<{
    bridgeId: string;
    externalThreadHash: string;
    requirementId: string;
    responsePresent: true;
    runId: string;
    schemaName: string;
    sessionId: string;
    skillContentHash: string;
    skillReleaseId: string;
    turnId: string;
    turnStatus: 'COMPLETED';
  }>;
  login: Readonly<{ loginName: string; password: string }>;
}

export async function startAIUXBrowserHarness(): Promise<AIUXBrowserHarness> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const runId = `UI_${suffix}`;
  const fixture = createAIWorkSessionTestData(runId);
  const database = createDatabase({
    connectionString: required(
      process.env.DATABASE_URL,
      'DATABASE_URL_REQUIRED',
    ),
  });
  const repository = new PostgresWorkSessionRepository(
    database,
    fixture.schemaName,
  );
  const identityRepository = new PostgresIdentityRepository(
    database,
    fixture.schemaName,
  );
  const password = `CODEx_TEST_AIUX_D_${suffix}_LocalOnly!`;
  const credential = `CODEx_TEST_AIUX_D_BRIDGE_${suffix}_LOCAL_ONLY`;
  const skillPath = path.resolve(
    'skills',
    'pfc-ai-product-work-session',
    'SKILL.md',
  );
  const skillHash = sha256(await readFile(skillPath));
  const syntheticWorkspace = path.resolve(
    '.local',
    'aiux-r1-d',
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
  let closed = false;

  async function close() {
    if (closed) {
      return {
        api: 'CLOSED' as const,
        appServers: 'CLOSED' as const,
        schemaRemainingTableCount: 0,
        syntheticWorkspace: 'REMOVED' as const,
      };
    }
    closed = true;
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
    await database.destroy();
    return {
      api: 'CLOSED' as const,
      appServers: 'CLOSED' as const,
      schemaRemainingTableCount: remaining.length,
      syntheticWorkspace: 'REMOVED' as const,
    };
  }

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
    const passwordDerivation = await hashPassword(password);
    await scoped
      .updateTable('accounts')
      .set({
        password_hash: passwordDerivation.hash,
        password_salt: passwordDerivation.salt,
        display_name: 'AIUX 产品负责人',
        updated_at: now(),
      })
      .where('id', '=', actor.actorId)
      .executeTakeFirstOrThrow();
    const account = await scoped
      .selectFrom('accounts')
      .select('login_name')
      .where('id', '=', actor.actorId)
      .executeTakeFirstOrThrow();
    await scoped
      .updateTable('skill_releases')
      .set({ content_hash: skillHash })
      .where('id', '=', fixture.skillReleaseId)
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
    await new PostgresScopedAuthorizationRepository(
      database,
      fixture.schemaName,
    ).grant(
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
      authorization,
      now,
      idFactory,
    });
    const identity = new IdentityApplicationService(identityRepository, {
      now,
      idFactory,
    });
    const productBridge = new ProductWorkTurnBridgeApplicationService({
      auth: new PostgresBridgeRuntimeRepository(database, fixture.schemaName),
      repository,
      now,
      idFactory,
    });
    const skills = new SkillApplicationService(
      new PostgresSkillRepository(database, fixture.schemaName),
    );
    server = buildServer({
      identityService: identity,
      productWorkTurnBridgeService: productBridge,
      resolveActor: (request) => identity.resolveActor(request.headers.cookie),
      secureCookies: false,
      skillService: skills,
      workSessionService: workSessions,
    });
    const apiUrl = await server.listen({ host: '127.0.0.1', port: 3001 });
    const gateway = new HttpProductWorkTurnGateway({
      baseUrl: apiUrl,
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
          { ...input, timeoutMs: 120_000 },
          onEvent,
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
        title: 'AI 产品协作 · 合成验收',
      },
    });
    const submitted = await workSessions.submitTurn({
      actor,
      sessionId: created.session.id,
      expectedSessionVersion: created.session.rowVersion,
      idempotencyKey: `${fixture.prefix}UI_HAPPY`,
      request: {
        schemaVersion: 'create-product-work-turn/1',
        intentKind: 'PRODUCT_DISCOVERY',
        message: '请基于当前完全合成材料，指出产品经理下一步应确认的事项。',
        contextBindingIds: [fixture.materialRefId],
        skillReleaseId: fixture.skillReleaseId,
      },
    });
    const started = await worker.runOnce();
    if (started !== 'STARTED') {
      throw new Error(`AIUX_D_TURN_NOT_STARTED:${started}`);
    }
    await worker.drain();
    const turn = await repository.findTurn(submitted.turn.id);
    if (turn?.status !== 'COMPLETED' || !turn.visibleResponse) {
      throw new Error(
        `AIUX_D_TURN_NOT_COMPLETED:${turn?.status ?? 'MISSING'}:${turn?.failureReason ?? 'NO_REASON'}`,
      );
    }
    return {
      apiUrl,
      close,
      evidence: {
        bridgeId: fixture.bridgeId,
        externalThreadHash: shortHash(turn.externalIds.threadId ?? 'missing'),
        requirementId: fixture.requirementId,
        responsePresent: true,
        runId: `CODEx_TEST_AIUX_${runId}`,
        schemaName: fixture.schemaName,
        sessionId: created.session.id,
        skillContentHash: skillHash,
        skillReleaseId: fixture.skillReleaseId,
        turnId: turn.id,
        turnStatus: 'COMPLETED',
      },
      login: { loginName: account.login_name, password },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
