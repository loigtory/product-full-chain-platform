import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.join(process.cwd(), 'apps', 'web', 'src');

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return cssFiles(target);
      return entry.isFile() && entry.name.endsWith('.css') ? [target] : [];
    }),
  );
  return nested.flat();
}

function declarationValue(declaration) {
  return declaration.split(':').slice(1).join(':').trim();
}

function findingReason(declaration) {
  const value = declarationValue(declaration);
  if (/#[0-9a-f]{3,8}\b|\brgba?\(/i.test(declaration)) return 'raw-color';
  if (declaration.startsWith('font-family:')) return 'raw-font-family';
  if (
    (declaration.startsWith('font-size:') ||
      declaration.startsWith('line-height:')) &&
    !value.startsWith('var(') &&
    value !== 'normal'
  ) {
    return 'raw-typography';
  }
  if (
    declaration.startsWith('border-radius:') &&
    !value.startsWith('var(') &&
    !value.startsWith('0')
  ) {
    return 'raw-radius';
  }
  if (
    declaration.startsWith('box-shadow:') &&
    !value.startsWith('var(') &&
    !value.startsWith('none')
  ) {
    return 'raw-shadow';
  }
  if (
    (declaration.startsWith('transition') ||
      declaration.startsWith('animation')) &&
    /\b\d+(?:\.\d+)?m?s\b/i.test(value)
  ) {
    return 'raw-motion';
  }
  return null;
}

const findings = [];
for (const file of await cssFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  source.split('\n').forEach((line, index) => {
    const declaration = line.trim();
    const reason = findingReason(declaration);
    if (reason) {
      findings.push(
        `${path.relative(process.cwd(), file)}:${index + 1} ${reason} ${declaration}`,
      );
    }
  });
}

if (findings.length > 0) {
  console.error('UI_GOVERNANCE_FAIL');
  findings.forEach((finding) => console.error(finding));
  process.exit(1);
}

console.log('UI_GOVERNANCE_PASS raw_visual_values=0');
