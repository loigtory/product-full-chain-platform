import { describe, expect, it } from 'vitest';

import { parseM2BrowserExpectation } from '../../scripts/m2-local-acceptance/browser-expectation.ts';

describe('M2 browser acceptance expectation', () => {
  it('defaults to a successful terminal run', () => {
    expect(parseM2BrowserExpectation([])).toEqual({
      runId: '',
      expectedTerminalLabel: '已完成',
      expectedTerminalStatus: 'SUCCEEDED',
    });
  });

  it('allows an explicit existing run with an expected blocked terminal', () => {
    expect(
      parseM2BrowserExpectation([
        'CODEx_TEST_M2_R1_REAL_20260906_agent-run-123',
        '--expected-terminal=失败',
      ]),
    ).toEqual({
      runId: 'CODEx_TEST_M2_R1_REAL_20260906_agent-run-123',
      expectedTerminalLabel: '失败',
      expectedTerminalStatus: 'FAILED',
    });
  });

  it('rejects unknown labels or multiple run ids', () => {
    expect(() =>
      parseM2BrowserExpectation(['--expected-terminal=任意']),
    ).toThrow('M2_BROWSER_EXPECTED_TERMINAL_INVALID');
    expect(() => parseM2BrowserExpectation(['run-1', 'run-2'])).toThrow(
      'M2_BROWSER_ARGUMENTS_INVALID',
    );
  });
});
