const terminalStatuses = {
  已完成: 'SUCCEEDED',
  失败: 'FAILED',
  已取消: 'CANCELLED',
  状态待核验: 'UNKNOWN',
} as const;

export function parseM2BrowserExpectation(args: readonly string[]): {
  runId: string;
  expectedTerminalLabel: keyof typeof terminalStatuses;
  expectedTerminalStatus: (typeof terminalStatuses)[keyof typeof terminalStatuses];
} {
  const positionals = args.filter((value) => !value.startsWith('--'));
  const terminalArguments = args.filter((value) =>
    value.startsWith('--expected-terminal='),
  );
  const unknownOptions = args.filter(
    (value) =>
      value.startsWith('--') && !value.startsWith('--expected-terminal='),
  );
  if (
    positionals.length > 1 ||
    terminalArguments.length > 1 ||
    unknownOptions.length
  ) {
    throw new Error('M2_BROWSER_ARGUMENTS_INVALID');
  }
  const expectedTerminalLabel = (
    terminalArguments[0]?.slice('--expected-terminal='.length) || '已完成'
  ).trim();
  if (!(expectedTerminalLabel in terminalStatuses)) {
    throw new Error('M2_BROWSER_EXPECTED_TERMINAL_INVALID');
  }
  const label = expectedTerminalLabel as keyof typeof terminalStatuses;
  return {
    runId: positionals[0]?.trim() ?? '',
    expectedTerminalLabel: label,
    expectedTerminalStatus: terminalStatuses[label],
  };
}
