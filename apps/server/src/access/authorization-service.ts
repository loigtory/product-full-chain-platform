import type {
  AccessDecision,
  ActorContext,
  AuthorizationPort,
  RequirementAccessRequest,
} from '@pfc/contracts';
import {
  createRequirementAccessDenial,
  evaluateRequirementAccess,
} from '@pfc/domain';

export class RequirementAuthorizationService {
  constructor(private readonly authorizationPort: AuthorizationPort) {}

  async authorize(
    actor: ActorContext,
    request: RequirementAccessRequest,
  ): Promise<AccessDecision> {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      return createRequirementAccessDenial(actor, request, 'IDENTITY_UNKNOWN');
    }
    try {
      const result =
        await this.authorizationPort.lookupRequirementAuthorization({
          actor,
          requirementId: request.requirementId,
          action: request.action,
        });
      if (result.status !== 'AVAILABLE') {
        return createRequirementAccessDenial(
          actor,
          request,
          `AUTHORIZATION_CAPABILITY_${result.status}`,
        );
      }
      return evaluateRequirementAccess({
        actor,
        request,
        authorization: result.data,
      });
    } catch {
      return createRequirementAccessDenial(
        actor,
        request,
        'AUTHORIZATION_CAPABILITY_ERROR',
      );
    }
  }
}
