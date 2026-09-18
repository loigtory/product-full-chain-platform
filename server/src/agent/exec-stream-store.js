'use strict';
// 63 号：EXEC 作业命令级输出流存储（ndjson 追加；jobId 白名单；读时限量）
const fs = require('node:fs');
const path = require('node:path');
const { repo, noLinks } = require('../local/profile');

const ROOT = path.join(repo, '.local/pfc-exec-streams');
const MAX_ENTRIES = 20000; // 单作业流块上限（防失控）
const MAX_BYTES_PER_ENTRY = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fileFor(jobId) {
  if (typeof jobId !== 'string' || !UUID_RE.test(jobId))
    throw Object.assign(new Error('EXEC_STREAM_JOB_INVALID'), { code: 'EXEC_STREAM_JOB_INVALID' });
  fs.mkdirSync(ROOT, { recursive: true });
  return path.join(ROOT, jobId + '.ndjson');
}

function append(jobId, entry) {
  const f = fileFor(jobId);
  const text = typeof entry.text === 'string' ? entry.text.slice(0, MAX_BYTES_PER_ENTRY) : '';
  const line =
    JSON.stringify({
      seq: entry.seq,
      at: new Date().toISOString(),
      stream: entry.stream || 'stdout',
      text,
      type: entry.type || 'chunk',
      exitCode: entry.exitCode,
      timedOut: entry.timedOut,
    }) + '\n';
  noLinks(f);
  fs.appendFileSync(f, line, 'utf8');
}

function read(jobId) {
  const f = fileFor(jobId);
  if (!fs.existsSync(f)) return { jobId, chunks: [], closed: false };
  const lines = fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter((x) => x.trim())
    .slice(-MAX_ENTRIES);
  const chunks = [];
  let exit = null;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.type === 'exit') {
        exit = { exitCode: e.exitCode, timedOut: e.timedOut };
        continue;
      }
      chunks.push({ seq: e.seq, at: e.at, stream: e.stream, text: e.text });
    } catch {
      /* 坏行忽略（只读展示） */
    }
  }
  return { jobId, chunks, closed: !!exit, exit };
}

module.exports = { ROOT, append, read, fileFor };
