'use strict';
const express = require('express');
const svc = require('../domain/service');
const router = express.Router();

/* ============ 需求域（M2a：领域模型，服务端状态机门控） ============ */

/* GET /api/reqs —— 列表（stage/q 过滤） */
router.get('/', async (req, res, next) => {
  try {
    const r = await svc.listReqs(
      req.query.stage,
      String(req.query.q || '').toLowerCase(),
    );
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs —— 创建需求（服务端知识检索） */
router.post('/', async (req, res, next) => {
  try {
    const r = await svc.createReq({
      ...req.body,
      name: req.body?.name,
      goal: req.body?.goal,
      scope: req.body?.scope,
      owner: req.body?.owner,
      projectId: req.body?.projectId,
    });
    if (r.error)
      return res
        .status(404)
        .json({ error: { code: r.error, msg: '创建失败' } });
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
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    res.json({ req: reqData });
  } catch (e) {
    next(e);
  }
});

/* PATCH /api/reqs/:id/stage —— 阶段推进（服务端校验全部阻塞条件） */
router.patch('/:id/stage', async (req, res, next) => {
  try {
    const r = await svc.advanceStage(
      req.params.id,
      req.body?.to,
      req.body || {},
    );
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    if (r.blockers?.length)
      return res
        .status(409)
        .json({
          error: { code: 'STAGE_BLOCKED', msg: r.blockers.join('；') },
          blockers: r.blockers,
        });
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
router.post('/:id/versions', async (req, res, next) => {
  try {
    const result = await svc.saveVersion(req.params.id, req.body || {});
    if (result.error)
      return res
        .status(result.error === 'NOT_FOUND' ? 404 : 409)
        .json({
          error: {
            code: result.error,
            msg: '草稿内容无效或服务端已有更新版本，请重新载入',
          },
        });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});
router.post('/:id/versions/:vid/confirm', async (req, res, next) => {
  try {
    const r = await svc.confirmVersion(
      req.params.id,
      req.params.vid,
      req.body || {},
    );
    if (r.error === 'STALE_VERSION')
      return res
        .status(409)
        .json({ error: { code: r.error, msg: '版本已更新，不能确认旧版本' } });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '版本不存在' } });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/materials —— 登记材料 */
router.post('/:id/materials', async (req, res, next) => {
  try {
    const r = await svc.addMaterial(req.params.id, {
      name: req.body?.name,
      ...req.body,
      content: req.body?.content,
      cls: req.body?.cls,
    });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/questions/:qid/answer —— 回答澄清问题 */
router.post('/:id/questions/:qid/answer', async (req, res, next) => {
  try {
    const r = await svc.answerQuestion(req.params.id, req.params.qid, {
      ...req.body,
      answer: req.body?.answer,
    });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '问题不存在' } });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* GET /api/reqs/:id/messages —— 跨阶段会话（分页） */
router.get('/:id/messages', async (req, res, next) => {
  try {
    const offset = Number(req.query.offset || 0) || 0;
    const limit = Number(req.query.limit || 20) || 20;
    const r = await svc.getMessages(
      req.params.id,
      req.query.stage,
      offset,
      limit,
    );
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* POST /api/reqs/:id/messages —— 发送消息 / 让 Agent 作业 */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const r = await svc.sendMessage(req.params.id, {
      ...req.body,
      content: req.body?.content,
      attachments: req.body?.attachments,
    });
    if (r.error === 'NOT_FOUND')
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', msg: '需求不存在' } });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

for (const [path, method] of [
  ['/:id/versions/:vid/reviews', 'reviewVersion'],
  ['/:id/materials/:mid/versions', 'replaceMaterial'],
  ['/:id/materials/:mid/impact', 'materialImpact'],
  ['/:id/messages/:mid/stop', 'stopMessage'],
  ['/:id/messages/:mid/diff', 'messageDiff'],
]) {
  router.post(path, async (req, res, next) => {
    try {
      res.json(
        await svc[method](
          req.params.id,
          req.params.vid || req.params.mid,
          req.body || {},
        ),
      );
    } catch (e) {
      next(e);
    }
  });
}
router.get('/:id/materials/:mid/content', async (req, res, next) => {
  try {
    const file = await svc.materialContent(
      req.params.id,
      req.params.mid,
      req.query.version,
    );
    res
      .set('Content-Type', 'application/octet-stream')
      .set(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      )
      .set('X-Content-Type-Options', 'nosniff');
    if (file.hash) res.set('X-Content-SHA256', file.hash);
    res.send(file.bytes);
  } catch (e) {
    next(e);
  }
});
module.exports = router;
