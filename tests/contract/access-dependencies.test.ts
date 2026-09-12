import { describe, expect, it } from 'vitest';

import {
  ACCESS_FACTS,
  ACTOR_ROLES,
  CAPABILITY_SOURCES,
  CAPABILITY_STATUSES,
  REQUIREMENT_ACTIONS,
  TRANSMISSION_TARGETS,
} from '../../packages/contracts/src/index.ts';

describe('T2 access and dependency contracts', () => {
  it('publishes stable actor, action, and fail-closed fact values', () => {
    expect(ACTOR_ROLES).toEqual([
      'PRODUCT_MANAGER',
      'PRODUCT_OWNER',
      'BUSINESS_OWNER',
      'ENGINEERING_OWNER',
      'TEST_OWNER',
      'RELEASE_OWNER',
      'TEAM_ADMIN',
    ]);
    expect(REQUIREMENT_ACTIONS).toEqual([
      'VIEW_REQUIREMENT',
      'CREATE_REQUIREMENT',
      'COMPLETE_G0_REGISTRATION',
      'ASSESS_MATERIAL_IMPACT',
      'ANSWER_QUESTION',
      'CONFIRM_QUESTION',
      'RUN_GATE',
      'REGISTER_MANUAL_GATE',
      'CONFIRM_MATERIAL_IMPACT',
      'VIEW_MATERIAL',
      'VIEW_ARTIFACT',
      'REGISTER_ARTIFACT',
      'APPEND_ARTIFACT_VERSION',
      'REVIEW_ARTIFACT',
      'MANAGE_TRACEABILITY',
      'RUN_AGENT',
      'RUN_AGENT_WRITE',
      'VIEW_AGENT_RUN',
      'APPROVE_AGENT_ACTION',
      'CANCEL_AGENT_RUN',
      'VERIFY_AGENT_RUN',
      'VIEW_AGENT_AUDIT',
      'REVOKE_BRIDGE',
      'TRANSMIT_MATERIAL',
      'VIEW_WORK_SESSION',
      'CREATE_WORK_SESSION',
      'SUBMIT_WORK_TURN',
      'DECIDE_ACTION_PROPOSAL',
      'CONTROL_WORK_SESSION',
      'GRANT_MATERIAL_TRANSMISSION',
      'READ_MCP',
    ]);
    expect(REQUIREMENT_ACTIONS).not.toContain('PUBLISH_EXTERNALLY');
    expect(ACCESS_FACTS).toEqual(['YES', 'NO', 'UNKNOWN']);
  });

  it('keeps unavailable and fixture capability results distinguishable', () => {
    expect(CAPABILITY_STATUSES).toEqual([
      'AVAILABLE',
      'UNAVAILABLE',
      'UNKNOWN',
    ]);
    expect(CAPABILITY_SOURCES).toEqual([
      'POSTGRESQL',
      'REMOTE',
      'FIXTURE',
      'UNAVAILABLE',
    ]);
    expect(TRANSMISSION_TARGETS).toEqual([
      'APPROVED_AI',
      'APPROVED_SKILL',
      'MODEL',
      'TERMINAL',
      'BRIDGE',
      'MCP',
    ]);
  });
});
