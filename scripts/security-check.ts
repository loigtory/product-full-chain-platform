import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SecurityPolicyInput = Readonly<{
  envExample: string;
  gitignore: string;
  serverMain: string;
  serverApp: string;
  webSources: string;
  runtimeSources: string;
  productionSourceTexts?: readonly string[];
}>;

export type SecurityFinding = Readonly<{
  code: string;
  message: string;
}>;

function sensitiveExampleValue(envExample: string): boolean {
  return envExample.split(/\r?\n/).some((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    return Boolean(
      match &&
      /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|COOKIE)$/.test(match[1]!) &&
      match[2]!.trim(),
    );
  });
}

export function evaluateSecurityPolicy(
  input: SecurityPolicyInput,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const add = (code: string, message: string) =>
    findings.push({ code, message });

  if (sensitiveExampleValue(input.envExample)) {
    add(
      'EXAMPLE_SECRET_VALUE',
      'A sensitive example key has a non-empty value.',
    );
  }
  if (!/^DATABASE_URL=\s*$/m.test(input.envExample)) {
    add(
      'EXAMPLE_DATABASE_URL',
      'DATABASE_URL must remain empty in .env.example.',
    );
  }
  if (!/^FIXTURE_ADAPTERS_ENABLED=false\s*$/m.test(input.envExample)) {
    add('FIXTURE_DEFAULT_UNSAFE', 'Fixture adapters must default to disabled.');
  }
  if (!/^PFC_EXPERIENCE_MODE=false\s*$/m.test(input.envExample)) {
    add(
      'EXPERIENCE_DEFAULT_UNSAFE',
      'The full-permission experience adapter must default to disabled.',
    );
  }
  if (
    !/^\.env\s*$/m.test(input.gitignore) ||
    !/^\.env\.\*\s*$/m.test(input.gitignore) ||
    !/^!\.env\.example\s*$/m.test(input.gitignore)
  ) {
    add(
      'ENV_IGNORE_BOUNDARY',
      'Local environment files are not safely ignored.',
    );
  }
  if (
    !input.serverMain.includes("?? '127.0.0.1'") ||
    !input.serverMain.includes("host !== '127.0.0.1'") ||
    !input.serverMain.includes('LOCAL_SERVER_CONFIG_INVALID')
  ) {
    add(
      'LOOPBACK_GUARD_MISSING',
      'Server startup lacks the explicit loopback guard.',
    );
  }
  if (
    !input.serverApp.includes('server.register(helmet)') ||
    !/bodyLimit:\s*1024\s*\*\s*1024/.test(input.serverApp) ||
    !input.serverApp.includes('message: safeMessage(code)')
  ) {
    add(
      'HTTP_HARDENING_MISSING',
      'HTTP hardening or redacted errors are missing.',
    );
  }
  if (/\blocalStorage\b/.test(input.webSources)) {
    add(
      'PERSISTENT_BROWSER_STORAGE',
      'Browser code uses persistent local storage.',
    );
  }
  if (
    /\bsessionStorage\b/.test(input.webSources) &&
    !input.webSources.includes('pfc.workbench.view.v1')
  ) {
    add(
      'SESSION_STORAGE_SCOPE',
      'Session storage is not limited to workbench view state.',
    );
  }
  if (
    /\beval\b|\bnew\s+Function\b|dangerouslySetInnerHTML/.test(
      input.runtimeSources,
    )
  ) {
    add(
      'DYNAMIC_CODE_EXECUTION',
      'Runtime source contains dynamic code execution.',
    );
  }
  if (/child_process|@pfc\/persistence|DATABASE_URL/.test(input.webSources)) {
    add(
      'BROWSER_BOUNDARY_VIOLATION',
      'Browser source crosses a server-only boundary.',
    );
  }
  for (const text of input.productionSourceTexts ?? []) {
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
      add(
        'PRIVATE_KEY_MATERIAL',
        'Production source contains private key material.',
      );
      break;
    }
    if (/postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@/i.test(text)) {
      add(
        'AUTHENTICATED_DATABASE_URL',
        'Production source contains an authenticated database URL.',
      );
      break;
    }
  }
  return findings;
}

function readTree(root: string, relativeDirectory: string): string[] {
  const directory = resolve(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (['dist', 'node_modules', 'coverage'].includes(entry.name)) return [];
      return readTree(root, relative);
    }
    return /\.(?:ts|tsx|js|mjs|json)$/.test(entry.name)
      ? [readFileSync(resolve(root, relative), 'utf8')]
      : [];
  });
}

export function checkRepositorySecurity(root: string): SecurityFinding[] {
  const webSources = readTree(root, 'apps/web/src').join('\n');
  const runtimeSources = [
    ...readTree(root, 'apps'),
    ...readTree(root, 'packages'),
  ];
  return evaluateSecurityPolicy({
    envExample: readFileSync(resolve(root, '.env.example'), 'utf8'),
    gitignore: readFileSync(resolve(root, '.gitignore'), 'utf8'),
    serverMain: readFileSync(resolve(root, 'apps/server/src/main.ts'), 'utf8'),
    serverApp: readFileSync(resolve(root, 'apps/server/src/app.ts'), 'utf8'),
    webSources,
    runtimeSources: runtimeSources.join('\n'),
    productionSourceTexts: runtimeSources,
  });
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (executedPath === resolve(fileURLToPath(import.meta.url))) {
  const findings = checkRepositorySecurity(process.cwd());
  if (findings.length > 0) {
    throw new Error(
      `SECURITY_CHECK_FAILED codes=${findings.map(({ code }) => code).join(',')}`,
    );
  }
  console.log('SECURITY_CHECK_OK checks=11 findings=0');
}
