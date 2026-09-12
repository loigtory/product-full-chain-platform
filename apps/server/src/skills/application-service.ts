import type { ActorContext, SkillCatalogResponse } from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';

import type { SkillRepositoryPort } from './repository-port.ts';

export class SkillApplicationService {
  constructor(private readonly repository: SkillRepositoryPort) {}

  private assertAuthenticated(actor: ActorContext): void {
    if (actor.authenticationStatus !== 'AUTHENTICATED') {
      throw new DomainRuleViolation(
        'AUTHENTICATION_REQUIRED',
        'Authentication required.',
      );
    }
  }

  async list(actor: ActorContext): Promise<SkillCatalogResponse> {
    this.assertAuthenticated(actor);
    return { items: await this.repository.listActive() };
  }

  async get(actor: ActorContext, skillKey: string, version: string) {
    this.assertAuthenticated(actor);
    const release = await this.repository.findRelease(skillKey, version);
    if (!release)
      throw new DomainRuleViolation('NOT_FOUND', 'SkillRelease not found.');
    return release;
  }
}
