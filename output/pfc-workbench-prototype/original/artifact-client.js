(() => {
  'use strict';
  const P = window.PFC,
    api = () => window.PFCAPI.api;
  const A = (P.artifactClient = { states: {}, errors: {}, selections: {} });
  let generation = 0;
  A.enabled = () =>
    P.domainView.pg() &&
    api().capabilities?.supportedActions?.includes('linkedArtifacts');
  const reads = new Map(),
    writeReads = new Map();
  A.key = (id) => 'pfc.r2:' + api().base() + ':' + api().user?.id + ':' + id;
  A.draft = (id) => {
    try {
      return JSON.parse(localStorage.getItem(A.key(id)) || '{}');
    } catch {
      return {};
    }
  };
  A.save = (id, value) => {
    localStorage.setItem(A.key(id), JSON.stringify(value));
  };
  A.load = async (id, force = false) => {
    const shared = writeReads.get(id);
    if (!force && shared?.key === A.key(id) && shared.epoch === generation)
      return shared.promise;
    const epoch = generation,
      key = A.key(id),
      request = Symbol();
    reads.set(id, request);
    try {
      const w = await api().req(
        'GET',
        '/api/reqs/' + id + '/artifact-workspace',
      );
      if (
        epoch !== generation ||
        key !== A.key(id) ||
        reads.get(id) !== request
      )
        return null;
      A.states[id] = w;
      delete A.errors[id];
      return w;
    } catch (e) {
      if (epoch === generation && key === A.key(id)) A.errors[id] = e.message;
      throw e;
    }
  };
  A.request = (id, path) => api().req('GET', '/api/reqs/' + id + path);
  A.readback = async (id) => {
    const read = {
      key: A.key(id),
      epoch: generation,
      promise: A.load(id, true),
    };
    writeReads.set(id, read);
    try {
      const value = await read.promise;
      P.assert(
        value,
        '读回已被新的读取取代，请核验原提交；草稿与提交编号已保留',
      );
      return value;
    } finally {
      if (writeReads.get(id) === read) writeReads.delete(id);
    }
  };
  A.write = async (id, path, input) => {
    P.write();
    const key = A.key(id),
      draft = A.draft(id),
      old = draft.pending,
      serialized = JSON.stringify({ path, input });
    P.assert(
      !old || old.serialized === serialized,
      '上一条提交结果待核验，请先重试原提交',
    );
    const pending = old || {
      path,
      input,
      serialized,
      commandId: crypto.randomUUID(),
      formKey: A.activeForm?.reqId === id ? A.activeForm.key : null,
    };
    A.save(id, { ...draft, pending });
    let result;
    try {
      result = await P.domainActions.command('POST', '/api/reqs/' + id + path, {
        ...input,
        commandId: pending.commandId,
      });
    } catch (e) {
      if (e.status && e.status < 500 && key === A.key(id)) {
        const d = A.draft(id);
        delete d.pending;
        A.save(id, d);
      }
      throw e;
    }
    // Background refresh joins the read started after COMMIT instead of superseding it.
    await A.readback(id);
    if (key !== A.key(id)) return result;
    if (result.req) P.domainView.map(result.req);
    const d = A.draft(id);
    delete d.pending;
    if (pending.formKey && d.forms) delete d.forms[pending.formKey];
    if (pending.formKey === 'editor') delete d.editor;
    A.save(id, d);
    P.save();
    P.render();
    return result;
  };
  A.retry = async (id) => {
    const pending = A.draft(id).pending;
    P.assert(pending, '没有待核验提交');
    return A.write(id, pending.path, pending.input);
  };
  A.install = () => {
    const render = P.render;
    const paint = (...args) => {
      const focused = document.activeElement,
        id = focused?.id,
        reqId = P.r()?.id;
      const restore =
        A.enabled() &&
        id &&
        focused.closest?.('#app') &&
        focused.matches('input,textarea');
      const start = restore ? focused.selectionStart : null,
        end = restore ? focused.selectionEnd : null;
      const result = render(...args);
      if (
        restore &&
        P.r()?.id === reqId &&
        !document.querySelector('#modal-root [role="dialog"]')
      ) {
        const next = document.getElementById(id);
        next?.focus({ preventScroll: true });
        if (start !== null && typeof next?.setSelectionRange === 'function')
          next.setSelectionRange(start, end);
      }
      return result;
    };
    let gesture = null,
      queued = null,
      releaseTimer;
    const release = () => {
      clearTimeout(releaseTimer);
      gesture = null;
      const args = queued;
      queued = null;
      if (args) paint(...args);
    };
    // Replacing a pressed button prevents the browser from delivering its click.
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (
          !A.enabled() ||
          event.button !== 0 ||
          !event.target.closest?.('button[data-action]')
        )
          return;
        gesture = A.key(P.r()?.id);
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(release, 10000);
      },
      true,
    );
    window.addEventListener(
      'pointerup',
      () => {
        if (gesture) {
          clearTimeout(releaseTimer);
          releaseTimer = setTimeout(release, 0);
        }
      },
      true,
    );
    window.addEventListener(
      'click',
      () => {
        if (gesture) window.queueMicrotask(release);
      },
      true,
    );
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', () => {
      clearTimeout(releaseTimer);
      gesture = null;
      queued = null;
    });
    P.render = (...args) => {
      if (gesture === A.key(P.r()?.id)) {
        queued = args;
        return;
      }
      if (gesture) {
        clearTimeout(releaseTimer);
        gesture = null;
        queued = null;
      }
      return paint(...args);
    };
    const reset = P.domainView.reset;
    P.domainView.reset = (...args) => {
      generation++;
      reads.clear();
      writeReads.clear();
      A.states = {};
      A.errors = {};
      A.selections = {};
      P.prototypePreview?.reset();
      return reset(...args);
    };
    const read = P.domainView.read;
    P.domainView.read = async (id) => {
      const req = await read(id);
      if (req && A.enabled()) await A.load(id).catch(() => {});
      return req;
    };
  };
})();
