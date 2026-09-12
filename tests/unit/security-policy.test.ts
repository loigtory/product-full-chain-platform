import { describe, expect, it } from 'vitest';

import {
  evaluateSecurityPolicy,
  type SecurityPolicyInput,
} from '../../scripts/security-check.ts';

const compliant: SecurityPolicyInput = {
  envExample: [
    'APP_ENV=local',
    'API_HOST=127.0.0.1',
    'DATABASE_URL=',
    'SESSION_SECRET=',
    'FIXTURE_ADAPTERS_ENABLED=false',
    'PFC_EXPERIENCE_MODE=false',
  ].join('\n'),
  gitignore: ['.env', '.env.*', '!.env.example'].join('\n'),
  serverMain: [
    "const host = process.env.API_HOST ?? '127.0.0.1';",
    "if (host !== '127.0.0.1') throw new Error('LOCAL_SERVER_CONFIG_INVALID');",
  ].join('\n'),
  serverApp: [
    'void server.register(helmet);',
    'bodyLimit: 1024 * 1024,',
    'message: safeMessage(code),',
  ].join('\n'),
  webSources:
    "window.sessionStorage.setItem('pfc.workbench.view.v1', JSON.stringify(view));",
  runtimeSources: 'export const boundedValue = 1;',
};

describe('T7 static security policy', () => {
  it('accepts the local-only, redacted configuration boundary', () => {
    expect(evaluateSecurityPolicy(compliant)).toEqual([]);
  });

  it('reports secrets, non-loopback startup, persistent browser data, and dynamic code', () => {
    const findings = evaluateSecurityPolicy({
      ...compliant,
      envExample: compliant.envExample.replace(
        'SESSION_SECRET=',
        'SESSION_SECRET=not-a-real-secret',
      ),
      serverMain: "const host = process.env.API_HOST ?? '0.0.0.0';",
      webSources: "localStorage.setItem('requirement', originalIdea);",
      runtimeSources: 'eval(userInput);',
    });

    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'EXAMPLE_SECRET_VALUE',
        'LOOPBACK_GUARD_MISSING',
        'PERSISTENT_BROWSER_STORAGE',
        'DYNAMIC_CODE_EXECUTION',
      ]),
    );
  });

  it('requires the full-permission experience adapter to default off', () => {
    const findings = evaluateSecurityPolicy({
      ...compliant,
      envExample: compliant.envExample.replace(
        'PFC_EXPERIENCE_MODE=false',
        'PFC_EXPERIENCE_MODE=true',
      ),
    });

    expect(findings.map((finding) => finding.code)).toContain(
      'EXPERIENCE_DEFAULT_UNSAFE',
    );
  });
});
