(() => {
  const P = window.PFC,
    { esc: e, btn: b } = P,
    A = P.actions;
  const commit = (fn, close = true) => {
    P.write();
    fn();
    P.save();
    if (close) P.close();
    P.render();
  };
  const form = (body) => `<form>${body}</form>`;
  const r = () => P.r();
  A['session-caps'] = () => P.sessionCaps();
  A['toggle-session'] = (d) => {
    commit(() => {
      const q = r(),
        st = P.s.ui.stage;
      P.assert(P.s.enabled.includes(d.id), '团队已停用此能力');
      q.overrides[st] ??= {};
      q.overrides[st][d.id] = !P.effective(q, st).some((x) => x.id === d.id);
      P.log(q, '会话能力调整', st + ' · ' + d.id);
    }, false);
    P.sessionCaps();
  };
  A['reset-session'] = () => {
    commit(() => {
      r().overrides[P.s.ui.stage] = {};
      P.log(r(), '恢复阶段默认', P.s.ui.stage);
    }, false);
    P.sessionCaps();
  };
  A['toggle-cap'] = (d) =>
    commit(() => {
      const c = P.s.caps.find((x) => x.id === d.id);
      P.assert(!c.pending, '能力需要先复核');
      P.s.enabled = P.s.enabled.includes(d.id)
        ? P.s.enabled.filter((id) => id !== d.id)
        : [...P.s.enabled, d.id];
      P.log(null, '团队能力切换', d.id);
    });
  A['toggle-binding'] = (d) =>
    commit(() => {
      const ids = P.s.bindings[d.stage] || [];
      P.s.bindings[d.stage] = ids.includes(d.id)
        ? ids.filter((x) => x !== d.id)
        : [...ids, d.id];
      P.log(null, '阶段绑定调整', d.stage + ' · ' + d.id);
    });
  A['cap-detail'] = (d) => {
    const c = P.s.caps.find((x) => x.id === d.id);
    P.modal(
      c.name,
      `<p>${e(c.desc)}</p><p>${e(c.type + ' · ' + c.src + ' · ' + c.ver + ' · ' + c.perm)}</p><p>协议：${e(c.protocol || (c.type === 'MCP' ? 'MCP' : c.type === '终端工具' ? '终端' : '原生 Skill'))}${c.endpoint ? ' · ' + e(c.endpoint) : ''}</p><p>状态：${c.pending ? '待复核' : P.s.enabled.includes(c.id) ? '团队启用' : '团队停用'}</p><p>运行时匹配工具名、输入结构和版本指纹；登记本身不会安装软件或连接账号。正式平台通过 MCP/ACP 开放协议接入任意 agent 与工具。</p>`,
      b('close-modal', '关闭'),
    );
  };
  A['register-cap'] = () => {
    P.write();
    P.modal(
      '登记新能力（开放协议）',
      form(
        P.field('name', '能力名称') +
          P.select(
            'type',
            '类型',
            [
              ['Skill', 'Skill'],
              ['MCP', 'MCP（协议 · server 命令）'],
              ['ACP', 'ACP（协议 · agent 端点）'],
              ['终端工具', '终端工具'],
            ],
            'Skill',
          ) +
          P.field(
            'endpoint',
            '连接地址 / 命令',
            '',
            'text',
            'MCP 例：npx mcp-server-xxx；ACP 例：ws://localhost:4000；终端例：zed / code',
          ) +
          P.field('src', '来源') +
          P.field('ver', '版本') +
          P.field('desc', '能力描述', '', 'textarea'),
      ),
      b('save-cap', '登记，等待复核', {}, 'primary'),
    );
  };
  A['save-cap'] = () => {
    const f = P.form();
    P.assert(
      f.name.trim() && f.src.trim() && f.ver.trim() && f.desc.trim(),
      '填写名称、来源、版本和描述',
    );
    commit(() => {
      P.assert(
        !P.s.caps.some(
          (c) => c.name === f.name.trim() && c.ver === f.ver.trim(),
        ),
        '相同能力版本已经登记',
      );
      const c = {
        id: 'CAP-' + ++P.s.seq,
        ...f,
        name: f.name.trim(),
        endpoint: f.endpoint?.trim() || '',
        protocol:
          f.type === 'MCP'
            ? 'MCP'
            : f.type === 'ACP'
              ? 'ACP'
              : f.type === '终端工具'
                ? '终端'
                : '原生 Skill',
        pending: true,
        perm: f.type === 'MCP' ? '已登记只读' : '任务范围内执行',
        ico: 'cpu',
        color: '#00A0E9',
      };
      P.s.caps.push(c);
      P.log(null, '能力登记', c.id + ' · ' + c.ver);
    });
  };
  A['review-cap'] = (d) =>
    commit(() => {
      const c = P.s.caps.find((x) => x.id === d.id);
      c.pending = false;
      P.log(null, '能力复核通过', c.id + ' · ' + c.ver);
    });
  A['export-audit'] = () => {
    P.write();
    commit(() => {
      const rows = [
        ['时间', '人员', '范围', '动作', '记录'],
        ...P.s.audit.map((a) => [
          P.time(a.time),
          a.actor,
          a.req,
          a.action,
          a.detail,
        ]),
      ];
      const csv =
        '\uFEFF' +
        rows
          .map((row) =>
            row
              .map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"')
              .join(','),
          )
          .join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pfc-audit-' + Date.now() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      P.log(null, '审计导出', rows.length - 1 + ' 条记录（CSV 下载）');
    });
    P.toast('审计记录已导出 CSV（浏览器本地下载）', 'ok');
  };
  A['install-plugin'] = (d) => {
    P.write();
    commit(() => {
      const p = P.s.plugins.find((x) => x.id === d.id);
      P.assert(p, '插件不存在');
      P.assert(
        !P.s.caps.some((c) => c.name === p.name),
        '该插件已登记（待复核或已启用）',
      );
      P.s.caps.push({
        id: 'CAP-' + ++P.s.seq,
        name: p.name,
        type:
          p.protocol === 'ACP' ? 'ACP' : p.protocol === 'MCP' ? 'MCP' : 'Skill',
        protocol: p.protocol,
        endpoint: p.endpoint,
        src: p.author,
        ver: p.ver,
        desc: p.desc,
        pending: true,
        perm: p.protocol === 'MCP' ? '已登记只读' : '任务范围内执行',
        ico: p.ico,
        color: p.color,
      });
      P.log(null, '插件安装', p.name + ' · ' + p.ver + '（待复核）');
      P.pushNotice('插件已安装待复核：' + p.name, null, 'info');
    });
    P.toast('插件已安装，进入能力目录待复核', 'ok');
  };
  A['add-knowledge'] = () => {
    P.write();
    P.modal(
      '手动登记知识条目',
      form(
        P.field('k-title', '标题') +
          P.select(
            'k-type',
            '类型',
            [
              ['复盘结论', '复盘结论'],
              ['组件规范', '组件规范'],
              ['接口契约', '接口契约'],
              ['踩坑记录', '踩坑记录'],
              ['Playbook', 'Playbook（可复用执行清单）'],
            ],
            '复盘结论',
          ) +
          P.field('k-content', '内容', '', 'textarea') +
          P.field('k-tags', '标签', '', 'text', '逗号分隔'),
      ),
      b('save-knowledge', '存入知识库', {}, 'primary'),
    );
  };
  A['save-knowledge'] = () => {
    const f = P.form();
    P.assert(f['k-title'].trim() && f['k-content'].trim(), '填写标题与内容');
    commit(() => {
      const kid = 'KN-' + String(P.s.knowledge.length + 1).padStart(2, '0');
      P.s.knowledge.push({
        id: kid,
        title: f['k-title'].trim(),
        type: f['k-type'],
        content: f['k-content'].trim(),
        sourceReq: null,
        tags: (f['k-tags'] || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        at: new Date(P.now()).toISOString(),
      });
      P.log(null, '知识条目登记', kid + ' · ' + f['k-title'].trim());
    });
    P.toast('已存入知识库：' + f['k-title'].trim());
  };
  A['add-member'] = () => {
    P.write();
    P.modal(
      '登记团队成员',
      form(
        P.field('name', '成员名称') +
          P.select(
            'role',
            '角色',
            [
              ['执行者', '执行者'],
              ['只读', '只读'],
              ['负责人', '负责人'],
            ],
            '只读',
          ),
      ),
      b('save-member', '保存成员', {}, 'primary'),
    );
  };
  A['save-member'] = () => {
    const f = P.form();
    P.assert(f.name.trim(), '填写成员名称');
    commit(() => {
      P.assert(
        !P.s.team.members.some((m) => m.name === f.name.trim()),
        '成员已经存在',
      );
      P.s.team.members.push({ name: f.name.trim(), role: f.role });
      P.log(null, '成员登记', f.name + ' · ' + f.role);
    });
  };
  A['edit-member'] = (d) => {
    P.write();
    const m = P.s.team.members.find((x) => x.name === d.name);
    P.assert(m, '成员不存在');
    P.modal(
      '成员角色 · ' + e(d.name),
      form(
        `<p>改角色或移除成员；其名下的 Unit / 后续事项会提示改派。</p>` +
          P.select(
            'role',
            '角色',
            [
              ['负责人', '负责人'],
              ['执行者', '执行者'],
              ['只读', '只读'],
            ],
            m.role,
          ),
      ),
      b('save-member-role', '保存角色', { name: m.name }, 'primary') +
        b('close-modal', '取消'),
    );
  };
  A['save-member-role'] = (d) => {
    const f = P.form();
    const m = P.s.team.members.find((x) => x.name === d.name);
    P.assert(m, '成员不存在');
    commit(() => {
      const old = m.role;
      m.role = f.role;
      /* 撤销执行权：名下 Unit 负责人与观察后续事项标记待改派 */
      if (old !== '只读' && f.role === '只读') {
        for (const q of Object.values(P.s.reqs))
          for (const u of q.units)
            if (u.owner === d.name) u.ownerNote = '负责人已撤销，待改派';
        for (const q of Object.values(P.s.reqs))
          for (const f2 of q.observation?.followups || [])
            if (f2.owner === d.name) f2.ownerNote = '负责人已撤销，待改派';
      }
      P.log(null, '成员角色变更', d.name + ' · ' + old + ' → ' + f.role);
    });
  };
  A['remove-member'] = (d) => {
    P.write();
    P.modal(
      '移除成员 · ' + e(d.name),
      `<p>移除后其名下 Unit / 后续事项需要改派；历史记录保留。</p>`,
      b('confirm-remove-member', '移除', { name: d.name }, 'danger') +
        b('close-modal', '取消'),
    );
  };
  A['confirm-remove-member'] = (d) =>
    commit(() => {
      const i = P.s.team.members.findIndex((x) => x.name === d.name);
      P.assert(i >= 0, '成员不存在');
      const [m] = P.s.team.members.splice(i, 1);
      for (const q of Object.values(P.s.reqs))
        for (const u of q.units)
          if (u.owner === d.name) u.ownerNote = '负责人已移除，待改派';
      for (const q of Object.values(P.s.reqs))
        for (const f2 of q.observation?.followups || [])
          if (f2.owner === d.name) f2.ownerNote = '负责人已移除，待改派';
      P.log(null, '成员移除', m.name + ' · ' + m.role);
    });
  A['edit-workspace'] = () => {
    P.write();
    P.modal(
      '登记工作区',
      form(
        P.field(
          'name',
          '当前需求的工作区名称',
          r()?.workspace || 'pfc-workspace',
        ) +
          P.field(
            'path',
            '本地项目路径',
            P.s.bridges[0]?.workspace || 'D:\\Projects\\pfc-workspace',
          ),
      ),
      b('save-workspace', '保存工作区', {}, 'primary'),
    );
  };
  A['save-workspace'] = () => {
    const f = P.form();
    P.assert(
      f.name.trim() && /^(?:[A-Za-z]:[\\/]|\/)/.test(f.path),
      '填写名称和本地绝对路径',
    );
    commit(() => {
      if (r()) {
        r().workspace = f.name.trim();
        P.log(r(), '工作区登记', f.name);
      }
      if (P.s.bridges[0]) P.s.bridges[0].workspace = f.path;
    });
  };
  A['pair-bridge'] = () => {
    P.write();
    P.pairCode = String(100000 + (++P.s.seq % 900000));
    P.modal(
      '配对本地 Bridge',
      form(
        `<p>在本地 Bridge 输入平台生成的配对码完成设备绑定。</p><p class="guide-notice">演示配对码：${P.pairCode}</p>` +
          P.field('code', '确认配对码') +
          P.field('name', '设备名称', '本地开发电脑'),
      ),
      b('confirm-pair', '确认配对（演示）', {}, 'primary'),
    );
  };
  A['confirm-pair'] = () => {
    const f = P.form();
    P.assert(
      f.code === P.pairCode && f.name.trim(),
      '配对码不匹配或设备名称为空',
    );
    commit(() => {
      P.s.bridges.push({
        id: 'BR-' + ++P.s.seq,
        name: f.name.trim(),
        workspace: 'D:\\Projects\\pfc-workspace',
        status: 'ONLINE',
      });
      P.log(null, 'Bridge 配对完成', f.name);
      P.pairCode = null;
    });
  };
  A['bridge-toggle'] = (d) =>
    commit(() => {
      const br = P.s.bridges.find((x) => x.id === d.id);
      P.assert(br.status !== 'REVOKED', '配对已撤销，请重新配对');
      br.status = br.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
      P.log(null, 'Bridge 连接变化', br.id + ' · ' + br.status);
    });
  A['bridge-revoke'] = (d) => {
    P.write();
    P.modal(
      '撤销设备配对',
      `<p>撤销后此设备不能领取新作业，运行结果需要核验。设备记录保留。</p>`,
      b('confirm-revoke', '撤销配对', { id: d.id }, 'danger') +
        b('close-modal', '取消'),
    );
  };
  A['confirm-revoke'] = (d) =>
    commit(() => {
      const br = P.s.bridges.find((x) => x.id === d.id);
      br.status = 'REVOKED';
      /* 撤销配对：该设备上的运行中作业租约失效，结果需核验 */
      for (const q of Object.values(P.s.reqs))
        for (const run of q.runs)
          if (
            run.lease?.deviceId === d.id &&
            ['RUNNING', 'QUEUED', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(
              run.status,
            )
          ) {
            run.status = 'UNKNOWN';
            run.verified = false;
            if (run.lease) run.lease.state = 'lost';
            run.lines.push({
              cls: 'error',
              text: '[bridge] 执行设备已撤销配对，作业租约失效，待核验',
            });
            P.log(q, '设备撤销致作业失效', run.id);
          }
      P.log(null, 'Bridge 配对撤销', d.id);
    });
  A['mcp-read'] = () => {
    P.write();
    const c = P.effective(r(), P.s.ui.stage).find((x) => x.type === 'MCP');
    P.assert(c, '当前阶段没有可用的已登记只读 MCP，请先调整能力');
    commit(() => {
      const q = r(),
        v = P.latest(q, P.s.ui.stage);
      const next = P.newVersion(q, P.s.ui.stage, [
        ...v.fields,
        {
          name: '只读 MCP 来源',
          value: c.name + ' ' + c.ver + '：读取的合成参考信息（演示）',
        },
      ]);
      P.log(q, 'MCP 只读结果归档', c.id + ' ' + c.ver + ' → ' + next.id);
      P.s.ui.panel = 'canvas';
    });
  };
  A['export-evidence'] = () => {
    const q = r();
    P.modal(
      '证据摘要 · 可复制',
      `<textarea class="evidence-export" aria-label="证据摘要" readonly rows="20">${e(
        JSON.stringify(
          {
            demo: true,
            requirement: q.id,
            cap: q.capId,
            units: q.units,
            baseline: P.stamp(q),
            artifacts: Object.values(q.artifacts)
              .flat()
              .map((v) => ({
                id: v.id,
                confirmed: v.confirmed,
                comments: v.comments,
              })),
            runs: q.runs,
            tests: q.tests,
            acceptance: q.accept,
            release: q.release,
            observation: q.observation,
            events: q.timeline,
          },
          null,
          2,
        ),
      )}</textarea>`,
      b('download-evidence', '下载 JSON 证据', {}, 'primary') +
        b('close-modal', '返回'),
      true,
    );
  };
  A['download-evidence'] = () => {
    const q = r();
    P.downloadBlob(
      JSON.stringify(
        {
          demo: true,
          requirement: q.id,
          cap: q.capId,
          units: q.units,
          baseline: P.stamp(q),
          artifacts: Object.values(q.artifacts)
            .flat()
            .map((v) => ({
              id: v.id,
              confirmed: v.confirmed,
              comments: v.comments,
            })),
          runs: q.runs,
          tests: q.tests,
          testRuns: q.testRuns,
          acceptance: q.accept,
          release: q.release,
          observation: q.observation,
          events: q.timeline,
        },
        null,
        2,
      ),
      q.id + '-evidence.json',
      'application/json',
    );
    P.log(q, '证据下载', q.id + '-evidence.json');
    P.toast('已下载 ' + q.id + '-evidence.json');
  };
})();
