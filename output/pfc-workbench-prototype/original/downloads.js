(() => {
  'use strict';
  const P = window.PFC,
    { esc: e } = P,
    A = P.actions;
  A['download-artifact'] = (d) => {
    const q = P.r(),
      stage = d.stage || P.s.ui.stage,
      id = d.id || P.s.ui.version || P.latest(q, stage).id,
      v = q.artifacts[stage]?.find((x) => x.id === id);
    P.assert(v, '指定产物版本不存在，请重新选择');
    const md =
      `# ${v.title} · ${v.id}\n\n需求：${q.id} · ${q.name}\n版本记录时间：${v.createdAt || '未记录'}\n\n` +
      v.fields.map((f) => `## ${f.name}\n\n${f.value}`).join('\n\n') +
      (v.confirmed ? '\n\n已确认' : '\n\n草稿 · 待确认');
    downloadBlob(md, v.id + '.md', 'text/markdown');
    P.toast('已下载 ' + v.id + '.md');
  };
  A['download-workspace-file'] = (d) => {
    const run = P.r().runs.find((x) => x.id === d.id),
      file = run?.files?.find((x) => x.path === d.file);
    P.assert(
      file && typeof file.preview === 'string',
      '此作业中没有可下载的文件内容',
    );
    downloadBlob(file.preview, file.path.split(/[\\/]/).at(-1), 'text/plain');
    P.toast('已下载 ' + file.path + '（演示文件）');
  };
  A['deliver-package'] = (d) => {
    const current = P.r();
    let q = current;
    const rel =
      (d?.rel &&
        (q.releaseHistory.find((x) => x.id === d.rel) ||
          (q.release?.id === d.rel ? q.release : null))) ||
      q.release ||
      null;
    P.assert(!d?.rel || rel?.id === d.rel, '指定发布记录不存在');
    const snap = rel?.snapshot || null;
    P.assert(
      !snap || snap.content,
      '该早期快照仅保存了版本编号，无法重建完整交付内容，请使用新的审批记录',
    );
    q = snap ? P.clone(snap.content) : P.deliveryContent(current);
    const releaseView = snap?.release || rel;
    const missing = q.missing;
    const frozen = snap
      ? `冻结快照 ${e(snap.stamp)}（${e(snap.frozenAt)}）`
      : '未冻结（当前记录实时拼接，草稿不构成交付）';
    const artifactRows = Object.values(q.artifacts)
      .map((v) => {
        const draftNote = v.confirmed && !v.stale ? '' : '（草稿 / 待确认）';
        return (
          `### ${v.title} · ${v.id} ${draftNote}\n\n` +
          v.fields.map((f) => `**${f.name}**\n\n${f.value}`).join('\n\n')
        );
      })
      .join('\n\n');
    const md =
      `# 交付包 · ${q.id} · ${q.name}\n\n` +
      `内容时间：${snap?.frozenAt || new Date().toISOString()}\n` +
      `基线：${q.stamp}\n` +
      `发布：${frozen}\n\n` +
      `## 1. 产物\n\n` +
      artifactRows +
      `\n\n## 2. 测试与缺陷\n\n` +
      (q.tests.length
        ? q.tests
            .map((t) => `- ${t.id} ${t.text} → ${t.status}（${t.runId}）`)
            .join('\n')
        : '尚无测试结果') +
      `\n\n缺陷：` +
      (q.defects.length
        ? q.defects.map((d) => `${d.id} ${d.title} ${d.status}`).join('；')
        : '无') +
      `\n\n## 3. 验收与发布\n\n` +
      `产品验收：${q.accept ? q.accept.status + ' · ' + q.accept.actor + ' · ' + (q.accept.note || '') : '未完成'}\n` +
      `发布：${rel ? releaseView.id + ' · ' + releaseView.status : '未申请'}\n` +
      `观察：${q.observation ? q.observation.conclusion || '观察中' : '未开始'}\n\n` +
      `## 4. 当前结论\n\n` +
      (q.closed
        ? '已完成观察复盘'
        : q.stage === 'observe'
          ? '观察中'
          : q.accept?.status === 'ACCEPTED'
            ? '已验收，' + (releaseView?.status || '待发布')
            : P.stageName(q.stage) +
              '（' +
              (missing.length ? missing.join('；') : '可推进') +
              '）') +
      `\n\n## 5. 缺失项\n\n` +
      (missing.length
        ? missing.map((x) => `- ${x}`).join('\n')
        : '本阶段条件已满足') +
      `\n\n> 原型演示交付包；正式交付含不可变证据清单与版本指纹。草稿 / 缺失内容不冒充正式交付。`;
    P.downloadBlob(
      md,
      q.id + (rel ? '-' + rel.id : '') + '-delivery-package.md',
      'text/markdown',
    );
    P.toast(
      '已下载交付包 ' +
        q.id +
        (rel ? '-' + rel.id : '') +
        '-delivery-package.md',
    );
  };
  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  P.downloadBlob = downloadBlob;
})();
