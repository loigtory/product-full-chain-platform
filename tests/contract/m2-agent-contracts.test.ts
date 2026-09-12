import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AGENT_APPROVAL_DECISIONS,
  AGENT_APPROVAL_KINDS,
  AGENT_RUN_ACTION_KINDS,
  AGENT_RUN_EVENT_TYPES,
  AGENT_RUN_OPERATIONS,
  AGENT_RUN_RESULT_OUTCOMES,
  REQUIREMENT_ACTIONS,
  AGENT_RUN_STATUSES,
  SKILL_EVALUATION_STATUSES,
  SKILL_RISK_LEVELS,
  type AgentRunDto,
  type SkillReleaseDto,
} from '../../packages/contracts/src/index.ts';

describe('M2 AgentRun and Skill contracts', () => {
  it('publishes the frozen run and event vocabularies', () => {
    expect(AGENT_RUN_STATUSES).toEqual([
      'QUEUED',
      'STARTING',
      'RUNNING',
      'WAITING_INPUT',
      'WAITING_APPROVAL',
      'CANCELLING',
      'UNKNOWN',
      'VERIFYING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'RETRY_QUEUED',
    ]);
    expect(AGENT_RUN_EVENT_TYPES).toContain('TURN_STARTED');
    expect(AGENT_RUN_EVENT_TYPES).toContain('TURN_INTERRUPTED');
    expect(AGENT_RUN_EVENT_TYPES).toContain('RESULT_RECORDED');
    expect(AGENT_RUN_EVENT_TYPES).toContain('APPROVAL_REQUESTED');
    expect(AGENT_RUN_EVENT_TYPES).toContain('RUN_CANCELLED');
    expect(AGENT_RUN_OPERATIONS).toContain('CONTROLLED_ARTIFACT_EDIT');
    expect(AGENT_RUN_RESULT_OUTCOMES).toEqual([
      'PASS',
      'WARN',
      'BLOCKED',
      'UNKNOWN',
    ]);
    expect(AGENT_RUN_ACTION_KINDS).toEqual([
      'EDIT_FILES',
      'FORMAT',
      'TEST',
      'BUILD',
    ]);
    expect(AGENT_APPROVAL_KINDS).toEqual([
      'RUN_START',
      'COMMAND_EXECUTION',
      'FILE_CHANGE',
      'PERMISSIONS',
    ]);
    expect(AGENT_APPROVAL_DECISIONS).toEqual([
      'PENDING',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'REVOKED',
      'CANCELLED',
    ]);
    expect(REQUIREMENT_ACTIONS).toEqual(
      expect.arrayContaining([
        'RUN_AGENT_WRITE',
        'APPROVE_AGENT_ACTION',
        'CANCEL_AGENT_RUN',
        'VERIFY_AGENT_RUN',
        'VIEW_AGENT_AUDIT',
        'REVOKE_BRIDGE',
      ]),
    );
  });

  it('publishes bounded Skill governance vocabularies', () => {
    expect(SKILL_RISK_LEVELS).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(SKILL_EVALUATION_STATUSES).toEqual([
      'NOT_EVALUATED',
      'PASSED',
      'FAILED',
    ]);
  });

  it('keeps raw prompts, local paths, and credentials out of public DTOs', () => {
    expectTypeOf<AgentRunDto>().not.toHaveProperty('rawPrompt');
    expectTypeOf<AgentRunDto>().not.toHaveProperty('databaseUrl');
    expectTypeOf<SkillReleaseDto>().not.toHaveProperty('absolutePath');
    expectTypeOf<SkillReleaseDto>().not.toHaveProperty('content');
  });
});
