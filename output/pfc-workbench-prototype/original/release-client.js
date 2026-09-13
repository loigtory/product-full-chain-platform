(() => {
  'use strict';
  const P = window.PFC,
    api = () => window.PFCAPI.api,
    A = (P.releaseClient = { states: {}, errors: {}, tabs: {} });
  let epoch = 0;
  const reads = new Map();
  A.enabled = () =>
    P.domainView.pg() &&
    api().capabilities?.supportedActions?.includes('releaseObservation');
  A.key = (id) =>
    'pfc.m4:' +
    api().base() +
    ':' +
    api().user?.id +
    ':' +
    api().user?.role +
    ':' +
    id;
  A.draft = (id) => {
    try {
      return JSON.parse(localStorage.getItem(A.key(id)) || '{}');
    } catch {
      return {};
    }
  };
  A.save = (id, value) => {
    try {
      localStorage.setItem(A.key(id), JSON.stringify(value));
    } catch {
      throw Error('草稿未保存，请复制输入并释放本地存储空间');
    }
  };
  A.request = async (id, path) => {
    const key = A.key(id),
      stamp = epoch,
      r = await api().req('GET', '/api/reqs/' + id + path);
    P.assert(
      key === A.key(id) && stamp === epoch && P.r()?.id === id,
      '需求或身份已切换，请重新打开',
    );
    return r;
  };
  A.load = async (id) => {
    const key = A.key(id),
      stamp = epoch,
      token = Symbol();
    reads.set(id, token);
    try {
      const w = await api().req(
          'GET',
          '/api/reqs/' + id + '/release-workspace',
        ),
        { req } = await api().req('GET', '/api/reqs/' + id);
      if (key !== A.key(id) || stamp !== epoch || reads.get(id) !== token)
        return null;
      if (req.revision !== w.revision)
        throw Error('状态更新中，请刷新后核对依据');
      P.domainView.map(req);
      A.states[id] = w;
      delete A.errors[id];
      return w;
    } catch (e) {
      if (key === A.key(id) && stamp === epoch) A.errors[id] = e.message;
      throw e;
    } finally {
      if (reads.get(id) === token) reads.delete(id);
    }
  };
  A.ensure = (id) => {
    if (!A.states[id] && !A.errors[id] && !reads.has(id)) {
      A.load(id)
        .then(() => {
          if (P.r()?.id === id) P.render();
        })
        .catch(() => {
          if (P.r()?.id === id) P.render();
        });
    }
  };
  A.write = async (id, path, input, global = false) => {
    P.write();
    const key = A.key(id),
      stamp = epoch,
      draft = A.draft(id),
      serialized = JSON.stringify({ path, input, global });
    P.assert(
      !draft.pending || draft.pending.serialized === serialized,
      '上一条提交结果待核实，请先核验原提交',
    );
    const pending = draft.pending || {
      path,
      input,
      global,
      serialized,
      commandId: crypto.randomUUID(),
      expectedRevision: input.expectedRevision ?? P.s.reqs[id]?.revision,
      formKey: A.activeForm?.id === id ? A.activeForm.key : null,
    };
    A.save(id, { ...draft, pending });
    let result;
    try {
      result = await P.domainActions.command(
        'POST',
        global ? path : '/api/reqs/' + id + path,
        {
          ...input,
          commandId: pending.commandId,
          expectedRevision: pending.expectedRevision,
        },
      );
    } catch (e) {
      if (e.status && e.status < 500 && key === A.key(id) && stamp === epoch) {
        const d = A.draft(id);
        delete d.pending;
        A.save(id, d);
      }
      if (key === A.key(id) && stamp === epoch && P.r()?.id === id) P.render();
      throw e;
    }
    P.assert(
      key === A.key(id) && stamp === epoch,
      '身份已切换，原提交编号已保留',
    );
    let w;
    try {
      w = await A.load(id);
    } catch (e) {
      if (key === A.key(id) && stamp === epoch && P.r()?.id === id) P.render();
      throw Error('已提交待核实，输入和原提交编号已保留：' + e.message, {
        cause: e,
      });
    }
    P.assert(
      w &&
        w.revision >= (result.revision ?? pending.expectedRevision + 1) &&
        stamp === epoch &&
        key === A.key(id),
      '已提交待核实，请核验原提交',
    );
    const d = A.draft(id);
    delete d.pending;
    if (pending.formKey && d.forms) delete d.forms[pending.formKey];
    A.save(id, d);
    P.save();
    P.render();
    return result;
  };
  A.retry = (id) => {
    const p = A.draft(id).pending;
    P.assert(p, '没有待核实提交');
    return A.write(id, p.path, p.input, p.global);
  };
  A.install = () => {
    const map = P.domainView.map;
    P.domainView.map = (remote) => {
      const q = map(remote);
      if (
        A.states[remote.id] &&
        remote.revision > A.states[remote.id].revision
      ) {
        delete A.states[remote.id];
        delete A.errors[remote.id];
      }
      return q;
    };
    const reset = P.domainView.reset,
      clear = P.domainView.clear,
      go = P.go;
    const forget = () => {
      epoch++;
      reads.clear();
      A.states = {};
      A.errors = {};
      A.tabs = {};
      A.activeForm = null;
    };
    P.domainView.reset = (...args) => {
      forget();
      return reset(...args);
    };
    P.domainView.clear = (...args) => {
      forget();
      return clear(...args);
    };
    P.go = (patch, ...args) => {
      if (patch?.stage || patch?.req) delete A.tabs[P.r()?.id];
      return go(patch, ...args);
    };
  };
})();
