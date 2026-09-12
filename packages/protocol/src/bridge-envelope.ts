export const BRIDGE_PROTOCOL_VERSION = 'pfc-bridge/1' as const;

export const BRIDGE_MESSAGE_KINDS = [
  'HEARTBEAT',
  'COMMAND_ACKNOWLEDGEMENT',
  'RUN_EVENTS',
  'CAPABILITY_SNAPSHOT',
] as const;

export type BridgeMessageKind = (typeof BRIDGE_MESSAGE_KINDS)[number];

export type BridgeEnvelope = Readonly<{
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  messageId: string;
  bridgeId: string;
  sentAt: string;
  nonce: string;
  kind: BridgeMessageKind;
  payload: Readonly<Record<string, unknown>>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error(`BRIDGE_${field}_INVALID`);
  }
  return value;
}

export function parseBridgeEnvelope(value: unknown): BridgeEnvelope {
  if (!record(value)) throw new Error('BRIDGE_ENVELOPE_INVALID');
  if (value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw new Error('BRIDGE_PROTOCOL_VERSION_UNSUPPORTED');
  }
  const kind = boundedString(value.kind, 'KIND');
  if (!BRIDGE_MESSAGE_KINDS.includes(kind as BridgeMessageKind)) {
    throw new Error('BRIDGE_KIND_INVALID');
  }
  const sentAt = boundedString(value.sentAt, 'SENT_AT');
  if (Number.isNaN(Date.parse(sentAt)))
    throw new Error('BRIDGE_SENT_AT_INVALID');
  if (!record(value.payload)) throw new Error('BRIDGE_PAYLOAD_INVALID');
  return value as BridgeEnvelope;
}

export function eventDedupeKey(input: {
  bridgeId: string;
  runId: string;
  sourceEventId: string;
}): string {
  const values = [input.bridgeId, input.runId, input.sourceEventId].map(
    (value) => boundedString(value, 'DEDUPE_PART'),
  );
  if (values.some((value) => value.includes(':'))) {
    throw new Error('BRIDGE_DEDUPE_PART_INVALID');
  }
  return values.join(':');
}
