import type { AuthorizationPort } from '@pfc/contracts';
import {
  createDatabase,
  PostgresAgentApprovalRepository,
  PostgresAgentAuditRepository,
  PostgresAgentControlRepository,
  PostgresAgentRunRepository,
  PostgresArtifactCollaborationRepository,
  PostgresArtifactRepository,
  PostgresExecutionEvidenceRepository,
  PostgresAuthorizationPort,
  PostgresBridgeRuntimeRepository,
  PostgresBridgePairingRepository,
  PostgresCollaborationRepository,
  PostgresIdentityRepository,
  PostgresLifecycleRepository,
  PostgresMcpReadRepository,
  PostgresScopedAuthorizationRepository,
  PostgresSkillRepository,
  PostgresWorkSessionRepository,
} from '@pfc/persistence';

import { RequirementAuthorizationService } from '../access/authorization-service.js';
import { AgentApprovalApplicationService } from '../agent-approvals/index.js';
import { AgentAuditApplicationService } from '../agent-audit/index.js';
import { AgentControlApplicationService } from '../agent-controls/index.js';
import { AgentRunApplicationService } from '../agent-runs/index.js';
import { buildServer } from '../app.js';
import { ArtifactApplicationService } from '../artifacts/index.js';
import { ArtifactCollaborationApplicationService } from '../artifact-collaboration/application-service.js';
import { BridgeApplicationService } from '../bridges/index.js';
import { BridgePairingApplicationService } from '../bridge-pairings/index.js';
import {
  createDependencyPorts,
  loadDependencyRuntimeConfig,
} from '../dependencies/index.js';
import { GateRunApplicationService } from '../gate-runs/index.js';
import { IdentityApplicationService } from '../identity/index.js';
import {
  createExperienceActor,
  createExperienceDependencyPorts,
  createExperienceIdFactory,
  loadExperienceRuntimeConfig,
} from '../local-experience.js';
import { MaterialImpactApplicationService } from '../material-impacts/index.js';
import { OperationsApplicationService } from '../operations/index.js';
import { QuestionApplicationService } from '../questions/index.js';
import { RequirementApplicationService } from '../requirements/index.js';
import { SkillApplicationService } from '../skills/index.js';
import { TeamApplicationService } from '../teams/index.js';
import { TimelineApplicationService } from '../timeline/index.js';
import { WorkspaceApplicationService } from '../workspaces/index.js';
import { createLocalTestIdFactory } from '../local-test-id-factory.js';
import {
  ProductWorkTurnBridgeApplicationService,
  WorkSessionApplicationService,
} from '../work-sessions/index.js';
import {
  McpReadApplicationService,
  McpReadBridgeApplicationService,
} from '../mcp-reads/index.js';

function m2Enabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.PFC_M2_R1_ENABLED?.trim().toLowerCase() ?? 'false';
  if (!['true', 'false'].includes(value)) {
    throw new Error('PFC_M2_R1_ENABLED_INVALID');
  }
  return value === 'true';
}

function aiWorkspaceEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.PFC_AI_WORKSPACE_ENABLED?.trim().toLowerCase() ?? 'false';
  if (!['true', 'false'].includes(value)) {
    throw new Error('PFC_AI_WORKSPACE_ENABLED_INVALID');
  }
  return value === 'true';
}

export function createApplication(env: NodeJS.ProcessEnv = process.env) {
  const dependencyConfig = loadDependencyRuntimeConfig(env);
  const experienceConfig = loadExperienceRuntimeConfig(env);
  const dependencyPorts = experienceConfig.enabled
    ? createExperienceDependencyPorts()
    : createDependencyPorts(dependencyConfig);
  const databaseUrl = env.DATABASE_URL?.trim();
  if (experienceConfig.enabled && !databaseUrl) {
    throw new Error('EXPERIENCE_DATABASE_URL_REQUIRED');
  }
  const database = databaseUrl
    ? createDatabase({ connectionString: databaseUrl })
    : null;
  const artifactRepository =
    database && !experienceConfig.enabled
      ? new PostgresArtifactRepository(database, experienceConfig.schemaName)
      : undefined;
  const standardDependencyPorts =
    database && !experienceConfig.enabled
      ? {
          ...dependencyPorts,
          authorization: new PostgresAuthorizationPort(
            database,
            experienceConfig.schemaName,
          ),
          artifactEvidence: artifactRepository!,
        }
      : dependencyPorts;
  const repository = database
    ? new PostgresLifecycleRepository(database, experienceConfig.schemaName)
    : null;
  const localTestIdFactory = createLocalTestIdFactory(env, {
    schemaName: experienceConfig.schemaName,
  });
  const identityService =
    database && !experienceConfig.enabled
      ? new IdentityApplicationService(
          new PostgresIdentityRepository(database, experienceConfig.schemaName),
          localTestIdFactory ? { idFactory: localTestIdFactory } : {},
        )
      : undefined;
  const collaborationRepository =
    database && !experienceConfig.enabled
      ? new PostgresCollaborationRepository(
          database,
          experienceConfig.schemaName,
        )
      : undefined;
  const teamService =
    collaborationRepository && identityService
      ? new TeamApplicationService(collaborationRepository, identityService)
      : undefined;
  const workspaceService = collaborationRepository
    ? new WorkspaceApplicationService(collaborationRepository)
    : undefined;
  const authorization = new RequirementAuthorizationService(
    standardDependencyPorts.authorization,
  );
  const artifactService = artifactRepository
    ? new ArtifactApplicationService(artifactRepository, authorization)
    : undefined;
  const artifactCollaborationService = artifactRepository
    ? new ArtifactCollaborationApplicationService({
        artifacts: artifactRepository,
        repository: new PostgresArtifactCollaborationRepository(
          database!,
          experienceConfig.schemaName,
        ),
        authorization,
        idFactory: localTestIdFactory,
      })
    : undefined;
  const idFactory = experienceConfig.enabled
    ? createExperienceIdFactory()
    : undefined;
  const requirementService = database
    ? new RequirementApplicationService({
        repository: repository!,
        authorizationPort: standardDependencyPorts.authorization,
        deliverySummaryPort: dependencyPorts.deliverySummary,
        gateExecutionPort: dependencyPorts.gateExecution,
        idFactory,
      })
    : undefined;
  const questionService = repository
    ? new QuestionApplicationService({
        repository,
        authorizationPort: standardDependencyPorts.authorization,
        idFactory,
      })
    : undefined;
  const gateRunService = repository
    ? new GateRunApplicationService({
        repository,
        authorizationPort: standardDependencyPorts.authorization,
        artifactEvidencePort: standardDependencyPorts.artifactEvidence,
        gateExecutionPort: dependencyPorts.gateExecution,
        idFactory,
      })
    : undefined;
  const materialImpactService = repository
    ? new MaterialImpactApplicationService({
        repository,
        authorizationPort: standardDependencyPorts.authorization,
        idFactory,
      })
    : undefined;
  const timelineService = repository
    ? new TimelineApplicationService({
        repository,
        authorizationPort: standardDependencyPorts.authorization,
      })
    : undefined;
  const operationsService = repository
    ? new OperationsApplicationService({
        repository,
        authorizationPort: standardDependencyPorts.authorization,
      })
    : undefined;

  const enableM2 = m2Enabled(env);
  if (enableM2 && (experienceConfig.enabled || !database)) {
    throw new Error('PFC_M2_R1_STANDARD_DATABASE_REQUIRED');
  }
  const m2Services = enableM2
    ? createM2Services(
        database!,
        experienceConfig.schemaName,
        standardDependencyPorts.authorization,
        localTestIdFactory,
      )
    : {};
  const enableAIWorkspace = aiWorkspaceEnabled(env);
  if (enableAIWorkspace && (experienceConfig.enabled || !database)) {
    throw new Error('PFC_AI_WORKSPACE_STANDARD_DATABASE_REQUIRED');
  }
  if (enableAIWorkspace && !enableM2) {
    throw new Error('PFC_AI_WORKSPACE_M2_REQUIRED');
  }
  const workSessionRepository = enableAIWorkspace
    ? new PostgresWorkSessionRepository(database!, experienceConfig.schemaName)
    : undefined;
  const workSessionService = enableAIWorkspace
    ? new WorkSessionApplicationService({
        repository: workSessionRepository!,
        scopedAuthorizations: new PostgresScopedAuthorizationRepository(
          database!,
          experienceConfig.schemaName,
        ),
        authorization: new RequirementAuthorizationService(
          new PostgresAuthorizationPort(
            database!,
            experienceConfig.schemaName,
            {
              includeScopedTransmission: true,
            },
          ),
        ),
        idFactory: localTestIdFactory,
      })
    : undefined;
  const productWorkTurnBridgeService = enableAIWorkspace
    ? new ProductWorkTurnBridgeApplicationService({
        auth: new PostgresBridgeRuntimeRepository(
          database!,
          experienceConfig.schemaName,
        ),
        repository: workSessionRepository!,
        idFactory: localTestIdFactory,
      })
    : undefined;
  const mcpReadRepository = enableAIWorkspace
    ? new PostgresMcpReadRepository(database!, experienceConfig.schemaName)
    : undefined;
  const mcpAuthorization = enableAIWorkspace
    ? new RequirementAuthorizationService(
        new PostgresAuthorizationPort(database!, experienceConfig.schemaName, {
          includeScopedTransmission: true,
        }),
      )
    : undefined;
  const mcpReadService = enableAIWorkspace
    ? new McpReadApplicationService({
        repository: mcpReadRepository!,
        evidence: new PostgresExecutionEvidenceRepository(
          database!,
          experienceConfig.schemaName,
        ),
        authorization: mcpAuthorization!,
        idFactory: localTestIdFactory,
      })
    : undefined;
  const mcpReadBridgeService = enableAIWorkspace
    ? new McpReadBridgeApplicationService({
        auth: new PostgresBridgeRuntimeRepository(
          database!,
          experienceConfig.schemaName,
        ),
        repository: mcpReadRepository!,
        idFactory: localTestIdFactory,
      })
    : undefined;

  const server = buildServer({
    dependencyPorts: standardDependencyPorts,
    requirementService,
    questionService,
    gateRunService,
    materialImpactService,
    timelineService,
    operationsService,
    identityService,
    teamService,
    workspaceService,
    artifactService,
    artifactCollaborationService,
    ...m2Services,
    workSessionService,
    productWorkTurnBridgeService,
    mcpReadService,
    mcpReadBridgeService,
    secureCookies: !['local', 'test'].includes(env.APP_ENV ?? ''),
    resolveActor: experienceConfig.enabled
      ? () => createExperienceActor()
      : identityService
        ? (request) => identityService.resolveActor(request.headers.cookie)
        : undefined,
  });
  return { database, experienceConfig, server };
}

function createM2Services(
  database: NonNullable<ReturnType<typeof createDatabase>>,
  schemaName: string,
  authorizationPort: AuthorizationPort,
  idFactory?: (prefix: string) => string,
) {
  const agentRunRepository = new PostgresAgentRunRepository(
    database,
    schemaName,
  );
  const authorization = new RequirementAuthorizationService(authorizationPort);
  const agentControlRepository = new PostgresAgentControlRepository(
    database,
    schemaName,
  );
  return {
    agentRunService: new AgentRunApplicationService({
      repository: agentRunRepository,
      authorization,
      idFactory,
    }),
    agentApprovalService: new AgentApprovalApplicationService({
      repository: new PostgresAgentApprovalRepository(database, schemaName),
      runRepository: agentRunRepository,
      authorization,
      idFactory,
    }),
    agentControlService: new AgentControlApplicationService({
      repository: agentControlRepository,
      authorization,
      idFactory,
    }),
    agentAuditService: new AgentAuditApplicationService({
      repository: new PostgresAgentAuditRepository(database, schemaName),
      authorization,
    }),
    skillService: new SkillApplicationService(
      new PostgresSkillRepository(database, schemaName),
    ),
    bridgeService: new BridgeApplicationService({
      repository: new PostgresBridgeRuntimeRepository(database, schemaName),
    }),
    bridgePairingService: new BridgePairingApplicationService({
      repository: new PostgresBridgePairingRepository(database, schemaName),
      idFactory,
    }),
  };
}
