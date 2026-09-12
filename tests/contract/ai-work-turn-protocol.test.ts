import { describe, expect, it } from 'vitest';

import {
  PRODUCT_WORK_TURN_PROTOCOL_VERSION,
  parseProductWorkTurnCommand,
  parseProductWorkTurnContext,
  parseProductWorkTurnEvent,
} from '../../packages/protocol/src/index.ts';

const hash = (character: string) => `sha256:${character.repeat(64)}`;

const startCommand = {
  schemaVersion: 'product-work-turn-command/1',
  commandId: 'CODEx_TEST_AIUX_COMMAND_001',
  commandType: 'START_PRODUCT_WORK_TURN',
  leaseUntil: '2026-09-07T04:00:30.000Z',
  attempt: 1,
  afterSequence: 2,
  payload: {
    sessionId: 'CODEx_TEST_AIUX_SESSION_001',
    turnId: 'CODEx_TEST_AIUX_TURN_001',
    turnVersion: 1,
    requirementId: 'CODEx_TEST_AIUX_REQUIREMENT_001',
    openedRequirementVersion: 3,
    baselineId: 'CODEx_TEST_AIUX_BASELINE_001',
    contextBindingIds: ['CODEx_TEST_AIUX_BINDING_001'],
    contextHash: hash('a'),
    skillReleaseId: 'CODEx_TEST_AIUX_SKILL_RELEASE_001',
    skillContentHash: hash('b'),
  },
} as const;

describe('AI-UX-R1 ProductWorkTurn protocol', () => {
  it('accepts bounded identifier-and-hash commands and rejects embedded prompt text', () => {
    expect(parseProductWorkTurnCommand(startCommand)).toEqual(startCommand);
    expect(() =>
      parseProductWorkTurnCommand({
        ...startCommand,
        payload: { ...startCommand.payload, prompt: 'untrusted full prompt' },
      }),
    ).toThrowError('PRODUCT_WORK_TURN_COMMAND_PAYLOAD_FIELDS_INVALID');
    expect(() =>
      parseProductWorkTurnCommand({
        ...startCommand,
        commandType: 'START_READ_ONLY_RUN',
      }),
    ).toThrowError('PRODUCT_WORK_TURN_COMMAND_TYPE_UNSUPPORTED');
  });

  it('parses independent interrupt and verify commands', () => {
    for (const commandType of [
      'INTERRUPT_PRODUCT_WORK_TURN',
      'VERIFY_PRODUCT_WORK_TURN',
    ] as const) {
      const command = {
        ...startCommand,
        commandId: `CODEx_TEST_AIUX_${commandType}`,
        commandType,
        payload: {
          sessionId: startCommand.payload.sessionId,
          turnId: startCommand.payload.turnId,
          turnVersion: 2,
        },
      };
      expect(parseProductWorkTurnCommand(command)).toEqual(command);
    }
  });

  it('accepts full authorized context only in the lease-scoped context envelope', () => {
    const context = {
      schemaVersion: 'product-work-turn-context/1',
      protocolVersion: PRODUCT_WORK_TURN_PROTOCOL_VERSION,
      commandId: startCommand.commandId,
      sessionId: startCommand.payload.sessionId,
      turnId: startCommand.payload.turnId,
      contextHash: startCommand.payload.contextHash,
      userMessage: '请基于当前合成材料给出一个澄清建议。',
      contextItems: [
        {
          bindingId: 'CODEx_TEST_AIUX_BINDING_001',
          contextType: 'MATERIAL_REF',
          targetId: 'CODEx_TEST_AIUX_MATERIAL_001',
          targetVersion: 1,
          contentHash: hash('c'),
          sensitivity: 'INTERNAL',
          content: '这是完全合成的本地测试材料，不包含真实业务数据。',
        },
      ],
      skill: {
        releaseId: 'CODEx_TEST_AIUX_SKILL_RELEASE_001',
        contentHash: hash('b'),
      },
    } as const;

    expect(parseProductWorkTurnContext(context)).toEqual(context);
    expect(() =>
      parseProductWorkTurnContext({
        ...context,
        contextItems: Array.from({ length: 51 }, () => context.contextItems[0]),
      }),
    ).toThrowError('PRODUCT_WORK_TURN_CONTEXT_ITEMS_INVALID');
  });

  it('parses bounded stream events without hidden reasoning or arbitrary fields', () => {
    const event = {
      schemaVersion: 'product-work-turn-event/1',
      sourceEventId: 'CODEx_TEST_AIUX_SOURCE_EVENT_001',
      eventType: 'TURN_MESSAGE_AVAILABLE',
      expectedSequence: 3,
      occurredAt: '2026-09-07T04:00:10.000Z',
      payload: { message: '建议先确认验收口径，再进入方案拆解。' },
    } as const;

    expect(parseProductWorkTurnEvent(event)).toEqual(event);
    expect(() =>
      parseProductWorkTurnEvent({
        ...event,
        payload: { ...event.payload, reasoning: 'hidden chain of thought' },
      }),
    ).toThrowError('PRODUCT_WORK_TURN_EVENT_PAYLOAD_FIELDS_INVALID');
    expect(() =>
      parseProductWorkTurnEvent({
        ...event,
        payload: { message: 'x'.repeat(8_193) },
      }),
    ).toThrowError('PRODUCT_WORK_TURN_EVENT_MESSAGE_INVALID');
  });
});
