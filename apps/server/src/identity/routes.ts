import type {
  AcceptInvitationRequest,
  CreateSessionRequest,
  CreateSessionResponse,
} from '@pfc/contracts';
import type { FastifyInstance } from 'fastify';

import {
  identityCookieNames,
  type IdentityApplicationService,
} from './application-service.ts';

export function registerIdentityRoutes(
  server: FastifyInstance,
  service: IdentityApplicationService | undefined,
  options: Readonly<{ secureCookies?: boolean }> = {},
): void {
  if (!service) return;
  const cookieBase = `Path=/; SameSite=Strict; Max-Age=28800${options.secureCookies ? '; Secure' : ''}`;
  const clearedCookieBase = `Path=/; SameSite=Strict; Max-Age=0${options.secureCookies ? '; Secure' : ''}`;

  server.post(
    '/api/v1/sessions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['loginName', 'password'],
          properties: {
            loginName: { type: 'string', minLength: 3, maxLength: 64 },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply): Promise<CreateSessionResponse> => {
      const result = await service.login(
        request.body as CreateSessionRequest,
        `${request.ip}:${(request.body as CreateSessionRequest).loginName.toLowerCase()}`,
        request.id,
      );
      reply.header('set-cookie', [
        `${identityCookieNames.session}=${result.sessionToken}; HttpOnly; ${cookieBase}`,
        `${identityCookieNames.csrf}=${result.csrfToken}; ${cookieBase}`,
      ]);
      return { actor: result.actor, expiresAt: result.expiresAt };
    },
  );

  server.delete('/api/v1/sessions/current', async (request, reply) => {
    await service.logout(request.headers.cookie, request.id);
    reply.header('set-cookie', [
      `${identityCookieNames.session}=; HttpOnly; ${clearedCookieBase}`,
      `${identityCookieNames.csrf}=; ${clearedCookieBase}`,
    ]);
    return { revoked: true };
  });

  server.get('/api/v1/me', async (request) =>
    service.getCurrentActor(request.headers.cookie),
  );

  server.get('/api/v1/session-state', async (request) =>
    service.getSessionState(request.headers.cookie),
  );

  server.post(
    '/api/v1/invitations/:token/accept',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 40, maxLength: 80 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['displayName', 'password'],
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            password: { type: 'string', minLength: 12, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      await service.acceptInvitation({
        token,
        requestId: request.id,
        ...(request.body as AcceptInvitationRequest),
      });
      reply.code(204).send();
    },
  );
}
