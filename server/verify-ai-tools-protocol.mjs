import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  tests: [],
  live: 'NOT_RUN',
  modelTurns: 0,
};
try {
  const {
    instanceArguments,
    summarizePreflight,
    preflight,
    disabledMcpNamesFromJson,
    imageToolDisabled,
  } = await import('./src/agent/protocol.mjs');
  const test = (name, run) => {
    run();
    report.tests.push({ name, status: 'PASS' });
  };
  const base = () => ({
    version: '0.154.0',
    initialize: { userAgent: 'codex/0.154.0' },
    account: {
      account: { type: 'chatgpt', email: 'secret@example.invalid' },
      requiresOpenaiAuth: true,
    },
    config: {
      config: {
        model_provider: 'openai',
        web_search: 'disabled',
        sandbox_mode: 'read-only',
        mcp_servers: {},
        features: {
          apps: false,
          plugins: false,
          hooks: false,
          multi_agent: false,
          browser_use: false,
          computer_use: false,
          skill_mcp_dependency_install: false,
        },
      },
    },
  });
  test('Instance configuration disables inherited effects without global writes', () => {
    const args = instanceArguments();
    for (const v of [
      'features.apps=false',
      'features.plugins=false',
      'features.hooks=false',
      'features.multi_agent=false',
      'mcp_servers={}',
      'web_search="disabled"',
      'sandbox_mode="read-only"',
    ])
      assert.ok(args.includes(v), v);
    assert.ok(!args.some((x) => x.includes('danger-full-access')));
    assert.ok(
      instanceArguments(['demo-mcp']).includes(
        'mcp_servers.demo-mcp.enabled=false',
      ),
    );
    assert.throws(() => instanceArguments(['escape.key']), {
      code: 'MCP_NAME_INVALID',
    });
    assert.deepEqual(
      disabledMcpNamesFromJson(
        '[{"name":"demo-mcp","enabled":true,"env":{"TOKEN":"secret"}}]',
      ),
      ['demo-mcp'],
    );
    assert.throws(() => disabledMcpNamesFromJson('{"not":"an array"}'), {
      code: 'MCP_CONFIG_LIST_INVALID',
    });
  });
  test('Only protocol/auth/config readiness; never claims tool sandbox verification', () => {
    const r = summarizePreflight(base());
    assert.equal(r.status, 'READ_ONLY_PRECHECK_READY');
    assert.equal(r.realTools, false);
    assert.equal(r.toolSandbox, 'NOT_VERIFIED');
    assert.ok(!JSON.stringify(r).includes('secret@'));
  });
  test('Version mismatch fails closed even if old source gate passed', () => {
    const x = base();
    x.version = '0.153.4';
    assert.equal(summarizePreflight(x).status, 'PROTOCOL_VERSION_MISMATCH');
  });
  test('Missing account cannot be replaced by synthetic success', () => {
    const x = base();
    x.account.account = null;
    assert.equal(summarizePreflight(x).status, 'AUTH_REQUIRED');
  });
  test('Unapproved provider and custom base URL do not receive model requests', () => {
    const x = base();
    x.config.config.model_provider = 'unapproved';
    assert.equal(summarizePreflight(x).status, 'PROVIDER_NOT_CONFIRMED');
    x.config.config.model_provider = 'openai';
    x.config.config.model_providers = {
      openai: { base_url: 'https://unapproved.invalid/v1' },
    };
    assert.equal(
      summarizePreflight(x).status,
      'PROVIDER_ENDPOINT_NOT_CONFIRMED',
    );
    const first = summarizePreflight(x).connectionFingerprint;
    x.config.config.model_providers.openai.base_url =
      'https://other.invalid/v1';
    assert.notEqual(summarizePreflight(x).connectionFingerprint, first);
  });
  test('Inherited MCP, hooks or apps must be effectively disabled', () => {
    const x = base();
    x.config.config.mcp_servers = {
      privateServer: { url: 'https://secret.invalid' },
    };
    assert.equal(summarizePreflight(x).status, 'INSTANCE_ISOLATION_UNVERIFIED');
    delete x.config.config.mcp_servers.privateServer;
    x.config.config.features.hooks = true;
    assert.equal(summarizePreflight(x).status, 'INSTANCE_ISOLATION_UNVERIFIED');
    delete x.config.config.features;
    assert.equal(summarizePreflight(x).status, 'INSTANCE_ISOLATION_UNVERIFIED');
  });
  test('Existing authorized connection is bound to exact provider/model/account fingerprint', () => {
    const x = base();
    x.config.config.model_provider = 'existing';
    x.config.config.model = 'synthetic-model';
    x.config.config.model_providers = {
      existing: { base_url: 'https://synthetic.invalid/v1' },
    };
    const fingerprint = summarizePreflight(x).connectionFingerprint;
    x.expectedConnectionFingerprint = fingerprint;
    assert.equal(summarizePreflight(x).status, 'READ_ONLY_PRECHECK_READY');
    x.config.config.model = 'changed-model';
    assert.equal(summarizePreflight(x).status, 'CONNECTION_CHANGED');
    x.expectedConnectionFingerprint = 'invalid';
    assert.equal(summarizePreflight(x).status, 'CONNECTION_CHANGED');
  });
  test('Blocked summaries never leak private settings or account information', () => {
    const x = base();
    x.config.config.model_provider = 'secret-provider';
    x.config.config.model_providers = {
      'secret-provider': {
        api_key: 'secret-token',
        base_url: 'https://secret.invalid',
      },
    };
    const s = JSON.stringify(summarizePreflight(x));
    for (const v of [
      'secret-token',
      'secret-provider',
      'secret.invalid',
      'secret@',
    ])
      assert.ok(!s.includes(v));
  });
  test('Config DTO omission uses verified effective origin and matching session layer', () => {
    const response = {
      config: { tools: { web_search: null } },
      origins: {
        'tools.view_image': { name: { type: 'sessionFlags' }, version: 'v1' },
      },
      layers: [
        {
          name: { type: 'sessionFlags' },
          version: 'v1',
          config: { tools: { view_image: false } },
          disabledReason: null,
        },
      ],
    };
    assert.equal(imageToolDisabled(response), true);
    response.origins['tools.view_image'].version = 'changed';
    assert.equal(imageToolDisabled(response), false);
    delete response.origins['tools.view_image'];
    assert.equal(imageToolDisabled(response), false);
  });
  if (process.argv.includes('--live')) {
    report.live = await preflight({
      binary: process.env.PFC_CODEX_BINARY,
      expectedSha256: process.env.PFC_CODEX_BINARY_SHA256,
      cwd: process.env.PFC_CODEX_PREFLIGHT_CWD,
      expectedConnectionFingerprint: process.env.PFC_CODEX_CONNECTION_SHA256,
    });
    assert.equal(
      report.live.status,
      'READ_ONLY_PRECHECK_READY',
      report.live.status,
    );
  }
  report.status = 'PASS';
} catch (error) {
  report.error = {
    code: error.code || 'ASSERTION_OR_PROTOCOL_FAILURE',
    message: String(error.message).slice(0, 200),
  };
  process.exitCode = 1;
} finally {
  mkdirSync(root, { recursive: true });
  const suffix = process.argv.includes('--live') ? 'live' : 'unit';
  const file = `${root}/protocol-${suffix}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      live: typeof report.live === 'object' ? report.live.status : report.live,
      file,
      modelTurns: report.modelTurns,
      error: report.error,
    }),
  );
}
