import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredFiles = [
  'AGENTS.md',
  '.quality-gate/profile.json',
  '.env.example',
  '.gitignore',
  '.node-version',
  'package.json',
];

const missing = requiredFiles.filter((file) => {
  try {
    readFileSync(resolve(file));
    return false;
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  throw new Error(`BOOTSTRAP_CONFIG_MISSING: ${missing.join(', ')}`);
}

if (process.versions.node.split('.')[0] !== '24') {
  throw new Error(
    `NODE_VERSION_MISMATCH: expected 24.x, received ${process.versions.node}`,
  );
}

const profile = JSON.parse(
  readFileSync(resolve('.quality-gate/profile.json'), 'utf8'),
);
if (
  profile.defaultPolicy !== 'fail-closed' ||
  profile.environment.externalWrites !== false
) {
  throw new Error('QUALITY_PROFILE_UNSAFE');
}

console.log(
  `BOOTSTRAP_CONFIG_OK node=${process.versions.node} policy=${profile.defaultPolicy}`,
);
