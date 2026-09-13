(() => {
  'use strict';
  const P = window.PFC,
    api = () => window.PFCAPI.api;
  const A = (P.verificationClient = { states: {}, errors: {}, tabs: {} });
  let epoch = 0;
  const reads = new Map();
  A.enabled = () =>
    P.domainView.pg() &&
    api().capabilities?.supportedActions?.includes('testing');
  A.key = (id) => 'pfc.r3:' + api().base() + ':' + api().user?.id + ':' + id;
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
      throw Error('草稿保存失败，请先复制内容并释放本地存储空间');
    }
  };
  A.request = (id, path) => api().req('GET', '/api/reqs/' + id + path);
  A.load = async (id) => {
    const stamp = epoch,
      key = A.key(id),
      token = Symbol();
    reads.set(id, token);
    try {
      const { req } = await api().req('GET', '/api/reqs/' + id);
      if (stamp !== epoch || key !== A.key(id)) return null;
      if (
        reads.get(id) === token ||
        req.revision > (P.s.reqs[id]?.revision ?? -1)
      ) {
        P.domainView.map(req);
        delete A.errors[id];
      }
      return A.states[id];
    } catch (e) {
      if (stamp === epoch && key === A.key(id)) A.errors[id] = e.message;
      throw e;
    }
  };
  A.write = async (id, path, input) => {
    P.write();
    const key = A.key(id),
      stamp = epoch,
      draft = A.draft(id),
      serialized = JSON.stringify({ path, input });
    P.assert(
      !draft.pending || draft.pending.serialized === serialized,
      '上一条提交结果待核实，请先核验原提交',
    );
    const pending = draft.pending || {
      path,
      input,
      serialized,
      commandId: crypto.randomUUID(),
      expectedRevision: input.expectedRevision ?? P.s.reqs[id]?.revision,
      formKey: A.activeForm?.reqId === id ? A.activeForm.key : null,
    };
    A.save(id, { ...draft, pending });
    let result;
    try {
      result = await P.domainActions.command('POST', '/api/reqs/' + id + path, {
        ...input,
        expectedRevision: pending.expectedRevision,
        commandId: pending.commandId,
      });
    } catch (e) {
      if (e.status && e.status < 500 && key === A.key(id) && stamp === epoch) {
        const d = A.draft(id);
        delete d.pending;
        A.save(id, d);
      }
      throw e;
    }
    P.assert(
      stamp === epoch && key === A.key(id),
      '身份已切换，原身份的提交编号已保留',
    );
    let value;
    try {
      value = await A.load(id);
    } catch (e) {
      if (stamp === epoch && key === A.key(id)) P.render();
      throw Error('已提交待核实，原输入与提交编号已保留：' + e.message, {
        cause: e,
      });
    }
    P.assert(
      value &&
        P.s.reqs[id]?.revision >=
          (result.req?.revision ?? pending.expectedRevision + 1) &&
        stamp === epoch &&
        key === A.key(id),
      '已提交待核实，输入与提交编号已保留',
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
    const d = A.draft(id).pending;
    P.assert(d, '没有待核实提交');
    return A.write(id, d.path, d.input);
  };
  A.install = () => {
    const map = P.domainView.map,
      reset = P.domainView.reset,
      clear = P.domainView.clear;
    P.domainView.map = (remote) => {
      const q = map(remote);
      if (remote.verification && q.revision === remote.revision)
        A.states[remote.id] = remote.verification;
      return q;
    };
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
  };
})();
