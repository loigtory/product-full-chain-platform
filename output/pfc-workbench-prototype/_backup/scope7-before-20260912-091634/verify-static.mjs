import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import js from '@eslint/js';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(scripts).size, scripts.length);
for (const file of scripts) {
  assert.match(file, /^original\/[\w-]+\.js$/);
  new vm.Script(readFileSync(join(root, file), 'utf8'), { filename: file });
}
for (const [, path] of html.matchAll(/<link[^>]*href="([^"]+)"/g)) {
  assert.match(path, /^original\/[\w-]+\.css$/);
  assert.ok(existsSync(join(root, path)));
}
// This standalone browser artifact has different globals from the React/Node workspace.
// Check the touched modules under browser rules without changing the project gate.
const globals = Object.fromEntries(
  [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'history',
    'location',
    'navigator',
    'File',
    'Blob',
    'URL',
    'URLSearchParams',
    'FileReader',
    'Image',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'crypto',
    'requestAnimationFrame',
    'getComputedStyle',
    'console',
    'performance',
  ].map((name) => [name, 'readonly']),
);
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [js.configs.recommended, { languageOptions: { globals } }],
});
const modules = [
  'model',
  'workbench',
  'spaces',
  'actions',
  'run-actions',
  'delivery-actions',
  'app',
  'attachments',
  'conversation',
  'downloads',
];
let errors = 0;
for (const name of modules) {
  const file = join(root, 'original', name + '.js');
  const [result] = await eslint.lintText(readFileSync(file, 'utf8'), {
    filePath: file,
  });
  errors += result.errorCount;
  if (result.errorCount)
    console.error(JSON.stringify({ file: name, messages: result.messages }));
}
assert.equal(
  errors,
  0,
  'Touched prototype modules must pass browser-aware ESLint',
);
console.log(
  JSON.stringify({
    status: 'PASS',
    syntaxScripts: scripts.length,
    lintModules: modules.length,
    externalEntryAssets: 0,
  }),
);
