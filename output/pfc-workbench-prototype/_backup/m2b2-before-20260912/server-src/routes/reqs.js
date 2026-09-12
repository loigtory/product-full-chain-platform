'use strict';
const express = require('express');
const svc = require('../domain/service');
const router = express.Router();

/* ============ 需求域（M2a：领域模型，服务端状态机门控） ============ */

/* GET /api/reqs —— 列表（stage/q 过滤） */
router.get('/', async (req, res, next) => {
  try {
    const r = await svc.listReqs(req.query.stage, String(req.query.q || '').toLowerCase());
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs —— 创建需求（服务端知识检索） */
router.post('/', async (req, res, next) => {
  try {
    const r = await svc.createReq({
      name: req.body?.name,
      goal: req.body?.goal,
      scope: req.body?.scope,
      owner: req.body?.owner,
      projectId: req.body?.projectId,
    });
    if (r.error) return res.status(404).json({ error: { code: r.error, msg: '创建失败' } });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

/* GET /api/reqs/:id —— 详情 */
router.get('/:id', async (req, res, next) => {
  try {
    const reqData = await svc.getReq(req.params.id);
    if (!reqData)
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    res.json({ req: reqData });
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/reqs/:id/stage —— 阶段推进（服务端校验全部阻塞条件） */
router.patch('/:id/stage', async (req, res, next) => {
  try {
    const r = await svc.advanceStage(req.params.id, req.body?.to);
    if (r.error === 'NOT_FOUND')
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    if (r.blockers?.length)
      return res.status(409).json({ error: { code: 'STAGE_BLOCKED', msg: r.blockers.join('；') }, blockers: r.blockers });
    res.json({ req: r.req, blockers: [] });
  } catch (e) {
    next(e);
  }
});

/* GET /api/reqs/:id/versions —— 各阶段版本 */
router.get('/:id/versions', async (req, res, next) => {
  try {
    const r = await svc.getVersions(req.params.id, req.query.stage);
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/versions/:vid/confirm —— 确认版本（使下游评审过期） */
router.post('/:id/versions/:vid/confirm', async (req, res, next) => {
  try {
    const r = await svc.confirmVersion(req.params.id, req.params.vid);
    if (r.error === 'NOT_FOUND')
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '版本不存在' } });
    res.json({ version: r.version });
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/materials —— 登记材料 */
router.post('/:id/materials', async (req, res, next) => {
  try {
    const r = await svc.addMaterial(req.params.id, {
      name: req.body?.name,
      content: req.body?.content,
      cls: req.body?.cls,
    });
    if (r.error === 'NOT_FOUND')
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/questions/:qid/answer —— 回答澄清问题 */
router.post('/:id/questions/:qid/answer', async (req, res, next) => {
  try {
    const r = await svc.answerQuestion(req.params.id, req.params.qid, {
      answer: req.body?.answer,
    });
    if (r.error === 'NOT_FOUND')
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '问题不存在' } });
    res.json({ question: r.question });
  } catch (e) {
    next(e);
  }
});

/* GET /api/reqs/:id/messages —— 跨阶段会话（分页） */
router.get('/:id/messages', async (req, res, next) => {
  try {
    const offset = Number(req.query.offset || 0) || 0;
    const limit = Number(req.query.limit || 20) || 20;
    const r = await svc.getMessages(req.params.id, req.query.stage, offset, limit);
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/messages —— 发送消息 / 让 Agent 作业 */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const r = await svc.sendMessage(req.params.id, {
      content: req.body?.content,
      attachments: req.body?.attachments,
    });
    if (r.error === 'NOT_FOUND')
      return res.status(404).json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
