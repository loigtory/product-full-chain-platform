'use strict';
const access = require('../access');
const repo = require('../persistence/release-plans');
async function guard(c, d, x, q, operation, input) {
  if (d.targetVersion !== '006' || (!q.closed_at && q.stage !== 'observe'))
    return;
  if (['message.sent', 'message.stopped'].includes(operation))
    return { protected: true };
  if (
    (operation === 'material.created' && input.usage === 'attachment') ||
    (operation === 'material.impact' && input.decision === 'exclude') ||
    operation === 'material.replaced'
  ) {
    const before = await repo.materialSnapshot(c, d, x, q);
    const versions = await repo.versionStaleness(c, d, x, q);
    return {
      protected: true,
      after: async () => {
        const after = await repo.materialSnapshot(c, d, x, q);
        if (
          operation === 'material.replaced' &&
          after.some(
            (m) =>
              m.usage !== 'attachment' &&
              before.find((v) => v.id === m.id)?.version !== m.version,
          )
        )
          access.fail('RELEASE_PHASE_LOCKED', 409);
        await repo.restoreStaleness(c, d, x, q, versions);
      },
    };
  }
  access.fail(
    'RELEASE_PHASE_LOCKED',
    409,
    q.closed_at
      ? '需求已结案；后续业务变更请创建关联新需求'
      : '已登记成功发布；业务变更须由Owner返回修复',
  );
}
module.exports = { guard };
