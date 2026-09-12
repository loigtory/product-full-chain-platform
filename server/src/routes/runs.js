'use strict';
const express = require('express');
const svc = require('../domain/service');
const router = express.Router();
router.get('/', async (req, res, next) => {
  try {
    res.json(await svc.listRuns(req.query.reqId));
  } catch (e) {
    next(e);
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    const result = await svc.getRun(req.params.id);
    if (!result)
      return res
        .status(404)
        .json({
          error: {
            code: 'NOT_FOUND',
            msg: '作业不存在；内存服务重启后需重新发起',
          },
        });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/* ============ 执行域（M2a：计划审批硬门 + 模拟执行，M2b 接 Bridge） ============ */

/* POST /api/runs —— 创建作业 + 生成执行计划（待审批） */
router.post('/', async (req, res, next) => {
  try {
    const r = await svc.createRun({
      ...req.body,
      reqId: req.body?.reqId,
      plan: req.body?.plan,
      commandId: req.body?.commandId,
      parentId: req.body?.parentId,
    });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    if (r.error)
      return res
        .status(409)
        .json({ error: { code: r.error, msg: '请求标识已用于其他计划' } });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/runs/:id/plan-approve —— 批准计划（硬门：批准后才可执行） */
router.post('/:id/plan-approve', async (req, res, next) => {
  try {
    const r = await svc.planApprove(
      req.params.id,
      req.body?.by,
      req.body || {},
    );
    if (r.error === 'INVALID_RUN_STATE')
      return res
        .status(409)
        .json({ error: { code: r.error, msg: '当前作业不可审批' } });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '作业不存在' } });
    res.json({ run: r.run });
  } catch (e) {
    next(e);
  }
});

/* POST /api/runs/:id/plan-reject —— 拒绝计划（原因必填，留痕审计 + 通知） */
router.post('/:id/plan-reject', async (req, res, next) => {
  try {
    const r = await svc.planReject(
      req.params.id,
      req.body?.reason,
      req.body || {},
    );
    if (r.error === 'INVALID_RUN_STATE')
      return res
        .status(409)
        .json({ error: { code: r.error, msg: '当前作业不可拒绝' } });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '作业不存在' } });
    if (r.error === 'REASON_REQUIRED')
      return res
        .status(400)
        .json({ error: { code: 'REASON_REQUIRED', msg: '拒绝原因必填' } });
    res.json({ run: r.run, audit: r.audit });
  } catch (e) {
    next(e);
  }
});

/* POST /api/runs/:id/start —— 启动执行（M1 模拟推进；未批准 409） */
router.post('/:id/start', async (req, res, next) => {
  try {
    const r = await svc.startRun(req.params.id, req.body || {});
    if (r.error === 'INVALID_RUN_STATE')
      return res
        .status(409)
        .json({ error: { code: r.error, msg: '当前作业不可启动' } });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '作业不存在' } });
    if (r.error === 'PLAN_NOT_APPROVED')
      return res
        .status(409)
        .json({
          error: {
            code: 'PLAN_NOT_APPROVED',
            msg: '计划未批准：硬门要求先 plan-approve',
          },
        });
    res.json({ run: r.run });
  } catch (e) {
    next(e);
  }
});

/* POST /api/runs/:id/cancel —— 取消（保留已输出记录） */
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const r = await svc.cancelRun(req.params.id, req.body || {});
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '作业不存在' } });
    res.json({ run: r.run });
  } catch (e) {
    next(e);
  }
});

/* POST /api/runs/:id/verify —— 核验未知结果 */
router.post('/:id/verify', async (req, res, next) => {
  try {
    const r = await svc.verifyRun(req.params.id);
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '作业不存在' } });
    res.json({ run: r.run });
  } catch (e) {
    next(e);
  }
});

/* POST /api/runs/:id/quality-gates —— 执行/回填质量门（fail 触发通知） */
router.post('/:id/quality-gates', async (req, res, next) => {
  try {
    const r = await svc.runQualityGates(
      req.params.id,
      req.body?.gates,
      req.body || {},
    );
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '作业不存在' } });
    res.json({ gates: r.gates });
  } catch (e) {
    next(e);
  }
});

/* GET /api/runs/:id/replay —— 快照回放步骤 */
router.get('/:id/replay', async (req, res, next) => {
  try {
    const r = await svc.replayRun(req.params.id, req.query);
    res.json(r);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/lines', async (req, res, next) => {
  try {
    res.json(await svc.runLines(req.params.id, req.query));
  } catch (e) {
    next(e);
  }
});
module.exports = router;
