import type { LifecycleErrorCode } from '@pfc/contracts';

import { DomainRuleViolation } from './errors.ts';

export type McpReadLifecycleStatus =
  | 'REQUESTED'
  | 'QUEUED'
  | 'LEASED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNKNOWN';

const transitions: Readonly<
  Record<McpReadLifecycleStatus, readonly McpReadLifecycleStatus[]>
> = {
  REQUESTED: ['QUEUED', 'FAILED'],
  QUEUED: ['LEASED', 'FAILED'],
  LEASED: ['RUNNING', 'FAILED', 'UNKNOWN'],
  RUNNING: ['COMPLETED', 'FAILED', 'UNKNOWN'],
  COMPLETED: [],
  FAILED: [],
  UNKNOWN: ['COMPLETED', 'FAILED', 'UNKNOWN'],
};

function fail(code: LifecycleErrorCode): never {
  throw new DomainRuleViolation(code, code);
}

function serializedInputBytes(
  input: Readonly<Record<string, unknown>>,
): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return fail('MCP_READ_INPUT_INVALID');
  }
  if (!serialized || Array.isArray(input))
    return fail('MCP_READ_INPUT_INVALID');
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertMcpReadAllowed(input: {
  registration: Readonly<{
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    effect: 'READ_ONLY';
    serverName: string;
    toolName: string;
    inputSchemaHash: string;
    configFingerprint: string;
    allowedTeamIds: readonly string[];
    allowedRequirementIds: readonly string[];
    maxInputBytes: number;
    maxOutputBytes: number;
    timeoutMs: number;
  }>;
  runtime: Readonly<{
    state: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
    serverName: string;
    toolName: string;
    inputSchemaHash: string;
    configFingerprint: string;
    runtimeStatus: 'CONNECTED' | 'UNAVAILABLE' | 'UNVERIFIED';
    authStatus: 'UNKNOWN' | 'UNSUPPORTED' | 'READY' | 'REQUIRED';
    readOnlyHint: boolean | null;
  }>;
  teamId: string;
  requirementId: string;
  input: Readonly<Record<string, unknown>>;
  sensitivity: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  transmissionAuthorized: boolean;
  activeRequestCount: number;
}): Readonly<{
  inputBytes: number;
  timeoutMs: number;
  maxOutputBytes: number;
}> {
  const { registration, runtime } = input;
  if (registration.status !== 'ACTIVE' || registration.effect !== 'READ_ONLY') {
    return fail('MCP_READ_NOT_ALLOWED');
  }
  if (
    runtime.state !== 'AVAILABLE' ||
    runtime.runtimeStatus !== 'CONNECTED' ||
    registration.serverName !== runtime.serverName ||
    registration.toolName !== runtime.toolName ||
    registration.inputSchemaHash.toLowerCase() !==
      runtime.inputSchemaHash.toLowerCase() ||
    registration.configFingerprint.toLowerCase() !==
      runtime.configFingerprint.toLowerCase()
  ) {
    return fail('MCP_CAPABILITY_DRIFTED');
  }
  if (
    !registration.allowedTeamIds.includes(input.teamId) ||
    !registration.allowedRequirementIds.includes(input.requirementId)
  ) {
    return fail('MCP_READ_NOT_ALLOWED');
  }
  if (input.sensitivity === 'RESTRICTED' && !input.transmissionAuthorized) {
    return fail('MCP_TRANSMISSION_AUTHORIZATION_REQUIRED');
  }
  if (
    !Number.isInteger(input.activeRequestCount) ||
    input.activeRequestCount > 0
  ) {
    return fail('MCP_READ_CONCURRENCY_LIMIT');
  }
  const inputBytes = serializedInputBytes(input.input);
  if (
    inputBytes > Math.min(registration.maxInputBytes, 32_768) ||
    registration.timeoutMs < 1 ||
    registration.timeoutMs > 30_000 ||
    registration.maxOutputBytes < 1 ||
    registration.maxOutputBytes > 262_144
  ) {
    return fail('MCP_READ_LIMIT_EXCEEDED');
  }
  return {
    inputBytes,
    timeoutMs: registration.timeoutMs,
    maxOutputBytes: registration.maxOutputBytes,
  };
}

export function transitionMcpRead(
  current: McpReadLifecycleStatus,
  next: McpReadLifecycleStatus,
): McpReadLifecycleStatus {
  if (!transitions[current].includes(next)) {
    return fail(
      current === 'UNKNOWN'
        ? 'MCP_RESULT_UNKNOWN'
        : 'MCP_READ_TRANSITION_INVALID',
    );
  }
  return next;
}
