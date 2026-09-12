import { describe, expect, it } from 'vitest';

import { EXPERIENCE_ID_PREFIX } from '../../apps/server/src/local-experience.ts';
import { createLocalExperienceFixture } from '../../packages/test-data/src/index.ts';

describe('local experience deterministic data', () => {
  it('covers draft, gate, question, and material-impact states with scoped IDs', () => {
    const fixture = createLocalExperienceFixture();

    expect(
      fixture.requirementWrites.map((item) => item.requirement.name),
    ).toEqual([
      '体验：待补齐登记的渠道需求',
      '体验：可执行门禁的结算规则',
      '体验：材料变更影响评估',
    ]);
    expect(fixture.questionRecords.length).toBeGreaterThanOrEqual(3);
    expect(fixture.gateRuns.map((item) => item.gateRun.stage)).toEqual([
      'G0',
      'G1',
      'G3',
    ]);
    expect(fixture.additionalMaterialBaselines).toHaveLength(1);
    expect(fixture.materialImpacts).toMatchObject([
      { status: 'PENDING', recommendedStage: 'G1' },
    ]);

    const ids = [
      fixture.actor.actorId,
      ...fixture.requirementWrites.flatMap((item) => [
        item.requirement.id,
        item.materialBaseline?.id ?? EXPERIENCE_ID_PREFIX,
        item.timelineEvent.id,
        item.outboxEvent.id,
      ]),
      ...fixture.questionRecords.flatMap((item) => [
        item.question.id,
        item.question.ownerId,
        ...item.decisions.flatMap((decision) => [
          decision.id,
          decision.confirmedBy ?? fixture.actor.actorId,
        ]),
      ]),
      ...fixture.gateRuns.flatMap((item) => [
        item.gateRun.id,
        item.gateRun.ownerId,
      ]),
      ...fixture.materialRefs.map((item) => item.id),
      ...fixture.additionalMaterialBaselines.flatMap((item) => [
        item.id,
        item.confirmedBy,
      ]),
      ...fixture.materialImpacts.map((item) => item.id),
    ];
    expect(ids.every((id) => id.startsWith(EXPERIENCE_ID_PREFIX))).toBe(true);
  });
});
