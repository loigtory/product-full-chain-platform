import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
export const root = dirname(fileURLToPath(import.meta.url));
if (
  process.env.PFC_FLOW_EVIDENCE_DIR !==
  'docs/quality-gate/reports/m2c-3-governance-20260913/flow'
)
  throw Error('EXPLICIT_EVIDENCE_TARGET_REQUIRED');
export const evidence = resolve(process.env.PFC_FLOW_EVIDENCE_DIR);
export const referenceEvidence = resolve(
  root,
  '../../docs/quality-gate/reports/flow-prototype-20260912',
);
export async function fixture(label = 'browser') {
  const requests = [],
    errors = [];
  let browser, context;
  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://127.0.0.1').pathname,
    );
    const file = resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    if (
      !file.startsWith(root + sep) ||
      !['.html', '.js', '.css', '.png'].includes(extname(file))
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      response.writeHead(200, {
        'Content-Type': {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.png': 'image/png',
        }[extname(file)],
        'Cache-Control': 'no-store',
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port,
    base = 'http://127.0.0.1:' + port;
  const cleanup = async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    return {
      pid: process.pid,
      port,
      browserClosed: true,
      serverClosed: !server.listening,
      isolatedContextsClosed: true,
      data: 'synthetic browser contexts discarded',
    };
  };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      requests.push({
        url: url.startsWith(base) ? url.slice(base.length) : 'external-blocked',
        method: route.request().method(),
      });
      return url.startsWith(base + '/') ? route.continue() : route.abort();
    });
    await context.addInitScript(() => {
      window.PFC_DATA_MODE = 'local';
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(base, { waitUntil: 'load' });
    await mkdir(evidence, { recursive: true });
    return {
      page,
      browser,
      context,
      base,
      port,
      requests,
      errors,
      cleanup,
      label,
      shot: (name) =>
        page.screenshot({ path: resolve(evidence, name + '.png') }),
      save: (name, data) =>
        writeFile(
          resolve(evidence, name + '.json'),
          JSON.stringify(data, null, 2) + '\n',
        ),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function ordinaryPage(page, stage = 'req') {
  await page.evaluate((stage) => {
    const P = window.PFC;
    P.now = () => 1799836800000;
    P.s.reqs = {};
    const r = P.makeRequirement(
      'CODEx_TEST_FLOW_REFERENCE',
      '合成参考目标',
      '合成参考范围',
      stage,
    );
    r.owner = '合成负责人';
    P.s.reqs[r.id] = r;
    P.s.ui.req = r.id;
    P.s.ui.stage = stage;
    P.s.ui.route = 'work';
    P.s.ui.panel = 'canvas';
    P.s.ui.artifactStage = stage;
    P.s.ui.version = null;
    P.go({});
  }, stage);
}
export async function shellSnapshot(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [
        '.work-layout',
        '.ctx-rail',
        '.chat-main',
        '.side-panel',
        '.composer',
      ].map((s) => {
        const el = document.querySelector(s),
          c = getComputedStyle(el),
          r = el.getBoundingClientRect();
        return [
          s,
          {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            font: c.fontFamily,
            size: c.fontSize,
            color: c.color,
            background: c.backgroundColor,
          },
        ];
      }),
    ),
  );
}
if (process.argv.includes('--baseline')) {
  const f = await fixture('reference');
  try {
    const snapshots = {};
    for (const width of [1280, 1440, 1920]) {
      await f.page.setViewportSize({ width, height: 960 });
      await ordinaryPage(f.page);
      snapshots[width] = await shellSnapshot(f.page);
      await f.shot('reference-' + width);
    }
    await f.save('reference-shell', snapshots);
    console.log(
      JSON.stringify({
        status: 'PASS',
        referenceWidths: Object.keys(snapshots),
        errors: f.errors,
      }),
    );
  } finally {
    console.log(JSON.stringify({ cleanup: await f.cleanup() }));
  }
}
