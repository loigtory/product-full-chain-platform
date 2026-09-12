import { describe, expect, it } from 'vitest';

import { normalizeDetectedToolVersion } from '../../apps/bridge/src/tool-version.ts';
import { codexHarnessCompatible } from '../../packages/persistence/src/bridge-capability-evidence.ts';

describe('M2 Codex protocol version boundary', () => {
  it('normalizes CLI version output before persisting Bridge metadata', () => {
    expect(normalizeDetectedToolVersion('codex-cli 0.153.4\n')).toBe('0.153.4');
    expect(normalizeDetectedToolVersion('Zed 0.205.7')).toBe('0.205.7');
    expect(normalizeDetectedToolVersion('unknown build')).toBeNull();
  });

  it('requires the registered Skill to support the Bridge Codex major/minor', () => {
    expect(codexHarnessCompatible(['codex-app-server/0.153'], '0.153.4')).toBe(
      true,
    );
    expect(codexHarnessCompatible(['codex-app-server/0.148'], '0.153.4')).toBe(
      false,
    );
    expect(codexHarnessCompatible([], '0.153.4')).toBe(false);
    expect(codexHarnessCompatible(['codex-app-server/0.153'], null)).toBe(
      false,
    );
  });
});
