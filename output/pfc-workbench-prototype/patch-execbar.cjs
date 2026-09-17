'use strict';
const fs = require('fs');
const p =
  'D:/项目管理/product-full-chain-platform/output/pfc-workbench-prototype/original/workbench.js';
let c = fs.readFileSync(p, 'utf8');
const start = c.indexOf('${P.domainView?.pg() && stage === \'dev\' ? `<div class="exec-bar"');
const endMarker = '</details></div>` : \'\'}';
const end = c.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  console.error('TARGET NOT FOUND', start, end);
  process.exit(1);
}
const endFull = end + endMarker.length;
const replacement =
  '${P.domainView?.pg() && stage === \'dev\' ? (P.execBar ? P.execBar(r, stage) : \'<div class="exec-bar" role="status"><span class="exec-cap">开发执行暂不可用</span></div>\') : \'\'}';
c = c.slice(0, start) + replacement + c.slice(endFull);
fs.writeFileSync(p, c, 'utf8');
console.log('exec-bar hook patched, replaced', endFull - start, 'chars');
