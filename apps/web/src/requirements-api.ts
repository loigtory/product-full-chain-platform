import type {
  AnswerQuestionRequest,
  ApiErrorResponse,
  CompleteG0RegistrationRequest,
  ConfirmMaterialImpactRequest,
  CreateMaterialImpactAssessmentRequest,
  ConfirmQuestionRequest,
  CreateRequirementRequest,
  DeferQuestionRequest,
  GateRunMutationResponse,
  GateCenterResponse,
  GateCenterStatus,
  GateCenterView,
  GateRunMode,
  QuestionMutationResponse,
  RequirementDetailDto,
  RequirementListResponse,
  RequirementListScope,
  RequirementMutationResponse,
  MaterialImpactMutationResponse,
  MaterialBaselineStatus,
  MaterialLibraryResponse,
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
  LifecycleStage,
  RequirementSubmissionResponse,
  RegisterManualGateRunRequest,
  ReturnQuestionRequest,
  SupersedeQuestionRequest,
  StartAutomaticGateRunRequest,
  TimelineEventDto,
  TimelinePageResponse,
} from '@pfc/contracts';
import { getCsrfToken } from './identity/session-store.ts';

export type RequirementListQuery = Readonly<{
  scope: RequirementListScope;
  search: string;
  cursor?: string | null;
  limit?: number;
}>;

export type GateCenterQuery = Readonly<{
  view: GateCenterView;
  search: string;
  stage?: LifecycleStage | null;
  status?: GateCenterStatus | null;
  mode?: GateRunMode | null;
  cursor?: string | null;
  limit?: number;
}>;

export type MaterialLibraryQuery = Readonly<{
  search: string;
  status?: MaterialBaselineStatus | null;
  sourceType?: MaterialSourceType | null;
  materialPurpose?: MaterialPurpose | null;
  sensitivity?: SensitivityLevel | null;
  cursor?: string | null;
  limit?: number;
}>;

export interface RequirementsApi {
  listRequirements(
    query: RequirementListQuery,
    signal?: AbortSignal,
  ): Promise<RequirementListResponse>;
  listGateCenter?(
    query: GateCenterQuery,
    signal?: AbortSignal,
  ): Promise<GateCenterResponse>;
  listMaterialLibrary?(
    query: MaterialLibraryQuery,
    signal?: AbortSignal,
  ): Promise<MaterialLibraryResponse>;
  getRequirement(
    requirementId: string,
    signal?: AbortSignal,
  ): Promise<RequirementDetailDto>;
  createRequirement(
    input: CreateRequirementRequest,
    idempotencyKey: string,
  ): Promise<RequirementMutationResponse>;
  completeG0Registration(
    requirementId: string,
    input: CompleteG0RegistrationRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<RequirementMutationResponse>;
  getRequirementSubmission(
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<RequirementSubmissionResponse>;
  answerQuestion(
    requirementId: string,
    questionId: string,
    input: AnswerQuestionRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse>;
  confirmQuestion(
    requirementId: string,
    questionId: string,
    input: ConfirmQuestionRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse>;
  returnQuestion(
    requirementId: string,
    questionId: string,
    input: ReturnQuestionRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse>;
  supersedeQuestion(
    requirementId: string,
    questionId: string,
    input: SupersedeQuestionRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse>;
  deferQuestion(
    requirementId: string,
    questionId: string,
    input: DeferQuestionRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<QuestionMutationResponse>;
  startAutomaticGateRun(
    requirementId: string,
    input: StartAutomaticGateRunRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<GateRunMutationResponse>;
  registerManualGateRun(
    requirementId: string,
    input: RegisterManualGateRunRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<GateRunMutationResponse>;
  getGateRun(
    requirementId: string,
    gateRunId: string,
  ): Promise<GateRunMutationResponse>;
  createMaterialImpactAssessment?(
    requirementId: string,
    input: CreateMaterialImpactAssessmentRequest,
    idempotencyKey: string,
  ): Promise<MaterialImpactMutationResponse>;
  confirmMaterialImpact?(
    requirementId: string,
    impactId: string,
    input: ConfirmMaterialImpactRequest,
    rowVersion: number,
    idempotencyKey: string,
  ): Promise<MaterialImpactMutationResponse>;
  listTimeline?(
    requirementId: string,
    cursor?: string | null,
    signal?: AbortSignal,
  ): Promise<TimelinePageResponse>;
  subscribeToRequirementEvents?(
    requirementId: string,
    afterSequence: number,
    onEvent: (
      event: TimelineEventDto | { type: 'stream.reset-required' },
    ) => void,
  ): Readonly<{ close: () => void }>;
}

export class RequirementsApiError extends Error {
  readonly code: ApiErrorResponse['code'];
  readonly requestId: string;
  readonly retryable: boolean;
  readonly recoveryAction: string;
  readonly currentVersion?: number;
  readonly existingResourceId?: string;

  constructor(response: ApiErrorResponse) {
    super(response.message);
    this.name = 'RequirementsApiError';
    this.code = response.code;
    this.requestId = response.requestId;
    this.retryable = response.retryable;
    this.recoveryAction = response.recoveryAction;
    this.currentVersion = response.currentVersion;
    this.existingResourceId = response.existingResourceId;
  }
}

export class RequirementSubmissionUnknownError extends Error {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super('The requirement submission result is unknown.');
    this.name = 'RequirementSubmissionUnknownError';
    this.idempotencyKey = idempotencyKey;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: ApiErrorResponse;
    try {
      body = (await response.json()) as ApiErrorResponse;
    } catch {
      body = {
        code: 'RESULT_UNKNOWN',
        message: '服务暂时无法返回可识别的结果。',
        requestId: response.headers.get('x-request-id') ?? 'UNKNOWN',
        retryable: false,
        recoveryAction: 'REFRESH_AND_VERIFY',
      };
    }
    throw new RequirementsApiError(body);
  }
  return (await response.json()) as T;
}

async function request<T>(
  url: string,
  init: RequestInit = {},
  unknownIdempotencyKey?: string,
): Promise<T> {
  try {
    const method = (init.method ?? 'GET').toUpperCase();
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && getCsrfToken()
          ? { 'X-CSRF-Token': getCsrfToken() }
          : {}),
        ...init.headers,
      },
    });
    return await readJson<T>(response);
  } catch (error) {
    if (
      unknownIdempotencyKey &&
      !(error instanceof RequirementsApiError) &&
      !(error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw new RequirementSubmissionUnknownError(unknownIdempotencyKey);
    }
    throw error;
  }
}

function questionPath(
  requirementId: string,
  questionId: string,
  action: string,
): string {
  return `/api/v1/requirements/${encodeURIComponent(requirementId)}/questions/${encodeURIComponent(questionId)}/${action}`;
}

function mutateQuestion(
  requirementId: string,
  questionId: string,
  action: string,
  input: object,
  rowVersion: number,
  idempotencyKey: string,
): Promise<QuestionMutationResponse> {
  return request<QuestionMutationResponse>(
    questionPath(requirementId, questionId, action),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'If-Match': `"${rowVersion}"`,
      },
      body: JSON.stringify(input),
    },
    idempotencyKey,
  );
}

function gateRunPath(requirementId: string, suffix: string): string {
  return `/api/v1/requirements/${encodeURIComponent(requirementId)}/gate-runs/${suffix}`;
}

function mutateGateRun(
  requirementId: string,
  mode: 'automatic' | 'manual',
  input: StartAutomaticGateRunRequest | RegisterManualGateRunRequest,
  rowVersion: number,
  idempotencyKey: string,
): Promise<GateRunMutationResponse> {
  return request<GateRunMutationResponse>(
    gateRunPath(requirementId, mode),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'If-Match': `"${rowVersion}"`,
      },
      body: JSON.stringify(input),
    },
    idempotencyKey,
  );
}

export const requirementsApi: RequirementsApi = {
  async listRequirements(query, signal) {
    const parameters = new URLSearchParams({
      scope: query.scope,
      search: query.search,
      limit: String(query.limit ?? 20),
    });
    if (query.cursor) parameters.set('cursor', query.cursor);
    return request<RequirementListResponse>(
      `/api/v1/requirements?${parameters.toString()}`,
      { signal },
    );
  },

  async listGateCenter(query, signal) {
    const parameters = new URLSearchParams({
      view: query.view,
      search: query.search,
      limit: String(query.limit ?? 20),
    });
    if (query.stage) parameters.set('stage', query.stage);
    if (query.status) parameters.set('status', query.status);
    if (query.mode) parameters.set('mode', query.mode);
    if (query.cursor) parameters.set('cursor', query.cursor);
    return request<GateCenterResponse>(
      `/api/v1/gate-center?${parameters.toString()}`,
      { signal },
    );
  },

  async listMaterialLibrary(query, signal) {
    const parameters = new URLSearchParams({
      search: query.search,
      limit: String(query.limit ?? 20),
    });
    if (query.status) parameters.set('status', query.status);
    if (query.sourceType) parameters.set('sourceType', query.sourceType);
    if (query.materialPurpose)
      parameters.set('materialPurpose', query.materialPurpose);
    if (query.sensitivity) parameters.set('sensitivity', query.sensitivity);
    if (query.cursor) parameters.set('cursor', query.cursor);
    return request<MaterialLibraryResponse>(
      `/api/v1/material-library?${parameters.toString()}`,
      { signal },
    );
  },

  async getRequirement(requirementId, signal) {
    return request<RequirementDetailDto>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}`,
      { signal },
    );
  },

  async createRequirement(input, idempotencyKey) {
    return request<RequirementMutationResponse>(
      '/api/v1/requirements',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(input),
      },
      idempotencyKey,
    );
  },

  async completeG0Registration(
    requirementId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return request<RequirementMutationResponse>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/g0-registration`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'If-Match': `"${rowVersion}"`,
        },
        body: JSON.stringify(input),
      },
      idempotencyKey,
    );
  },

  async getRequirementSubmission(idempotencyKey, signal) {
    return request<RequirementSubmissionResponse>(
      `/api/v1/requirement-submissions/${encodeURIComponent(idempotencyKey)}`,
      { signal },
    );
  },

  async answerQuestion(
    requirementId,
    questionId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateQuestion(
      requirementId,
      questionId,
      'answers',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async confirmQuestion(
    requirementId,
    questionId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateQuestion(
      requirementId,
      questionId,
      'confirmations',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async returnQuestion(
    requirementId,
    questionId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateQuestion(
      requirementId,
      questionId,
      'returns',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async supersedeQuestion(
    requirementId,
    questionId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateQuestion(
      requirementId,
      questionId,
      'supersessions',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async deferQuestion(
    requirementId,
    questionId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateQuestion(
      requirementId,
      questionId,
      'deferrals',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async startAutomaticGateRun(
    requirementId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateGateRun(
      requirementId,
      'automatic',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async registerManualGateRun(
    requirementId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return mutateGateRun(
      requirementId,
      'manual',
      input,
      rowVersion,
      idempotencyKey,
    );
  },

  async getGateRun(requirementId, gateRunId) {
    return request<GateRunMutationResponse>(
      gateRunPath(requirementId, encodeURIComponent(gateRunId)),
    );
  },

  async createMaterialImpactAssessment(requirementId, input, idempotencyKey) {
    return request<MaterialImpactMutationResponse>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/material-impact-assessments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(input),
      },
      idempotencyKey,
    );
  },

  async confirmMaterialImpact(
    requirementId,
    impactId,
    input,
    rowVersion,
    idempotencyKey,
  ) {
    return request<MaterialImpactMutationResponse>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/material-impact-assessments/${encodeURIComponent(impactId)}/confirmations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'If-Match': `"${rowVersion}"`,
        },
        body: JSON.stringify(input),
      },
      idempotencyKey,
    );
  },

  async listTimeline(requirementId, cursor, signal) {
    const parameters = new URLSearchParams({ limit: '50' });
    if (cursor) parameters.set('cursor', cursor);
    return request<TimelinePageResponse>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/timeline?${parameters.toString()}`,
      { signal },
    );
  },

  subscribeToRequirementEvents(requirementId, afterSequence, onEvent) {
    const source = new EventSource(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/events?after=${afterSequence}`,
      { withCredentials: true },
    );
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as TimelineEventDto);
      } catch {
        onEvent({ type: 'stream.reset-required' });
      }
    };
    return { close: () => source.close() };
  },
};
