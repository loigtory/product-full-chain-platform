import { useState, type FormEvent } from 'react';
import {
  ClipboardCheck,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import type {
  GateConfirmationRole,
  GateResult,
  GateRunResult,
  RequirementDetailDto,
} from '@pfc/contracts';

import {
  RequirementSubmissionUnknownError,
  RequirementsApiError,
  type RequirementsApi,
} from './requirements-api.ts';
import { createUiIdempotencyKey } from './idempotency.ts';
import { StatusPill } from './StatusPill.tsx';
import { useDialogFocus } from './useDialogFocus.ts';

type CheckForm = {
  localId: number;
  checkKey: string;
  result: GateResult;
  reason: string;
};

const roleOptions: ReadonlyArray<readonly [GateConfirmationRole, string]> = [
  ['PRODUCT_OWNER', '产品责任人'],
  ['BUSINESS_OWNER', '业务责任人'],
  ['ENGINEERING_OWNER', '研发责任人'],
  ['TEST_OWNER', '测试责任人'],
  ['RELEASE_OWNER', '发布责任人'],
];

const checkResultOptions: ReadonlyArray<readonly [GateResult, string]> = [
  ['PASS', '通过'],
  ['BLOCK', '阻断'],
  ['WARN', '警告'],
  ['NOT_APPLICABLE', '不适用'],
  ['UNKNOWN', '未知'],
];

const overallResultOptions: ReadonlyArray<readonly [GateRunResult, string]> = [
  ['PASS', '通过'],
  ['BLOCK', '阻断'],
  ['WARN', '警告'],
];

function newCheck(localId: number): CheckForm {
  return {
    localId,
    checkKey: 'manual.aggregate',
    result: 'PASS',
    reason: '',
  };
}

function idempotencyKey(action: 'AUTO' | 'MANUAL'): string {
  return createUiIdempotencyKey(`GATE_${action}`, 'CODEx_TEST_UI');
}

function errorMessage(error: unknown): string {
  if (error instanceof RequirementSubmissionUnknownError) {
    return '门禁提交结果待核验，请刷新当前需求。';
  }
  if (error instanceof RequirementsApiError) {
    if (error.code === 'DEPENDENCY_UNAVAILABLE') {
      return '自动门禁能力暂不可用，可登记人工结论。';
    }
    if (error.code === 'VERSION_CONFLICT') {
      return '需求版本已变化，请刷新后再操作。';
    }
    return error.message;
  }
  return '门禁服务暂时不可用，请稍后刷新。';
}

function resultLabel(result: GateResult | null): string {
  if (result === null) return '处理中';
  return checkResultOptions.find(([value]) => value === result)?.[1] ?? result;
}

export function GateRunPanel({
  api,
  detail,
  onDetailChange,
}: {
  api: RequirementsApi;
  detail: RequirementDetailDto;
  onDetailChange: (detail: RequirementDetailDto) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [overallResult, setOverallResult] =
    useState<Exclude<GateRunResult, 'UNKNOWN'>>('PASS');
  const [confirmedRole, setConfirmedRole] =
    useState<GateConfirmationRole>('BUSINESS_OWNER');
  const [registrationNote, setRegistrationNote] = useState('');
  const [evidenceRefs, setEvidenceRefs] = useState('');
  const [checks, setChecks] = useState<CheckForm[]>([newCheck(1)]);
  const [nextCheckId, setNextCheckId] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const closeManualDialog = () => setManualOpen(false);
  const manualDialogRef = useDialogFocus<HTMLElement>(
    closeManualDialog,
    manualOpen,
  );

  const baseline = detail.currentBaseline;
  const processing = detail.currentGateRun?.status === 'IN_PROGRESS';
  const unknown = detail.currentGateRun?.result === 'UNKNOWN';
  const automaticAvailable = detail.gateExecution.status === 'AVAILABLE';

  async function reloadDetail() {
    const current = await api.getRequirement(detail.id);
    onDetailChange(current);
  }

  async function runAutomatic() {
    if (!baseline || !automaticAvailable || processing) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.startAutomaticGateRun(
        detail.id,
        { baselineId: baseline.id, stage: detail.currentStage },
        detail.rowVersion,
        idempotencyKey('AUTO'),
      );
      await reloadDetail();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshResult() {
    if (!detail.currentGateRun) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.getGateRun(detail.id, detail.currentGateRun.id);
      await reloadDetail();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function validateManual(): string | null {
    if (!registrationNote.trim()) return '请填写登记说明';
    const evidence = evidenceRefs
      .split(/[，,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (evidence.length === 0) return '请填写至少一条证据引用';
    if (new Set(evidence).size !== evidence.length) return '证据引用不能重复';
    if (checks.some((check) => !check.checkKey.trim())) {
      return '每项检查都需要检查标识';
    }
    if (
      checks.some(
        (check) =>
          (check.result === 'NOT_APPLICABLE' || check.result === 'UNKNOWN') &&
          !check.reason.trim(),
      )
    ) {
      return '不适用或未知的检查必须填写原因';
    }
    const results = checks.map((check) => check.result);
    if (
      (overallResult === 'PASS' &&
        (!results.includes('PASS') ||
          results.some((value) =>
            ['BLOCK', 'WARN', 'UNKNOWN'].includes(value),
          ))) ||
      (overallResult === 'BLOCK' && !results.includes('BLOCK')) ||
      (overallResult === 'WARN' &&
        (!results.includes('WARN') || results.includes('BLOCK')))
    ) {
      return '总体结论与检查结果不一致';
    }
    return null;
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    if (!baseline) return;
    const invalid = validateManual();
    setValidationError(invalid);
    if (invalid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.registerManualGateRun(
        detail.id,
        {
          baselineId: baseline.id,
          stage: detail.currentStage,
          result: overallResult,
          registrationNote: registrationNote.trim(),
          confirmedRole,
          evidenceRefIds: evidenceRefs
            .split(/[，,\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
          checks: checks.map((check) => ({
            checkKey: check.checkKey.trim(),
            result: check.result,
            reason: check.reason.trim() || null,
            ownerId: null,
            closePoint: detail.currentStage,
          })),
        },
        detail.rowVersion,
        idempotencyKey('MANUAL'),
      );
      const current = await api.getRequirement(detail.id);
      onDetailChange(current);
      setManualOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function updateCheck(localId: number, patch: Partial<CheckForm>) {
    setChecks((current) =>
      current.map((check) =>
        check.localId === localId ? { ...check, ...patch } : check,
      ),
    );
  }

  return (
    <section className="detail-section gate-run-section">
      <div className="section-heading gate-heading">
        <div>
          <p className="eyebrow">{detail.currentStage} · 阶段门禁</p>
          <h2>当前阶段门禁</h2>
        </div>
        <StatusPill value={detail.gateProjection} />
      </div>

      <div className="gate-summary">
        <div>
          <span>自动执行能力</span>
          <strong>
            {automaticAvailable ? '自动门禁可用' : '自动门禁不可用'}
          </strong>
          <small>{detail.gateExecution.capabilityVersion}</small>
        </div>
        <div>
          <span>当前运行</span>
          <strong>
            {detail.currentGateRun
              ? resultLabel(detail.currentGateRun.result)
              : '尚未运行'}
          </strong>
          <small>
            {detail.currentGateRun
              ? `${detail.currentGateRun.mode === 'AUTOMATIC' ? '自动' : '人工'} · ${detail.currentGateRun.stage}`
              : `等待 ${detail.currentStage} 门禁`}
          </small>
        </div>
      </div>

      {error ? (
        <div className="notice-banner error gate-notice" role="alert">
          {error}
        </div>
      ) : null}

      <div className="gate-actions">
        {processing || unknown ? (
          <button
            className="secondary-button"
            disabled={submitting}
            onClick={() => void refreshResult()}
            type="button"
          >
            {submitting ? (
              <LoaderCircle
                aria-hidden="true"
                className="spinning-icon"
                size={16}
                strokeWidth={1.8}
              />
            ) : (
              <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            {submitting ? '刷新中...' : '刷新门禁结果'}
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={!baseline || !automaticAvailable || submitting}
            onClick={() => void runAutomatic()}
            type="button"
          >
            {submitting ? (
              <LoaderCircle
                aria-hidden="true"
                className="spinning-icon"
                size={16}
                strokeWidth={1.8}
              />
            ) : (
              <Play aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            {submitting ? '运行中...' : '运行自动门禁'}
          </button>
        )}
        <button
          className="secondary-button"
          disabled={!baseline || processing || submitting}
          onClick={() => {
            setValidationError(null);
            setManualOpen(true);
          }}
          type="button"
        >
          <ClipboardCheck aria-hidden="true" size={16} strokeWidth={1.8} />
          登记人工结论
        </button>
      </div>

      {detail.gateRuns.length > 0 ? (
        <div className="gate-history">
          <h3>运行记录</h3>
          {detail.gateRuns.map((run) => (
            <article className="gate-history-row" key={run.id}>
              <div>
                <StatusPill value={run.result ?? run.status} />
                <strong>
                  {run.stage} · {run.mode === 'AUTOMATIC' ? '自动' : '人工'}
                </strong>
                <small>{run.id}</small>
              </div>
              <span>{run.completedAt ?? run.startedAt}</span>
              {run.checks.length > 0 ? (
                <ul>
                  {run.checks.map((check) => (
                    <li key={check.id}>
                      <span>{check.checkKey}</span>
                      <StatusPill value={check.result} />
                      {check.reason ? <small>{check.reason}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {manualOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="manual-gate-title"
            aria-modal="true"
            className="dialog manual-gate-dialog"
            ref={manualDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="dialog-header">
              <h2 id="manual-gate-title">登记人工门禁结论</h2>
              <button
                aria-label="关闭"
                className="icon-button"
                onClick={closeManualDialog}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </header>
            <form onSubmit={submitManual}>
              <div className="dialog-body manual-gate-body">
                <div className="form-grid">
                  <label className="field required">
                    <span>总体结论</span>
                    <select
                      aria-label="总体结论"
                      value={overallResult}
                      onChange={(event) =>
                        setOverallResult(
                          event.target.value as Exclude<
                            GateRunResult,
                            'UNKNOWN'
                          >,
                        )
                      }
                    >
                      {overallResultOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field required">
                    <span>确认责任角色</span>
                    <select
                      aria-label="确认责任角色"
                      value={confirmedRole}
                      onChange={(event) =>
                        setConfirmedRole(
                          event.target.value as GateConfirmationRole,
                        )
                      }
                    >
                      {roleOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field field-wide required">
                    <span>登记说明</span>
                    <textarea
                      aria-label="登记说明"
                      data-dialog-initial-focus
                      maxLength={2000}
                      onChange={(event) =>
                        setRegistrationNote(event.target.value)
                      }
                      rows={3}
                      value={registrationNote}
                    />
                  </label>
                  <label className="field field-wide required">
                    <span>证据引用</span>
                    <textarea
                      aria-label="证据引用"
                      maxLength={10000}
                      onChange={(event) => setEvidenceRefs(event.target.value)}
                      placeholder="多个引用使用逗号或换行分隔"
                      rows={2}
                      value={evidenceRefs}
                    />
                  </label>
                </div>

                <div className="manual-checks">
                  <div className="manual-checks-heading">
                    <h3>检查项</h3>
                    <button
                      aria-label="添加检查项"
                      className="icon-button compact"
                      onClick={() => {
                        setChecks((current) => [
                          ...current,
                          newCheck(nextCheckId),
                        ]);
                        setNextCheckId((value) => value + 1);
                      }}
                      title="添加检查项"
                      type="button"
                    >
                      <Plus aria-hidden="true" size={17} strokeWidth={1.8} />
                    </button>
                  </div>
                  {checks.map((check, index) => (
                    <div className="manual-check-row" key={check.localId}>
                      <label className="field">
                        <span>检查标识 {index + 1}</span>
                        <input
                          aria-label={`检查标识 ${index + 1}`}
                          maxLength={160}
                          onChange={(event) =>
                            updateCheck(check.localId, {
                              checkKey: event.target.value,
                            })
                          }
                          value={check.checkKey}
                        />
                      </label>
                      <label className="field">
                        <span>结果</span>
                        <select
                          aria-label={`检查结果 ${index + 1}`}
                          onChange={(event) =>
                            updateCheck(check.localId, {
                              result: event.target.value as GateResult,
                            })
                          }
                          value={check.result}
                        >
                          {checkResultOptions.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field manual-check-reason">
                        <span>原因</span>
                        <input
                          aria-label={`检查原因 ${index + 1}`}
                          maxLength={2000}
                          onChange={(event) =>
                            updateCheck(check.localId, {
                              reason: event.target.value,
                            })
                          }
                          value={check.reason}
                        />
                      </label>
                      <button
                        aria-label={`删除检查项 ${index + 1}`}
                        className="icon-button compact"
                        disabled={checks.length === 1}
                        onClick={() =>
                          setChecks((current) =>
                            current.filter(
                              (item) => item.localId !== check.localId,
                            ),
                          )
                        }
                        title="删除检查项"
                        type="button"
                      >
                        <Trash2
                          aria-hidden="true"
                          size={15}
                          strokeWidth={1.8}
                        />
                      </button>
                    </div>
                  ))}
                </div>
                {validationError ? (
                  <p className="field-error" role="alert">
                    {validationError}
                  </p>
                ) : null}
                {error ? (
                  <div className="notice-banner error" role="alert">
                    {error}
                  </div>
                ) : null}
              </div>
              <footer className="dialog-actions">
                <button
                  className="secondary-button"
                  onClick={closeManualDialog}
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
                      提交中...
                    </>
                  ) : (
                    '提交人工结论'
                  )}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
