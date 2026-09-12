export const MCP_READ_PROTOCOL_VERSION = 'mcp-read/1' as const;
export const MCP_READ_COMMAND_VERSION = 'mcp-read-command/1' as const;
export const MCP_READ_EVENT_VERSION = 'mcp-read-event/1' as const;
export const MCP_READ_CONTEXT_VERSION = 'mcp-read-context/1' as const;

export type McpReadCommand = Readonly<{
  schemaVersion: typeof MCP_READ_COMMAND_VERSION;
  commandId: string;
  commandType: 'EXECUTE_MCP_READ';
  leaseUntil: string;
  attempt: number;
  payload: Readonly<{
    requestId: string;
    sessionId: string;
    turnId: string;
    capabilityId: string;
    serverName: string;
    toolName: string;
    inputSchemaHash: string;
    configFingerprint: string;
    inputHash: string;
  }>;
}>;

export type McpReadContext = Readonly<{
  schemaVersion: typeof MCP_READ_CONTEXT_VERSION;
  commandId: string;
  requestId: string;
  input: Readonly<Record<string, unknown>>;
  sensitivity: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  limits: Readonly<{
    timeoutMs: number;
    maxOutputBytes: number;
  }>;
}>;

export type McpReadEvent = Readonly<{
  schemaVersion: typeof MCP_READ_EVENT_VERSION;
  sourceEventId: string;
  occurredAt: string;
}> &
  (
    | Readonly<{
        eventType: 'MCP_READ_STARTED';
        payload: Readonly<{ requestId: string; threadId: string }>;
      }>
    | Readonly<{
        eventType: 'MCP_READ_COMPLETED';
        payload: Readonly<{
          requestId: string;
          outputSummary: string;
          outputHash: string;
          outputBytes: number;
          truncated: boolean;
          durationMs: number;
          threadId: string;
        }>;
      }>
    | Readonly<{
        eventType: 'MCP_READ_FAILED' | 'MCP_READ_UNKNOWN';
        payload: Readonly<{
          requestId: string;
          reasonCode: string;
          threadId: string | null;
        }>;
      }>
  );

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((item, index) => item !== expected[index])
  ) {
    throw new Error(code);
  }
}

function boundedString(value: unknown, code: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  const normalized = boundedString(value, code, 80);
  if (!/^sha256:[a-f0-9]{64}$/i.test(normalized)) throw new Error(code);
  return normalized;
}

function timestamp(value: unknown, code: string): string {
  const result = boundedString(value, code);
  if (Number.isNaN(Date.parse(result))) throw new Error(code);
  return result;
}

function integer(value: unknown, code: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum)
    throw new Error(code);
  return Number(value);
}

export function parseMcpReadCommand(value: unknown): McpReadCommand {
  if (!record(value)) throw new Error('MCP_READ_COMMAND_INVALID');
  exactFields(
    value,
    [
      'schemaVersion',
      'commandId',
      'commandType',
      'leaseUntil',
      'attempt',
      'payload',
    ],
    'MCP_READ_COMMAND_FIELDS_INVALID',
  );
  if (
    value.schemaVersion !== MCP_READ_COMMAND_VERSION ||
    value.commandType !== 'EXECUTE_MCP_READ'
  ) {
    throw new Error('MCP_READ_COMMAND_VERSION_UNSUPPORTED');
  }
  boundedString(value.commandId, 'MCP_READ_COMMAND_ID_INVALID');
  timestamp(value.leaseUntil, 'MCP_READ_COMMAND_LEASE_INVALID');
  integer(value.attempt, 'MCP_READ_COMMAND_ATTEMPT_INVALID', 1);
  if (!record(value.payload))
    throw new Error('MCP_READ_COMMAND_PAYLOAD_INVALID');
  exactFields(
    value.payload,
    [
      'requestId',
      'sessionId',
      'turnId',
      'capabilityId',
      'serverName',
      'toolName',
      'inputSchemaHash',
      'configFingerprint',
      'inputHash',
    ],
    'MCP_READ_COMMAND_PAYLOAD_FIELDS_INVALID',
  );
  for (const field of [
    'requestId',
    'sessionId',
    'turnId',
    'capabilityId',
    'serverName',
    'toolName',
  ] as const) {
    boundedString(value.payload[field], 'MCP_READ_COMMAND_PAYLOAD_INVALID');
  }
  for (const field of [
    'inputSchemaHash',
    'configFingerprint',
    'inputHash',
  ] as const) {
    hash(value.payload[field], 'MCP_READ_COMMAND_HASH_INVALID');
  }
  return value as unknown as McpReadCommand;
}

export function parseMcpReadContext(value: unknown): McpReadContext {
  if (!record(value)) throw new Error('MCP_READ_CONTEXT_INVALID');
  exactFields(
    value,
    [
      'schemaVersion',
      'commandId',
      'requestId',
      'input',
      'sensitivity',
      'limits',
    ],
    'MCP_READ_CONTEXT_FIELDS_INVALID',
  );
  if (value.schemaVersion !== MCP_READ_CONTEXT_VERSION) {
    throw new Error('MCP_READ_CONTEXT_VERSION_UNSUPPORTED');
  }
  boundedString(value.commandId, 'MCP_READ_COMMAND_ID_INVALID');
  boundedString(value.requestId, 'MCP_READ_REQUEST_ID_INVALID');
  if (!record(value.input)) throw new Error('MCP_READ_INPUT_INVALID');
  if (
    !['PUBLIC', 'INTERNAL', 'RESTRICTED'].includes(String(value.sensitivity))
  ) {
    throw new Error('MCP_READ_SENSITIVITY_INVALID');
  }
  if (!record(value.limits)) throw new Error('MCP_READ_LIMITS_INVALID');
  exactFields(
    value.limits,
    ['timeoutMs', 'maxOutputBytes'],
    'MCP_READ_LIMITS_FIELDS_INVALID',
  );
  integer(value.limits.timeoutMs, 'MCP_READ_TIMEOUT_INVALID', 1);
  integer(value.limits.maxOutputBytes, 'MCP_READ_OUTPUT_LIMIT_INVALID', 1);
  if (
    Number(value.limits.timeoutMs) > 30_000 ||
    Number(value.limits.maxOutputBytes) > 262_144
  ) {
    throw new Error('MCP_READ_LIMIT_EXCEEDED');
  }
  return value as unknown as McpReadContext;
}

export function parseMcpReadEvent(value: unknown): McpReadEvent {
  if (!record(value)) throw new Error('MCP_READ_EVENT_INVALID');
  exactFields(
    value,
    ['schemaVersion', 'sourceEventId', 'eventType', 'occurredAt', 'payload'],
    'MCP_READ_EVENT_FIELDS_INVALID',
  );
  if (
    value.schemaVersion !== MCP_READ_EVENT_VERSION ||
    ![
      'MCP_READ_STARTED',
      'MCP_READ_COMPLETED',
      'MCP_READ_FAILED',
      'MCP_READ_UNKNOWN',
    ].includes(String(value.eventType))
  ) {
    throw new Error('MCP_READ_EVENT_VERSION_UNSUPPORTED');
  }
  boundedString(value.sourceEventId, 'MCP_READ_EVENT_ID_INVALID');
  timestamp(value.occurredAt, 'MCP_READ_EVENT_TIMESTAMP_INVALID');
  if (!record(value.payload)) throw new Error('MCP_READ_EVENT_PAYLOAD_INVALID');
  if (value.eventType === 'MCP_READ_STARTED') {
    exactFields(
      value.payload,
      ['requestId', 'threadId'],
      'MCP_READ_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    boundedString(value.payload.requestId, 'MCP_READ_REQUEST_ID_INVALID');
    boundedString(value.payload.threadId, 'MCP_READ_THREAD_ID_INVALID');
  } else if (value.eventType === 'MCP_READ_COMPLETED') {
    exactFields(
      value.payload,
      [
        'requestId',
        'outputSummary',
        'outputHash',
        'outputBytes',
        'truncated',
        'durationMs',
        'threadId',
      ],
      'MCP_READ_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    boundedString(value.payload.requestId, 'MCP_READ_REQUEST_ID_INVALID');
    boundedString(
      value.payload.outputSummary,
      'MCP_READ_OUTPUT_INVALID',
      16_384,
    );
    hash(value.payload.outputHash, 'MCP_READ_OUTPUT_HASH_INVALID');
    integer(value.payload.outputBytes, 'MCP_READ_OUTPUT_BYTES_INVALID');
    integer(value.payload.durationMs, 'MCP_READ_DURATION_INVALID');
    if (typeof value.payload.truncated !== 'boolean') {
      throw new Error('MCP_READ_TRUNCATION_INVALID');
    }
    boundedString(value.payload.threadId, 'MCP_READ_THREAD_ID_INVALID');
  } else {
    exactFields(
      value.payload,
      ['requestId', 'reasonCode', 'threadId'],
      'MCP_READ_EVENT_PAYLOAD_FIELDS_INVALID',
    );
    boundedString(value.payload.requestId, 'MCP_READ_REQUEST_ID_INVALID');
    boundedString(value.payload.reasonCode, 'MCP_READ_REASON_INVALID');
    if (value.payload.threadId !== null) {
      boundedString(value.payload.threadId, 'MCP_READ_THREAD_ID_INVALID');
    }
  }
  return value as unknown as McpReadEvent;
}
