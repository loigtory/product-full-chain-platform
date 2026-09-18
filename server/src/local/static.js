'use strict';
const fs = require('node:fs');
const { resolve } = require('node:path');
const { repo, noLinks } = require('./profile');
function source() {
  const root = resolve(repo, 'output/pfc-workbench-prototype');
  const html = fs.readFileSync(resolve(root, 'index.html'), 'utf8');
  const paths = [
    ...html.matchAll(
      /<(?:script|link)\b[^>]*(?:src|href)="(original\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:js|css))"/g,
    ),
  ].map((m) => m[1]);
  return { root, html, paths: new Set(paths) };
}
function middleware(req, res, next) {
  if (!require('./profile').current()) return next();
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const s = source();
  const raw = req.originalUrl.split('?')[0];
  if (raw === '/' || raw === '/index.html') {
    return res
      .type('html')
      .send(
        s.html.replace(
          '<head>',
          '<head>\n<script src="/local-config.js"></script>',
        ),
      );
  }
  if (raw === '/local-config.js')
    return res
      .type('js')
      .send(
        "Object.defineProperty(window,'PFC_LOCAL_PERSONAL',{value:true});window.PFC_DATA_MODE='api';window.PFC_API_BASE=location.origin;",
      );
  const key = raw.slice(1);
  if (s.paths.has(key)) return res.sendFile(noLinks(resolve(s.root, key)));
  return next();
}
module.exports = { source, middleware };
