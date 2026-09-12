'use strict';
const express = require('express');
const contract = require('../contract');
const router = express.Router();

/* GET /api/contract —— 契约清单（与前端 PFCAPI.api.contract() 对齐，供验证/文档） */
router.get('/', (req, res) => {
  res.json({ contract, note: '对齐《13-M1接口清单》' });
});

module.exports = router;
