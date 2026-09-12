import type { AgentRunEventType } from '@pfc/contracts';

import { redactAgentEvidence } from './evidence-redaction.ts';

export type NormalizedAgentEvent = Readonly<{
  eventType: AgentRunEventType;
  summary: Readonly<Record<string, string | number | boolean | null>>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAppServerNotification(
  value: unknown,
  context: { userProfile?: string; workspacePath?: string } = {},
): NormalizedAgentEvent | null {
  if (
    !record(value) ||
    typeof value.method !== 'string' ||
    !record(value.params)
  ) {
    return null;
  }
  const turn = record(value.params.turn) ? value.params.turn : null;
  if (value.method === 'turn/started') {
    return {
      eventType: 'TURN_STARTED',
      summary: {
        threadId:
          typeof value.params.threadId === 'string'
            ? value.params.threadId
            : null,
        turnId: typeof turn?.id === 'string' ? turn.id : null,
      },
    };
  }
  if (value.method === 'turn/completed') {
    const status = typeof turn?.status === 'string' ? turn.status : 'unknown';
    const eventType: AgentRunEventType =
      status === 'completed'
        ? 'RESULT_RECORDED'
        : status === 'interrupted'
          ? 'TURN_INTERRUPTED'
          : 'RUN_FAILED';
    return { eventType, summary: { status } };
  }
  const item = record(value.params.item) ? value.params.item : null;
  const itemId = typeof item?.id === 'string' ? item.id : null;
  if (
    value.method === 'item/started' &&
    item?.type === 'commandExecution' &&
    itemId
  ) {
    return { eventType: 'COMMAND_STARTED', summary: { itemId } };
  }
  if (value.method === 'item/completed' && itemId) {
    if (item?.type === 'commandExecution') {
      return { eventType: 'COMMAND_COMPLETED', summary: { itemId } };
    }
    if (item?.type === 'agentMessage') {
      const text =
        typeof item.text === 'string'
          ? redactAgentEvidence(item.text, context).trim().slice(0, 2_000)
          : '';
      return {
        eventType: 'AGENT_MESSAGE',
        summary: {
          itemId,
          messageCompleted: true,
          ...(text ? { text } : {}),
        },
      };
    }
  }
  return null;
}
