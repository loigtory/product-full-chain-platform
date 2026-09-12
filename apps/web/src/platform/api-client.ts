import type { ApiErrorResponse } from '@pfc/contracts';

import { getCsrfToken } from '../identity/session-store.ts';

export class PlatformApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

export async function platformRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method)
        ? { 'X-CSRF-Token': getCsrfToken() }
        : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      code: 'RESULT_UNKNOWN',
      message: '服务暂时不可用。',
    }))) as Partial<ApiErrorResponse>;
    throw new PlatformApiError(
      body.code ?? 'RESULT_UNKNOWN',
      body.message ?? '服务暂时不可用。',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
