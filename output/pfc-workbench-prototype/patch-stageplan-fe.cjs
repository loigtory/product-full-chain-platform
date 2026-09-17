'use strict';
const fs = require('fs');
const p =
  'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/original/domain-conversation.js';
let c = fs.readFileSync(p, 'utf8');
const anchor = `    P.enqueueFile = async (file, reqId = P.r().id) => {`;
const idx = c.indexOf(anchor);
if (idx < 0) {
  console.error('ANCHOR NOT FOUND');
  process.exit(1);
}
const injection = `    // ---- 52 号：阶段执行基线（freeze / review / revoke）----
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
        if (!r || r.id !== id || r.stage !== 'dev') return;
        const data = await stageApi(id, 'GET', '/stage-plan?stage=dev');
        if (P.r()?.id !== id) return;
        const k = stageKey(r, 'dev');
        P.s.ui.stagePlan = P.s.ui.stagePlan || {};
        P.s.ui.stagePlan[k] = {
          ...(P.s.ui.stagePlan[k] || {}),
          ...data,
          fetchedAt: Date.now(),
        };
        P.save();
        P.render({ quiet: true });
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
        P.btn(action, label, { req: r.id, ...(data || {}) }, cls || '');
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
        '<label class="exec-field">工作区<input aria-label="阶段工作区" data-sp="workspace" value="' + f(draft.workspace) + '" placeholder="授权 workspace 绝对路径" /></label>' +
        '<label class="exec-field">允许文件<input aria-label="允许文件" data-sp="allowedFiles" value="' + f(draft.allowedFiles) + '" placeholder="glob 逗号分隔，如 src/**, package.json" /></label>' +
        '<label class="exec-field">允许命令<input aria-label="允许命令" data-sp="allowedCommands" value="' + f(draft.allowedCommands) + '" placeholder="命令逗号分隔，如 node --version, npm test" /></label>' +
        '<label class="exec-field">有效期<select data-sp="validDays"><option value="1">1 天</option><option value="2" selected>2 天</option><option value="3">3 天</option><option value="7">7 天</option></select></label>' +
        '</div>' + errHtml +
        '<div class="btn-group">' + btn('stage-freeze', '冻结执行基线', {}, 'primary') + '</div>' +
        '</details></div>'
      );
    };
    remote['stage-freeze'] = async (d) => {
      const r = P.r();
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, 'dev');
      const g = (name) =>
        document.querySelector('[data-sp="' + name + '"]')?.value?.trim() || '';
      const workspace = g('workspace');
      const allowedFiles = g('allowedFiles')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const allowedCommands = g('allowedCommands')
        .split(/[,，]/)
        .map((s) => s.trim().split(/\\s+/))
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
          stage: 'dev',
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
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, 'dev');
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/review', {
          stage: 'dev',
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
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, 'dev');
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/revoke', {
          stage: 'dev',
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
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, 'dev');
      P.s.ui.stageDraft = P.s.ui.stageDraft || {};
      P.s.ui.stageDraft[k] = {
        workspace: '',
        allowedFiles: '',
        allowedCommands: '',
        validDays: 2,
        error: null,
      };
      P.s.ui.stagePlan = P.s.ui.stagePlan || {};
      P.s.ui.stagePlan[k] = {
        ...(P.s.ui.stagePlan[k] || {}),
        state: 'none',
      };
      P.save();
      P.render({ quiet: true });
    };
`;
c = c.slice(0, idx) + injection + c.slice(idx);
fs.writeFileSync(p, c, 'utf8');
console.log('stage-plan frontend injected at', idx);
