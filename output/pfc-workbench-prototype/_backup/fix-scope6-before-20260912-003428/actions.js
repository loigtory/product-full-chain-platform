(() => {
  const P = window.PFC,
    { esc: e, btn: b, icon: i } = P,
    A = (P.actions = {});
  const commit = (fn, close = true) => {
    P.write();
    fn();
    P.save();
    if (close) P.close();
    P.render();
  };
  const form = (body) => `<form>${body}</form>`;
  const r = () => P.r();
  A['close-modal'] = () => P.close();
  A.navigate = (d) => P.go({ route: d.route });
  A['open-work'] = (d) => {
    const req = P.s.reqs[d.req] || r();
    P.assert(req, '先创建需求');
    P.go({
      route: 'work',
      req: req.id,
      stage: d.stage || req.stage,
      panel: d.panel || P.s.ui.panel,
      artifactStage: null,
      version: null,
      runId: d.runId || d.runid || null,
    });
  };
  A['view-stage'] = (d) =>
    P.go({ stage: d.stage, artifactStage: null, version: null });
  A.panel = (d) => P.go({ panel: d.panel });
  A['select-run'] = (d) => P.go({ runId: d.id });
  A['product-tab'] = (d) => P.go({ productTab: d.tab });
  A['space-tab'] = (d) => P.go({ route: 'product', productTab: d.tab });
  A['gov-tab'] = (d) => P.go({ govTab: d.tab });
  A['switch-req'] = () =>
    P.modal(
      '切换需求',
      `<div class="search-results">${Object.values(P.s.reqs)
        .map((q) =>
          b(
            'pick-req',
            e(q.id + ' · ' + q.name) + ' ' + P.badge(P.stageName(q.stage)),
            { req: q.id },
          ),
        )
        .join('')}</div>`,
    );
  A['pick-req'] = (d) => {
    const req = P.s.reqs[d.req];
    P.close();
    P.go({
      req: req.id,
      stage: req.stage,
      artifactStage: null,
      version: null,
      runId: null,
    });
  };
  A['new-requirement'] = () => {
    P.write();
    P.modal(
      '登记新需求',
      form(
        P.field('name', '需求名称', '', 'text', '用一句话说明要解决的问题') +
          P.field('goal', '原始想法 / 目标', '', 'textarea') +
          P.field('scope', '本次范围', '', 'textarea') +
          P.field('owner', '负责人', '陈立'),
      ),
      b('close-modal', '取消') +
        b('create-requirement', '创建并开始澄清', {}, 'primary'),
    );
  };
  A['create-requirement'] = () => {
    const f = P.form();
    P.assert(
      f.name.trim() && f.goal.trim() && f.scope.trim() && f.owner.trim(),
      '请填写名称、想法、范围与负责人。',
    );
    P.assert(
      f.name.length <= 80 && f.goal.length <= 8000,
      '名称不超过 80 字，想法不超过 8000 字。',
    );
    let req;
    commit(() => {
      const id = 'R-' + ++P.s.seq;
      req = P.makeRequirement(id, f.name.trim(), f.goal.trim());
      req.owner = f.owner.trim();
      for (const vs of Object.values(req.artifacts)) {
        const field = vs[0].fields.find((x) => x.name === '范围');
        if (field) field.value = f.scope.trim();
      }
      P.s.reqs[id] = req;
      P.log(req, '需求创建', f.goal);
    });
    A['open-work']({ req: req.id });
  };
  A['add-material'] = () => {
    P.write();
    P.modal(
      '登记来源材料',
      form(
        P.field('name', '材料名称') +
          P.field('content', '文本内容 / 来源说明', '', 'textarea') +
          `<label class="form-field" for="material-file"><span>可选附件（最大 10 MB）</span><input id="material-file" type="file" accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg"><small>原型仅在当前浏览器保留文本预览或文件元信息，不上传。PDF / Word 解析属于正式接入。</small></label>` +
          P.select(
            'classification',
            '材料级别',
            [
              ['内部', '内部'],
              ['公开', '公开'],
              ['受限', '受限'],
            ],
            '内部',
          ) +
          P.select(
            'allowed',
            '使用范围',
            [
              ['yes', '允许本需求分析'],
              ['no', '只登记，不用于 AI'],
            ],
            'yes',
          ),
      ),
      b('close-modal', '取消') + b('save-material', '登记材料', {}, 'primary'),
    );
  };
  A['save-material'] = async () => {
    P.write();
    const targetRequirement = r();
    const f = P.form(),
      file = document.querySelector('#material-file').files[0];
    P.assert(f.name.trim() || file, '请填写材料名称或选择文件');
    P.assert(f.content.trim() || file, '请提供文本或附件');
    P.assert(!file || file.size <= 10 * 1024 * 1024, '附件不能超过 10 MB');
    P.assert(
      !file || /\.(txt|md|pdf|docx|png|jpe?g)$/i.test(file.name),
      '仅支持 TXT、Markdown、PDF、Word 或图片',
    );
    P.assert(
      f.classification !== '受限' || f.allowed === 'no',
      '受限材料仅登记，不纳入 AI 上下文',
    );
    let content = f.content;
    if (file && /\.(md|txt)$/i.test(file.name)) {
      P.assert(file.size <= 200000, '文本预览最多 200 KB');
      content += (content ? '\n' : '') + (await file.text());
    }
    commit(() => {
      const q = targetRequirement,
        m = {
          id: 'M-' + ++P.s.seq,
          name: f.name.trim() || file.name,
          type: file ? file.name.split('.').at(-1) : '文本',
          size: file?.size || content.length,
          content,
          classification: f.classification,
          allowed: f.allowed === 'yes',
          status:
            f.allowed === 'yes'
              ? q.stage === 'idea'
                ? '已纳入'
                : '待影响评估'
              : '仅登记',
          version: 1,
        };
      q.materials.push(m);
      if (m.status === '待影响评估') {
        q.impactList.push(m.id);
        q.impact = q.impactList[0];
      }
      P.log(q, '材料登记', m.id + ' · ' + m.name);
    });
  };
  A['material-detail'] = (d) => {
    const m = r().materials.find((x) => x.id === d.id);
    P.assert(m, '材料不存在');
    P.modal(
      m.name,
      `<p>${e(m.id)} · v${m.version} · ${e(m.classification)} · ${e(m.status)}</p><div class="doc-body">${e(m.content || '仅登记文件元信息，正文待解析。')}</div>`,
      b('download-material', '下载内容', { id: m.id }) +
        b('close-modal', '关闭'),
    );
  };
  A['download-material'] = (d) => {
    const m = r().materials.find((x) => x.id === d.id);
    P.assert(m, '材料不存在');
    P.assert(m.content, '该材料没有可下载的文本内容');
    P.downloadBlob(m.content, m.name.replace(/\.[^.]+$/, '') + '.md', 'text/markdown');
    P.toast('已下载 ' + m.name);
  };
  A['material-impact'] = () => {
    P.write();
    const q = r(),
      pending = q.impactList || [],
      m = q.materials.find((x) => x.id === pending[0]);
    P.assert(pending.length && m, '没有待处理的材料变更');
    const rest = pending.length - 1;
    P.modal(
      '评估材料变更影响',
      `<div class="impact-card"><div class="impact-head">${e(m.name)} · v${e(m.version)}</div><div class="kv-row"><span>编号</span><b>${e(m.id)}</b></div><div class="kv-row"><span>级别</span><b>${e(m.classification)}</b></div><div class="kv-row"><span>摘要</span><b>${e((m.content || '仅登记文件元信息，正文待解析。').slice(0, 200))}</b></div></div><p class="muted">${rest ? `另还有 ${rest} 条待处理变更，将按队列逐条评估。` : '这是当前唯一待处理变更。'}</p><p>纳入后建立新材料基线，返回需求阶段重新评审；旧版本与旧执行记录保留。受影响对象：需求文档、技术方案、开发作业、测试和发布审批。</p>`,
      b('apply-impact', '纳入并重新评审', {}, 'primary') +
        b('exclude-impact', '排除本次变更') +
        b('close-modal', '稍后处理'),
    );
  };
  A['apply-impact'] = () =>
    commit(() => {
      const q = r(),
        pending = [...q.impactList];
      P.assert(pending.length, '没有待处理的材料变更');
      const m = q.materials.find((x) => x.id === pending[0]);
      P.assert(m, '待处理材料不存在');
      m.status = '已纳入';
      q.baseline++;
      q.impactList.shift();
      q.impact = q.impactList[0] || null;
      P.invalidate(q, 'req');
      for (const st of ['req', 'design', 'dev']) {
        const v = P.latest(q, st);
        P.newVersion(q, st, v.fields);
      }
      P.s.ui.stage = q.stage;
      P.log(q, '材料变更已纳入', '基线 ' + q.baseline + '，回到需求评审');
    });
  A['exclude-impact'] = () =>
    commit(() => {
      const q = r(),
        pending = [...q.impactList];
      P.assert(pending.length, '没有待处理变更');
      const m = q.materials.find((x) => x.id === pending[0]);
      P.assert(m, '待处理材料不存在');
      m.status = '排除';
      m.allowed = false;
      q.impactList.shift();
      q.impact = q.impactList[0] || null;
      P.log(q, '材料变更排除', m.id);
    });
  A['answer-question'] = (d) => {
    P.write();
    const q = r().questions.find((x) => x.id === d.id);
    P.modal(
      '回答澄清问题',
      form(
        `<p>${e(q.text)}</p>` +
          P.field('answer', '你的回答', q.answer, 'textarea'),
      ),
      b('save-answer', '保存回答', { id: d.id }, 'primary'),
    );
  };
  A['save-answer'] = (d) => {
    const f = P.form();
    P.assert(f.answer.trim(), '回答不能为空');
    commit(() => {
      const req = r(),
        q = req.questions.find((x) => x.id === d.id);
      q.answer = f.answer.trim();
      const fields = P.clone(P.latest(req, 'idea').fields);
      const index = fields.findIndex((x) => x.name === q.text);
      if (index < 0) fields.push({ name: q.text, value: q.answer });
      else fields[index].value = q.answer;
      P.newVersion(req, 'idea', fields);
      P.log(req, '问题已回答', q.id + ' · ' + q.answer);
    });
  };
  A['open-artifact'] = (d) => {
    P.close();
    P.go({
      route: 'work',
      stage: d.stage,
      artifactStage: d.stage,
      panel: 'canvas',
      version: null,
    });
  };
  A['focus-artifact'] = (d) => {
    const v =
      r().artifacts[d.stage].find((x) => x.id === d.id) ||
      P.latest(r(), d.stage);
    P.modal(
      v.title + ' · v' + v.version,
      `<p class="muted">${e(v.id)} · ${v.confirmed ? '已确认' : '草稿'}</p>${v.fields.map((f) => `<section class="doc-section"><h3>${e(f.name)}</h3><div class="doc-body">${e(f.value)}</div></section>`).join('')}`,
      b('close-modal', '返回工作区'),
      true,
    );
  };
  A['compare-artifact'] = (d) => {
    const versions = r().artifacts[d.stage];
    const after =
        versions.find((x) => x.id === P.s.ui.version) || versions.at(-1),
      before = versions[Math.max(0, versions.indexOf(after) - 1)];
    P.modal(
      '版本比较',
      `<p class="muted">${e(before.id)} → ${e(after.id)}${before.id === after.id ? ' · 当前仅有一个版本' : ''}</p><div class="comparison"><div><h3>之前 · v${before.version}</h3>${before.fields.map((f) => `<section class="doc-section"><b>${e(f.name)}</b><p class="doc-body">${e(f.value)}</p></section>`).join('')}</div><div><h3>之后 · v${after.version}</h3>${after.fields.map((f) => `<section class="doc-section ${before.fields.find((x) => x.name === f.name)?.value !== f.value ? 'changed' : ''}"><b>${e(f.name)}</b><p class="doc-body">${e(f.value)}</p></section>`).join('')}</div></div>`,
      b('close-modal', '返回'),
      true,
    );
  };
  A['edit-artifact'] = (d) => {
    P.write();
    const req = r(),
      v = P.latest(req, d.stage),
      cached = P.s.ui.editDrafts[v.id];
    P.editor = { req: req.id, stage: d.stage, base: v.id, fields: v.fields };
    P.modal(
      v.title + ' · 创建新版本',
      form(
        `<p class="muted">保存会创建新版本，旧正文和评审保留。已确认内容修改后回到对应阶段，重新检查下游结果。</p>${v.fields.map((f, n) => P.field('field' + n, f.name, cached?.[n] ?? f.value, 'textarea')).join('')}`,
      ),
      b('close-modal', '保留草稿并关闭') +
        b('save-artifact', '保存新版本', {}, 'primary'),
      true,
    );
  };
  A['save-artifact'] = () => {
    const f = P.form(),
      editor = P.editor,
      req = P.s.reqs[editor.req];
    P.assert(
      P.latest(req, editor.stage).id === editor.base,
      '已有新版本。编辑内容已保留，请关闭后比较最新版本再继续。',
    );
    const fields = editor.fields.map((old, n) => ({
      name: old.name,
      value: f['field' + n].trim(),
    }));
    P.assert(
      fields.every((x) => x.value),
      '各字段不能为空',
    );
    commit(() => {
      const v = P.newVersion(req, editor.stage, fields);
      delete P.s.ui.editDrafts[editor.base];
      P.s.ui.stage = editor.stage;
      P.s.ui.artifactStage = editor.stage;
      P.s.ui.version = v.id;
      P.s.ui.panel = 'canvas';
    });
  };
  A['confirm-artifact'] = (d) =>
    commit(() => P.confirmVersion(r(), d.stage, d.id));
  A['review-artifact'] = (d) => {
    const v = P.latest(r(), d.stage);
    P.modal(
      '版本评审 · ' + v.id,
      form(
        P.select(
          'result',
          '评审结论',
          [
            ['意见', '仅记录意见'],
            ['需修改', '要求修改'],
          ],
          '意见',
        ) + P.field('comment', '评审意见', '', 'textarea'),
      ),
      b('save-review', '提交意见', { stage: d.stage, id: v.id }, 'primary'),
    );
  };
  A['save-review'] = (d) => {
    const f = P.form();
    P.assert(f.comment.trim(), '请填写评审意见');
    commit(() => {
      const v = P.latest(r(), d.stage);
      P.assert(v.id === d.id, '版本已变化，请重新评审');
      v.comments.push({ text: f.comment, actor: '陈立', time: P.now() });
      if (f.result === '需修改') {
        v.confirmed = false;
        v.review = '需修改';
        P.invalidate(r(), d.stage);
      }
      P.log(r(), '版本评审', v.id + ' · ' + f.result + ' · ' + f.comment);
    });
  };
  A['edit-scope'] = () => {
    P.write();
    const q = r();
    P.modal(
      '维护 CAP / Unit 与 AC',
      form(
        P.field('cap', 'CAP 标识', q.capId) +
          P.field(
            'units',
            'Unit 名称（每行一项）',
            q.units.map((x) => x.name).join('\n'),
            'textarea',
          ) +
          P.field(
            'acs',
            '验收标准（每行一项）',
            q.acs.map((x) => x.text).join('\n'),
            'textarea',
          ),
      ),
      b('save-scope', '保存并重新确认范围', {}, 'primary'),
    );
  };
  A['save-scope'] = () => {
    const f = P.form(),
      units = f.units
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      acs = f.acs
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    P.assert(
      f.cap.trim() && units.length && acs.length,
      'CAP、Unit 和 AC 均必填',
    );
    commit(() => {
      const q = r();
      q.capId = f.cap.trim();
      /* 稳定身份：同名 Unit/AC 保留原 id 与状态，不因重排重建 */
      const oldUnits = q.units.slice();
      q.units = units.map((name) => {
        const hit = oldUnits.find((x) => x.name === name);
        return hit ? { ...hit, name } : { id: q.id + '-U' + (++P.s.seq % 9000 + 100), name, status: '待开始' };
      });
      const oldAcs = q.acs.slice();
      q.acs = acs.map((text) => {
        const hit = oldAcs.find((x) => x.text === text);
        return hit ? { ...hit, text } : { id: 'AC-' + String(++P.s.seq % 9000 + 1).padStart(2, '0'), text };
      });
      const fields = P.clone(P.latest(q, 'req').fields);
      fields.push(
        { name: '范围拆解', value: units.join('\n') },
        { name: '验收标准明细', value: acs.join('\n') },
      );
      P.newVersion(q, 'req', fields);
      P.log(q, '范围拆解更新', q.capId);
    });
  };
  A.advance = () => commit(() => P.advance(r()));
})();
