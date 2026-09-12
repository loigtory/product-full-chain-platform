import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ACTION_PROPOSAL_KINDS,
  ACTION_PROPOSAL_STATUSES,
  CONTEXT_BINDING_ROLES,
  PRODUCT_WORK_CONTEXT_TYPES,
  PRODUCT_WORK_SESSION_EVENT_TYPES,
  PRODUCT_WORK_SESSION_STATUSES,
  PRODUCT_WORK_TURN_STATUSES,
  WORK_SESSION_CONTROL_ACTIONS,
  WORK_TURN_CONTROL_ACTIONS,
  type ActionProposalDto,
  type ProductWorkSessionDto,
  type ProductWorkTurnDto,
} from '../../packages/contracts/src/index.ts';

describe('AI-UX-R1 work-session contracts', () => {
  it('publishes the confirmed session, turn, proposal, context, and control vocabularies', () => {
    expect(PRODUCT_WORK_SESSION_STATUSES).toEqual([
      'ACTIVE',
      'BLOCKED',
      'COMPLETED',
      'ARCHIVED',
    ]);
    expect(PRODUCT_WORK_TURN_STATUSES).toEqual([
      'RECEIVED',
      'QUEUED',
      'RUNNING',
      'WAITING_INPUT',
      'PROPOSING',
      'COMPLETED',
      'FAILED',
      'CANCELLING',
      'CANCELLED',
      'UNKNOWN',
    ]);
    expect(ACTION_PROPOSAL_STATUSES).toEqual([
      'DRAFT',
      'PENDING_CONFIRMATION',
      'CONFIRMED',
      'APPLYING',
      'APPLIED',
      'REJECTED',
      'EXPIRED',
      'STALE',
      'FAILED',
      'UNKNOWN',
    ]);
    expect(ACTION_PROPOSAL_KINDS).toEqual([
      'COMPLETE_G0_REGISTRATION',
      'ANSWER_QUESTION',
      'CONFIRM_QUESTION',
      'REGISTER_ARTIFACT',
      'APPEND_ARTIFACT_VERSION',
      'CREATE_AGENT_RUN',
      'REGISTER_TRACE_LINK',
      'READ_MCP',
    ]);
    expect(PRODUCT_WORK_CONTEXT_TYPES).toEqual([
      'MATERIAL_BASELINE',
      'MATERIAL_REF',
      'QUESTION',
      'DECISION',
      'ARTIFACT_VERSION',
      'GATE_RUN',
      'AGENT_RUN',
      'EVIDENCE',
    ]);
    expect(CONTEXT_BINDING_ROLES).toEqual([
      'PRIMARY',
      'SOURCE',
      'OUTPUT',
      'EVIDENCE',
    ]);
    expect(WORK_SESSION_CONTROL_ACTIONS).toEqual([
      'COMPLETE',
      'ARCHIVE',
      'RESUME',
    ]);
    expect(WORK_TURN_CONTROL_ACTIONS).toEqual(['CANCEL', 'VERIFY']);
  });

  it('publishes safe event types and versioned public DTOs without hidden reasoning', () => {
    expect(PRODUCT_WORK_SESSION_EVENT_TYPES).toContain(
      'TURN_PROPOSAL_AVAILABLE',
    );
    expect(PRODUCT_WORK_SESSION_EVENT_TYPES).toContain('PROPOSAL_UNKNOWN');
    expect(PRODUCT_WORK_SESSION_EVENT_TYPES).toContain('AGENT_RUN_LINKED');
    expectTypeOf<ProductWorkSessionDto>().toHaveProperty('schemaVersion');
    expectTypeOf<ProductWorkTurnDto>().toHaveProperty('schemaVersion');
    expectTypeOf<ActionProposalDto>().toHaveProperty('schemaVersion');
    expectTypeOf<ProductWorkTurnDto>().not.toHaveProperty('reasoning');
    expectTypeOf<ProductWorkTurnDto>().not.toHaveProperty('rawPrompt');
    expectTypeOf<ActionProposalDto>().not.toHaveProperty('sql');
    expectTypeOf<ActionProposalDto>().not.toHaveProperty('url');
  });
});
