import helmet from '@fastify/helmet';
import Fastify from 'fastify';

import type {
  ApiErrorResponse,
  BootstrapHealthResponse,
  LifecycleErrorCode,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import {
  createUnavailableDependencyPorts,
  type DependencyPorts,
} from './dependencies/index.js';
import type { GateRunApplicationService } from './gate-runs/application-service.js';
import { registerGateRunRoutes } from './gate-runs/routes.js';
import type { MaterialImpactApplicationService } from './material-impacts/application-service.js';
import { registerMaterialImpactRoutes } from './material-impacts/routes.js';
import type { OperationsApplicationService } from './operations/application-service.js';
import { registerOperationsRoutes } from './operations/routes.js';
import type { QuestionApplicationService } from './questions/application-service.js';
import { registerQuestionRoutes } from './questions/routes.js';
import type { RequirementApplicationService } from './requirements/application-service.js';
import {
  registerRequirementRoutes,
  type ActorResolver,
} from './requirements/routes.js';
import type { TimelineApplicationService } from './timeline/application-service.js';
import { registerTimelineRoutes } from './timeline/routes.js';
import type { IdentityApplicationService } from './identity/application-service.js';
import { registerIdentityRoutes } from './identity/routes.js';
import type { TeamApplicationService } from './teams/application-service.js';
import { registerTeamRoutes } from './teams/routes.js';
import type { WorkspaceApplicationService } from './workspaces/application-service.js';
import { registerWorkspaceRoutes } from './workspaces/routes.js';
import type { ArtifactApplicationService } from './artifacts/application-service.js';
import { registerArtifactRoutes } from './artifacts/routes.js';
import type { ArtifactCollaborationApplicationService } from './artifact-collaboration/application-service.js';
import { registerArtifactCollaborationRoutes } from './artifact-collaboration/routes.js';
import type { AgentRunApplicationService } from './agent-runs/application-service.js';
import { registerAgentRunRoutes } from './agent-runs/routes.js';
import type { AgentApprovalApplicationService } from './agent-approvals/application-service.js';
import { registerAgentApprovalRoutes } from './agent-approvals/routes.js';
import type { AgentControlApplicationService } from './agent-controls/application-service.js';
import { registerAgentControlRoutes } from './agent-controls/routes.js';
import type { AgentAuditApplicationService } from './agent-audit/application-service.js';
import { registerAgentAuditRoutes } from './agent-audit/routes.js';
import type { SkillApplicationService } from './skills/application-service.js';
import { registerSkillRoutes } from './skills/routes.js';
import type { BridgeApplicationService } from './bridges/application-service.js';
import { registerBridgeRoutes } from './bridges/routes.js';
import type { BridgePairingApplicationService } from './bridge-pairings/application-service.js';
import { registerBridgePairingRoutes } from './bridge-pairings/routes.js';
import type { WorkSessionApplicationService } from './work-sessions/application-service.js';
import { registerWorkSessionRoutes } from './work-sessions/routes.js';
import type { ProductWorkTurnBridgeApplicationService } from './work-sessions/bridge-application-service.js';
import { registerProductWorkTurnBridgeRoutes } from './work-sessions/bridge-routes.js';
import type { McpReadApplicationService } from './mcp-reads/application-service.js';
import type { McpReadBridgeApplicationService } from './mcp-reads/bridge-application-service.js';
import { registerMcpReadRoutes } from './mcp-reads/routes.js';
import { registerMcpReadBridgeRoutes } from './mcp-reads/bridge-routes.js';

export type BuildServerOptions = Readonly<{
  dependencyPorts?: DependencyPorts;
  requirementService?: RequirementApplicationService;
  questionService?: QuestionApplicationService;
  gateRunService?: GateRunApplicationService;
  materialImpactService?: MaterialImpactApplicationService;
  operationsService?: OperationsApplicationService;
  timelineService?: TimelineApplicationService;
  resolveActor?: ActorResolver;
  identityService?: IdentityApplicationService;
  teamService?: TeamApplicationService;
  workspaceService?: WorkspaceApplicationService;
  artifactService?: ArtifactApplicationService;
  artifactCollaborationService?: ArtifactCollaborationApplicationService;
  agentRunService?: AgentRunApplicationService;
  agentApprovalService?: AgentApprovalApplicationService;
  agentControlService?: AgentControlApplicationService;
  agentAuditService?: AgentAuditApplicationService;
  skillService?: SkillApplicationService;
  bridgeService?: BridgeApplicationService;
  bridgePairingService?: BridgePairingApplicationService;
  workSessionService?: WorkSessionApplicationService;
  productWorkTurnBridgeService?: ProductWorkTurnBridgeApplicationService;
  mcpReadService?: McpReadApplicationService;
  mcpReadBridgeService?: McpReadBridgeApplicationService;
  secureCookies?: boolean;
}>;

const defaultActorResolver: ActorResolver = (request) => ({
  actorId: `UNKNOWN_${request.id}`,
  roles: [],
  teamIds: [],
  authenticationStatus: 'UNKNOWN',
});

function errorStatus(code: LifecycleErrorCode): number {
  if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTHENTICATION_FAILED')
    return 401;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'NOT_FOUND') return 404;
  if (
    code === 'PERMISSION_DENIED' ||
    code === 'SENSITIVE_ACTION_AUTH_REQUIRED' ||
    code === 'CSRF_INVALID'
  ) {
    return 403;
  }
  if (
    code === 'VERSION_CONFLICT' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'INVALID_STATE_TRANSITION' ||
    code === 'WORK_SESSION_BLOCKED' ||
    code === 'CONTEXT_STALE' ||
    code === 'PROPOSAL_STALE' ||
    code === 'PROPOSAL_SCOPE_MISMATCH' ||
    code === 'WORK_TURN_ALREADY_ACTIVE' ||
    code === 'EVENT_GAP_REQUIRES_RELOAD' ||
    code === 'ARTIFACT_CONTENT_UNAVAILABLE' ||
    code === 'ARTIFACT_REVIEW_VERSION_STALE' ||
    code === 'TRACE_LINK_ALREADY_EXISTS' ||
    code === 'MCP_CAPABILITY_DRIFTED' ||
    code === 'MCP_READ_CONCURRENCY_LIMIT' ||
    code === 'MCP_RESULT_UNKNOWN'
  ) {
    return 409;
  }
  if (
    code === 'DEPENDENCY_UNAVAILABLE' ||
    code === 'RESULT_UNKNOWN' ||
    code === 'BRIDGE_CAPABILITY_UNAVAILABLE' ||
    code === 'MCP_CAPABILITY_UNAVAILABLE' ||
    code === 'EVIDENCE_ARCHIVE_PENDING'
  ) {
    return 503;
  }
  if (code === 'TRANSMISSION_AUTH_REQUIRED') return 403;
  if (code === 'MCP_TRANSMISSION_AUTHORIZATION_REQUIRED') return 403;
  return 400;
}

function recoveryAction(code: LifecycleErrorCode): string {
  if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTHENTICATION_FAILED')
    return 'SIGN_IN';
  if (code === 'CSRF_INVALID') return 'RELOAD_SESSION';
  if (code === 'RATE_LIMITED') return 'WAIT_AND_RETRY';
  if (code === 'PERMISSION_DENIED' || code === 'NOT_FOUND') {
    return 'RETURN_TO_WORKLIST';
  }
  if (code === 'VERSION_CONFLICT') return 'RELOAD_CURRENT';
  if (code === 'CONTEXT_STALE' || code === 'PROPOSAL_STALE')
    return 'RELOAD_CURRENT';
  if (code === 'TRANSMISSION_AUTH_REQUIRED')
    return 'REQUEST_TRANSMISSION_AUTHORIZATION';
  if (code === 'WORK_SESSION_BLOCKED') return 'RESUME_SESSION';
  if (code === 'WORK_TURN_ALREADY_ACTIVE') return 'VIEW_ACTIVE_TURN';
  if (code === 'BRIDGE_CAPABILITY_UNAVAILABLE')
    return 'RETURN_TO_STRUCTURED_WORKFLOW';
  if (code === 'EVENT_GAP_REQUIRES_RELOAD') return 'RELOAD_CURRENT';
  if (code === 'ARTIFACT_CONTENT_UNAVAILABLE') return 'IMPORT_CONTENT';
  if (code === 'ARTIFACT_CONTENT_TOO_LARGE') return 'SELECT_OTHER_VERSION';
  if (code === 'ARTIFACT_DIFF_LIMIT_EXCEEDED') return 'SELECT_OTHER_VERSION';
  if (code === 'ARTIFACT_REVIEW_VERSION_STALE') return 'RELOAD_CURRENT';
  if (code === 'TRACE_SUBJECT_UNVERIFIED') return 'VERIFY_AUTHORITY';
  if (code === 'TRACE_CROSS_REQUIREMENT_FORBIDDEN') return 'VERIFY_AUTHORITY';
  if (code === 'TRACE_LINK_ALREADY_EXISTS') return 'RELOAD_CURRENT';
  if (code === 'MCP_CAPABILITY_UNAVAILABLE') return 'VERIFY_MCP_CAPABILITY';
  if (code === 'MCP_CAPABILITY_DRIFTED') return 'VERIFY_MCP_CAPABILITY';
  if (code === 'MCP_READ_NOT_ALLOWED') return 'SELECT_APPROVED_MCP_CAPABILITY';
  if (code === 'MCP_TRANSMISSION_AUTHORIZATION_REQUIRED')
    return 'REQUEST_TRANSMISSION_AUTHORIZATION';
  if (code === 'MCP_READ_CONCURRENCY_LIMIT') return 'VIEW_ACTIVE_MCP_REQUEST';
  if (code === 'MCP_OUTPUT_LIMIT_EXCEEDED') return 'NARROW_MCP_QUERY';
  if (code === 'MCP_RESULT_UNKNOWN') return 'VERIFY_MCP_RESULT';
  if (code === 'EVIDENCE_ARCHIVE_PENDING') return 'RETRY_EVIDENCE_ARCHIVE';
  if (code === 'IDEMPOTENCY_CONFLICT') return 'USE_ORIGINAL_KEY_OR_NEW_REQUEST';
  if (code === 'RESULT_UNKNOWN') return 'VERIFY_SUBMISSION';
  if (code === 'DEPENDENCY_UNAVAILABLE') return 'RETRY';
  return 'CORRECT_INPUT';
}

function safeMessage(code: LifecycleErrorCode): string {
  if (code === 'AUTHENTICATION_REQUIRED') return '请先登录后继续。';
  if (code === 'AUTHENTICATION_FAILED') return '账号或密码不正确。';
  if (code === 'CSRF_INVALID') return '会话校验失败，请刷新后重试。';
  if (code === 'RATE_LIMITED') return '登录尝试过多，请稍后重试。';
  if (code === 'PERMISSION_DENIED') return '你没有执行此操作的权限。';
  if (code === 'NOT_FOUND') return '目标需求不存在或不可用。';
  if (code === 'VERSION_CONFLICT') return '需求已更新，请重新加载后再操作。';
  if (code === 'IDEMPOTENCY_CONFLICT') return '提交标识已用于其他请求。';
  if (code === 'RESULT_UNKNOWN') return '提交结果暂时无法确认，请先核验。';
  if (code === 'DEPENDENCY_UNAVAILABLE') return '当前能力暂不可用。';
  if (code === 'TRANSMISSION_AUTH_REQUIRED')
    return '当前材料尚未获得本次 AI 作业所需的传输授权。';
  if (code === 'CONTEXT_STALE' || code === 'PROPOSAL_STALE')
    return '当前内容已变化，请重新加载后再继续。';
  if (code === 'WORK_SESSION_BLOCKED') return '当前作业会话已阻断。';
  if (code === 'WORK_TURN_ALREADY_ACTIVE') return '当前会话已有进行中的回合。';
  if (code === 'BRIDGE_CAPABILITY_UNAVAILABLE')
    return '当前没有兼容的本地 AI 作业能力。';
  if (code === 'ARTIFACT_CONTENT_UNAVAILABLE') return '当前版本正文尚未归档。';
  if (code === 'ARTIFACT_CONTENT_TOO_LARGE')
    return '当前版本正文超过归档上限。';
  if (code === 'ARTIFACT_DIFF_LIMIT_EXCEEDED')
    return '版本差异超过当前计算上限。';
  if (code === 'ARTIFACT_REVIEW_VERSION_STALE')
    return '产物版本已变化，请重新加载后评审。';
  if (code === 'TRACE_SUBJECT_UNVERIFIED')
    return '追踪对象缺少可验证的权威版本。';
  if (code === 'TRACE_CROSS_REQUIREMENT_FORBIDDEN')
    return '不能建立跨需求追踪关系。';
  if (code === 'TRACE_LINK_ALREADY_EXISTS') return '该追踪关系已经存在。';
  if (code === 'MCP_CAPABILITY_UNAVAILABLE')
    return '当前没有已登记且可用的 MCP 只读能力。';
  if (code === 'MCP_CAPABILITY_DRIFTED')
    return 'MCP 配置或参数结构已变化，请重新核验。';
  if (code === 'MCP_READ_NOT_ALLOWED') return '当前 MCP 能力未获准执行。';
  if (code === 'MCP_TRANSMISSION_AUTHORIZATION_REQUIRED')
    return '受限材料尚未获得本次 MCP 传输授权。';
  if (code === 'MCP_READ_CONCURRENCY_LIMIT')
    return '当前会话已有 MCP 查询正在执行。';
  if (code === 'MCP_OUTPUT_LIMIT_EXCEEDED')
    return 'MCP 返回结果超过当前归档上限。';
  if (code === 'MCP_RESULT_UNKNOWN')
    return 'MCP 调用结果不确定，请先核验后再继续。';
  if (code === 'EVIDENCE_ARCHIVE_PENDING')
    return '执行结果尚未完成持久证据归档。';
  return '请求不符合当前业务规则。';
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    bodyLimit: 1024 * 1024,
    logger: false,
  });

  server.setErrorHandler((error, request, reply) => {
    const domainError = error instanceof DomainRuleViolation ? error : null;
    const isValidationError =
      typeof error === 'object' && error !== null && 'validation' in error;
    const code: LifecycleErrorCode = isValidationError
      ? 'VALIDATION_FAILED'
      : (domainError?.code ?? 'DEPENDENCY_UNAVAILABLE');
    const details = domainError?.details;
    const response: ApiErrorResponse = {
      code,
      message: safeMessage(code),
      requestId: request.id,
      retryable: code === 'DEPENDENCY_UNAVAILABLE' || code === 'RESULT_UNKNOWN',
      recoveryAction: recoveryAction(code),
      ...(typeof details?.currentVersion === 'number'
        ? { currentVersion: details.currentVersion }
        : {}),
      ...(typeof details?.existingResourceId === 'string'
        ? { existingResourceId: details.existingResourceId }
        : {}),
    };
    return reply.code(errorStatus(code)).send(response);
  });

  void server.register(helmet);
  server.decorate(
    'pfcDependencyPorts',
    options.dependencyPorts ?? createUnavailableDependencyPorts(),
  );

  server.addHook('preHandler', async (request) => {
    if (!options.identityService || !request.url.startsWith('/api/v1/')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (
      request.method === 'POST' &&
      (request.url === '/api/v1/sessions' ||
        /^\/api\/v1\/invitations\/[^/]+\/accept$/.test(request.url))
    ) {
      return;
    }
    await options.identityService.assertCsrf(
      request.headers.cookie,
      request.headers['x-csrf-token'],
    );
  });

  registerIdentityRoutes(server, options.identityService, {
    secureCookies: options.secureCookies,
  });
  registerTeamRoutes(server, {
    service: options.teamService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerWorkspaceRoutes(server, {
    service: options.workspaceService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerArtifactRoutes(server, {
    service: options.artifactService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerArtifactCollaborationRoutes(server, {
    service: options.artifactCollaborationService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerSkillRoutes(server, {
    service: options.skillService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerAgentRunRoutes(server, {
    service: options.agentRunService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerAgentApprovalRoutes(server, {
    service: options.agentApprovalService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerAgentControlRoutes(server, {
    service: options.agentControlService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerAgentAuditRoutes(server, {
    service: options.agentAuditService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerBridgeRoutes(server, options.bridgeService);
  registerBridgePairingRoutes(server, {
    service: options.bridgePairingService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerWorkSessionRoutes(server, {
    service: options.workSessionService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerProductWorkTurnBridgeRoutes(
    server,
    options.productWorkTurnBridgeService,
  );
  registerMcpReadRoutes(server, {
    service: options.mcpReadService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerMcpReadBridgeRoutes(server, options.mcpReadBridgeService);

  server.get('/health', async (): Promise<BootstrapHealthResponse> => ({
    status: 'ok',
    stage: options.materialImpactService
      ? 't6'
      : options.gateRunService
        ? 't5'
        : options.questionService
          ? 't4'
          : options.requirementService
            ? 't3'
            : 'bootstrap',
    businessFeatures: Boolean(options.requirementService),
  }));

  registerRequirementRoutes(server, {
    service: options.requirementService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerOperationsRoutes(server, {
    service: options.operationsService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerQuestionRoutes(server, {
    service: options.questionService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerGateRunRoutes(server, {
    service: options.gateRunService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerMaterialImpactRoutes(server, {
    service: options.materialImpactService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });
  registerTimelineRoutes(server, {
    service: options.timelineService,
    resolveActor: options.resolveActor ?? defaultActorResolver,
  });

  return server;
}
