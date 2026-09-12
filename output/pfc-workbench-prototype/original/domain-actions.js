(() => {
  'use strict';
  const P = window.PFC,
    V = P.domainView,
    api = () => window.PFCAPI.api;
  const D = (P.domainActions = {}),
    pending = new Map();
  const uuid = () => crypto.randomUUID();
  D.command = async (method, path, input = {}) => {
    const serialized = JSON.stringify(input),
      old = pending.get(path);
    const commandId =
      input.commandId ||
      (old?.serialized === serialized ? old.commandId : uuid());
    pending.set(path, { serialized, commandId });
    try {
      const result = await api().req(method, path, { ...input, commandId });
      pending.delete(path);
      return result;
    } catch (e) {
      if (e.status && e.status < 500) pending.delete(path);
      throw e;
    }
  };
  D.mutate = async (q, path, input = {}, method = 'POST') => {
    P.write();
    const result = await D.command(method, '/api/reqs/' + q.id + path, {
      ...input,
      expectedRevision: input.expectedRevision ?? q.revision,
    });
    if (result.req) V.map(result.req);
    else await V.read(q.id);
    P.save();
    P.render({ quiet: true });
    return result;
  };
  D.confirm = async (q, stage, id) => {
    const v = P.latest(q, stage);
    P.assert(v.id === id && v._serverId, '请读取当前版本');
    await D.mutate(q, '/versions/' + v._serverId + '/confirm');
    P.toast('版本已确认并保存到服务端');
  };
  D.advance = async (q) => {
    const to = P.D.STAGES[P.index(q.stage) + 1]?.id;
    const result = await D.mutate(q, '/stage', { to }, 'PATCH');
    if (P.s.ui.req === q.id)
      P.go({ stage: result.req.stage, artifactStage: null, version: null });
  };
  D.file = async (file) => {
    P.assert(file.size <= 10485760, '单文件不超过 10 MiB');
    const value = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
    return {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      encoding: 'base64',
      content: value,
    };
  };
  D.fileBlob = async (q, material) => {
    const response = await fetch(
      api().base() +
        '/api/reqs/' +
        q.id +
        '/materials/' +
        material.id +
        '/content?version=' +
        material.version,
      { headers: api().authHeaders(), signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) {
      const value = await response.json();
      throw Error(value.error?.msg || '下载失败');
    }
    return response.blob();
  };
  D.download = async (q, material) =>
    P.downloadBlob(
      await D.fileBlob(q, material),
      material.name,
      'application/octet-stream',
    );
  D.submitPlan = async (reject = false) => {
    const intent = P.domainPlan,
      q = P.r();
    P.assert(
      intent?.reqId === q.id && intent.stamp === P.stamp(q),
      '需求基线已更新，请重新打开计划',
    );
    const reason = (P.form()['reject-reason'] || '').trim();
    if (reject) P.assert(reason, '请填写拒绝原因');
    const created = await D.command('POST', '/api/runs', {
      reqId: q.id,
      plan: intent.text,
      parentId: intent.parentId,
      commandId: intent.commandId,
      expectedRevision: q.revision,
    });
    P.domain.merge(created, true);
    let run = created.run;
    if (reject)
      await D.command('POST', '/api/runs/' + run.id + '/plan-reject', {
        reason,
        expectedRevision: run.revision,
      });
    else {
      if (run.status === 'WAITING_APPROVAL' && !created.plan?.approvedAt)
        run = (
          await D.command('POST', '/api/runs/' + run.id + '/plan-approve', {
            expectedRevision: run.revision,
          })
        ).run;
      if (run.status === 'WAITING_APPROVAL')
        await D.command('POST', '/api/runs/' + run.id + '/start', {
          expectedRevision: run.revision,
        });
    }
    await P.domain.readRun(run.id, true);
    await V.sync();
    P.close();
    P.domainPlan = null;
    P.toast(reject ? '计划拒绝已保存' : '已提交模拟作业');
  };
  const remote = {
    'pg-info': () =>
      P.modal(
        '当前接入范围',
        '<p>需求、版本、材料原件、会话和模拟作业保存到 PostgreSQL；会话与执行仍为模拟。</p><p>' +
          P.esc(api().capabilities.unsupportedReason) +
          '</p>',
        P.btn('pg-logout', '退出登录') + P.btn('close-modal', '关闭'),
      ),
    'pg-logout': () => {
      P.close();
      V.clear();
    },
    'plan-run': (d = {}) => {
      P.write();
      const q = P.r();
      P.assert(q.stage === 'dev', '请进入开发阶段');
      P.domainPlan = {
        reqId: q.id,
        stamp: P.stamp(q),
        parentId: d.parent || null,
        commandId: uuid(),
        text: '模拟：读取需求、输出示例记录、保留模拟回放，不执行真实工具',
      };
      P.modal(
        '模拟作业 · 计划审批',
        '<p>' +
          P.esc(q.id + ' · ' + q.name) +
          '</p><p>读取当前需求与已确认设计，产生明确标记的模拟输出。不执行真实 Shell、Git、Codex 或 Zed。</p><form>' +
          P.field('reject-reason', '拒绝原因', '', 'textarea') +
          '</form>',
        P.btn('reject-plan', '拒绝计划') +
          P.btn('start-run', '批准并执行模拟', {}, 'primary') +
          P.btn('close-modal', '取消'),
      );
    },
    'pg-reload': () =>
      api()
        .init()
        .then(() => window.PFCWS.connect()),
    'reload-state': () => V.sync(),
    'new-requirement': () => {
      P.write();
      P.modal(
        '登记新需求',
        '<form>' +
          P.field('name', '需求名称') +
          P.field('goal', '原始想法 / 目标', '', 'textarea') +
          P.field('scope', '本次范围', '', 'textarea') +
          P.field('owner', '负责人', api().user.name) +
          '<p class="muted">新需求从空白开始，项目关联尚未接入。</p></form>',
        P.btn('close-modal', '取消') +
          P.btn('create-requirement', '创建并开始澄清', {}, 'primary'),
      );
    },
    'create-requirement': async () => {
      P.write();
      const f = P.form();
      P.assert(
        f.name.trim() && f.goal.trim() && f.scope.trim() && f.owner.trim(),
        '请填写名称、想法、范围与负责人',
      );
      const result = await D.command('POST', '/api/reqs', {
        name: f.name.trim(),
        goal: f.goal.trim(),
        scope: f.scope.trim(),
        owner: f.owner.trim(),
      });
      V.map(result.req);
      P.close();
      P.go({
        route: 'work',
        req: result.req.id,
        stage: 'idea',
        panel: 'canvas',
        artifactStage: null,
        version: null,
      });
    },
    'save-answer': async (d) => {
      const q = P.r(),
        f = P.form();
      await D.mutate(q, '/questions/' + d.id + '/answer', {
        answer: f.answer.trim(),
      });
      if (P.s.ui.req === q.id) P.close();
    },
    'save-artifact': async () => {
      const editor = P.editor,
        q = P.s.reqs[editor.req],
        v = P.latest(q, editor.stage),
        f = P.form();
      P.assert(
        v.id === editor.base,
        '已有新版本，编辑内容已保留，请比较后继续',
      );
      const fields = editor.fields.map((field, n) => ({
        name: field.name,
        value: f['field' + n].trim(),
      }));
      P.s.ui.editDrafts[editor.base] = fields.map((f) => f.value);
      P.save();
      const result = await D.mutate(q, '/versions', {
        stage: editor.stage,
        baseVersionId: v._serverId,
        expectedRevision: editor.revision,
        content: { title: v.title, fields },
      });
      delete P.s.ui.editDrafts[editor.base];
      if (P.s.ui.req === q.id) {
        P.close();
        P.go({
          stage: editor.stage,
          artifactStage: editor.stage,
          version: result.version.content.id,
          panel: 'canvas',
        });
      }
    },
    'save-review': async (d) => {
      const q = P.r(),
        v = P.latest(q, d.stage);
      P.assert(v.id === d.id, '版本已更新，请重新评审');
      await D.mutate(q, '/versions/' + v._serverId + '/reviews', P.form());
      P.close();
    },
    'save-material': async () => {
      const q = P.r(),
        f = P.form(),
        file = document.querySelector('#material-file').files[0];
      await D.mutate(q, '/materials', {
        name: f.name.trim() || file?.name,
        content: f.content,
        classification: f.classification,
        allowed: f.allowed === 'yes',
        ...(file ? { file: await D.file(file) } : {}),
      });
      if (P.s.ui.req === q.id) P.close();
    },
    'download-material': (d) =>
      D.download(
        P.r(),
        P.r().materials.find((m) => m.id === d.id),
      ),
    'download-attachment-original': (d) =>
      D.download(P.r(), P.domainConversation.attachment(d)),
    'pg-messages-page': async (d) => {
      const q = P.r();
      q.messagePageOffset = d.offset === 'latest' ? null : Number(d.offset);
      await V.readMessages(q.id);
      P.render();
    },
    'material-detail': (d) => {
      const m = P.r().materials.find((m) => m.id === d.id);
      P.assert(m, '材料不存在');
      P.modal(
        m.name,
        `<p>${P.esc(m.id)} · v${m.version} · ${P.esc(m.classification)} · ${P.esc(m.status)}</p><div class="doc-body">${P.esc(m.content || m.parseStatus)}</div>`,
        P.btn('download-material', '下载原件 / 文本', { id: m.id }) +
          P.btn('pg-replace-material', '上传新版本', { id: m.id }) +
          P.btn('close-modal', '关闭'),
      );
    },
    'pg-replace-material': (d) => {
      P.modal(
        '替换材料原件',
        '<form><input id="pg-material-file" type="file" aria-label="新版本原件"><p>保留历史原件，新版本需要重新确认影响。</p></form>',
        P.btn('pg-save-material-version', '保存新版本', { id: d.id }) +
          P.btn('close-modal', '取消'),
      );
    },
    'pg-save-material-version': async (d) => {
      const file = document.querySelector('#pg-material-file').files[0];
      P.assert(file, '请选择文件');
      await D.mutate(P.r(), '/materials/' + d.id + '/versions', {
        file: await D.file(file),
      });
      P.close();
    },
    'material-impact': () => {
      const q = P.r(),
        m = [...q.materials, ...q.attachments].find((m) => m.id === q.impact);
      P.assert(m, '没有待处理的材料变更');
      P.modal(
        '材料影响确认',
        '<p>' +
          P.esc(m.name + ' · v' + m.version) +
          '</p><p>纳入或排除此版本后重新确认受影响产物；历史原件与记录保留。</p>',
        P.btn('apply-impact', '纳入并重新评审') +
          P.btn('exclude-impact', '排除本次变更') +
          P.btn('close-modal', '稍后处理'),
      );
    },
    'replace-attachment': (d) => remote['pg-replace-material'](d),
    'apply-impact': async () => {
      await D.mutate(P.r(), '/materials/' + P.r().impact + '/impact', {
        decision: 'include',
      });
      P.close();
    },
    'exclude-impact': async () => {
      await D.mutate(P.r(), '/materials/' + P.r().impact + '/impact', {
        decision: 'exclude',
      });
      P.close();
    },
    'run-control': async (d) => {
      const run = P.r().runs.find((r) => r.id === d.id) || P.run(P.r());
      P.assert(run, '没有作业');
      if (d.control === 'verify') return P.domain.readRun(run.id);
      P.assert(d.control === 'cancel', '当前 PG 只支持取消和核验');
      await D.command('POST', '/api/runs/' + run.id + '/cancel', {
        expectedRevision: run.revision,
      });
      return P.domain.readRun(run.id);
    },
    'run-quality-gates': async (d) => {
      const run = P.r().runs.find((r) => r.id === d.id) || P.run(P.r());
      await D.command('POST', '/api/runs/' + run.id + '/quality-gates', {
        expectedRevision: run.revision,
        gates: run.qualityGates.map((g) => ({
          gateId: g.id,
          name: g.name,
          status: 'pending',
          evidenceRef: null,
        })),
      });
      await P.domain.readRun(run.id);
      P.toast('已登记模拟质量门，尚未执行真实检查');
    },
    'mark-notice': async (d) => {
      await D.command('POST', '/api/notices/' + d.id + '/read');
      await V.sync();
      P.close();
    },
    'mark-all-notices': async () => {
      await D.command('POST', '/api/notices/read-all');
      await V.sync();
      P.close();
    },
  };
  const viewActions = new Set(
    'close-modal navigate open-work view-stage panel select-run product-tab space-tab gov-tab switch-req pick-req search search-open notifications data-mode add-material answer-question open-artifact focus-artifact compare-artifact edit-artifact confirm-artifact review-artifact advance material-impact attach-menu attach-files attach-material-ref attach-artifact-ref pick-ref toggle-ref remove-pending retry-pending open-attachment download-attachment-text reply-message cancel-reply clear-reply expand-early-msgs ref-source msg-source resend-message send stop-reply diff-full accept-diff accept-selected-diff reject-diff view-reference reference-detail message-detail expand-message toggle-stage-all toggle-expand-all plan-run reject-plan start-run plan-retry replay-run replay-play replay-pause replay-reset'.split(
      ' ',
    ),
  );
  D.remote = remote;
  D.decorate = () => {
    if (!V.pg()) return;
    for (const label of document.querySelectorAll('#app .rail-title'))
      if (label.textContent === '质量门（客观检查）')
        label.textContent = '质量门（模拟记录，未执行真实检查）';
    for (const button of document.querySelectorAll(
      '#app [data-action="run-quality-gates"]',
    ))
      button.textContent = '登记模拟质量门';
    const q = P.r(),
      stream = document.querySelector('#stream');
    if (stream && q?.messageTotal > 100) {
      const bar = document.createElement('div');
      bar.className = 'btn-group';
      bar.setAttribute('aria-label', '对话分页');
      bar.innerHTML =
        `<span>对话 ${q.messageOffset + 1}–${Math.min(q.messageOffset + 100, q.messageTotal)} / ${q.messageTotal}</span>` +
        (q.messageOffset > 0
          ? P.btn('pg-messages-page', '上一页', {
              offset: Math.max(0, q.messageOffset - 100),
            })
          : '') +
        (q.messageOffset + 100 < q.messageTotal
          ? P.btn('pg-messages-page', '下一页', {
              offset: q.messageOffset + 100,
            })
          : '') +
        P.btn('pg-messages-page', '最新消息', { offset: 'latest' });
      stream.prepend(bar);
    }
    for (const button of document.querySelectorAll('#app button[data-action]'))
      if (
        !remote[button.dataset.action] &&
        !viewActions.has(button.dataset.action)
      ) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = 'PG 尚未接入此操作';
      }
  };
  D.install = () => {
    P.domainConversation.install(remote);
    const A = P.actions;
    const edit = A['edit-artifact'];
    A['edit-artifact'] = (d) => {
      const result = edit(d);
      if (V.pg()) {
        P.assert(P.latest(P.r(), d.stage)._serverId, '该阶段产物尚未生成');
        P.editor.revision = P.r().revision;
      }
      return result;
    };
    for (const name of new Set([...Object.keys(A), ...Object.keys(remote)])) {
      const original = A[name];
      A[name] = (...args) => {
        if (!V.pg()) return original?.(...args);
        P.assert(
          remote[name] || viewActions.has(name),
          'PG 尚未接入此操作，请查看当前接入范围',
        );
        return (remote[name] || original)(...args);
      };
    }
    const tick = P.tick;
    // A failed first health request has not discovered storage mode yet.
    A['pg-reload'] = remote['pg-reload'];
    P.tick = () => (V.pg() ? undefined : tick());
  };
})();
