'use strict';
const { fail, text } = require('../access');
const invalid = () =>
  fail('UNSUPPORTED_PROTOTYPE_SPEC', 400, '原型描述不符合受控组件格式');
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    invalid();
}
function string(value, max = 4000, required = false) {
  try {
    return text(value, max, required);
  } catch {
    invalid();
  }
}
function id(value) {
  if (typeof value !== 'string' || !/^[-A-Za-z0-9_]{1,80}$/.test(value))
    invalid();
  return value;
}
function validate(spec) {
  keys(spec, ['schemaVersion', 'title', 'pages']);
  if (
    spec.schemaVersion !== 1 ||
    Buffer.byteLength(JSON.stringify(spec)) > 262144
  )
    invalid();
  string(spec.title, 160, true);
  if (
    !Array.isArray(spec.pages) ||
    !spec.pages.length ||
    spec.pages.length > 10
  )
    invalid();
  const ids = new Map(),
    actions = [];
  let rows = 0;
  const add = (value, type) => {
    id(value);
    if (ids.has(value)) invalid();
    ids.set(value, type);
  };
  for (const page of spec.pages) {
    keys(page, ['id', 'title', 'nodes']);
    add(page.id, 'page');
    string(page.title, 160, true);
    if (!Array.isArray(page.nodes) || page.nodes.length > 100) invalid();
    for (const node of page.nodes) {
      const common = ['id', 'type', 'ruleId'];
      const fields = {
        section: ['text'],
        text: ['text'],
        field: ['label', 'required', 'value'],
        select: ['label', 'options', 'value', 'required'],
        button: ['text', 'action'],
        table: ['columns', 'rows'],
        dialog: ['text', 'open'],
      };
      if (!Object.hasOwn(fields, node?.type)) invalid();
      keys(node, [...common, ...fields[node.type]]);
      add(node.id, node.type);
      if (node.ruleId !== undefined) id(node.ruleId);
      for (const field of ['text', 'label', 'value'])
        if (node[field] !== undefined) string(node[field]);
      if (['field', 'select'].includes(node.type))
        string(node.label, 160, true);
      if (['text', 'section', 'button', 'dialog'].includes(node.type))
        string(node.text, 4000, true);
      for (const field of ['required', 'open'])
        if (node[field] !== undefined && typeof node[field] !== 'boolean')
          invalid();
      if (node.type === 'select') {
        if (
          !Array.isArray(node.options) ||
          !node.options.length ||
          node.options.length > 100
        )
          invalid();
        node.options.forEach((x) => string(x, 160, true));
        if (node.value !== undefined && !node.options.includes(node.value))
          invalid();
      }
      if (node.type === 'table') {
        if (
          !Array.isArray(node.columns) ||
          !node.columns.length ||
          node.columns.length > 20 ||
          !Array.isArray(node.rows)
        )
          invalid();
        node.columns.forEach((x) => string(x, 160, true));
        rows += node.rows.length;
        if (rows > 500) invalid();
        for (const row of node.rows) {
          if (!Array.isArray(row) || row.length !== node.columns.length)
            invalid();
          row.forEach((x) => string(x, 2000));
        }
      }
      if (node.type === 'button') {
        keys(node.action, ['type', 'target', 'value']);
        if (!['page', 'toggle', 'validate', 'state'].includes(node.action.type))
          invalid();
        id(node.action.target);
        if (node.action.value !== undefined) string(node.action.value);
        actions.push(node.action);
      }
    }
  }
  for (const a of actions) {
    const type = ids.get(a.target);
    if (!type) invalid();
    if (['page', 'validate'].includes(a.type) && type !== 'page') invalid();
    if (
      a.type === 'state' &&
      !['text', 'field', 'select', 'section'].includes(type)
    )
      invalid();
    if (a.type === 'toggle' && type !== 'dialog') invalid();
  }
  return structuredClone(spec);
}
function template(templateId, params = {}) {
  if (!['form-table', 'approval-dialog'].includes(templateId)) invalid();
  keys(params, ['title']);
  const title = string(params.title || '业务候选', 160, true);
  const nodes =
    templateId === 'form-table'
      ? [
          {
            id: 'intro',
            type: 'text',
            text: '填写信息并查看结果',
            ruleId: 'RULE1',
          },
          {
            id: 'name',
            type: 'field',
            label: '名称',
            required: true,
            ruleId: 'RULE1',
          },
          {
            id: 'save',
            type: 'button',
            text: '检查填写内容',
            action: { type: 'validate', target: 'main' },
          },
          {
            id: 'list',
            type: 'table',
            columns: ['名称', '状态'],
            rows: [['示例记录', '待确认']],
          },
        ]
      : [
          { id: 'summary', type: 'text', text: '待确认', ruleId: 'RULE1' },
          {
            id: 'review',
            type: 'button',
            text: '查看确认说明',
            action: { type: 'toggle', target: 'detail' },
          },
          {
            id: 'detail',
            type: 'dialog',
            text: '这是业务交互候选，不会执行真实审批。',
            open: false,
          },
          {
            id: 'confirm',
            type: 'button',
            text: '体验确认',
            action: {
              type: 'state',
              target: 'summary',
              value: '已确认（预览）',
            },
          },
        ];
  return validate({
    schemaVersion: 1,
    title,
    pages: [{ id: 'main', title, nodes }],
  });
}
module.exports = { validate, template };
