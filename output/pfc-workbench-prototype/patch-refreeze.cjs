'use strict';
const fs = require('fs');
const p =
  'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/original/domain-conversation.js';
let c = fs.readFileSync(p, 'utf8');
const startMarker = "    remote['stage-refreeze'] = async (d) => {";
const start = c.indexOf(startMarker);
if (start < 0) {
  console.error('ANCHOR NOT FOUND');
  process.exit(1);
}
const endMarker = "    };\n";
const bodyStart = start + startMarker.length;
const bodyEnd = c.indexOf(endMarker, bodyStart);
if (bodyEnd < 0) {
  console.error('END NOT FOUND');
  process.exit(1);
}
const end = bodyEnd + endMarker.length;
const replacement = `    remote['stage-refreeze'] = async (d) => {
      const r = P.r();
      P.assert(r && r.id === d.req, '需求已切换');
      const k = stageKey(r, 'dev');
      const plan = P.s.ui.stagePlan?.[k] || {};
      const ctl = plan.control || {};
      try {
        const data = await stageApi(d.req, 'POST', '/stage-plan/freeze', {
          stage: 'dev',
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
`;
c = c.slice(0, start) + replacement + c.slice(end);
fs.writeFileSync(p, c, 'utf8');
console.log('stage-refreeze fixed, replaced', end - start, 'chars');
