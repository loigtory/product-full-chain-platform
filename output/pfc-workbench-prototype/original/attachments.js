(() => {
  'use strict';
  const P = window.PFC,
    { esc: e, btn: b, icon: i } = P,
    A = P.actions;
  P.raws = {};
  P.fileHandles = new Map();
  P.findAttachment = (q, id) =>
    P.uiBag(q.id).atts.find((x) => x.id === id) ||
    q.attachments.find((x) => x.id === id) ||
    q.messages.flatMap((m) => m.attachments || []).find((x) => x.id === id);
  // JSON restores separate copies; reconnect all references to one asset per ID.
  P.hydrateAttachments = () => {
    for (const q of Object.values(P.s.reqs)) {
      const bag = P.uiBag(q.id);
      const assets = new Map(
        [
          ...q.attachments,
          ...q.messages.flatMap((m) => m.attachments || []),
          ...bag.atts,
        ].map((a) => [a.id, a]),
      );
      q.attachments = [...assets.values()];
      bag.atts = bag.atts.map((a) => assets.get(a.id));
      for (const m of q.messages)
        m.attachments = (m.attachments || []).map((a) => assets.get(a.id));
      for (const a of assets.values())
        if (a.status === 'parsing') {
          a.status = 'error';
          a.error = '读取已中断，请重新选择原文件';
        }
    }
  };
  P.hydrateAttachments();
  /* 确定性合成解析结构：只用于表达解析后的范围与引用，不声称真实解析 */
  P.syntheticStructure = (kind, seed) => {
    const pick = (arr, n) => arr[(seed + n * 7) % arr.length];
    const titles = [
      '概述与背景',
      '范围与边界',
      '流程说明',
      '接口与数据',
      '验收清单',
      '风险与回退',
      '附录',
    ];
    const texts = [
      '本部分说明目标与适用范围（合成样例文本）。',
      '定义参与角色、输入输出与异常边界。',
      '描述主流程、分支与结束条件。',
      '列出交互字段、取值与校验规则。',
      '给出验收标准与通过条件。',
      '记录已知风险与回退步骤。',
      '补充参考信息与术语表。',
    ];
    if (kind === 'pdf') {
      const n = 4 + (seed % 7); // 4–10 页
      return {
        pages: Array.from({ length: n }, (_, k) => ({
          n: k + 1,
          title: pick(titles, k),
          text: pick(texts, k),
        })),
      };
    }
    if (kind === 'word') {
      const n = 6 + (seed % 11); // 6–16 段
      return {
        paragraphs: Array.from({ length: n }, (_, k) => ({
          n: k + 1,
          text: pick(texts, k) + '（第 ' + (k + 1) + ' 段，合成样例）',
        })),
      };
    }
    const n = 2 + (seed % 4); // 2–5 个工作表
    return {
      sheets: Array.from({ length: n }, (_, k) => ({
        name: pick(['规则配置', '触达记录', '验收用例', '指标汇总'], k),
        rows: 8 + ((seed + k) % 40),
        cols: 3 + ((seed + k * 3) % 8),
        range: 'A1:' + String.fromCharCode(67 + ((seed + k) % 8)) + (8 + ((seed + k) % 40)),
      })),
    };
  };
  A['attach-menu'] = () => {
    P.write();
    P.modal(
      '添加附件 · 随消息发送',
      `<div class="attach-menu"><button class="attach-opt" data-action="attach-files">${i('clip')} 上传本地文件 / 粘贴截图</button><button class="attach-opt" data-action="attach-material-ref">${i('doc')} 引用已有材料</button><button class="attach-opt" data-action="attach-artifact-ref">${i('link')} 引用当前产物</button><button class="attach-opt" data-action="add-material">${i('plus')} 登记长期材料（材料区）</button></div><p class="source-note">上传文件只保存在当前浏览器会话；正式接入由服务端本地文件区与 Bridge 处理。</p>`,
      b('close-modal', '取消'),
    );
  };
  A['attach-files'] = () => {
    P.write();
    const reqId = P.r().id,
      dialog = document.querySelector('.guide-dialog');
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.csv,.xlsx,.json';
    input.onchange = async () => {
      const files = [...input.files];
      try {
        await P.enqueueFiles(files, reqId);
        if (document.querySelector('.guide-dialog') === dialog) P.close();
      } catch (err) {
        P.toast(err.message, 'error');
      }
      P.render();
    };
    input.click();
  };
  A['attach-material-ref'] = () => {
    const q = P.r();
    P.modal(
      '引用已有材料（本轮上下文）',
      `<div class="search-results">${
        q.materials
          .filter((m) => m.status !== '排除')
          .map((m) =>
            m.allowed === false
              ? `<button type="button" class="btn" disabled title="仅登记，不用于 AI">${e(m.name)} ${P.badge('v' + m.version)}<small class="lock-note">仅登记 · 不可引用</small></button>`
              : b('pick-ref', e(m.name) + ' ' + P.badge('v' + m.version), {
                  kind: 'material',
                  id: m.id,
                  label: m.name + ' v' + m.version,
                }),
          )
          .join('') || '<div class="empty-stage">当前需求还没有材料</div>'
      }</div>`,
      b('close-modal', '取消'),
    );
  };
  A['attach-artifact-ref'] = () => {
    const q = P.r();
    P.modal(
      '引用当前产物（本轮上下文）',
      `<div class="search-results">${P.D.STAGES.map((st) => {
        const v = P.latest(q, st.id);
        return v
          ? b('pick-ref', e(v.title + ' · v' + v.version + ' · ' + v.id), {
              kind: 'artifact',
              id: v.id,
              stage: st.id,
              label: v.title + ' v' + v.version,
            })
          : '';
      }).join('')}</div>`,
      b('close-modal', '取消'),
    );
  };
  A['pick-ref'] = (d) => {
    P.write();
    const bag = P.uiBag();
    if (d.kind === 'material') {
      const m = P.r().materials.find((x) => x.id === d.id);
      P.assert(m, '材料不存在');
      P.assert(
        m.allowed !== false && m.status !== '排除',
        '该材料仅登记、不用于 AI，不能加入本轮引用',
      );
      bag.refs.push({
        kind: 'material',
        id: m.id,
        label: m.name + ' v' + m.version,
        version: m.version,
        target: m.id,
        requirementId: P.r().id,
        snapshot: P.clone(m),
      });
    } else {
      bag.refs.push({
        kind: 'artifact',
        id: d.id,
        stage: d.stage,
        label: d.label,
        target: d.id,
        requirementId: P.r().id,
      });
    }
    P.close();
    P.save();
    P.render();
    P.toast('已加入本轮引用，可在输入框上方调整或排除');
  };
  A['toggle-ref'] = (d) => {
    P.write();
    const refs = P.uiBag().refs;
    const ref = refs[Number(d.idx)];
    if (ref) ref.excluded = !ref.excluded;
    P.save();
    P.render();
  };
  A['ref-scope'] = (d) => {
    P.write();
    const q = P.r(),
      a = P.findAttachment(q, d.id);
    P.assert(a && a.status === 'ready', '附件不存在或尚未解析完成');
    const bag = P.uiBag();
    bag.refs.push({
      kind: 'attachment',
      id: d.id,
      scope: d.scope,
      label: a.name + ' · ' + d.scope,
      target: d.id,
      requirementId: q.id,
    });
    P.close();
    P.save();
    P.render();
    P.toast('已按范围加入本轮引用：' + d.scope);
  };
  A['remove-pending'] = (d) => {
    P.write();
    const [removed] = P.uiBag().atts.splice(Number(d.idx), 1);
    if (
      removed &&
      !P.r().messages.some((m) =>
        m.attachments?.some((a) => a.id === removed.id),
      )
    ) {
      P.r().attachments = P.r().attachments.filter((a) => a.id !== removed.id);
      P.fileHandles.delete(removed.id);
      delete P.raws[removed.id];
    }
    P.save();
    P.render();
  };
  A['retry-pending'] = async (d) => {
    P.write();
    const q = P.r(),
      a = P.uiBag(q.id).atts[Number(d.idx)];
    P.assert(a, '附件不存在');
    P.assert(
      !/不支持|超过/.test(a.error || ''),
      '该附件无法重试（类型或大小受限），请移除后重新添加',
    );
    const file = P.fileHandles.get(a.id);
    P.assert(file, '原文件已不在当前会话，请查看附件并重新选择原文件');
    await readAttachment(q, a, file);
  };
  A['replace-attachment'] = (d) => {
    P.write();
    const q = P.r(),
      a = P.findAttachment(q, d.id);
    P.assert(a, '附件不存在');
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      try {
        const file = input.files[0];
        if (!file) return;
        P.write();
        P.assert(
          file.name === a.name && (!a.bytes || file.size === a.bytes),
          '请重新选择同名、同大小的原文件；替换内容应作为新附件发送',
        );
        if (a.digest)
          P.assert(
            (await fileDigest(file)) === a.digest,
            '所选文件内容与原件不同，请作为新附件添加',
          );
        P.fileHandles.set(a.id, file);
        await readAttachment(q, a, file);
        P.close();
        P.render();
      } catch (err) {
        P.toast(err.message, 'error');
      }
    };
    input.click();
  };
  A['download-attachment-original'] = (d) => {
    const a = P.findAttachment(P.r(), d.id),
      file = P.fileHandles.get(d.id);
    P.assert(a && file, '原文件已不在当前会话，请重新选择原文件');
    P.downloadBlob(file, a.name, file.type || 'application/octet-stream');
  };
  A['open-attachment'] = (d) => {
    const q = P.r(),
      bag = P.uiBag(),
      queue = bag.atts,
      a =
        queue.find((x) => x.id === d.id) ||
        q.attachments.find((x) => x.id === d.id) ||
        q.messages
          .flatMap((m) => m.attachments || [])
          .find((x) => x.id === d.id);
    P.assert(a, '附件不存在');
    const meta = a.meta || {};
    const statLine = `<p class="muted">${e(a.name)} · 原件 ${e(a.size)} · 解析 ${e(meta.charCount ? meta.charCount.toLocaleString() + ' 字符' : a.type)}</p>`;
    let parsed, origin;
    if (a.status !== 'ready') {
      parsed = `<div class="guide-notice">${e(a.error || '附件仍在读取，请等待完成')}</div>`;
      origin = '';
    } else if (a.type === 'image') {
      parsed = `<p class="muted">图片已生成缩略图与原件预览。</p>`;
      origin = `<div class="att-origin">${i('image')} 原件预览${P.raws[a.id] ? '' : '（刷新后原件失效，需重新上传）'}</div><img class="att-preview-img" src="${P.raws[a.id] || a.thumb}" alt="${e(a.name)}">`;
    } else if (a.type === 'text') {
      parsed = `<div class="att-origin">${i('file')} 解析文本${meta.truncated ? ` · 已截断至 50,000 字符（全文 ${meta.charCount.toLocaleString()} 字符）` : ''}</div><div class="doc-body">${e(a.content || '（无内容）')}</div><div class="btn-group">${b('download-attachment-text', i('download') + ' 下载全文', { id: a.id })}</div>`;
      origin = `<div class="att-origin">${i('clip')} 原件</div><p class="muted">${e(a.size)} · 原文件保留在当前会话内存，刷新后需重新上传关联。</p>`;
    } else {
      const pages = meta.pages || [],
        paras = meta.paragraphs || [],
        sheets = meta.sheets || [];
      const ext =
        a.type === 'pdf'
          ? `PDF · ${pages.length || '—'} 页`
          : a.type === 'word'
            ? `Word · ${paras.length || '—'} 段`
            : `Excel · ${sheets.length || '—'} 个工作表`;
      const structure =
        a.type === 'pdf'
          ? pages
              .map(
                (p) =>
                  `<div class="syn-row"><span>第 ${p.n} 页</span><b>${e(p.title)}</b><small>${e(p.text)}</small>${b('ref-scope', '引用此页', { id: a.id, scope: '第' + p.n + '页 · ' + p.title, idx: p.n })}</div>`,
              )
              .join('')
          : a.type === 'word'
            ? paras
                .map(
                  (p) =>
                    `<div class="syn-row"><span>第 ${p.n} 段</span><small>${e(p.text)}</small>${b('ref-scope', '引用此段', { id: a.id, scope: '第' + p.n + '段', idx: p.n })}</div>`,
                )
                .join('')
            : sheets
                .map(
                  (s, n) =>
                    `<div class="syn-row"><span>表 ${n + 1}</span><b>${e(s.name)}</b><small>${s.rows} 行 × ${s.cols} 列 · ${e(s.range)}</small>${b('ref-scope', '引用此表', { id: a.id, scope: '表' + (n + 1) + ' · ' + s.name + ' · ' + s.range, idx: n + 1 })}</div>`,
                )
                .join('');
      parsed = `<div class="att-origin">${i('doc')} 解析摘要 · ${e(ext)}</div><div class="doc-body">${e(a.content)}</div><p class="muted">类型 / 大小 / 数量：${e(ext)} · ${e(a.size)}。以下为合成样例结构，用于表达引用范围；正式接入由解析服务处理。</p><div class="syn-list">${structure}</div>`;
      origin = `<div class="att-origin">${i('clip')} 原件</div><p class="muted">二进制原件未持久化，当前会话外不可预览；正式接入由文件存储保留。</p>`;
    }
    P.modal(
      '附件 · ' + a.name,
      statLine + parsed + origin,
      (P.fileHandles.has(a.id)
        ? b('download-attachment-original', '下载原文件', { id: a.id })
        : b('replace-attachment', '重新选择原文件', {
            id: a.id,
            disabled: !P.canWrite(),
          })) + b('close-modal', '关闭'),
      true,
    );
  };
  A['download-attachment-text'] = (d) => {
    const a = P.findAttachment(P.r(), d.id);
    P.assert(
      a &&
        (typeof a.fullContent === 'string' ||
          (typeof a.content === 'string' && !a.meta?.truncated)),
      '该旧附件没有保留全文，请重新选择原文件',
    );
    P.downloadBlob(
      a.fullContent ?? a.content,
      a.name.replace(/\.[^.]+$/, '') + '.txt',
      'text/plain',
    );
    P.toast('已下载完整文本 ' + a.name);
  };
  P.enqueueFiles = async (files, reqId) => {
    P.write();
    const bag = P.uiBag(reqId);
    P.assert(
      bag.atts.length + files.length <= 20,
      '单条消息最多 20 个附件，请分批发送',
    );
    P.assert(
      bag.atts.reduce((n, a) => n + (a.bytes || 0), 0) +
        files.reduce((n, f) => n + f.size, 0) <=
        50 * 1024 * 1024,
      '单条消息附件总量不超过 50 MB',
    );
    for (const file of files) await P.enqueueFile(file, reqId);
  };
  P.enqueueFile = async (file, reqId = P.r().id) => {
    P.write();
    const q = P.s.reqs[reqId],
      bag = P.uiBag(reqId);
    P.assert(q, '附件所属需求不存在');
    P.assert(bag.atts.length < 20, '单条消息最多 20 个附件，请分批发送');
    const a = {
      id: 'ATT-' + ++P.s.seq,
      requirementId: reqId,
      name: file.name,
      bytes: file.size,
      size:
        file.size > 1024 * 1024
          ? (file.size / 1024 / 1024).toFixed(1) + ' MB'
          : Math.max(1, Math.round(file.size / 1024)) + ' KB',
      status: 'parsing',
      error: '',
      origin: 'browser',
    };
    bag.atts.push(a);
    q.attachments.push(a);
    P.fileHandles.set(a.id, file);
    await readAttachment(q, a, file);
  };
  async function readAttachment(q, a, file) {
    P.write();
    const stillOwned = () =>
      P.s.reqs[q.id] === q && P.findAttachment(q, a.id) === a;
    const attempt = (a.attempt || 0) + 1;
    a.attempt = attempt;
    a.status = 'parsing';
    a.error = '';
    P.save();
    P.render();
    try {
      const isText = /\.(md|txt|csv|json)$/i.test(file.name),
        isImage = /\.(png|jpe?g|gif)$/i.test(file.name);
      P.assert(file.size <= 10 * 1024 * 1024, '超过 10 MB 上限');
      P.assert(
        isText || isImage || /\.(pdf|docx|xlsx)$/i.test(file.name),
        '不支持的文件类型',
      );
      let result, raw;
      if (isImage) {
        const [thumb, original] = await Promise.all([
          readThumb(file),
          readRaw(file),
        ]);
        raw = original;
        result = {
          type: 'image',
          thumb,
          meta: { origin: 'image', rawInMemory: true },
        };
      } else if (isText) {
        P.assert(file.size <= 200000, '文本预览超过 200 KB');
        const content = await file.text();
        result = {
          type: 'text',
          fullContent: content,
          content: content.slice(0, 50000),
          meta: {
            origin: 'text',
            charCount: content.length,
            truncated: content.length > 50000,
            fullInMemory: true,
          },
        };
      } else {
        /* 二进制：结构化合成样例（非真实解析）。结构由文件名哈希确定性生成，可稳定引用。 */
        const kind = /\.pdf$/i.test(file.name)
          ? 'pdf'
          : /\.docx$/i.test(file.name)
            ? 'word'
            : 'sheet';
        const seed = [...file.name].reduce((n, ch) => n + ch.charCodeAt(0), 0);
        const syn = P.syntheticStructure(kind, seed);
        result = {
          type: kind,
          content:
            '（演示解析）以下结构为合成样例，用于表达解析后的页 / 段落 / 工作表与引用范围；不声称已真实解析任意用户文档。',
          meta: {
            origin: 'binary',
            fullInMemory: false,
            pages: syn.pages,
            paragraphs: syn.paragraphs,
            sheets: syn.sheets,
          },
        };
      }
      result.digest = await fileDigest(file);
      if (!stillOwned() || a.attempt !== attempt || !P.canWrite()) return;
      Object.assign(a, result, { status: 'ready', error: '' });
      if (raw) P.raws[a.id] = raw;
    } catch (err) {
      if (!stillOwned() || a.attempt !== attempt) return;
      a.status = 'error';
      a.error = err.message || '读取失败，请重试';
    }
    P.save();
    P.render();
  }
  async function fileDigest(file) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    );
    return [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  }
  function readRaw(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function readThumb(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 160;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas
            .getContext('2d')
            .drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
})();
