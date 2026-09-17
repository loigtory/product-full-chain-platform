'use strict';
const {
  textThreadParams,
  hostThreadParams,
  execThreadParams,
  assertTextThread,
  assertExecThread,
  checkedTextInput,
  assertInstructionSources,
} = require('./config');
const { readFileSync, statSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { homedir } = require('node:os');
const { Buffer } = require('node:buffer');
const { setTimeout, clearTimeout } = require('node:timers');
const fail = (code) => Object.assign(new Error(code), { code });

// Host-owned input authorization and durable turn reservation precede runText.
// No arbitrary RPC, command execution, file access or provider selection is exposed.
class TextConversation {
  constructor() {
    this.active = null;
    this.closed = false;
    this.instructionSources = [];
    this.approvedInstructionSources = [];
    this.enabledSkills = [];
  }
  static async open(options) {
    const self = new TextConversation();
    self.execMode = options.mode === 'exec';
    self.hostMode = options.mode === 'host';
    if (self.hostMode && typeof options.onToolCall !== 'function')
      throw fail('HOST_DISPATCHER_REQUIRED');
    self.bindings = self.hostMode
      ? new (require('./approval-service').DynamicBindings)()
      : null;
    self.onToolCall = options.onToolCall;
    if (self.execMode) require('./execution-policy').requireCapability();
    self.onTurnEvent = options.onTurnEvent ?? null;
    self.enabledSkills = Array.isArray(options.enabledSkills)
      ? options.enabledSkills.map((n) => String(n))
      : [];
    self.approvedInstructionSources = (
      options.approvedInstructionSources ?? []
    ).map((s) => Object.freeze({ ...s }));
    assertInstructionSources(
      self.approvedInstructionSources.map((s) => s.path),
      self.approvedInstructionSources,
    );
    const { openProtocol } = await import('./protocol.mjs');
    self.connection = await openProtocol({
      ...options,
      mode: self.hostMode ? 'host' : self.execMode ? 'exec' : 'text',
      onToolCall: (message) => self.receiveToolCall(message),
      onNotification: (event) => self.receive(event),
    });
    self.connection.rpc.child.once('exit', () =>
      self.active?.reject(fail('TURN_CONNECTION_LOST')),
    );
    try {
      const inventory = await self.connection.rpc.request('skills/list', {
        cwds: [self.connection.cwd],
        forceReload: true,
      });
      const params = self.hostMode
        ? hostThreadParams(
            self.connection.summary,
            self.connection.cwd,
            inventory,
          )
        : self.execMode
          ? execThreadParams(
              self.connection.summary,
              self.connection.cwd,
              inventory,
            )
          : textThreadParams(
              self.connection.summary,
              self.connection.cwd,
              inventory,
              self.enabledSkills,
            );
      const thread = await self.connection.rpc.request('thread/start', params);
      self.readback = {
        instructionSourceCount: Array.isArray(thread.instructionSources)
          ? thread.instructionSources.length
          : null,
        disabledSkillCount: params.config['skills.config'].length,
        modelMatches: thread.model === self.connection.summary.model,
        sandboxType: [
          'readOnly',
          'workspaceWrite',
          'dangerFullAccess',
        ].includes(thread.sandbox?.type)
          ? thread.sandbox.type
          : 'UNKNOWN',
        networkAccess: thread.sandbox?.networkAccess,
        instructionSources: Array.isArray(thread.instructionSources)
          ? thread.instructionSources.map((source) => {
              const globalPaths = ['AGENTS.md', 'AGENTS.override.md'].map(
                (name) => path.join(homedir(), '.codex', name),
              );
              if (
                typeof source !== 'string' ||
                !globalPaths.includes(path.resolve(source))
              )
                return { kind: 'OTHER_UNAPPROVED' };
              const bytes = statSync(source).size;
              if (bytes > 1024 * 1024)
                return { kind: 'GLOBAL_INSTRUCTIONS', bytes, hash: null };
              return {
                kind: 'GLOBAL_INSTRUCTIONS',
                file: path.basename(source),
                bytes,
                sha256: createHash('sha256')
                  .update(readFileSync(source))
                  .digest('hex'),
              };
            })
          : [],
      };
      if (self.execMode)
        assertExecThread(
          thread,
          self.connection.summary,
          self.connection.cwd,
          self.approvedInstructionSources,
        );
      else
        assertTextThread(
          thread,
          self.connection.summary,
          self.connection.cwd,
          self.approvedInstructionSources,
        );
      self.instructionSources = Object.freeze([...thread.instructionSources]);
      Object.freeze(self.approvedInstructionSources);
      self.threadId = thread.thread.id;
      return self;
    } catch (reason) {
      reason.readback = self.readback;
      reason.connection = await self.connection.close();
      throw reason;
    }
  }
  receive(event) {
    if (this.onTurnEvent) {
      try {
        this.onTurnEvent(event);
      } catch {
        /* Non-authoritative diagnostic/readiness output cannot establish success. */
      }
    }
    const p = event.params;
    if (!this.active || p?.threadId !== this.threadId) return;
    const a = this.active;
    if (!a.turnId) {
      a.bufferedBytes += Buffer.byteLength(JSON.stringify(event));
      if (a.bufferedBytes > 1024 * 1024 || a.buffered.length >= 512) {
        a.reject(fail('MODEL_OUTPUT_LIMIT'));
        this.connection.rpc.child.kill();
        return;
      }
      a.buffered.push(event);
      return;
    }
    const eventTurnId = p.turnId ?? p.turn?.id;
    if (eventTurnId && a.turnId !== eventTurnId) return;
    const allowedItems = this.execMode
      ? [
          'userMessage',
          'agentMessage',
          'reasoning',
          'toolCall',
          'command',
          'applyPatch',
          'customToolCall',
        ]
      : [
          'userMessage',
          'agentMessage',
          'reasoning',
          ...(this.hostMode ? ['dynamicToolCall'] : []),
        ];
    if (this.hostMode) this.bindings.observe(event);
    if (
      event.method === 'item/started' &&
      !allowedItems.includes(p.item?.type)
    ) {
      a.reject(fail('UNEXPECTED_TOOL_EVENT'));
      this.connection.rpc.child.kill();
      return;
    }
    if (event.method === 'item/agentMessage/delta') {
      if (typeof p.delta !== 'string') return;
      a.deltaBytes += Buffer.byteLength(p.delta);
      if (a.deltaBytes > 1024 * 1024) {
        a.reject(fail('MODEL_OUTPUT_LIMIT'));
        this.connection.rpc.child.kill();
        return;
      }
      a.onDelta?.(p.delta);
    }
    if (event.method === 'item/completed' && p.item?.type === 'agentMessage') {
      if (typeof p.item.text !== 'string' || p.item.text.length > 200000) {
        a.reject(fail('MODEL_OUTPUT_LIMIT'));
        return;
      }
      if (p.item.phase !== 'commentary') a.finalText = p.item.text;
    }
    if (event.method === 'thread/tokenUsage/updated') {
      const usage = p.tokenUsage?.last ?? p.tokenUsage?.total;
      a.usage = Object.fromEntries(
        [
          'inputTokens',
          'outputTokens',
          'cachedInputTokens',
          'reasoningOutputTokens',
          'totalTokens',
        ]
          .filter((k) => Number.isSafeInteger(usage?.[k]) && usage[k] >= 0)
          .map((k) => [k, usage[k]]),
      );
    }
    if (event.method === 'turn/completed') {
      if (p.turn?.status !== 'completed') {
        a.reject(
          fail(
            p.turn?.status === 'interrupted' ? 'TURN_CANCELLED' : 'TURN_FAILED',
          ),
        );
        return;
      }
      if (!a.finalText?.trim()) {
        a.reject(fail('MODEL_OUTPUT_EMPTY'));
        return;
      }
      a.resolve({
        text: a.finalText,
        usage: a.usage ?? null,
        threadId: this.threadId,
        turnId: p.turn.id,
        status: 'SUCCEEDED',
      });
    }
  }
  async receiveToolCall(message) {
    const a = this.active;
    if (!this.hostMode || !a || this.closed) throw fail('TURN_CANCELLED');
    await a.ready;
    if (this.closed || this.active !== a) throw fail('TURN_CANCELLED');
    const bound = this.bindings.bind(message);
    // Serialize dynamic dispatches even if the model issues concurrent callbacks.
    const dispatch = () => {
      if (this.closed || this.active !== a) throw fail('TURN_CANCELLED');
      return this.onToolCall(bound);
    };
    const result = (a.tools || Promise.resolve()).then(dispatch);
    a.tools = result.catch(() => {});
    return result;
  }
  async runText({ text, reserveTurn, onDelta, outputSchema }) {
    if (this.closed || this.active || typeof reserveTurn !== 'function')
      throw fail('TEXT_SESSION_NOT_READY');
    const input = checkedTextInput(text);
    let timer;
    let resolveTurn, rejectTurn;
    const completion = new Promise((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    // Attach rejection handling before the asynchronous turn/start acknowledgement.
    completion.catch(() => {});
    let readyResolve;
    const ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    this.active = {
      ready,
      readyResolve,
      resolve: resolveTurn,
      reject: rejectTurn,
      onDelta,
      deltaBytes: 0,
      bufferedBytes: 0,
      buffered: [],
    };
    try {
      assertInstructionSources(
        this.instructionSources,
        this.approvedInstructionSources,
      );
      // 超时覆盖整个 turn（reserveTurn / turn/start / completion 任一环节挂起都触发）：
      // 触发时 rejectTurn 收口 completion，并 kill 子进程 + rejectAll 挂起的 rpc 请求，
      // 避免 `await rpc.request('turn/start')` 永久挂起导致作业卡 RUNNING（真实缺陷修复）。
      console.error(
        '[runText:diag] runText entered, setting 300s timer at',
        new Date().toISOString(),
      );
      timer = setTimeout(() => {
        console.error(
          '[runText:diag] TURN_TIMED_OUT fired at',
          new Date().toISOString(),
        );
        rejectTurn(fail('TURN_TIMED_OUT'));
        try {
          this.connection.rpc.child.kill();
        } catch {
          /* ignore */
        }
        try {
          this.connection.rpc.rejectAll?.(fail('APP_SERVER_CLOSED'));
        } catch {
          /* ignore */
        }
      }, 300000);
      await reserveTurn();
      assertInstructionSources(
        this.instructionSources,
        this.approvedInstructionSources,
      );
      const started = await this.connection.rpc.request('turn/start', {
        threadId: this.threadId,
        input,
        model: this.connection.summary.model,
        cwd: this.connection.cwd,
        environments: [],
        runtimeWorkspaceRoots: [this.connection.cwd],
        approvalPolicy: 'on-request',
        sandboxPolicy: this.execMode
          ? { type: 'workspaceWrite', networkAccess: false }
          : { type: 'readOnly', networkAccess: false },
        effort: 'low',
        ...(outputSchema ? { outputSchema } : {}),
      });
      if (typeof started?.turn?.id !== 'string')
        throw fail('TURN_PROTOCOL_MISMATCH');
      this.active.turnId = started.turn.id;
      if (this.hostMode) this.bindings.start(this.threadId, started.turn.id);
      for (const event of this.active.buffered.splice(0)) this.receive(event);
      this.active.readyResolve();
      const result = await completion;
      await this.active.tools;
      return result;
    } catch (reason) {
      await this.close();
      throw reason;
    } finally {
      clearTimeout(timer);
      this.active = null;
    }
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.bindings?.stop();
    const current = this.active;
    // Reject the caller immediately; interrupt and process exit are separately acknowledged.
    current?.reject(fail('TURN_CANCELLED'));
    current?.readyResolve?.();
    this.closePromise = (async () => {
      if (current?.turnId) {
        let timer;
        await Promise.race([
          this.connection.rpc
            .request('turn/interrupt', {
              threadId: this.threadId,
              turnId: current.turnId,
            })
            .catch(() => {}),
          new Promise((resolve) => {
            timer = setTimeout(resolve, 500);
          }),
        ]);
        clearTimeout(timer);
      }
      await current?.tools;
      return this.connection.close();
    })();
    return this.closePromise;
  }
}
module.exports = { TextConversation };
