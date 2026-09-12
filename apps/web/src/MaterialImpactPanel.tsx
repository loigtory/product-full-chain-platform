import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FilePlus2,
  LoaderCircle,
} from 'lucide-react';

import type {
  ConfirmMaterialImpactRequest,
  LifecycleStage,
  MaterialImpactAssessmentDto,
  MaterialPurpose,
  MaterialSourceType,
  RequirementDetailDto,
  SensitivityLevel,
} from '@pfc/contracts';

import {
  RequirementsApiError,
  type RequirementsApi,
} from './requirements-api.ts';
import { StatusPill } from './StatusPill.tsx';
import { createUiIdempotencyKey } from './idempotency.ts';

const stages = Array.from(
  { length: 13 },
  (_, index) => `G${index}` as LifecycleStage,
);

const sources: ReadonlyArray<readonly [MaterialSourceType, string]> = [
  ['BUSINESS_FEEDBACK', '业务反馈'],
  ['USER_INTERVIEW', '用户访谈'],
  ['OPERATIONS_ISSUE', '运营问题'],
  ['INTERNAL_IMPROVEMENT', '内部改进'],
  ['POLICY_OR_COMPLIANCE', '政策或合规'],
  ['OTHER', '其他'],
];

const purposes: ReadonlyArray<readonly [MaterialPurpose, string]> = [
  ['FACT', '事实依据'],
  ['CONSTRAINT', '约束条件'],
  ['ASSUMPTION', '待验证假设'],
  ['HISTORICAL_DESIGN', '历史设计'],
  ['REGRESSION_SAMPLE', '回归样本'],
];

function errorText(error: unknown): string {
  if (error instanceof RequirementsApiError) return error.message;
  return '材料影响提交失败，请重新读取当前需求后再试。';
}

function ImpactSummary({ impact }: { impact: MaterialImpactAssessmentDto }) {
  return (
    <article className="impact-record">
      <div className="impact-record-heading">
        <StatusPill value={impact.status} />
        <strong>
          {impact.decision === 'NO_IMPACT'
            ? '确认不影响'
            : impact.decision === 'IMPACTS'
              ? `从 ${impact.selectedStage} 回退`
              : `建议从 ${impact.recommendedStage} 评估`}
        </strong>
      </div>
      <p className="baseline-transition">
        基线 {impact.originalBaselineId}
        <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
        {impact.candidateBaselineId}
      </p>
      {impact.confirmedRole ? (
        <small>
          {impact.confirmedRole === 'BUSINESS_OWNER'
            ? '业务责任人'
            : '产品负责人'}{' '}
          · {impact.confirmedBy} ·{' '}
          {new Date(impact.confirmedAt!).toLocaleString('zh-CN')}
        </small>
      ) : null}
      {impact.reason ? <p className="impact-reason">{impact.reason}</p> : null}
      {impact.invalidatedGateRunIds.length > 0 ? (
        <small>{impact.invalidatedGateRunIds.length} 条旧门禁结论已失效</small>
      ) : null}
    </article>
  );
}

export function MaterialImpactPanel({
  api,
  detail,
  onReload,
}: {
  api: RequirementsApi;
  detail: RequirementDetailDto;
  onReload: () => Promise<void>;
}) {
  const impacts = detail.materialImpacts ?? [];
  const baselines =
    detail.materialBaselines ??
    (detail.currentBaseline ? [detail.currentBaseline] : []);
  const pending = impacts.find((impact) => impact.status === 'PENDING');
  const [mode, setMode] = useState<'CREATE' | 'CONFIRM' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] =
    useState<MaterialSourceType>('USER_INTERVIEW');
  const [sourceDescription, setSourceDescription] = useState('');
  const [purpose, setPurpose] = useState<MaterialPurpose>('FACT');
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('INTERNAL');
  const [recommendedStage, setRecommendedStage] = useState<LifecycleStage>(
    detail.currentStage,
  );
  const [confirmation, setConfirmation] =
    useState<ConfirmMaterialImpactRequest>({
      decision: 'IMPACTS',
      selectedStage: pending?.recommendedStage ?? detail.currentStage,
      reason: '',
      confirmedRole: 'BUSINESS_OWNER',
    });
  const availableStages = stages.slice(
    0,
    stages.indexOf(detail.currentStage) + 1,
  );
  const effectiveRecommendedStage = availableStages.includes(recommendedStage)
    ? recommendedStage
    : detail.currentStage;

  async function createImpact(event: FormEvent) {
    event.preventDefault();
    if (!api.createMaterialImpactAssessment) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createMaterialImpactAssessment(
        detail.id,
        {
          candidateBaseline: {
            sourceType,
            sourceDescription:
              sourceType === 'OTHER' ? sourceDescription.trim() : null,
            materialPurpose: purpose,
            sensitivity,
          },
          recommendedStage: effectiveRecommendedStage,
        },
        createUiIdempotencyKey('MATERIAL_IMPACT_CREATE'),
      );
      setMode(null);
      await onReload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmImpact(event: FormEvent) {
    event.preventDefault();
    if (!pending || !api.confirmMaterialImpact) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.confirmMaterialImpact(
        detail.id,
        pending.id,
        {
          ...confirmation,
          selectedStage:
            confirmation.decision === 'IMPACTS'
              ? confirmation.selectedStage
              : null,
        },
        detail.rowVersion,
        createUiIdempotencyKey('MATERIAL_IMPACT_CONFIRM'),
      );
      setMode(null);
      await onReload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="detail-section impact-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">材料基线 · 影响评估</p>
          <h2>基线与影响记录</h2>
        </div>
        <div className="impact-actions">
          {pending && api.confirmMaterialImpact ? (
            <button
              className="primary-button"
              onClick={() => {
                setError(null);
                setConfirmation({
                  ...confirmation,
                  selectedStage: pending.recommendedStage,
                });
                setMode('CONFIRM');
              }}
              type="button"
            >
              <CheckCircle2 aria-hidden="true" size={16} strokeWidth={1.8} />
              确认影响
            </button>
          ) : null}
          {!pending && api.createMaterialImpactAssessment ? (
            <button
              className="secondary-button"
              onClick={() => {
                setError(null);
                setMode('CREATE');
              }}
              type="button"
            >
              <FilePlus2 aria-hidden="true" size={16} strokeWidth={1.8} />
              登记新材料
            </button>
          ) : null}
        </div>
      </div>

      <div className="baseline-strip" aria-label="材料基线历史">
        {baselines.map((baseline) => (
          <div className="baseline-item" key={baseline.id}>
            <strong>V{baseline.versionNumber}</strong>
            <span>
              {baseline.id === detail.currentBaseline?.id
                ? '当前'
                : pending?.candidateBaselineId === baseline.id
                  ? '候选'
                  : '历史'}
            </span>
          </div>
        ))}
      </div>

      {error ? (
        <div className="notice-banner error" role="alert">
          {error}
        </div>
      ) : null}

      {mode === 'CREATE' ? (
        <form className="impact-form" onSubmit={createImpact}>
          <label>
            <span>材料来源</span>
            <select
              aria-label="材料来源"
              onChange={(event) =>
                setSourceType(event.target.value as MaterialSourceType)
              }
              value={sourceType}
            >
              {sources.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {sourceType === 'OTHER' ? (
            <label>
              <span>来源说明</span>
              <input
                aria-label="来源说明"
                onChange={(event) => setSourceDescription(event.target.value)}
                required
                value={sourceDescription}
              />
            </label>
          ) : null}
          <label>
            <span>材料用途</span>
            <select
              aria-label="材料用途"
              onChange={(event) =>
                setPurpose(event.target.value as MaterialPurpose)
              }
              value={purpose}
            >
              {purposes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>敏感边界</span>
            <select
              aria-label="敏感边界"
              onChange={(event) =>
                setSensitivity(event.target.value as SensitivityLevel)
              }
              value={sensitivity}
            >
              <option value="INTERNAL">内部普通</option>
              <option value="RESTRICTED">内部受限</option>
              <option value="PUBLIC">可公开</option>
            </select>
          </label>
          <label>
            <span>建议最早受影响门禁</span>
            <select
              aria-label="建议最早受影响门禁"
              onChange={(event) =>
                setRecommendedStage(event.target.value as LifecycleStage)
              }
              value={effectiveRecommendedStage}
            >
              {availableStages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <div className="impact-form-actions">
            <button
              className="secondary-button"
              onClick={() => setMode(null)}
              type="button"
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={submitting}
              type="submit"
            >
              {submitting ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="spinning-icon"
                    size={16}
                    strokeWidth={1.8}
                  />
                  登记中...
                </>
              ) : (
                '登记候选基线'
              )}
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'CONFIRM' && pending ? (
        <form className="impact-form" onSubmit={confirmImpact}>
          <fieldset>
            <legend>影响结论</legend>
            <label>
              <input
                checked={confirmation.decision === 'IMPACTS'}
                name="impact-decision"
                onChange={() =>
                  setConfirmation({
                    ...confirmation,
                    decision: 'IMPACTS',
                    selectedStage: pending.recommendedStage,
                  })
                }
                type="radio"
              />
              影响现有结论
            </label>
            <label>
              <input
                checked={confirmation.decision === 'NO_IMPACT'}
                name="impact-decision"
                onChange={() =>
                  setConfirmation({
                    ...confirmation,
                    decision: 'NO_IMPACT',
                    selectedStage: null,
                  })
                }
                type="radio"
              />
              不影响现有结论
            </label>
          </fieldset>
          {confirmation.decision === 'IMPACTS' ? (
            <label>
              <span>最早受影响门禁</span>
              <select
                aria-label="最早受影响门禁"
                onChange={(event) =>
                  setConfirmation({
                    ...confirmation,
                    selectedStage: event.target.value as LifecycleStage,
                  })
                }
                value={confirmation.selectedStage ?? pending.recommendedStage}
              >
                {availableStages.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>确认原因</span>
            <textarea
              aria-label="确认原因"
              maxLength={4000}
              onChange={(event) =>
                setConfirmation({ ...confirmation, reason: event.target.value })
              }
              required
              rows={3}
              value={confirmation.reason}
            />
          </label>
          <label>
            <span>确认责任</span>
            <select
              aria-label="确认责任"
              onChange={(event) =>
                setConfirmation({
                  ...confirmation,
                  confirmedRole: event.target
                    .value as ConfirmMaterialImpactRequest['confirmedRole'],
                })
              }
              value={confirmation.confirmedRole}
            >
              <option value="BUSINESS_OWNER">业务责任人</option>
              <option value="PRODUCT_OWNER">产品负责人</option>
            </select>
          </label>
          <div className="impact-form-actions">
            <button
              className="secondary-button"
              onClick={() => setMode(null)}
              type="button"
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={submitting}
              type="submit"
            >
              {submitting ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="spinning-icon"
                    size={16}
                    strokeWidth={1.8}
                  />
                  确认中...
                </>
              ) : (
                '确认并切换基线'
              )}
            </button>
          </div>
        </form>
      ) : null}

      <div className="impact-history">
        {impacts.length ? (
          impacts.map((impact) => (
            <ImpactSummary impact={impact} key={impact.id} />
          ))
        ) : (
          <p>暂无材料影响记录</p>
        )}
      </div>
    </section>
  );
}
