'use strict';
const router = require('express').Router(),
  svc = require('../domain/artifact-service'),
  confirm = require('../domain/artifact-confirmation-service');
const handler =
  (fn, status = 200) =>
  async (req, res, next) => {
    try {
      if (!require('../runtime').isPg())
        require('../access').fail(
          'CAPABILITY_UNAVAILABLE',
          409,
          '当前模式未接入关联成果存储',
        );
      res.status(status).json(await fn(req));
    } catch (e) {
      next(e);
    }
  };
router.get(
  '/:id/artifact-workspace',
  handler((r) => svc.getWorkspace(r.params.id)),
);
router.get(
  '/:id/artifact-groups',
  handler((r) => svc.listGroups(r.params.id, r.query)),
);
router.get(
  '/:id/artifact-groups/:gid',
  handler((r) => svc.getGroup(r.params.id, r.params.gid)),
);
router.get(
  '/:id/linked-artifacts/:vid',
  handler((r) => svc.getArtifact(r.params.id, r.params.vid)),
);
router.get(
  '/:id/artifact-proposals',
  handler((r) => svc.listProposals(r.params.id, r.query)),
);
router.get(
  '/:id/artifact-proposals/:pid',
  handler((r) => svc.getProposal(r.params.id, r.params.pid)),
);
router.post(
  '/:id/artifact-proposals',
  handler((r) => svc.createProposal(r.params.id, r.body || {}), 201),
);
router.post(
  '/:id/artifact-proposals/:pid/adopt',
  handler((r) => svc.adopt(r.params.id, r.params.pid, r.body || {})),
);
router.post(
  '/:id/artifact-proposals/:pid/reject',
  handler((r) => svc.reject(r.params.id, r.params.pid, r.body || {})),
);
router.post(
  '/:id/artifact-groups/:gid/confirm-business',
  handler((r) =>
    confirm.confirmBusiness(r.params.id, r.params.gid, r.body || {}),
  ),
);
router.post(
  '/:id/artifact-groups/:gid/confirm-design',
  handler((r) =>
    confirm.confirmDesign(r.params.id, r.params.gid, r.body || {}),
  ),
);
router.get(
  '/:id/stage-inputs',
  handler((r) => confirm.stageInputs(r.params.id, r.query.stage)),
);
module.exports = router;
