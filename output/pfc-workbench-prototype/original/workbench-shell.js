(() => {
  const P = window.PFC;
  P.workbenchShell = {
    frame: ({ context, rail, main, panel, className = '' }) =>
      `<div class="work-layout${className ? ' ' + P.esc(className) : ''}" data-context="${P.esc(context)}">${rail}${main}${panel}</div>`,
    panel: ({ selected, body, action = 'panel' }) =>
      `<aside class="side-panel"><div class="panel-tabs" role="tablist" aria-label="工作面板">${[
        ['terminal', '终端', 'terminal'],
        ['canvas', '画布', 'eye'],
        ['evidence', '证据', 'list'],
      ]
        .map(
          ([id, label, icon]) =>
            `<button class="panel-tab ${selected === id ? 'active' : ''}" role="tab" aria-selected="${selected === id}" data-action="${action}" data-panel="${id}">${P.icon(icon)}${label}</button>`,
        )
        .join('')}</div><div class="panel-body">${body}</div></aside>`,
  };
})();
