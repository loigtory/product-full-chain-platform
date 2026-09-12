import type { LifecycleErrorCode } from '@pfc/contracts';

export class DomainRuleViolation extends Error {
  readonly code: LifecycleErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: LifecycleErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainRuleViolation';
    this.code = code;
    this.details = details;
  }
}
