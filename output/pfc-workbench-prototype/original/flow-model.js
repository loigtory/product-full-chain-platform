(() => {
  const D = window.PFCFlowData;
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const current = (s) => s.reqs.find((r) => r.id === s.selected);
  const latest = (r) => r.versions.at(-1);
  const active = (r) =>
    r.run && ['RUNNING', 'PAUSED', 'UNKNOWN'].includes(r.run.status);
  function validate(s) {
    assert(
      s?.schema === 1 && s.source === 'simulation' && D.validId(s.runId),
      '演练记录格式不正确，请保留数据后核验',
    );
    assert(
      Number.isSafeInteger(s.revision) && s.revision >= 0,
      '演练版本不正确',
    );
    assert(['owner', 'viewer'].includes(s.role), '演练身份不正确');
    assert(
      Array.isArray(s.reqs) && s.reqs.length > 0 && s.reqs.length <= 20,
      '演练需求数量超过 20',
    );
    assert(
      new Set(s.reqs.map((r) => r.id)).size === s.reqs.length,
      '演练需求编号重复',
    );
    assert(
      s.reqs.every(
        (r) =>
          r.id.startsWith(s.runId + '-') &&
          D.stages.includes(r.stage) &&
          Array.isArray(r.versions) &&
          Array.isArray(r.events),
      ),
      '演练需求格式不正确',
    );
    assert(
      s.ui && typeof s.ui === 'object' && typeof s.returnHash === 'string',
      '演练视图不完整',
    );
    for (const r of s.reqs) {
      assert(
        typeof r.title === 'string' &&
          typeof r.goal === 'string' &&
          r.flags &&
          Array.isArray(r.materials) &&
          r.materials.length > 0 &&
          Array.isArray(r.messages) &&
          Array.isArray(r.history),
        '演练内容不完整',
      );
      for (const v of r.versions) {
        assert(
          v &&
            typeof v.id === 'string' &&
            Number.isInteger(v.version) &&
            ['prototype', 'prd', 'design', 'ac'].every(
              (k) =>
                v[k] &&
                typeof v[k].id === 'string' &&
                Number.isInteger(v[k].version),
            ),
          '演练产物不完整',
        );
        assert(
          [v.prototype.days, v.prd.days, v.ac.days].every(
            (n) => Number.isInteger(n) && n >= 1 && n <= 30,
          ) &&
            v.prototype.days === v.prd.days &&
            v.prd.days === v.ac.days &&
            Array.isArray(v.ac.items) &&
            v.ac.items.length === 3,
          '演练产物规则不一致',
        );
      }
      assert(!r.run || Array.isArray(r.run.lines), '演练运行证据不完整');
      assert(
        !r.tests ||
          (Array.isArray(r.tests.items) && r.tests.items.length === 3),
        '演练测试证据不完整',
      );
    }
    assert(
      s.reqs.reduce((sum, r) => sum + r.versions.length * 4, 0) <= 200,
      '演练产物版本已达 200 上限',
    );
    assert(
      Array.isArray(s.receipts) && s.receipts.length <= 1000 && current(s),
      '演练状态不完整或操作已达上限',
    );
    assert(
      JSON.stringify(s).length * 2 <= 10 * 1024 * 1024,
      '演练存储超过 10 MiB 上限',
    );
    return s;
  }
  function event(r, action, detail = '') {
    r.events.push({
      id: r.id + '-E' + (r.events.length + 1),
      action,
      detail,
      source: 'simulation',
    });
  }
  function move(s, r, stage) {
    const from = r.stage;
    r.stage = stage;
    s.ui.stage = stage;
    s.ui.version = null;
    event(
      r,
      '阶段承接',
      from +
        ' → ' +
        stage +
        '；材料 ' +
        r.materials.length +
        ' 项；基线 ' +
        (latest(r)?.id || '待形成'),
    );
  }
  function reduce(input, c) {
    validate(input);
    assert(
      c && typeof c.id === 'string' && /^[\w-]{1,120}$/.test(c.id),
      '命令编号不正确',
    );
    const scenario = c.type === 'scenario';
    assert(
      input.role === 'owner' || scenario || c.type === 'select',
      '当前为只读演练身份',
    );
    assert(
      input.reqs.some((r) => r.id === c.reqId),
      '演练需求不存在',
    );
    const signature = JSON.stringify([c.type, c.reqId, c.payload || {}]);
    const receipt = input.receipts.find((x) => x.id === c.id);
    if (receipt) {
      assert(receipt.signature === signature, '重复命令内容不一致');
      return structuredClone(input);
    }
    assert(
      c.expectedRevision === input.revision,
      '内容版本已更新，请载入最新记录后比较',
    );
    const s = structuredClone(input),
      r = s.reqs.find((r) => r.id === c.reqId),
      p = c.payload || {},
      v = latest(r);
    const stage = (expected) =>
      assert(r.stage === expected, '当前阶段不能执行此动作');
    const complete = () => assert(v?.complete, '请先生成并补齐全部关联产物');
    const addMessage = (role, text) =>
      r.messages.push({
        id: r.id + '-M' + (r.messages.length + 1),
        role,
        text,
        stage: r.stage,
      });
    switch (c.type) {
      case 'generate':
        stage('idea');
        assert(!v, '候选已生成');
        if (p.goal !== undefined) {
          assert(
            typeof p.goal === 'string' &&
              p.goal.trim().length > 0 &&
              p.goal.length <= 2000,
            '请填写 1–2000 字目标',
          );
          r.goal = p.goal.trim();
        }
        r.versions.push(D.bundle(r));
        latest(r).complete = !r.flags.partial;
        addMessage('user', r.goal);
        addMessage(
          'ai',
          '已按固定积分提醒模板形成可体验草案。原型、PRD、验收项共同演进；规则和数据均为合成演练。',
        );
        event(r, '生成合成候选', latest(r).id);
        move(s, r, 'req');
        break;
      case 'complete-generation':
        completePartial();
        break;
      case 'propose':
        complete();
        assert(
          Number.isInteger(p.days) && p.days >= 1 && p.days <= 30,
          '提醒时间必须为 1–30 天的整数',
        );
        assert(p.days !== v.prototype.days, '提醒时间没有变化');
        r.proposal = {
          id: r.id + '-P' + (s.revision + 1),
          baselineId: v.id,
          days: p.days,
          status: 'pending',
        };
        addMessage('user', p.text || '提醒时间改成提前 ' + p.days + ' 天');
        r.draft = '';
        addMessage(
          'ai',
          '建议同步更新原型、PRD 和验收项；请比较差异后采纳为新草稿。',
        );
        break;
      case 'reject':
        assert(r.proposal?.status === 'pending', '没有待处理建议');
        r.proposal.status = 'rejected';
        event(r, '拒绝变更建议');
        break;
      case 'apply-proposal':
        assert(r.proposal?.status === 'pending', '没有待处理建议');
        assert(r.proposal.baselineId === v?.id, '建议基线已变化，请重新提出');
        assert(!active(r), '请先停止或核验当前运行，再采纳变更');
        r.history.push({
          baselineId: v.id,
          run: r.run,
          tests: r.tests,
          acceptance: r.acceptance,
          release: r.release,
          observation: r.observation,
        });
        r.versions.push(D.bundle(r, r.proposal.days));
        r.proposal.status = 'applied';
        r.impact = {
          affected: [
            '原型',
            'PRD',
            '验收项',
            '设计确认',
            ...(r.run ? ['开发与测试证据'] : []),
          ],
          preserved: ['原始材料', '历史版本与证据'],
        };
        r.run = null;
        r.tests = null;
        r.acceptance = null;
        r.release = null;
        r.observation = null;
        r.closed = false;
        event(r, '采纳关联变更', v.id + ' → ' + latest(r).id);
        move(s, r, 'req');
        break;
      case 'confirm-business':
        stage('req');
        complete();
        assert(!r.question || r.question.answer, '请先处理待决定事项');
        assert(r.proposal?.status !== 'pending', '请先采纳或拒绝变更建议');
        v.businessConfirmed = true;
        event(r, '确认业务方案', v.id);
        move(s, r, 'design');
        break;
      case 'confirm-design':
        stage('design');
        complete();
        assert(v.businessConfirmed, '先确认业务方案');
        if (v.version > 1)
          v.design = {
            ...v.design,
            id: r.id + '-design-' + v.version,
            version: v.version,
          };
        v.designApproved = true;
        event(
          r,
          '确认实施设计与演练范围',
          v.id + '；仅模拟执行，不调用真实工具',
        );
        move(s, r, 'dev');
        break;
      case 'prepare':
        complete();
        r.prepared = true;
        event(r, '独立准备工作完成', '验收项草拟；未替用户回答待决事项');
        break;
      case 'answer':
        assert(r.question && !r.question.answer, '没有待决定事项');
        assert(p.answer === 'inbox', '当前演练只覆盖站内提醒');
        r.question.answer = 'inbox';
        event(r, '确认待决事项', '本轮仅演练站内提醒');
        break;
      case 'message':
        assert(
          typeof p.text === 'string' && p.text.trim() && p.text.length <= 2000,
          '请填写 1–2000 字反馈',
        );
        addMessage('user', p.text);
        addMessage(
          'ai',
          '反馈已保存。此处为确定性演练，尚未调用 AI；可通过“调整规则”体验关联变更。',
        );
        r.draft = '';
        break;
      case 'draft':
        assert(
          typeof p.text === 'string' && p.text.length <= 2000,
          '草稿最多 2000 字',
        );
        r.draft = p.text;
        break;
      case 'start-run':
        stage('dev');
        assert(v?.designApproved, '实施设计尚未确认');
        assert(!r.run, '已有运行，请继续或核验当前运行');
        r.run = {
          id: r.id + '-RUN' + (r.history.length + 1),
          baselineId: v.id,
          status: 'RUNNING',
          step: 0,
          codeVersion: 1,
          lines: [
            '[合成演练] 已承接 ' +
              v.id +
              ' 与材料引用；未调用 Shell / Codex / Zed。',
          ],
        };
        event(r, '启动模拟开发', r.run.id);
        break;
      case 'step-run':
        stage('dev');
        assert(r.run?.status === 'RUNNING', '运行未就绪；未知结果请先核验');
        assert(r.run.baselineId === v?.id, '运行基线已变化');
        r.run.step++;
        r.run.lines.push(
          r.run.step === 1
            ? '[合成演练] 提醒筛选与去重变更已准备。'
            : '[合成演练] 代码候选已形成，进入测试；没有真实文件写入。',
        );
        if (r.run.step >= 2) {
          r.run.status = 'SUCCEEDED';
          event(r, '模拟开发完成', r.run.id);
          move(s, r, 'test');
        }
        break;
      case 'pause':
        assert(r.run?.status === 'RUNNING', '当前运行不能暂停');
        r.run.status = 'PAUSED';
        event(r, '暂停模拟运行');
        break;
      case 'resume':
        assert(r.run?.status === 'PAUSED', '先核验运行，再继续');
        r.run.status = 'RUNNING';
        event(r, '恢复同一模拟运行', r.run.id);
        break;
      case 'cancel-run':
        assert(active(r), '没有可停止的运行');
        r.run.status = 'CANCELLED';
        event(r, '停止模拟运行', '保留证据；可基于变更形成新草稿');
        break;
      case 'verify-run':
        assert(r.run?.status === 'UNKNOWN', '运行不需要核验');
        r.run.status = 'PAUSED';
        event(r, '核验模拟运行', '读回相同运行编号；尚未重新执行');
        break;
      case 'run-tests':
        stage('test');
        assert(
          r.run?.status === 'SUCCEEDED' && r.run.baselineId === v?.id,
          '缺少当前基线开发证据',
        );
        r.tests = {
          baselineId: v.id,
          status: r.flags.testFailure ? 'FAIL' : 'PASS',
          codeVersion: r.run.codeVersion,
          items: v.ac.items.map((text, n) => ({
            text,
            result: r.flags.testFailure && n === 2 ? 'FAIL' : 'PASS',
          })),
        };
        event(r, '模拟测试' + r.tests.status, v.id);
        if (r.tests.status === 'PASS') move(s, r, 'accept');
        break;
      case 'fix-tests':
        stage('test');
        assert(r.tests?.status === 'FAIL', '没有待修复的失败项');
        r.history.push({ tests: structuredClone(r.tests) });
        r.flags.testFailure = false;
        r.run.codeVersion++;
        r.tests = null;
        event(r, '模拟修复完成', '保留失败证据，等待重新测试');
        break;
      case 'accept':
        stage('accept');
        assert(
          r.tests?.status === 'PASS' && r.tests.baselineId === v?.id,
          '当前基线测试未通过',
        );
        r.acceptance = {
          baselineId: v.id,
          actor: '合成负责人',
          status: 'ACCEPTED',
        };
        event(r, '人类演练验收', v.id);
        move(s, r, 'release');
        break;
      case 'return-acceptance':
        stage('accept');
        r.history.push({ tests: r.tests });
        r.tests = {
          ...r.tests,
          status: 'FAIL',
          items: r.tests.items.map((item, n) => ({
            ...item,
            result: n === 2 ? 'FAIL' : item.result,
          })),
        };
        r.flags.testFailure = true;
        event(r, '验收退回', '合成去重场景待修复');
        move(s, r, 'test');
        break;
      case 'approve-release':
        stage('release');
        assert(r.acceptance?.baselineId === v?.id, '缺少当前版本验收');
        r.release = {
          baselineId: v.id,
          status: 'APPROVED',
          target: '合成演练环境',
          rollback: '恢复上一合成版本',
          attempts: 0,
        };
        event(r, '批准模拟发布', v.id);
        break;
      case 'execute-release':
      case 'retry-release':
        stage('release');
        assert(
          r.release?.baselineId === v?.id &&
            ['APPROVED', 'FAILED'].includes(r.release.status),
          '发布尚未批准或结果需核验',
        );
        assert(r.release.attempts < 3, '已达 3 次演练重试上限');
        r.release.attempts++;
        if (c.type === 'retry-release') r.flags.releaseFailure = false;
        r.release.status = r.flags.releaseFailure ? 'FAILED' : 'SUCCEEDED';
        event(
          r,
          r.flags.releaseFailure ? '模拟发布失败' : '模拟发布完成',
          v.id,
        );
        if (r.release.status === 'SUCCEEDED') move(s, r, 'observe');
        break;
      case 'collect-observation':
        stage('observe');
        assert(r.release?.status === 'SUCCEEDED', '发布未成功');
        r.observation = {
          baselineId: v.id,
          source: 'simulation',
          window: '合成观察窗口',
          status: 'COLLECTED',
          samples: 3,
          duplicates: 0,
        };
        event(r, '采集合成观察样本', '模拟时钟和 3 个固定样本；非真实指标');
        break;
      case 'finish':
        stage('observe');
        assert(r.observation?.baselineId === v?.id, '请先完成合成观察采集');
        assert(!r.closed, '演练已完成');
        r.closed = true;
        event(r, '完成演练复盘', '下一需求建议待确认');
        break;
      case 'create-followup':
        assert(r.closed && !r.followupId, '演练未完成或已创建后续建议');
        r.followupId = s.runId + '-NEXT' + s.reqs.length;
        s.reqs.push(D.requirement(r.followupId, '积分提醒效果 · 后续合成需求'));
        event(r, '采纳后续需求建议', r.followupId);
        break;
      case 'scenario':
        assert(
          [
            'owner',
            'viewer',
            'partial',
            'input',
            'unknown',
            'test-failure',
            'release-failure',
          ].includes(p.kind),
          '未知演练场景',
        );
        if (['owner', 'viewer'].includes(p.kind)) s.role = p.kind;
        else if (p.kind === 'partial') {
          stage('idea');
          r.flags.partial = true;
        } else if (p.kind === 'input')
          r.question = { text: '本轮是否仅覆盖站内提醒？', answer: '' };
        else if (p.kind === 'unknown') {
          assert(active(r), '先启动模拟运行');
          r.run.status = 'UNKNOWN';
        } else if (p.kind === 'test-failure') r.flags.testFailure = true;
        else if (p.kind === 'release-failure') r.flags.releaseFailure = true;
        event(r, '切换演练场景', p.kind);
        break;
      case 'select':
        assert(
          s.reqs.some((x) => x.id === p.reqId),
          '需求不存在',
        );
        s.selected = p.reqId;
        s.ui.stage = current(s).stage;
        s.ui.version = null;
        break;
      default:
        throw Error('未支持的演练动作');
    }
    s.revision++;
    s.receipts.push({ id: c.id, signature });
    return validate(s);
    function completePartial() {
      assert(v && !v.complete, '没有待补齐的部分');
      v.complete = true;
      r.flags.partial = false;
      event(r, '补齐生成失败部分', v.id);
    }
  }
  function createStore({ storage, locks, mode }) {
    const key = (id) => {
      assert(D.validId(id), '非合成演练编号');
      return D.prefix + id;
    };
    const local = () =>
      assert(mode() === 'local', '仅本地模式可操作连续协作演练');
    function load(id) {
      local();
      const raw = storage.getItem(key(id));
      assert(raw, '演练记录不存在');
      const state = validate(JSON.parse(raw));
      assert(state.runId === id, '演练归属不一致');
      return state;
    }
    async function locked(id, fn) {
      local();
      assert(
        locks?.request,
        '浏览器缺少可靠保存所需的锁能力；请通过本地 HTTP 打开',
      );
      return locks.request(
        key(id),
        { mode: 'exclusive', signal: AbortSignal.timeout(5000) },
        () => {
          local();
          return fn();
        },
      );
    }
    return {
      key,
      load,
      create: (s) =>
        locked(s.runId, () => {
          validate(s);
          assert(!storage.getItem(key(s.runId)), '演练已存在，请恢复原记录');
          storage.setItem(key(s.runId), JSON.stringify(s));
          return structuredClone(s);
        }),
      transact: (id, c) =>
        locked(id, () => {
          const before = load(id),
            after = reduce(before, c);
          if (after.revision !== before.revision)
            storage.setItem(key(id), JSON.stringify(after));
          return after;
        }),
      remove: (id, revision) =>
        locked(id, () => {
          const s = load(id);
          assert(s.revision === revision, '版本已变化，不能清理');
          storage.removeItem(key(id));
          assert(storage.getItem(key(id)) === null, '演练清理未完成');
        }),
    };
  }
  window.PFCFlow = { validate, reduce, createStore, current, latest };
})();
