(() => {
  'use strict';
  const P = window.PFC,
    A = P.artifactClient,
    V = P.artifactView,
    e = (v) => P.esc(v),
    b = (...x) => P.btn(...x);
  const X = (P.artifactActions = {});
  let formKey = null,
    formReq = null;
  let originalUrl = null;
  const releaseOriginal = () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = null;
  };
  const current = () => {
    const q = P.r();
    P.assert(q && A.states[q.id], '先读取当前关联成果');
    return q;
  };
  const w = () => A.states[current().id];
  const unchanged = (id, key) =>
    P.assert(
      P.r()?.id === id && A.key(id) === key,
      '已切换需求或身份，请在当前需求重新打开',
    );
  X.open = (key, title, body, footer) => {
    const q = current();
    P.modal(
      title,
      '<form>' + body + '</form>',
      footer + b('close-modal', '关闭'),
      true,
    );
    formKey = key;
    formReq = q.id;
    A.activeForm = { reqId: q.id, key };
    const draft = A.draft(q.id).forms?.[key];
    if (draft)
      for (const input of document.querySelectorAll('#modal-root [name]'))
        if (Object.hasOwn(draft, input.name)) input.value = draft[input.name];
  };
  const remember = () => {
    if (!formKey || !formReq || !document.querySelector('#modal-root form'))
      return;
    const draft = A.draft(formReq);
    draft.forms = { ...draft.forms, [formKey]: P.form() };
    A.save(formReq, draft);
  };
  const finish = (id) => {
    if (formReq === id) {
      const d = A.draft(id);
      if (d.forms) delete d.forms[formKey];
      delete d.editor;
      A.save(id, d);
      formKey = null;
      P.close();
      P.render();
    }
  };
  X.editor = (content = {}, supersedes = null) => {
    const q = current(),
      draft = A.draft(q.id),
      existing = draft.editor;
    const base = existing || {
      baseGroupId: w().currentGroup?.id || null,
      inputFingerprint: w().inputFingerprint,
      expectedRevision: q.revision,
      supersedesProposalId: supersedes,
    };
    A.save(q.id, { ...draft, editor: base });
    const prd = content.prd,
      ac = content.acceptance;
    X.open(
      'editor',
      '整理关联候选',
      '<p>允许先保存原型。PRD、验收项和规则补齐后再采纳。各项留空表示沿用当前成果；首组留空则显示缺口。</p>' +
        P.field(
          'prototype',
          '原型描述（受控组件 JSON）',
          content.prototype ? JSON.stringify(content.prototype, null, 2) : '',
          'textarea',
        ) +
        P.field(
          'prd',
          'PRD（标题与字段 JSON）',
          prd ? JSON.stringify(prd, null, 2) : '',
          'textarea',
        ) +
        P.field(
          'acceptance',
          '验收项（items JSON）',
          ac ? JSON.stringify(ac, null, 2) : '',
          'textarea',
        ) +
        P.field(
          'rules',
          '规则对应（ruleId / fieldIndex）',
          content.rules ? JSON.stringify(content.rules, null, 2) : '',
          'textarea',
        ) +
        '<p class="muted">可从模板开始，再按实际需求修改字段、交互和验收项；模板内容需要人工核对。</p>',
      b('r2-save', '保存候选', {}, 'primary') + b('r2-rebase', '比较最新基线'),
    );
  };
  const actions = {
    'r2-refresh': async () => {
      const q = P.r();
      await A.load(q.id);
      await P.domainView.read(q.id);
      P.render();
    },
    'r2-retry': async () => {
      const q = current();
      await A.retry(q.id);
      finish(q.id);
      P.toast('原提交已核验，未重复创建');
    },
    'r2-tab': (d) => {
      const id = current().id;
      A.selections[id] = { kind: d.tab };
      P.render();
    },
    'r2-return': () =>
      P.go({ stage: P.r().stage, artifactStage: null, version: null }),
    'r2-edit': () => {
      const g = w().currentGroup;
      X.editor(
        g
          ? {
              prototype: g.prototype.content,
              prd: g.prd.content,
              acceptance: g.acceptance.content,
              rules: g.rules,
            }
          : {},
      );
    },
    'r2-rebase': async () => {
      remember();
      const q = current(),
        key = A.key(q.id);
      await P.domainView.read(q.id);
      unchanged(q.id, key);
      X.open(
        'compare-latest',
        '最新基线与保留草稿',
        '<p>保留的内容尚未覆盖新基线。确认已比较后，草稿将作为一个新的候选提交。</p>' +
          P.table(
            ['对象', '当前版本'],
            Object.entries(w().currentGroup || {})
              .filter(([k]) => ['prototype', 'prd', 'acceptance'].includes(k))
              .map(([k, v]) => [e(k), e(v.id) + ' · v' + v.version]),
          ),
        b('r2-use-latest', '已比较，保留草稿使用新基线'),
      );
    },
    'r2-use-latest': () => {
      const q = current(),
        d = A.draft(q.id);
      P.assert(!d.pending, '先核验待处理提交');
      d.editor = {
        ...d.editor,
        baseGroupId: w().currentGroup?.id || null,
        inputFingerprint: w().inputFingerprint,
        expectedRevision: q.revision,
      };
      A.save(q.id, d);
      X.editor();
    },
    'r2-save': async () => {
      remember();
      const q = current(),
        draft = A.draft(q.id),
        form = P.form(),
        changes = {};
      for (const kind of ['prototype', 'prd', 'acceptance', 'rules'])
        if (form[kind]?.trim()) {
          try {
            changes[kind] = JSON.parse(form[kind]);
          } catch {
            throw Error(kind + ' JSON格式不正确，输入已保留');
          }
        }
      const result = await A.write(q.id, '/artifact-proposals', {
        ...draft.editor,
        inputMode: 'manual',
        changes,
      });
      finish(q.id);
      P.toast(
        result.proposal.state === 'READY'
          ? '候选已保存，可比较采纳'
          : '候选已保存，请继续补齐',
      );
    },
    'r2-template': () =>
      X.open(
        'template',
        '从平台模板开始',
        P.select(
          'template',
          '模板',
          [
            ['form-table', '表单与列表'],
            ['approval-dialog', '确认与弹窗'],
          ],
          'form-table',
        ) +
          P.field('title', '候选名称', current().name) +
          '<p>模板是固定交互示例，需修改为真实业务方案。</p>',
        b('r2-save-template', '形成候选', {}, 'primary'),
      ),
    'r2-save-template': async () => {
      remember();
      const q = current(),
        f = P.form();
      await A.write(q.id, '/artifact-proposals', {
        expectedRevision: q.revision,
        baseGroupId: w().currentGroup?.id || null,
        inputFingerprint: w().inputFingerprint,
        inputMode: 'template',
        templateId: f.template,
        params: { title: f.title },
      });
      finish(q.id);
    },
    'r2-import': () =>
      X.open(
        'import',
        '导入当前需求原件',
        '<p>JSON可导入受控原型描述或完整候选。HTML与图片保存为原件；HTML只查看源码，不运行脚本。</p><input type="file" id="r2-file" accept=".json,.html,.png,.jpg,.jpeg,.gif" aria-label="候选原件">',
        b('r2-save-import', '上传并形成候选', {}, 'primary'),
      ),
    'r2-save-import': async () => {
      const q = current(),
        key = A.key(q.id),
        f = document.getElementById('r2-file').files[0];
      P.assert(f, '请选择原件');
      const result = await P.domainActions.mutate(q, '/materials', {
        name: f.name,
        classification: '内部',
        allowed: true,
        file: await P.domainActions.file(f),
      });
      unchanged(q.id, key);
      await A.load(q.id);
      const material = result.material;
      P.assert(material, '原件保存结果待核验');
      await A.write(q.id, '/artifact-proposals', {
        expectedRevision: P.r().revision,
        baseGroupId: w().currentGroup?.id || null,
        inputFingerprint: w().inputFingerprint,
        inputMode: 'import',
        sourceRefs: [
          { kind: 'material', id: material.id, version: material.version },
        ],
      });
      finish(q.id);
    },
    'r2-proposal': async (d) => {
      const q = current(),
        key = A.key(q.id),
        result = await A.request(q.id, '/artifact-proposals/' + d.id);
      unchanged(q.id, key);
      const p = result.proposal;
      X.proposal = p;
      const g = w().currentGroup,
        c = p.content;
      X.open(
        'proposal:' + p.id,
        '候选比较 · ' + p.id,
        '<p>' +
          V.source(p.source) +
          ' · ' +
          e(p.state) +
          (p.stale ? ' · 基线已变化，需修订' : '') +
          '</p>' +
          P.table(
            ['产物', '当前成果', '候选'],
            ['prototype', 'prd', 'acceptance'].map((k) => [
              e(k),
              g ? e(g[k].id) + ' · v' + g[k].version : '尚无',
              c[k]
                ? JSON.stringify(c[k]) === JSON.stringify(g?.[k].content)
                  ? '沿用'
                  : '新增 / 有变更'
                : '待补齐',
            ]),
          ) +
          '<details><summary>查看完整候选与当前内容</summary>' +
          P.table(
            ['当前', '候选'],
            [
              [
                `<pre>${e(JSON.stringify(g, null, 2))}</pre>`,
                `<pre>${e(JSON.stringify(c, null, 2))}</pre>`,
              ],
            ],
          ) +
          '</details>' +
          P.field('reason', '拒绝原因', '', 'textarea'),
        (c.prototype
          ? b('r2-preview-candidate', '体验候选', { id: p.id })
          : '') +
          (['READY', 'INCOMPLETE'].includes(p.state)
            ? b('r2-revise', '继续修订', { id: p.id }) +
              b('r2-reject', '拒绝候选', { id: p.id })
            : '') +
          (p.state === 'READY' && !p.stale
            ? b('r2-adopt', '采纳这组成果', { id: p.id }, 'primary')
            : ''),
      );
    },
    'r2-revise': () => {
      const p = X.proposal;
      const q = current(),
        d = A.draft(q.id);
      delete d.editor;
      if (d.forms) delete d.forms.editor;
      A.save(q.id, d);
      X.editor(p.content, p.id);
    },
    'r2-preview-candidate': () => {
      const p = X.proposal,
        proto = p.content.prototype;
      P.assert(proto, '候选没有原型');
      if (proto.representation === 'file')
        return actions['r2-original']({
          id: proto.materialId,
          version: proto.version,
        });
      P.modal(
        '体验候选 · ' + p.id,
        '<div id="r2-candidate-preview"></div>',
        b('r2-proposal', '返回比较', { id: p.id }) + b('close-modal', '关闭'),
        true,
      );
      P.prototypePreview.mount(
        document.getElementById('r2-candidate-preview'),
        proto.spec,
      );
    },
    'r2-adopt': async (d) => {
      const q = current(),
        p = X.proposal;
      P.assert(p?.id === d.id, '重新读取候选');
      await A.write(q.id, '/artifact-proposals/' + p.id + '/adopt', {
        expectedRevision: q.revision,
        baselineGroupId: w().currentGroup?.id || null,
        inputFingerprint: p.inputFingerprint,
      });
      finish(q.id);
      P.go({ stage: P.r().stage, artifactStage: null, version: null });
    },
    'r2-reject': async (d) => {
      remember();
      const q = current();
      await A.write(q.id, '/artifact-proposals/' + d.id + '/reject', {
        expectedRevision: q.revision,
        reason: P.form().reason,
      });
      finish(q.id);
    },
    'r2-confirm-business': () => X.confirm('business'),
    'r2-confirm-design': () => X.confirm('design'),
    'r2-save-confirm': async (d) => {
      remember();
      const q = current(),
        f = P.form(),
        intent = X.confirmIntent;
      P.assert(
        intent?.reqId === q.id && intent.kind === d.kind,
        '重新打开确认',
      );
      const input = { expectedRevision: intent.revision, comment: f.comment };
      if (d.kind === 'business')
        Object.assign(input, {
          advanceTo: 'design',
          inputFingerprint: intent.inputFingerprint,
          previewReview: f.previewReview || '',
        });
      else {
        Object.assign(input, {
          advanceTo: 'dev',
          designVersionId: intent.designVersionId,
          scope: {
            goal: f.goal,
            files: f.files,
            capabilityIds: (f.capabilityIds || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
            validation: f.validation,
            exit: f.exit,
            rollback: f.rollback,
          },
        });
      }
      await A.write(
        q.id,
        '/artifact-groups/' + intent.groupId + '/confirm-' + d.kind,
        input,
      );
      finish(q.id);
      P.go({ stage: P.r().stage, artifactStage: null, version: null });
    },
    'r2-history': async () => {
      const q = current(),
        key = A.key(q.id),
        result = await A.request(q.id, '/artifact-groups?limit=100');
      unchanged(q.id, key);
      P.modal(
        '成果版本与确认历史',
        P.table(
          ['版本', '记录'],
          result.items.map((g) => [
            '第 ' + g.version + ' 组',
            b('r2-group', e(g.id), { id: g.id }),
          ]),
        ) +
          P.table(
            ['确认', '确认人 / 角色', '意见'],
            w().confirmations.map((c) => [
              e(c.kind) + ' · ' + e(c.groupId),
              e(c.memberId) + ' / ' + e(c.role),
              e(c.comment),
            ]),
          ),
        b('close-modal', '关闭'),
        true,
      );
    },
    'r2-group': async (d) => {
      const q = current(),
        key = A.key(q.id),
        result = await A.request(q.id, '/artifact-groups/' + d.id);
      unchanged(q.id, key);
      P.modal(
        '历史成果 · ' + d.id,
        '<pre>' + e(JSON.stringify(result.group, null, 2)) + '</pre>',
        b('r2-history', '返回历史') + b('close-modal', '关闭'),
        true,
      );
    },
    'r2-more': async (d) => {
      const q = current(),
        key = A.key(q.id),
        offset = Number(d.offset),
        result = await A.request(
          q.id,
          '/artifact-proposals?limit=20&offset=' + offset,
        );
      unchanged(q.id, key);
      P.modal(
        '更早候选',
        P.table(
          ['候选', '状态', '操作'],
          result.items.map((p) => [
            e(p.id),
            e(p.state),
            b('r2-proposal', '比较', { id: p.id }),
          ]),
        ),
        (result.items.length === 20
          ? b('r2-more', '下一页', { offset: offset + 20 })
          : '') + b('close-modal', '关闭'),
      );
    },
    'r2-rule': (d) => {
      const rule = w().currentGroup?.rules.find((r) => r.ruleId === d.rule);
      P.assert(rule, '规则不在当前成果中');
      A.selections[current().id] = { kind: 'prd' };
      P.render();
      document
        .getElementById('r2-rule-' + rule.fieldIndex)
        ?.scrollIntoView({ block: 'nearest' });
    },
    'r2-inputs': async () => {
      const q = current(),
        key = A.key(q.id),
        stage =
          {
            req: 'design',
            design: 'dev',
            dev: 'test',
            test: 'accept',
            accept: 'release',
            release: 'release',
          }[q.stage] || 'design',
        value = await A.request(q.id, '/stage-inputs?stage=' + stage);
      unchanged(q.id, key);
      P.modal(
        '进入' + P.stageName(stage) + '的输入',
        P.notice(
          value.ready || value.inputsReady
            ? '输入已就绪'
            : value.blockers.join('；'),
        ) +
          '<pre>' +
          e(JSON.stringify(value, null, 2)) +
          '</pre>',
        b('close-modal', '关闭'),
        true,
      );
    },
    'r2-original': async (d) => {
      const q = current(),
        key = A.key(q.id),
        material = [...q.materials, ...q.attachments].find(
          (m) => m.id === d.id,
        );
      P.assert(material, '原件不属于当前需求');
      P.assert(
        material.allowed && material.version === Number(d.version),
        '原件权限或版本已变化，请重新读取',
      );
      const blob = await P.domainActions.fileBlob(q, {
        ...material,
        version: Number(d.version),
      });
      unchanged(q.id, key);
      if (/\.(png|jpe?g|gif)$/i.test(material.name)) {
        P.modal(
          '原件预览',
          '<img class="att-preview-img" id="r2-original-image" alt="' +
            e(material.name) +
            '">',
          b('r2-download', '下载原件', d) + b('close-modal', '关闭'),
          true,
        );
        const url = URL.createObjectURL(blob);
        originalUrl = url;
        const img = document.getElementById('r2-original-image');
        img.onload = img.onerror = () => {
          URL.revokeObjectURL(url);
          if (originalUrl === url) originalUrl = null;
        };
        img.src = url;
      } else {
        const text = await blob.text();
        unchanged(q.id, key);
        P.modal(
          '原件源码 · 不执行脚本',
          '<p>原件已保存，交互运行尚未接入。</p><pre>' + e(text) + '</pre>',
          b('r2-download', '下载原件', d) + b('close-modal', '关闭'),
          true,
        );
      }
    },
    'r2-download': (d) =>
      P.domainActions.download(current(), {
        ...[...current().materials, ...current().attachments].find(
          (m) => m.id === d.id,
        ),
        version: Number(d.version),
      }),
  };
  X.confirm = (kind) => {
    const q = current(),
      state = w();
    P.assert(state.currentGroup, '先采纳完整关联成果');
    X.confirmIntent = {
      reqId: q.id,
      kind,
      groupId: state.currentGroup.id,
      revision: q.revision,
      inputFingerprint: state.inputFingerprint,
      designVersionId: P.latest(q, 'design')?._serverId,
    };
    X.open(
      'confirm:' + kind + ':' + state.currentGroup.id,
      kind === 'business' ? '确认业务方案并继续' : '确认实施设计并继续',
      '<p>关联成果 ' +
        e(state.currentGroup.id) +
        '；本次确认和阶段推进一起保存。</p>' +
        P.field('comment', '确认意见', '', 'textarea') +
        (kind === 'business'
          ? state.currentGroup.prototype.content.representation === 'file'
            ? P.field(
                'previewReview',
                '原件评审记录与接受的预览限制',
                '',
                'textarea',
              )
            : ''
          : [
              ['goal', '实施目标'],
              ['files', '文件与模块范围'],
              ['capabilityIds', '工具能力 ID（逗号分隔，可为空）'],
              ['validation', '验证策略'],
              ['exit', '退出条件'],
              ['rollback', '回滚方式'],
            ]
              .map(([key, label]) =>
                P.field(
                  key,
                  label,
                  '',
                  key === 'capabilityIds' ? 'text' : 'textarea',
                ),
              )
              .join('')),
      b(
        'r2-save-confirm',
        kind === 'business' ? '确认并进入设计' : '确认并进入开发',
        { kind },
        'primary',
      ),
    );
  };
  X.install = (remote) => {
    A.install();
    V.install();
    Object.assign(remote, actions);
    const acceptDiff = remote['accept-diff'];
    remote['accept-diff'] = (d) => {
      const q = current(),
        diff = q.messages.find((m) => m.id === d.mid)?.diff;
      if (diff?.stage !== 'req') return acceptDiff(d);
      const group = w().currentGroup;
      P.assert(group, '先建立关联成果，再将差异整理为候选');
      P.assert(
        group.prd.id === diff.baseVersionId,
        '差异基线已变化，请重新比较',
      );
      const selected = d.selected || diff.fields.map((_, i) => i);
      P.assert(selected.length, '请选择差异');
      const prd = structuredClone(group.prd.content);
      for (const i of selected) {
        const change = diff.fields[i],
          field = prd.fields.find((f) => f.name === change?.name);
        P.assert(field && field.value === change.before, '差异基线已变化');
        field.value = change.after;
      }
      P.assert(!A.draft(q.id).editor, '已有未完成编辑，请先恢复该草稿');
      X.editor({
        prototype: group.prototype.content,
        prd,
        acceptance: group.acceptance.content,
        rules: group.rules,
      });
      P.toast('已带入候选编辑，请核对原型与验收项后保存');
    };
    const attach = P.actions['attach-artifact-ref'],
      refSource = P.actions['ref-source'];
    remote['attach-artifact-ref'] = () => {
      attach();
      const g = w().currentGroup;
      if (g)
        document
          .querySelector('#modal-root .search-results')
          .insertAdjacentHTML(
            'afterbegin',
            ['prototype', 'acceptance']
              .map((kind) =>
                b(
                  'r2-attach-ref',
                  e(kind === 'prototype' ? '关联原型' : '关联验收项') +
                    ' · v' +
                    g[kind].version,
                  { kind },
                ),
              )
              .join(''),
          );
    };
    remote['r2-attach-ref'] = (d) => {
      P.write();
      const q = current(),
        v = w().currentGroup[d.kind],
        bag = P.uiBag();
      P.assert(v, '当前产物不存在');
      if (!bag.refs.some((r) => r.id === v.id && r.kind === 'linked-artifact'))
        bag.refs.push({
          kind: 'linked-artifact',
          id: v.id,
          version: v.version,
          stage: d.kind,
          label:
            (d.kind === 'prototype' ? '原型' : '验收项') + ' v' + v.version,
          requirementId: q.id,
        });
      P.close();
      P.save();
      P.render();
    };
    remote['ref-source'] = async (d) => {
      const q = current(),
        ref = q.messages.find((m) => m.id === d.mid)?.refs?.[Number(d.idx)];
      if (ref?.kind !== 'linked-artifact') return refSource(d);
      const key = A.key(q.id),
        value = await A.request(q.id, '/linked-artifacts/' + ref.id);
      unchanged(q.id, key);
      const v = value.artifact;
      P.modal(
        '引用来源 · ' + v.id,
        V.part(v.kind, v.content, w().currentGroup?.rules || []),
        b('close-modal', '关闭'),
        true,
      );
      if (v.content.representation === 'spec')
        P.prototypePreview.mount(
          document.querySelector('#modal-root #r2-preview'),
          v.content.spec,
        );
    };
    const modal = P.modal,
      close = P.close;
    P.modal = (...args) => {
      remember();
      releaseOriginal();
      formKey = null;
      formReq = null;
      P.prototypePreview.destroy();
      return modal(...args);
    };
    P.close = () => {
      remember();
      releaseOriginal();
      formKey = null;
      formReq = null;
      P.prototypePreview.destroy();
      return close();
    };
    document.addEventListener('input', (ev) => {
      if (ev.target.closest('#modal-root form')) remember();
    });
    const oldEdit = P.actions['edit-artifact'];
    remote['edit-artifact'] = (d) =>
      d.stage === 'req'
        ? actions['r2-edit']()
        : (oldEdit(d), (P.editor.revision = P.r().revision));
    const oldSave = remote['save-artifact'];
    remote['save-artifact'] = () =>
      P.editor?.stage === 'req' ? actions['r2-edit']() : oldSave();
    const confirm = P.domainActions.confirm,
      advance = P.domainActions.advance;
    P.domainActions.confirm = (q, stage, id) =>
      ['req', 'design'].includes(stage)
        ? X.confirm(stage === 'req' ? 'business' : 'design')
        : confirm(q, stage, id);
    P.domainActions.advance = (q) =>
      ['req', 'design'].includes(q.stage)
        ? X.confirm(q.stage === 'req' ? 'business' : 'design')
        : advance(q);
  };
})();
