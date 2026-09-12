import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const adapterRoot = path.resolve('packages/codex-adapter');
const manifest = JSON.parse(
  await readFile(path.join(adapterRoot, 'app-server-protocol.json'), 'utf8'),
);
if (
  manifest.schemaVersion !== '1.0.0' ||
  !/^\d+\.\d+\.\d+$/.test(manifest.codexCliVersion) ||
  !/^codex-app-server\/\d+\.\d+$/.test(manifest.compatibleHarness) ||
  !/^src\/generated\/app-server-\d+\.\d+\.\d+$/.test(
    manifest.generatedDirectory,
  )
) {
  throw new Error('CODEX_PROTOCOL_MANIFEST_INVALID');
}

const generatedRoot = path.resolve(adapterRoot, manifest.generatedDirectory);
if (!generatedRoot.startsWith(`${adapterRoot}${path.sep}`)) {
  throw new Error('CODEX_PROTOCOL_PATH_INVALID');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    }),
  );
  return nested.flat();
}

const files = (await walk(generatedRoot)).sort();
if (
  files.length !== manifest.generatedFileCount ||
  files.some((file) => path.extname(file) !== '.ts')
) {
  throw new Error('CODEX_PROTOCOL_FILE_SET_DRIFT');
}

const digest = createHash('sha256');
for (const file of files) {
  const relative = path.relative(generatedRoot, file).replaceAll('\\', '/');
  const content = await readFile(file);
  digest.update(relative);
  digest.update('\0');
  digest.update(content);
  digest.update('\0');
}
const actualBundleSha256 = digest.digest('hex');
if (actualBundleSha256 !== manifest.formattedBundleSha256) {
  throw new Error(`CODEX_PROTOCOL_CONTENT_DRIFT:${actualBundleSha256}`);
}

const adapter = await readFile(
  path.join(adapterRoot, 'src/app-server-adapter.ts'),
  'utf8',
);
const bindingImportRoot = manifest.generatedDirectory.replace(/^src\//, '');
for (const required of [
  'InitializeParams.ts',
  'v2/ThreadStartParams.ts',
  'v2/TurnStartParams.ts',
]) {
  if (!adapter.includes(`${bindingImportRoot}/${required}`)) {
    throw new Error(`CODEX_PROTOCOL_BINDING_NOT_USED:${required}`);
  }
}

console.log(
  `CODEX_PROTOCOL_OK version=${manifest.codexCliVersion} files=${files.length}`,
);
