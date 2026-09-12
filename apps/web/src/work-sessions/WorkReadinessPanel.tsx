import { ShieldCheck, ShieldX } from 'lucide-react';

import type { ProductWorkSessionReadinessDto } from '@pfc/contracts';
import { Button, ReadinessPanel, SelectField } from '@pfc/ui';

export function WorkReadinessPanel({
  busyAction,
  canGrant,
  canSubmit,
  onGrant,
  onRevoke,
  onSkillChange,
  onToggleContext,
  readiness,
  selectedContextIds,
  selectedSkillReleaseId,
}: {
  busyAction: string | null;
  canGrant: boolean;
  canSubmit: boolean;
  onGrant: () => void;
  onRevoke: () => void;
  onSkillChange: (releaseId: string) => void;
  onToggleContext: (materialRefId: string) => void;
  readiness: ProductWorkSessionReadinessDto;
  selectedContextIds: readonly string[];
  selectedSkillReleaseId: string | null;
}) {
  const availableSkills = readiness.skillOptions.filter(
    (skill) => skill.availability === 'AVAILABLE',
  );
  const visibleBlockers = readiness.blockers.filter(
    (blocker) =>
      !(
        blocker.code === 'SKILL_SELECTION_REQUIRED' && selectedSkillReleaseId
      ) &&
      !(
        blocker.code === 'CONTEXT_SELECTION_REQUIRED' &&
        selectedContextIds.length > 0 &&
        selectedContextIds.length <= 50
      ),
  );
  const authorizationRequired =
    readiness.transmissionStatus === 'AUTHORIZATION_REQUIRED';
  const actions = canGrant ? (
    readiness.activeTransmissionAuthorization ? (
      <Button
        icon={<ShieldX aria-hidden="true" size={15} strokeWidth={1.8} />}
        loading={busyAction === 'revoke-transmission'}
        onClick={onRevoke}
        size="sm"
        variant="ghost"
      >
        撤销授权
      </Button>
    ) : authorizationRequired ? (
      <Button
        icon={<ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />}
        loading={busyAction === 'grant-transmission'}
        onClick={onGrant}
        size="sm"
        variant="secondary"
      >
        授权 15 分钟
      </Button>
    ) : null
  ) : null;

  return (
    <ReadinessPanel
      actions={actions}
      aria-live="polite"
      description="发送前核对本次材料范围、执行 Skill 与传输权限。"
      ready={canSubmit}
      summary={`${selectedContextIds.length} 项上下文`}
      title="本回合作业范围"
    >
      <section className="pfc-readiness-panel__group">
        <strong>上下文</strong>
        <ul className="pfc-readiness-panel__options">
          {readiness.contextOptions.map((context) => (
            <li key={context.materialRefId}>
              <label className="pfc-readiness-panel__option">
                <input
                  aria-label={`选择上下文 ${context.referenceType}`}
                  checked={selectedContextIds.includes(context.materialRefId)}
                  onChange={() => onToggleContext(context.materialRefId)}
                  type="checkbox"
                />
                <span>
                  {context.referenceType}{' '}
                  <small>
                    {context.version ? `v${context.version}` : '未标版本'} ·{' '}
                    {context.sensitivity}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="pfc-readiness-panel__group">
        <strong>执行能力</strong>
        <SelectField
          disabled={availableSkills.length === 0}
          label="本回合 Skill"
          onChange={(event) => onSkillChange(event.target.value)}
          value={selectedSkillReleaseId ?? ''}
        >
          <option value="">请选择 Skill</option>
          {availableSkills.map((skill) => (
            <option key={skill.releaseId} value={skill.releaseId}>
              {skill.displayName} · {skill.version}
            </option>
          ))}
        </SelectField>
        {visibleBlockers.length ? (
          <ul className="pfc-readiness-panel__blockers">
            {visibleBlockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
        ) : null}
        {!canGrant && authorizationRequired ? (
          <ul className="pfc-readiness-panel__blockers">
            <li>需产品负责人或团队管理员授权。</li>
          </ul>
        ) : null}
      </section>
    </ReadinessPanel>
  );
}
