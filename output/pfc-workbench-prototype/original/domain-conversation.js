(() => {
  'use strict';
  const P = window.PFC,
    V = P.domainView,
    D = P.domainActions;
  const C = (P.domainConversation = {});
  let previewUrl = null,
    previewEpoch = 0;
  C.attachment = (d) => {
    const q = P.r(),
      message = d.mid ? q.messages.find((m) => m.id === d.mid) : null;
    const a =
      message?.attachments.find(
        (a) => a.id === d.id && (!d.version || a.version === Number(d.version)),
      ) ||
      P.uiBag().atts.find((a) => a.id === d.id) ||
      q.attachments.find(
        (a) => a.id === d.id && (!d.version || a.version === Number(d.version)),
      );
    P.assert(a, '附件不存在或该版本未加载');
    return a;
  };
  const refresh = async (id) => {
    await V.read(id);
    P.save();
    P.render({ quiet: true });
  };
  C.install = (remote) => {
    const submit = P.submitTurn,
      enqueue = P.enqueueFile,
      renderMsg = P.renderMsg,
      close = P.close;
    // ---- 51 号：聊天消息流内嵌审批卡片（remote 模式，PENDING 交互式审批）----
    // 渲染完成后异步拉取 tool-control，将当前需求的 PENDING 审批注入消息流底部，
    // owner 可直接在对话中 approve/deny（复用 host-tool-decision，落 decide API 与审计）。
    const approvalBanner = async (id) => {
      try {
        const data = await window.PFCAPI.api.req(
          'GET',
          '/api/agent/requirements/' + encodeURIComponent(id) + '/tool-control',
        );
        if (P.r()?.id !== id || !data.reqId) return;
        const pend = (data.approvals || []).filter(
          (a) => a.state === 'PENDING',
        );
        const stream = document.querySelector('#stream');
        document
          .querySelectorAll('.pfc-approval-banner')
          .forEach((n) => n.remove());
        if (!stream || !pend.length) return;
        const div = document.createElement('div');
        div.className = 'pfc-approval-banner';
        div.innerHTML =
          '<div class="approval-banner-head">' +
          pend.length +
          ' 项工具操作待审批 · 计划外操作需 owner 确认后并入执行计划</div>' +
          pend
            .map(
              (a) =>
                '<div class="approval-scope">' +
                '<div class="row"><b>工具</b>' +
                P.esc(a.tool || '—') +
                '</div>' +
                '<div class="row"><b>范围</b>' +
                P.esc(a.path || '固定命令') +
                '</div>' +
                '<div class="row"><b>状态</b>待审批</div>' +
                '<div class="row"><b>哈希</b><code>' +
                P.esc(String(a.scopeHash || '').slice(0, 16)) +
                '…</code></div>' +
                '<div class="btn-group">' +
                P.btn(
                  'host-tool-decision',
                  '同意范围（需新计划）',
                  {
                    req: id,
                    job: a.jobId,
                    approval: a.id,
                    hash: a.scopeHash,
                    decision: 'approve',
                  },
                  'primary',
                ) +
                P.btn('host-tool-decision', '拒绝', {
                  req: id,
                  job: a.jobId,
                  approval: a.id,
                  hash: a.scopeHash,
                  decision: 'deny',
                }) +
                '</div></div>',
            )
            .join('');
        stream.appendChild(div);
      } catch {
        /* 审批拉取失败不阻塞对话渲染 */
      }
    };
    const baseRender = P.render;
    P.render = (opts = {}) => {
      const ret = baseRender(opts);
      if (V.pg()) {
        const id = P.r()?.id;
        if (id) setTimeout(() => { approvalBanner(id); refetchStagePlan(id); }, 80);
      }
      return ret;
    };
    P.close = (...args) => {
      previewEpoch++;
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      return close(...args);
    };
    P.renderMsg = (message, q) => {
      const html = renderMsg(message, q);
      if (!V.pg()) return html;
      const template = document.createElement('template');
      template.innerHTML = html;
      for (const button of template.content.querySelectorAll(
        '[data-action="open-attachment"]',
      )) {
        const a = message.attachments.find((a) => a.id === button.dataset.id);
        if (a) {
          button.dataset.mid = message.id;
          button.dataset.version = a.version;
        }
      }
      if (message.status === 'interrupted') {
        const note = document.createElement('p');
        note.className = 'muted';
        note.textContent =
          '服务重启已中断本次模拟回复，已输出内容保留，可从原消息重发。';
        template.content.firstElementChild?.append(note);
      }
      return template.innerHTML;
    };
    P.submitTurn = (...args) =>
      V.pg() ? persistentSubmit(...args) : submit(...args);
    const persistentSubmit = async (q, payload, clear = false) => {
      P.write();
      P.assert(
        (payload.attachments || []).every(
          (a) => a.status === 'ready' && a.requirementId === q.id,
        ),
        '附件尚未保存或不属于当前需求',
      );
      const refs = (payload.refs || [])
        .filter(
          (ref) =>
            ref.kind !== 'attachment' ||
            !(payload.attachments || []).some((a) => a.id === ref.id),
        )
        .map((ref) => {
          if (ref.kind === 'artifact') {
            const version = q.artifacts[ref.stage]?.find(
              (v) => v.id === ref.id,
            );
            P.assert(version?._serverId, '产物引用已失效');
            return {
              kind: 'artifact',
              id: version._serverId,
              version: version.version,
              requirementId: q.id,
            };
          }
          return {
            kind: ref.kind,
            id: ref.id,
            version: ref.version,
            requirementId: ref.requirementId,
          };
        });
      const stage = payload.stage || P.s.ui.stage || q.stage;
      const key = q.id + ':' + stage;
      const draft = P.s.ui.execDrafts?.[key];
      const execWs =
        P.s.ui.realMode === true ? draft?.workspace?.trim() || '' : '';
      if (execWs) {
        P.assert(stage === 'dev' && q.stage === 'dev', '仅当前开发阶段可执行');
        P.assert(
          P.s.env?.execCapable === true,
          P.s.env?.execution?.reason || '开发执行暂不可用：执行前约束尚未验证',
        );
        P.assert(draft?.control?.confirmed === true, '请先预览并确认执行计划');
      }
      await D.mutate(q, '/messages', {
        content: payload.text,
        stage: payload.stage,
        refs,
        attachments: (payload.attachments || []).map((a) => ({
          id: a.id,
          version: a.version,
        })),
        replyTo: payload.replyTo,
        parentMessageId: payload.parentMessageId,
        // The server resolves prior-stage versions and labels AI drafts. Client text is optional, untrusted input.
        ...(payload.stageContext !== undefined
          ? { stageContext: payload.stageContext }
          : {}),
        ...(payload.contextSources !== undefined
          ? { contextSources: payload.contextSources }
          : {}),
        ...(P.s.ui.realMode || execWs ? { mode: 'real' } : {}),
        ...(execWs
          ? {
              tool: 'exec',
              workspace: execWs,
              restrictedReadDirs: [],
              control: draft.control,
            }
          : {}),
      });
      if (clear) {
        P.s.ui.drafts[q.id] = '';
        const bag = P.uiBag(q.id);
        bag.atts = [];
        bag.refs = [];
        bag.reply = null;
      }
      await refresh(q.id);
    };
    remote.send = () => {
      const q = P.r(),
        bag = P.uiBag(q.id);
      return P.submitTurn(
        q,
        {
          text: document.querySelector('#chat-input').value.trim(),
          stage: P.s.ui.stage,
          attachments: bag.atts,
          refs: bag.refs.filter((r) => !r.excluded),
          replyTo: bag.reply,
        },
        true,
      );
    };
    remote['host-tool-records'] = async () => {
      const id = P.r()?.id;
      P.assert(id, '请选择需求');
      const data = await window.PFCAPI.api.req(
        'GET',
        '/api/agent/requirements/' + encodeURIComponent(id) + '/tool-control',
      );
      if (P.r()?.id !== id || data.reqId !== id) return;
      const e = P.esc,
        states = {
          PENDING: '待确认',
          APPROVED: '已同意',
          DENIED: '已拒绝',
          EXPIRED: '已失效',
          SUCCEEDED: '成功',
          FAILED: '失败',
          UNKNOWN: '结果未知',
          RUNNING: '进行中',
          CANCELLED: '已取消',
          TIMED_OUT: '超时',
        };
      const approvals = data.approvals
        .map(
          (a) =>
            `<li>${e(a.tool || '工具')} · ${e(a.path || '固定命令')} · ${e(states[a.state] || a.state)}${a.state === 'PENDING' && P.s.role === 'owner' ? `<div>${P.btn('host-tool-decision', '同意范围（需新计划）', { req: id, job: a.jobId, approval: a.id, hash: a.scopeHash, decision: 'approve' })}${P.btn('host-tool-decision', '拒绝', { req: id, job: a.jobId, approval: a.id, hash: a.scopeHash, decision: 'deny' })}</div>` : ''}</li>`,
        )
        .join('');
      const records = data.executions
        .map(
          (t) =>
            `<li>${e(t.tool || '工具')} · ${e(t.path || '')} · ${e(states[t.state] || t.state)}${t.sha256 ? `<code> ${e(t.sha256.slice(0, 12))}</code>` : ''}</li>`,
        )
        .join('');
      P.modal(
        '工具审批与记录',
        `<p>范围内的操作自动校验。超出范围需重新确认执行计划；此处同意不会立即执行。</p><h3>范围确认</h3>${approvals ? '<ul>' + approvals + '</ul>' : '<p>暂无待处理或历史确认</p>'}<h3>执行记录</h3>${records ? '<ul>' + records + '</ul>' : '<p>暂无工具执行记录</p>'}`,
        P.btn('close-modal', '关闭'),
      );
    };
    remote['host-tool-decision'] = async (d) => {
      P.assert(P.r()?.id === d.req, '需求已切换，请重新打开记录');
      await window.PFCAPI.api.req(
        'POST',
        '/api/agent/jobs/' +
          encodeURIComponent(d.job) +
          '/approvals/' +
          encodeURIComponent(d.approval) +
          '/decision',
        {
          decision: d.decision,
          scopeHash: d.hash,
          expectedState: 'PENDING',
          commandId: crypto.randomUUID(),
        },
      );
      if (P.r()?.id === d.req) {
        await remote['host-tool-records']();
        P.render({ quiet: true }); // 刷新消息流内嵌审批卡片
      }
    };
    // ---- 52 号：阶段执行基线（freeze / review / revoke）----
    const stageKey = (r, stage) => r.id + ':' + stage;
    const stageApi = (id, method, path, body) =>
      window.PFCAPI.api.req(
        method,
        '/api/agent/requirements/' + encodeURIComponent(id) + path,
        body,
      );
    const refetchStagePlan = async (id) => {
      try {
        const r = P.r();
        if (!r || r.id !== id || !['design', 'dev', 'test'].includes(r.stage)) return;
        const data = await stageApi(id, 'GET', '/stage-plan?stage=' + r.stage);
        if (P.r()?.id !== id) return;
        const k = stageKey(r, r.stage);
        P.s.ui.stagePlan = P.s.ui.stagePlan || {};
        const prev = P.s.ui.stagePlan[k];
        P.s.ui.stagePlan[k] = {
          ...(prev || {}),
          ...data,
          fetchedAt: Date.now(),
        };
        const changed =
          !prev ||
          prev.state !== data.state ||
          prev.baselineHash !== data.baselineHash ||
          JSON.stringify(prev.review || null) !== JSON.stringify(data.review || null);
        P.save();
        if (changed) P.render({ quiet: true });
      } catch {
        /* 阶段计划拉取失败不阻塞对话 */
      }
    };
    P.execBar = (r, stage) => {
      const k = stageKey(r, stage);
      const ui = P.s.ui,
        plan = ui.stagePlan?.[k],
        draft = ui.stageDraft?.[k] || {};
      const e = P.esc;
      const state = plan?.state || 'none';
      const fmtTime = (t) =>
        t ? String(t).replace('T', ' ').slice(0, 16) : '—';
      const btn = (action, label, data, cls) =>
        P.btn(action, label, { req: r.id, stage, ...(data || {}) }, cls || '');
      const errHtml = draft.error
        ? '<div class="exec-err">' + e(draft.error) + '</div>'
        : '';
      if (state === 'frozen' || state === 'revoked') {
        const frozen = plan,
          review = frozen.review;
        const changes = (review?.changes || []).slice(0, 6);
        const reviewHtml = review
          ? '<div class="exec-review"><div class="row"><b>复核</b>' +
            (review.violates ? '存在越界改动' : '通过') +
            '</div>' +
            (changes.length
              ? '<div class="row"><b>差异</b>' +
                e(changes.map((x) => x.path + '（' + x.action + '）').join('、')) +
                '</div>'
              : '') +
            (review.outOfScope?.length
              ? '<div class="row"><b>越界</b>' +
                e(review.outOfScope.join('、')) +
                '</div>'
              : '') +
            '</div>'
          : '';
        return (
          '<div class="exec-bar" role="status"><span class="exec-cap">阶段执行基线 · ' +
          (state === 'frozen' ? '已冻结' : '已撤权') +
          '</span>' +
          '<details class="exec-control" ' +
          (state === 'frozen' ? 'open' : '') +
          '><summary>执行契约' +
          (frozen.fileCount != null ? ' · 基线文件 ' + frozen.fileCount + ' 个' : '') +
          '</summary><div class="exec-fields">' +
          '<div class="row"><b>工作区</b>' + e(frozen.workspace || '—') + '</div>' +
          '<div class="row"><b>基线哈希</b><code>' + e(String(frozen.baselineHash || '').slice(0, 16)) + '…</code></div>' +
          '<div class="row"><b>模式</b>' + e(frozen.control?.mode || '—') + '</div>' +
          '<div class="row"><b>允许文件</b>' + e((frozen.control?.allowedFiles || []).join('、') || '—') + '</div>' +
          '<div class="row"><b>允许命令</b>' + e((frozen.control?.allowedCommands || []).map((x) => x.join(' ')).join('；') || '—') + '</div>' +
          '<div class="row"><b>有效期至</b>' + e(fmtTime(frozen.control?.validUntil)) + '</div>' +
          '</div>' + errHtml + reviewHtml +
          '<div class="btn-group">' +
          (state === 'frozen'
            ? btn('stage-review', '差异复核', {}, 'primary') +
              (review && !review.violates ? btn('stage-revoke', '撤权', {}) : '')
            : btn('stage-refreeze', '重新冻结（新周期）', {})) +
          '</div></details></div>'
        );
      }
      const f = (v) => e(String(v ?? ''));
      return (
        '<div class="exec-bar" role="status"><span class="exec-cap">阶段执行基线 · 未冻结</span>' +
        '<span class="exec-hint">确认工作区与允许清单后冻结为本阶段执行契约；执行期间的改动在阶段结束复核，无违规后撤权。</span>' +
        '<details class="exec-control" open><summary>冻结执行基线</summary>' +
        '<div class="exec-fields">' +
        '<label class="exec-field">工作区<input aria-label="阶段工作区" data-sp="workspace" value="' + f(draft.workspace) + '" placeholder="授权 workspace 绝对路径（' + (stage === 'design' ? '设计产物目录' : stage === 'test' ? '测试工程目录' : '代码工程目录') + '）" /></label>' +
        '<label class="exec-field">允许文件<input aria-label="允许文件" data-sp="allowedFiles" value="' + f(draft.allowedFiles) + '" placeholder="' + (stage === 'design' ? 'docs/**, *.md' : stage === 'test' ? 'test/**, src/**, package.json' : 'src/**, package.json') + '" /></label>' +
        '<label class="exec-field">允许命令<input aria-label="允许命令" data-sp="allowedCommands" value="' + f(draft.allowedCommands) + '" placeholder="命令逗号分隔，如 ' + (stage === 'design' ? 'ls, cat package.json' : stage === 'test' ? 'npm test, node --test' : 'node --version, npm test') + '" /></label>' +
        '<label class="exec-field">有效期<select data-sp="validDays"><option value="1">1 天</option><option value="2" selected>2 天</option><option value="3">3 天</option><option value="7">7 天</option></select></label>' +
        '</div>' + errHtml +
        '<div class="btn-group">' + btn('stage-freeze', '冻结执行基线', {}, 'primary') + '</div>' +
        '</details></div>'
      );
    };
    remote['stage-freeze'] = async (d) => {
      const r = P.r();
      const stage = d.stage || r.stage;
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, stage);
      const g = (name) =>
        document.querySelector('[data-sp="' + name + '"]')?.value?.trim() || '';
      const workspace = g('workspace');
      const allowedFiles = g('allowedFiles')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const allowedCommands = g('allowedCommands')
        .split(/[,，]/)
        .map((s) => s.trim().split(/\s+/))
        .filter((a) => a.length);
      const validDays = Number(
        document.querySelector('[data-sp="validDays"]')?.value || 2,
      );
      P.s.ui.stageDraft = P.s.ui.stageDraft || {};
      P.s.ui.stageDraft[k] = {
        workspace,
        allowedFiles: allowedFiles.join(', '),
        allowedCommands: g('allowedCommands'),
        validDays,
        error: null,
      };
      if (!workspace || !allowedFiles.length || !allowedCommands.length) {
        P.s.ui.stageDraft[k].error = '工作区、允许文件、允许命令均为必填';
        P.save();
        P.render({ quiet: true });
        return;
      }
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/freeze', {
          stage,
          workspace,
          control: {
            mode: 'strict',
            allowedFiles,
            allowedCommands,
            maxFiles: 50,
            maxBytes: 2097152,
            validUntil: new Date(
              Date.now() + validDays * 86400000,
            ).toISOString(),
          },
        });
        P.s.ui.stagePlan = P.s.ui.stagePlan || {};
        P.s.ui.stagePlan[k] = {
          ...(P.s.ui.stagePlan[k] || {}),
          ...data,
          state: 'frozen',
          fetchedAt: Date.now(),
        };
        P.toast('执行基线已冻结，可在阶段内执行开发作业', 'info');
      } catch (e) {
        P.s.ui.stageDraft[k].error = e.message || '冻结失败';
      }
      P.save();
      P.render({ quiet: true });
    };
    remote['stage-review'] = async (d) => {
      const r = P.r();
      const stage = d.stage || r.stage;
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, stage);
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/review', {
          stage,
        });
        P.s.ui.stagePlan = P.s.ui.stagePlan || {};
        P.s.ui.stagePlan[k] = {
          ...(P.s.ui.stagePlan[k] || {}),
          ...data,
          fetchedAt: Date.now(),
        };
        P.toast(
          data.violates ? '复核发现越界改动，需处理后再撤权' : '复核通过，可撤权',
          data.violates ? 'error' : 'info',
        );
      } catch (e) {
        P.toast(e.message || '复核失败', 'error');
      }
      P.save();
      P.render({ quiet: true });
    };
    remote['stage-revoke'] = async (d) => {
      const r = P.r();
      const stage = d.stage || r.stage;
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, stage);
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/revoke', {
          stage,
        });
        P.s.ui.stagePlan = P.s.ui.stagePlan || {};
        P.s.ui.stagePlan[k] = {
          ...(P.s.ui.stagePlan[k] || {}),
          ...data,
          state: 'revoked',
          fetchedAt: Date.now(),
        };
        P.toast('执行权已撤除，基线解除', 'info');
      } catch (e) {
        P.toast(e.message || '撤权失败', 'error');
      }
      P.save();
      P.render({ quiet: true });
    };
    remote['stage-refreeze'] = async (d) => {
      const r = P.r();
      const stage = d.stage || r.stage;
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, stage);
      const plan = P.s.ui.stagePlan?.[k] || {};
      const ctl = plan.control || {};
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/freeze', {
          stage,
          workspace: plan.workspace,
          control: {
            mode: ctl.mode || 'strict',
            allowedFiles: ctl.allowedFiles || ['src/**'],
            allowedCommands: ctl.allowedCommands || [['node', '--version']],
            maxFiles: ctl.maxFiles || 50,
            maxBytes: ctl.maxBytes || 2097152,
            validUntil: new Date(Date.now() + 2 * 86400000).toISOString(),
          },
        });
        P.s.ui.stagePlan = P.s.ui.stagePlan || {};
        P.s.ui.stagePlan[k] = {
          ...(P.s.ui.stagePlan[k] || {}),
          ...data,
          state: 'frozen',
          fetchedAt: Date.now(),
        };
        P.toast('已重新冻结执行基线（新周期）', 'info');
      } catch (e) {
        P.toast(e.message || '重新冻结失败', 'error');
      }
      P.save();
      P.render({ quiet: true });
    };
    P.enqueueFile = async (file, reqId = P.r().id) => {
      if (!V.pg()) return enqueue(file, reqId);
      P.write();
      const bag = P.uiBag(reqId);
      P.assert(
        bag.atts.length < 20 &&
          bag.atts.reduce((n, a) => n + (a.bytes || 0), 0) + file.size <=
            52428800,
        '单消息最多 20 份、合计 50 MiB',
      );
      const a = {
        id: 'pending-' + crypto.randomUUID(),
        name: file.name,
        bytes: file.size,
        size: Math.ceil(file.size / 1024) + ' KB',
        status: 'parsing',
        requirementId: reqId,
        origin: 'pending',
      };
      const pendingId = a.id;
      bag.atts.push(a);
      P.fileHandles.set(a.id, file);
      P.render();
      try {
        const result = await D.mutate(P.s.reqs[reqId], '/materials', {
          name: file.name,
          usage: 'attachment',
          file: await D.file(file),
        });
        Object.assign(a, V.attachment(result.material, reqId));
        P.fileHandles.delete(pendingId);
        P.save();
        P.render();
      } catch (e) {
        a.status = 'error';
        a.error = e.message;
        P.render();
        throw e;
      }
    };
    remote['retry-pending'] = async (d) => {
      const bag = P.uiBag(),
        old = bag.atts.find((a) => a.id === d.id),
        file = P.fileHandles.get(d.id);
      P.assert(old && file, '请重新选择原文件');
      bag.atts = bag.atts.filter((a) => a.id !== d.id);
      return P.enqueueFile(file, old.requirementId);
    };
    remote['toggle-real-mode'] = async () => {
      const next = !P.s.ui.realMode;
      if (next && V.pg()) {
        let status;
        try {
          status = await window.PFCAPI.api.req('GET', '/api/agent/status');
        } catch {
          status = null;
        }
        if (!status || status.capable !== true) {
          P.toast(
            '本机 Codex 未配置（缺少连接参数），真实回复会明确失败；已保持模拟模式',
            'error',
          );
          return;
        }
      }
      P.s.ui.realMode = next;
      if (!next) P.s.ui.execDrafts = {};
      P.save();
      P.render({ quiet: true });
      P.toast(
        next
          ? '真实 AI 已开启：回复将调用本机 Codex 并消耗模型预算'
          : '已切回模拟模式（回复不调用真实模型）',
        next ? 'info' : 'info',
      );
    };
    remote['stop-reply'] = async (d) => {
      const q = P.r(),
        message =
          q.messages.find((m) => m.id === (d.mid || d.id)) ||
          q.messages.findLast((m) => m.typing);
      P.assert(message, '没有正在生成的回复');
      const result = await D.mutate(q, '/messages/' + message.id + '/stop');
      if (result.cancellation && !result.cancellation.confirmed)
        P.toast('已提交停止请求，进程退出尚未确认，请勿重试执行', 'error');
      await refresh(q.id);
    };
    remote['resend-message'] = (d) => {
      const q = P.r(),
        m = q.messages.find((m) => m.id === (d.mid || d.id));
      P.assert(m?.role === 'user', '请选择原用户消息');
      return P.submitTurn(q, {
        text: m.text,
        stage: m.stage,
        refs: m.refs,
        attachments: m.attachments,
        parentMessageId: m.id,
        replyTo: m.replyTo,
      });
    };
    const diff = (decision) => async (d) => {
      const q = P.r(),
        m = q.messages.find((m) => m.id === d.mid);
      P.assert(m?.diff, '差异不存在');
      await D.mutate(q, '/messages/' + m.id + '/diff', {
        decision,
        selected: d.selected,
        baseVersionId: m.diff.baseVersionId,
      });
      await refresh(q.id);
      P.close();
    };
    remote['accept-diff'] = diff('accept');
    remote['reject-diff'] = diff('reject');
    remote['accept-selected-diff'] = (d) =>
      remote['accept-diff']({
        ...d,
        selected: [
          ...document.querySelectorAll('[name="diff-field"]:checked'),
        ].map((n) => Number(n.value)),
      });
    remote['open-attachment'] = async (d) => {
      const q = P.r(),
        a = C.attachment(d),
        reqId = q.id;
      P.close();
      const epoch = previewEpoch;
      const isImage = /^image\/(png|jpeg|gif)$/.test(a.mimeType || '');
      let body =
        '<p>' +
        P.esc(a.size) +
        ' · v' +
        a.version +
        ' · 原件已保存到服务端</p>';
      if (isImage) {
        const blob = await D.fileBlob(q, a);
        if (epoch !== previewEpoch || P.r()?.id !== reqId) return;
        previewUrl = URL.createObjectURL(
          new Blob([blob], { type: a.mimeType }),
        );
        body +=
          '<img class="att-preview-img" src="' +
          previewUrl +
          '" alt="' +
          P.esc(a.name) +
          '">';
      } else {
        let text = a.fullContent || '';
        if (!text && /^text\/|application\/json/.test(a.mimeType || '')) {
          const blob = await D.fileBlob(q, a);
          text = await blob.slice(0, 200000).text();
        }
        if (epoch !== previewEpoch || P.r()?.id !== reqId) return;
        body +=
          '<div class="doc-body">' +
          P.esc(text || '原件已保存，尚未解析') +
          '</div>';
      }
      P.modal(
        a.name,
        body,
        P.btn('download-attachment-original', '下载原件', {
          id: a.id,
          mid: d.mid || '',
          version: a.version,
        }) + P.btn('close-modal', '关闭'),
      );
    };
  };
})();
