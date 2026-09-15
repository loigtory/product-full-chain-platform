'use strict';
const express = require('express');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const budget = require('../agent/budget');
const router = express.Router();

const AUTHORIZATION_PATH = path.resolve(
  'docs/quality-gate/reports/ai-tools-integration-20260914/context-exception-confirmation-20260914.json',
);

function authorizationState() {
  try {
    const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
    if (auth?.status === 'USER_CONFIRMED')
      return { status: 'USER_CONFIRMED', sourceBytes: auth.source?.bytes ?? null };
    return { status: auth?.status || 'NOT_CONFIRMED' };
  } catch {
    return { status: 'NOT_FOUND' };
  }
}

function approvedSources() {
  try {
    const auth = JSON.parse(readFileSync(AUTHORIZATION_PATH, 'utf8'));
    if (auth?.status === 'USER_CONFIRMED' && auth?.source) return [auth.source];
  } catch {
    /* 无已确认指令源 */
  }
  return [];
}

// 非敏感连接状态；不返回二进制路径、token 或连接串。
router.get('/status', (req, res) => {
  let schemaVersion = null;
  try {
    schemaVersion = require('../runtime').db()?.targetVersion || null;
  } catch {
    schemaVersion = null;
  }
  const capable = !!process.env.PFC_CODEX_BINARY;
  res.json({
    mode: 'real',
    provider: 'codex',
    expectedVersion: '0.154.0',
    configured: !!process.env.PFC_CODEX_BINARY,
    binary: !!process.env.PFC_CODEX_BINARY,
    cwdConfigured: !!process.env.PFC_CODEX_PREFLIGHT_CWD,
    connectionFingerprintSet: !!process.env.PFC_CODEX_CONNECTION_SHA256,
    authorization: authorizationState(),
    schemaVersion,
    // exec 工具入口能力：真实 agent 连接 + agent_jobs schema（007）就绪。
    // 前端据此决定是否展示"开发执行"入口（006 环境不展示，避免无效作业）。
    execCapable: capable && schemaVersion === '007',
    capable,
    budget: budget.snapshot(),
  });
});

// 各阶段 AI 能力清单（只读声明）：前端"本阶段启用能力"面板据此展示真实配置；
// worker 按阶段注入 guide 与期望 skill。不触发任何模型调用。
router.get('/stage-capabilities', (req, res) => {
  const caps = require('../agent/stage-capabilities');
  res.json({ stages: caps.all() });
});

// 只读预检：验证 CLI 版本、账号模式、连接指纹与隔离配置；不发起模型生成。
router.post('/preflight', async (req, res, next) => {
  try {
    const binary = process.env.PFC_CODEX_BINARY;
    if (!binary)
      return res
        .status(409)
        .json({ ok: false, code: 'CONNECTION_UNAVAILABLE' });
    const { preflight } = await import('../agent/protocol.mjs');
    const result = await preflight({
      binary,
      expectedSha256: process.env.PFC_CODEX_BINARY_SHA256 || undefined,
      cwd: process.env.PFC_CODEX_PREFLIGHT_CWD,
      expectedConnectionFingerprint:
        process.env.PFC_CODEX_CONNECTION_SHA256 || undefined,
      approvedInstructionSources: approvedSources(),
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
