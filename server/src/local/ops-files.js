'use strict';
const fs = require('node:fs');
const { resolve, relative, isAbsolute } = require('node:path');
const { execFileSync, execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID, createHash } = require('node:crypto');
const { repo, noLinks, fault } = require('./profile');
const system = process.env.SystemRoot || 'C:\\Windows';
const execute = promisify(execFile);
const powershell = resolve(
  process.env.ProgramFiles || 'C:\\Program Files',
  'PowerShell/7/pwsh.exe',
);
let userSid;
function sid() {
  if (!userSid) {
    const output = execFileSync(
      resolve(system, 'System32/whoami.exe'),
      ['/user', '/fo', 'csv', '/nh'],
      { windowsHide: true, encoding: 'utf8', timeout: 5000 },
    );
    userSid = output.match(/S-1-5-21-(?:\d+-){3}\d+/)?.[0];
    if (!userSid) throw fault('LOCAL_ACL_IDENTITY_UNAVAILABLE');
  }
  return userSid;
}
function assertPrivate(path) {
  noLinks(path);
  if (process.platform !== 'win32') throw fault('WINDOWS_REQUIRED');
  let data;
  try {
    const output = execFileSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:PFC_ACL_TARGET; @($a.Access | ForEach-Object { @{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; type=$_.AccessControlType.ToString()} }) | ConvertTo-Json -Compress",
      ],
      {
        env: { ...process.env, PFC_ACL_TARGET: path },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe',
      },
    );
    data = JSON.parse(output);
  } catch {
    throw fault('LOCAL_ACL_CHECK_FAILED');
  }
  const entries = Array.isArray(data) ? data : [data],
    allowed = new Set([sid(), 'S-1-5-18', 'S-1-5-32-544']);
  if (
    !entries.some((e) => e.sid === sid() && e.type === 'Allow') ||
    entries.some((e) => e.type !== 'Allow' || !allowed.has(e.sid))
  )
    throw fault('LOCAL_ACL_NOT_PRIVATE');
}
function privateDirectory(path) {
  noLinks(path);
  if (fs.existsSync(path)) {
    assertPrivate(path);
    return;
  }
  fs.mkdirSync(path, { recursive: true });
  try {
    execFileSync(
      resolve(system, 'System32/icacls.exe'),
      [
        path,
        '/inheritance:r',
        '/grant:r',
        '*' + sid() + ':(OI)(CI)F',
        '*S-1-5-18:(OI)(CI)F',
        '*S-1-5-32-544:(OI)(CI)F',
      ],
      { windowsHide: true, timeout: 10000, stdio: 'pipe' },
    );
    assertPrivate(path);
  } catch (e) {
    throw fault(
      e.code?.startsWith('LOCAL_') ? e.code : 'LOCAL_ACL_SETUP_FAILED',
    );
  }
}
function atomicJson(path, value) {
  noLinks(path);
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
    });
    fs.renameSync(temp, path);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function readJson(path, max = 65536) {
  noLinks(path);
  if (fs.statSync(path).size > max) throw fault('LOCAL_FILE_TOO_LARGE');
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    throw fault('LOCAL_FILE_INVALID');
  }
}
function manifest(root, maxBytes = 1073741824) {
  noLinks(root);
  const files = [];
  let bytes = 0;
  const visit = (path) => {
    noLinks(path);
    const s = fs.lstatSync(path);
    if (s.isDirectory())
      for (const name of fs.readdirSync(path).sort())
        visit(resolve(path, name));
    else {
      if (!s.isFile()) throw fault('LOCAL_FILE_INVALID');
      bytes += s.size;
      if (bytes > maxBytes || files.length >= 20000)
        throw fault('LOCAL_STORAGE_LIMIT');
      const digest = createHash('sha256'),
        chunk = Buffer.alloc(65536),
        fd = fs.openSync(path, 'r');
      try {
        let length;
        while ((length = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0)
          digest.update(chunk.subarray(0, length));
      } finally {
        fs.closeSync(fd);
      }
      files.push({
        path: relative(root, path).replace(/\\/g, '/'),
        size: s.size,
        sha256: digest.digest('hex'),
      });
    }
  };
  if (fs.existsSync(root)) visit(root);
  return { files, bytes };
}
function safeChild(root, name) {
  if (
    typeof name !== 'string' ||
    /[\\:\0]/.test(name) ||
    name.startsWith('/') ||
    name.split('/').some((x) => !x || x === '.' || x === '..')
  )
    throw fault('LOCAL_PATH_NOT_AUTHORIZED');
  const child = resolve(root, name),
    rel = relative(root, child);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw fault('LOCAL_PATH_NOT_AUTHORIZED');
  return noLinks(child);
}
async function pgTool(name, args, env = {}) {
  if (!['initdb', 'pg_ctl', 'pg_dump', 'pg_restore', 'psql'].includes(name))
    throw fault('LOCAL_TOOL_FORBIDDEN');
  const exe = resolve(repo, '.tools/postgresql-18.6/bin', name + '.exe');
  if (!fs.existsSync(exe)) throw fault('PG_TOOL_MISSING');
  const safeEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^PG|^DATABASE_URL$|^PFC_/.test(key),
    ),
  );
  try {
    const executable = pgPath(exe);
    if (name === 'pg_ctl') {
      // On Windows a daemon can inherit execFile pipes after pg_ctl has exited.
      // Wait for this exact control process, without a pipe kept open by postgres.
      await new Promise((ok, no) => {
        const child = spawn(executable, args, {
          cwd: require('node:path').dirname(executable),
          env: { ...safeEnv, ...env },
          windowsHide: true,
          shell: false,
          stdio: 'ignore',
        });
        const timer = setTimeout(() => {
          child.kill();
          no(fault('PG_CONTROL_TIMEOUT'));
        }, 120000);
        child.once('error', (e) => {
          clearTimeout(timer);
          no(e);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          code === 0 ? ok() : no(fault('PG_CONTROL_FAILED'));
        });
      });
      return '';
    }
    const r = await execute(executable, args, {
      cwd: require('node:path').dirname(executable),
      env: { ...safeEnv, ...env },
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
    });
    return r.stdout;
  } catch (e) {
    const error = fault('PG_' + name.toUpperCase() + '_FAILED');
    // Diagnostic stays in memory; CLI/logs expose only the code. Strip all supplied secret values.
    let diagnostic = String(e.stderr || '').replace(
      /postgres(?:ql)?:\/\/\S+/g,
      '[connection redacted]',
    );
    for (const [key, value] of Object.entries(env))
      if (/PASSWORD|SECRET/.test(key) && value)
        diagnostic = diagnostic.split(value).join('[redacted]');
    error.diagnostic = diagnostic.slice(0, 4000);
    throw error;
  }
}
function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw fault('LOCAL_INSTANCE_INVALID');
  try {
    const output = execFileSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$env:PFC_INSPECT_PID); if($p){ @{pid=$p.ProcessId; exe=$p.ExecutablePath; started=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress }",
      ],
      {
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, PFC_INSPECT_PID: String(pid) },
        timeout: 10000,
        stdio: 'pipe',
      },
    );
    return output.trim() ? JSON.parse(output) : null;
  } catch {
    throw fault('LOCAL_PROCESS_CHECK_FAILED');
  }
}
function pgPath(path) {
  noLinks(path);
  const alias = resolve(process.env.LOCALAPPDATA || '', 'PFCPlatform');
  if (
    !fs.existsSync(alias) ||
    fs.realpathSync(alias).toLowerCase() !== fs.realpathSync(repo).toLowerCase()
  )
    throw fault('PG_JUNCTION_MISMATCH');
  return resolve(alias, relative(repo, path));
}
module.exports = {
  assertPrivate,
  privateDirectory,
  atomicJson,
  readJson,
  manifest,
  safeChild,
  pgTool,
  pgPath,
  processInfo,
};
