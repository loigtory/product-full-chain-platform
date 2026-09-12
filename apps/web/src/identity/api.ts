import type {
  ApiErrorResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  CurrentActorDto,
  SessionStateDto,
} from '@pfc/contracts';

import { clearCsrfToken, getCsrfToken, setCsrfToken } from './session-store.ts';

export class IdentityApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityApiError';
  }
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      code: 'RESULT_UNKNOWN',
      message: '服务暂时不可用。',
    }))) as Partial<ApiErrorResponse>;
    throw new IdentityApiError(
      response.status,
      body.code ?? 'RESULT_UNKNOWN',
      body.message ?? '服务暂时不可用。',
    );
  }
  return (await response.json()) as T;
}

export const identityApi = {
  async login(input: CreateSessionRequest): Promise<CreateSessionResponse> {
    const response = await read<CreateSessionResponse>(
      await fetch('/api/v1/sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    setCsrfToken(response.actor.csrfToken);
    return response;
  },
  async me(): Promise<CurrentActorDto> {
    const actor = await read<CurrentActorDto>(
      await fetch('/api/v1/me', { credentials: 'same-origin' }),
    );
    setCsrfToken(actor.csrfToken);
    return actor;
  },
  async sessionState(): Promise<SessionStateDto> {
    const state = await read<SessionStateDto>(
      await fetch('/api/v1/session-state', { credentials: 'same-origin' }),
    );
    if (state.authenticated) setCsrfToken(state.actor.csrfToken);
    else clearCsrfToken();
    return state;
  },
  async logout(): Promise<void> {
    await read<{ revoked: boolean }>(
      await fetch('/api/v1/sessions/current', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      }),
    );
    clearCsrfToken();
  },
};
