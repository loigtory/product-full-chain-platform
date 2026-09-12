'use strict';
const questions = [
  '本次覆盖的用户与范围是什么？',
  '异常、退出与验收边界是什么？',
];
function template(req, stage, version = 1) {
  return {
    id: `${req.public_id}-${stage}-v${version}`,
    version,
    title: {
      idea: '需求草案',
      req: '需求说明',
      design: '设计方案',
      dev: '开发方案',
    }[stage],
    fields:
      stage === 'idea'
        ? [
            { name: '需求名称', value: req.name },
            { name: '目标', value: req.goal || '' },
            { name: '范围', value: req.scope || '' },
          ]
        : [
            { name: '目标', value: req.goal || '待补充' },
            { name: '范围', value: req.scope || '待补充' },
            {
              name:
                stage === 'req'
                  ? '验收标准'
                  : stage === 'design'
                    ? '设计说明'
                    : '实施说明',
              value: '待补充，尚未确认',
            },
          ],
    confirmed: false,
    review: '待评审',
    comments: [],
  };
}
module.exports = { questions, template };
