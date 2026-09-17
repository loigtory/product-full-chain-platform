import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { instanceArguments, PreflightRpc } from './src/agent/protocol.mjs';
import {
  reportFor,
  scenario,
  saveReport,
} from './test-data/ai-tools-host-exec-fixture.mjs';
const require = createRequire(import.meta.url);
const report = reportFor('host-protocol');
await scenario(
  report,
  'Host mode disables native tools and registers exactly five strict dynamic contracts',
  () => {
    const args = instanceArguments([], 'host');
    assert.ok(args.includes('features.shell_tool=false'));
    assert.ok(args.includes('features.unified_exec=false'));
    assert.ok(args.includes('features.apply_patch_freeform=false'));
    const { hostThreadParams } = require('./src/agent/config');
    const p = hostThreadParams({ model: 'gpt-6-astra' }, process.cwd(), {
      data: [{ skills: [], errors: [] }],
    });
    assert.equal(p.sandbox, 'read-only');
    assert.deepEqual(
      p.dynamicTools.map((t) => t.name),
      [
        'pfc_read_file',
        'pfc_write_file',
        'pfc_run_checks',
        'pfc_git_status',
        'pfc_git_diff',
      ],
    );
    for (const t of p.dynamicTools)
      assert.equal(t.inputSchema.additionalProperties, false);
  },
);
await scenario(
  report,
  'Only host mode dispatches item/tool/call; text rejects all server requests',
  async () => {
    const messages = [],
      calls = [];
    const rpc = Object.create(PreflightRpc.prototype);
    Object.assign(rpc, {
      mode: 'host',
      buffer: '',
      pending: new Map(),
      serverRequests: new Map(),
      onToolCall: async (m) => {
        calls.push(m);
        return {
          success: true,
          contentItems: [{ type: 'inputText', text: 'ok' }],
        };
      },
      write: (m) => messages.push(m),
    });
    rpc.receive(
      JSON.stringify({
        id: 7,
        method: 'item/tool/call',
        params: {
          threadId: 'thread',
          turnId: 'turn',
          callId: 'call',
          tool: 'pfc_read_file',
          arguments: { path: 'example.txt' },
        },
      }) + '\n',
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(messages[0].result.success, true);
    rpc.mode = 'text';
    rpc.receive(
      JSON.stringify({ id: 8, method: 'item/tool/call', params: {} }) + '\n',
    );
    assert.equal(messages[1].error.code, -32601);
  },
);
await scenario(
  report,
  'Host protocol rejects dangerous RPC methods without starting a process',
  async () => {
    const rpc = Object.create(PreflightRpc.prototype);
    rpc.mode = 'host';
    for (const method of [
      'process/spawn',
      'thread/shellCommand',
      'windowsSandbox/setupStart',
    ])
      await assert.rejects(rpc.request(method, {}), {
        code: 'PREFLIGHT_METHOD_NOT_ALLOWED',
      });
  },
);
saveReport(report, 'protocol');
