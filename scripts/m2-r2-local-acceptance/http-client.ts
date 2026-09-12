export type LocalSession = Readonly<{
  actorId: string;
  cookie: string;
  csrfToken: string;
}>;

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('M2_R2_HTTP_RESPONSE_INVALID');
  }
  return value as Record<string, unknown>;
}

export async function createLocalSession(input: {
  baseUrl: string;
  loginName: string;
  password: string;
}): Promise<LocalSession> {
  const response = await fetch(`${input.baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginName: input.loginName,
      password: input.password,
    }),
  });
  if (!response.ok) throw new Error('M2_R2_LOGIN_FAILED');
  const body = asRecord(await response.json());
  const actor = asRecord(body.actor);
  if (
    typeof actor.actorId !== 'string' ||
    typeof actor.csrfToken !== 'string'
  ) {
    throw new Error('M2_R2_SESSION_RESPONSE_INVALID');
  }
  return {
    actorId: actor.actorId,
    csrfToken: actor.csrfToken,
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; '),
  };
}

export async function platformRequest(input: {
  baseUrl: string;
  path: string;
  session: LocalSession;
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: number;
  expectedStatus?: number;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const method = input.method ?? 'GET';
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method,
    headers: {
      Cookie: input.session.cookie,
      ...(method === 'POST'
        ? {
            'Content-Type': 'application/json',
            'X-CSRF-Token': input.session.csrfToken,
          }
        : {}),
      ...(input.idempotencyKey
        ? { 'Idempotency-Key': input.idempotencyKey }
        : {}),
      ...(input.ifMatch === undefined
        ? {}
        : { 'If-Match': `"${input.ifMatch}"` }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  const body = asRecord(await response.json().catch(() => ({})));
  if (input.expectedStatus !== undefined) {
    if (response.status !== input.expectedStatus) {
      throw new Error(
        `M2_R2_HTTP_STATUS_MISMATCH expected=${input.expectedStatus} actual=${response.status}`,
      );
    }
  } else if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : 'UNKNOWN';
    throw new Error(`M2_R2_HTTP_FAILED status=${response.status} code=${code}`);
  }
  return { status: response.status, body };
}
