(() => {
  'use strict';
  /* =====================================================================
   * PFC API 客户端（M1 前后端握手 · 完整桥接）
   * 契约来源：《13-M1接口清单》。职责：
   *   - 同步表面 getSync/setSync/removeSync：apiStore 的内存镜像 + 变更入队
   *   - token 管理：dev-login 签发，localStorage 持久化
   *   - hydrate/seed：首屏从后端拉状态树；无则工厂种子 PUT 提交
   *   - flush：P.save 后 debounce 自动整树 PUT /api/state（M1 可靠路径；batch 供 M2 增量）
   *   - contract()：契约清单（与后端 GET /api/contract 对齐）
   * 诚实标注：M1 以整棵状态树为持久化单元；领域增量 API 由 M2 逐步替换。
   * ===================================================================== */
  const P = (window.PFCAPI = window.PFCAPI || {});
  const mem = new Map(); // 同步镜像：apiStore.getItem 读此
  const queue = []; // 变更队列（batch 语义预留）
  const artifactErrors = {
    INVALID_ARTIFACT: '候选格式不正确，请核对产物字段与内容。',
    INVALID_RULE_REFERENCE:
      '原型、PRD与验收项的规则编号未对应，请检查规则关联。',
    INCOMPLETE_ARTIFACT_GROUP:
      '候选尚未补齐，先完善原型、PRD、验收项和规则关联。',
    STALE_ARTIFACT_PROPOSAL:
      '成果或输入已有新版本，草稿已保留，请比较最新基线后重试。',
    INVALID_PROPOSAL_STATE: '该候选已处理，请查看历史或创建后续候选。',
    ARTIFACT_LIMIT_EXCEEDED:
      '候选数量或内容超过上限，请先处理已有候选或缩小内容。',
    UNSUPPORTED_PROTOTYPE_SPEC:
      '原型描述不符合受控组件格式，请检查组件、动作和大小。',
    STALE_REFERENCE: '引用的材料权限或版本已变化，请重新核对引用。',
    INVALID_SCOPE: '请补齐实施目标、范围、验证、退出条件和回滚方式。',
  };
  const TOKEN_KEY = 'pfc.prototype.token';
  const tokenKey = () => (P.api?.pg ? TOKEN_KEY + ':' + base() : TOKEN_KEY);
  let flushTimer = null;
  let hydrating = false; // hydrate 完成前禁止 flush，避免工厂数据覆盖后端状态

  const base = () => {
    try {
      return (
        window.PFC_API_BASE ||
        (location.protocol === 'file:'
          ? 'http://127.0.0.1:5188'
          : location.origin)
      ).replace(/\/$/, '');
    } catch {
      return '';
    }
  };
  const authHeaders = () => {
    const t = P.api.token();
    return {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: 'Bearer ' + t } : {}),
    };
  };
  const req = (method, path, body) =>
    fetch(base() + path, {
      method,
      headers: authHeaders(),
      signal: AbortSignal.timeout(15000),
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => {
      if (res.status === 401)
        throw Object.assign(Error('API 401 ' + method + ' ' + path), {
          code: 'UNAUTHORIZED',
          status: 401,
        });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw Object.assign(
          Error(
            (data.error?.msg === data.error?.code
              ? artifactErrors[data.error?.code]
              : null) ||
              data.error?.msg ||
              'API ' + res.status + ' ' + method + ' ' + path,
          ),
          { code: data.error?.code, status: res.status },
        );
      }
      return res.json();
    });

  P.api = {
    /* ---- 同步表面（apiStore 桥接） ---- */
    getSync: (k) => mem.get(k) ?? null,
    setSync: (k, v) => {
      mem.set(k, v);
      queue.push({ op: 'set', k, at: Date.now() });
    },
    removeSync: (k) => {
      mem.delete(k);
      queue.push({ op: 'remove', k, at: Date.now() });
    },
    flush: () => {
      const pending = queue.splice(0);
      return Promise.resolve(pending); // batch 语义：M2 增量提交 /api/batch
    },

    /* ---- token ---- */
    token: () => {
      try {
        return localStorage.getItem(tokenKey()) || '';
      } catch {
        return '';
      }
    },
    setToken: (t) => {
      try {
        localStorage.setItem(tokenKey(), t);
      } catch {
        /* ignore */
      }
    },
    devLogin: async () => {
      const name = (() => {
        try {
          return window.PFC_USER_NAME || '陈立';
        } catch {
          return '陈立';
        }
      })();
      const r = await req('POST', '/api/auth/dev-login', { name });
      P.api.setToken(r.token);
      P.api.user = r.user;
      return r;
    },

    /* ---- 首屏：拉取 / 种子提交 ---- */
    hydrate: async () => {
      // 返回 true=已从后端恢复状态；false=后端无状态（调用方需 seed）
      if (!P.api.token()) await P.api.devLogin();
      const res = await fetch(base() + '/api/state', {
        method: 'GET',
        headers: authHeaders(),
      });
      if (res.status === 401) {
        P.api.setToken('');
        await P.api.devLogin();
        return P.api.hydrate();
      }
      if (!res.ok) throw Error('API ' + res.status + ' GET /api/state');
      const data = await res.json();
      if (data.state) {
        const PFC = window.PFC;
        PFC.s = data.state; // 服务端权威：整树替换
        PFC.storageBase = null;
        PFC.conflict = false;
        PFC.render?.();
        return true;
      }
      return false;
    },
    seed: async () => {
      if (P.api.pg) throw Error('PG 不接受演示种子');
      const PFC = window.PFC;
      const r = await req('PUT', '/api/state', {
        state: PFC.s,
        revision: PFC.s.revision || 0,
      });
      return r;
    },

    /* ---- 自动持久化：P.save 后 debounce 整树提交 ---- */
    scheduleFlush: () => {
      if (hydrating || !P.api.ready || P.api.pg) return; // 首屏 hydrate 期间不提交
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        flushTimer = null;
        P.api.flushNow().catch((e) => {
          try {
            window.PFC?.toast?.('同步服务端失败：' + e.message, 'error');
          } catch {
            /* ignore */
          }
        });
      }, 500);
    },
    flushNow: async () => {
      if (hydrating || !P.api.ready || P.api.pg) return;
      const PFC = window.PFC;
      if (!PFC) return;
      await req('PUT', '/api/state', {
        state: PFC.s,
        revision: PFC.s.revision || 0,
      });
      P.api.flush(); // 清空 batch 队列（已由整树提交覆盖）
    },

    /* ---- 启动：api 模式入口（app.js 调用） ---- */
    init: async () => {
      hydrating = true;
      P.api.ready = false;
      if (window.PFC) {
        window.PFC.remoteLoading = true;
        window.PFC.remoteError = null;
        window.PFC.render?.();
      }
      try {
        const health = await req('GET', '/api/health');
        P.api.pg = health.storage === 'pg';
        P.api.capabilities = health;
        if (P.api.pg) {
          if (!P.api.token()) await P.api.devLogin();
          try {
            P.api.user = (await req('GET', '/api/auth/me')).user;
          } catch (e) {
            if (e.code !== 'UNAUTHORIZED') throw e;
            await P.api.devLogin();
          }
          window.PFC.domainView.reset();
          await window.PFC.domainView.sync();
          P.api.ready = true;
          return true;
        }
        const ok = await P.api.hydrate();
        if (!ok) await P.api.seed();
        await window.PFC?.domain?.sync();
        P.api.ready = true;
        window.PFC.remoteLoading = false;
        window.PFC.remoteError = null;
        window.PFC.render();
        return ok;
      } catch (e) {
        window.PFC.remoteLoading = false;
        window.PFC.remoteError = 'API 连接失败：' + e.message;
        window.PFC.render();
        throw e;
      } finally {
        hydrating = false;
        P.api.scheduleFlush();
      }
    },

    base,
    req,
    authHeaders,
    TOKEN_KEY,

    /* ---- 契约清单（对齐 13 号与后端 /api/contract） ---- */
    contract: () => ({
      auth: [
        ['devLogin', 'POST /api/auth/dev-login'],
        ['me', 'GET /api/auth/me'],
      ],
      reqs: [
        ['artifactWorkspace', 'GET /api/reqs/:id/artifact-workspace'],
        ['artifactGroups', 'GET /api/reqs/:id/artifact-groups'],
        ['artifactGroup', 'GET /api/reqs/:id/artifact-groups/:gid'],
        ['linkedArtifact', 'GET /api/reqs/:id/linked-artifacts/:vid'],
        ['artifactProposals', 'GET /api/reqs/:id/artifact-proposals'],
        ['artifactProposal', 'GET /api/reqs/:id/artifact-proposals/:pid'],
        ['createArtifactProposal', 'POST /api/reqs/:id/artifact-proposals'],
        [
          'adoptArtifactProposal',
          'POST /api/reqs/:id/artifact-proposals/:pid/adopt',
        ],
        [
          'rejectArtifactProposal',
          'POST /api/reqs/:id/artifact-proposals/:pid/reject',
        ],
        [
          'confirmBusiness',
          'POST /api/reqs/:id/artifact-groups/:gid/confirm-business',
        ],
        [
          'confirmDesign',
          'POST /api/reqs/:id/artifact-groups/:gid/confirm-design',
        ],
        ['stageInputs', 'GET /api/reqs/:id/stage-inputs'],
        ['list', 'GET /api/reqs'],
        ['create', 'POST /api/reqs'],
        ['get', 'GET /api/reqs/:id'],
        ['advanceStage', 'PATCH /api/reqs/:id/stage'],
        ['associateProject', 'PATCH /api/reqs/:id/project'],
        ['capOverrides', 'GET /api/reqs/:id/cap-overrides'],
        ['setCapOverrides', 'PUT /api/reqs/:id/cap-overrides'],
        ['versions', 'GET /api/reqs/:id/versions'],
        ['saveVersion', 'POST /api/reqs/:id/versions'],
        ['reviewVersion', 'POST /api/reqs/:id/versions/:vid/reviews'],
        ['replaceMaterial', 'POST /api/reqs/:id/materials/:mid/versions'],
        ['materialImpact', 'POST /api/reqs/:id/materials/:mid/impact'],
        ['materialContent', 'GET /api/reqs/:id/materials/:mid/content'],
        ['stopMessage', 'POST /api/reqs/:id/messages/:mid/stop'],
        ['messageDiff', 'POST /api/reqs/:id/messages/:mid/diff'],
        ['confirmVersion', 'POST /api/reqs/:id/versions/:vid/confirm'],
        ['addMaterial', 'POST /api/reqs/:id/materials'],
        ['answerQuestion', 'POST /api/reqs/:id/questions/:qid/answer'],
        ['messages', 'GET /api/reqs/:id/messages'],
        ['sendMessage', 'POST /api/reqs/:id/messages'],
      ],
      runs: [
        ['createRun', 'POST /api/runs'],
        ['lines', 'GET /api/runs/:id/lines'],
        ['planApprove', 'POST /api/runs/:id/plan-approve'],
        ['planReject', 'POST /api/runs/:id/plan-reject'],
        ['start', 'POST /api/runs/:id/start'],
        ['cancel', 'POST /api/runs/:id/cancel'],
        ['verify', 'POST /api/runs/:id/verify'],
        ['qualityGates', 'POST /api/runs/:id/quality-gates'],
        ['replay', 'GET /api/runs/:id/replay'],
        ['acquireLease', 'POST /api/leases/acquire'],
        ['handoffLease', 'POST /api/leases/handoff'],
      ],
      governance: [
        ['caps', 'GET /api/caps'],
        ['registerCap', 'POST /api/caps'],
        ['reviewCap', 'POST /api/caps/:id/review'],
        ['toggleCap', 'PATCH /api/caps/:id/toggle'],
        ['bindings', 'GET/PUT /api/bindings'],
        ['members', 'GET /api/members'],
        ['addMember', 'POST /api/members'],
        ['disableMember', 'DELETE /api/members/:uid'],
        ['exportAudit', 'GET /api/audit/export'],
        ['setRole', 'PATCH /api/members/:uid/role'],
        ['audit', 'GET /api/audit'],
        ['budget', 'GET /api/budgets/me'],
        ['knowledge', 'GET /api/knowledge'],
        ['addKnowledge', 'POST /api/knowledge'],
      ],
      release: [
        ['submit', 'POST /api/reqs/:id/releases'],
        ['approve', 'POST /api/releases/:id/approve'],
        ['reject', 'POST /api/releases/:id/reject'],
        ['execute', 'POST /api/releases/:id/execute'],
        ['rollback', 'POST /api/releases/:id/rollback'],
        ['cicd', 'POST /api/releases/:id/cicd'],
      ],
      notices: [
        ['list', 'GET /api/notices'],
        ['markRead', 'POST /api/notices/:id/read'],
        ['readAll', 'POST /api/notices/read-all'],
      ],
      projects: [
        ['list', 'GET /api/projects'],
        ['create', 'POST /api/projects'],
        ['get', 'GET /api/projects/:id'],
      ],
    }),
  };
})();
