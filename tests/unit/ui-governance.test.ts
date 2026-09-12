import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('UI governance', () => {
  it('keeps the design token source split into three explicit layers', async () => {
    const tokenRoot = path.join(root, 'packages', 'ui', 'src', 'tokens');
    const [primitives, semantic, components] = await Promise.all([
      readFile(path.join(tokenRoot, 'primitives.css'), 'utf8'),
      readFile(path.join(tokenRoot, 'semantic.css'), 'utf8'),
      readFile(path.join(tokenRoot, 'components.css'), 'utf8'),
    ]);

    expect(primitives).toContain('--pfc-blue-600');
    expect(semantic).toContain('--pfc-color-primary: var(--pfc-blue-600)');
    expect(components).toContain('--pfc-button-bg: var(--pfc-color-primary)');
    expect(primitives).toContain('--pfc-layout-agent-context-width: 248px');
    expect(semantic).toContain(
      '--pfc-color-agent-workspace: var(--pfc-gray-50)',
    );
    expect(components).toContain(
      '--pfc-agent-context-width: var(--pfc-layout-agent-context-width)',
    );
  });

  it('locks the UI-R11 reference typography and dense workbench metrics into tokens', async () => {
    const tokenRoot = path.join(root, 'packages', 'ui', 'src', 'tokens');
    const [primitives, semantic, components] = await Promise.all([
      readFile(path.join(tokenRoot, 'primitives.css'), 'utf8'),
      readFile(path.join(tokenRoot, 'semantic.css'), 'utf8'),
      readFile(path.join(tokenRoot, 'components.css'), 'utf8'),
    ]);

    expect(primitives).toContain(
      "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', -apple-system",
    );
    expect(semantic).toContain(
      '--pfc-reference-font-size-control: var(--pfc-font-size-14)',
    );
    expect(semantic).toContain(
      '--pfc-reference-font-weight-control: var(--pfc-font-weight-regular)',
    );
    expect(semantic).toContain(
      '--pfc-reference-font-weight-table-header: var(--pfc-font-weight-medium)',
    );
    expect(semantic).toContain(
      '--pfc-reference-size-table-row: var(--pfc-size-11-25)',
    );
    expect(components).toContain(
      '--pfc-reference-control-height: var(--pfc-reference-size-control)',
    );
    expect(components).toContain(
      '--pfc-reference-row-height: var(--pfc-reference-size-table-row)',
    );
    expect(components).toContain('--pfc-reference-table-cell-padding-x: var(');
  });

  it('keeps UI-R12 two-line operations rows on the shared reference scale', async () => {
    const tokenRoot = path.join(root, 'packages', 'ui', 'src', 'tokens');
    const [semantic, components] = await Promise.all([
      readFile(path.join(tokenRoot, 'semantic.css'), 'utf8'),
      readFile(path.join(tokenRoot, 'components.css'), 'utf8'),
    ]);

    expect(semantic).toContain(
      '--pfc-reference-size-operation-row: var(--pfc-size-14)',
    );
    expect(components).toContain(
      '--pfc-reference-operation-row-height: var(--pfc-reference-size-operation-row)',
    );
  });

  it('keeps business CSS free of raw visual-system values', async () => {
    const css = await readFile(
      path.join(root, 'apps', 'web', 'src', 'styles.css'),
      'utf8',
    );
    const findings = css.split('\n').flatMap((line, index) => {
      const declaration = line.trim();
      const value = declaration.split(':').slice(1).join(':').trim();
      const rawColor = /#[0-9a-f]{3,8}\b|\brgba?\(/i.test(declaration);
      const rawFont = declaration.startsWith('font-family:');
      const rawTypography =
        (declaration.startsWith('font-size:') ||
          declaration.startsWith('line-height:')) &&
        !value.startsWith('var(') &&
        value !== 'normal';
      const rawRadius =
        declaration.startsWith('border-radius:') &&
        !value.startsWith('var(') &&
        !value.startsWith('0');
      const rawShadow =
        declaration.startsWith('box-shadow:') &&
        !value.startsWith('var(') &&
        !value.startsWith('none');
      const rawMotion =
        (declaration.startsWith('transition') ||
          declaration.startsWith('animation')) &&
        /\b\d+(?:\.\d+)?m?s\b/i.test(value);

      return rawColor ||
        rawFont ||
        rawTypography ||
        rawRadius ||
        rawShadow ||
        rawMotion
        ? [`${index + 1}:${declaration}`]
        : [];
    });
    expect(findings).toEqual([]);
  });
});
