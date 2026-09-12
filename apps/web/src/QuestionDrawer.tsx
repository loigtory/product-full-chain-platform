import { useId, useState } from 'react';
import { X } from 'lucide-react';

import type {
  QuestionConfirmationRole,
  QuestionDto,
  QuestionMutationAction,
  QuestionMutationResponse,
} from '@pfc/contracts';
import { statusLabel } from '@pfc/ui';

import {
  RequirementSubmissionUnknownError,
  RequirementsApiError,
  type RequirementsApi,
} from './requirements-api.ts';
import { createUiIdempotencyKey } from './idempotency.ts';
import { StatusPill } from './StatusPill.tsx';
import { useDialogFocus } from './useDialogFocus.ts';

type UnknownMutation = Readonly<{
  action: QuestionMutationAction;
  idempotencyKey: string;
  startingVersion: number;
}>;

const expectedStatus: Readonly<
  Partial<Record<QuestionMutationAction, QuestionDto['status']>>
> = {
  ANSWER: 'ANSWERED',
  CONFIRM: 'CONFIRMED',
  RETURN: 'OPEN',
  DEFER: 'DEFERRED',
  SUPERSEDE: 'SUPERSEDED',
};

const roleLabels: Readonly<Record<string, string>> = {
  BUSINESS_OWNER: '业务责任人',
  PRODUCT_OWNER: '产品负责人',
};

function mutationKey(action: QuestionMutationAction): string {
  return createUiIdempotencyKey(`QUESTION_${action}`);
}

function questionError(error: unknown): string {
  if (error instanceof RequirementsApiError) {
    if (error.code === 'VERSION_CONFLICT') {
      return '问题已被更新，请关闭后重新读取。';
    }
    if (error.code === 'PERMISSION_DENIED') return '你没有执行该操作的权限。';
    return error.message;
  }
  return '问题操作失败，请稍后重试。';
}

function displayTime(value: string | null): string {
  if (!value) return '待确认';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function DecisionHistory({ question }: { question: QuestionDto }) {
  if (question.decisions.length === 0) {
    return <p className="question-empty">尚无决定记录</p>;
  }
  return (
    <div className="decision-history">
      {question.decisions.map((decision) => (
        <article className="decision-entry" key={decision.id}>
          <header>
            <strong>
              {decision.kind === 'DEFERRAL' ? '延后决定' : '回答决定'} V
              {decision.versionNumber}
            </strong>
            <span>{statusLabel(decision.validity)}</span>
          </header>
          <p>{decision.rawAnswer}</p>
          {decision.explanation ? <small>{decision.explanation}</small> : null}
          <dl className="decision-scope">
            <div>
              <dt>基线</dt>
              <dd>绑定 {decision.scope.baselineId}</dd>
            </div>
            <div>
              <dt>最晚关闭</dt>
              <dd>阶段 {decision.scope.closeByStage}</dd>
            </div>
            <div>
              <dt>确认责任</dt>
              <dd>
                {decision.confirmedRole
                  ? (roleLabels[decision.confirmedRole] ??
                    decision.confirmedRole)
                  : '待确认'}
              </dd>
            </div>
            <div>
              <dt>确认时间</dt>
              <dd>{displayTime(decision.confirmedAt)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function QuestionDrawer({
  api,
  question: initialQuestion,
  onClose,
  onQuestionChange,
}: {
  api: RequirementsApi;
  question: QuestionDto;
  onClose: () => void;
  onQuestionChange: (
    action: QuestionMutationAction,
    question: QuestionDto,
    originalQuestionId: string,
  ) => void;
}) {
  const titleId = useId();
  const roleName = useId();
  const [question, setQuestion] = useState(initialQuestion);
  const [rawAnswer, setRawAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [deferReason, setDeferReason] = useState('');
  const [reopenCondition, setReopenCondition] = useState('');
  const [confirmedRole, setConfirmedRole] =
    useState<QuestionConfirmationRole>('PRODUCT_OWNER');
  const [pendingAction, setPendingAction] =
    useState<QuestionMutationAction | null>(null);
  const [unknown, setUnknown] = useState<UnknownMutation | null>(null);
  const [retry, setRetry] = useState<Readonly<{
    action: QuestionMutationAction;
    idempotencyKey: string;
  }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const drawerRef = useDialogFocus<HTMLElement>(onClose);

  const canWrite = pendingAction === null && unknown === null;

  async function runMutation(
    action: QuestionMutationAction,
    operation: (idempotencyKey: string) => Promise<QuestionMutationResponse>,
  ) {
    if (!canWrite) return;
    const idempotencyKey =
      retry?.action === action ? retry.idempotencyKey : mutationKey(action);
    setPendingAction(action);
    setMessage(null);
    try {
      const response = await operation(idempotencyKey);
      const originalQuestionId = question.id;
      setQuestion(response.question);
      setRetry(null);
      setMessage(
        `${response.replayed ? '已确认既有' : '已保存'}：${statusLabel(response.question.status)}`,
      );
      onQuestionChange(response.action, response.question, originalQuestionId);
    } catch (error) {
      if (error instanceof RequirementSubmissionUnknownError) {
        setUnknown({
          action,
          idempotencyKey: error.idempotencyKey,
          startingVersion: question.rowVersion,
        });
        setMessage('问题操作结果待核验');
      } else {
        setMessage(questionError(error));
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function verifyUnknownMutation() {
    if (!unknown || pendingAction !== null) return;
    setPendingAction(unknown.action);
    try {
      const detail = await api.getRequirement(question.requirementId);
      const original = detail.questions.find((item) => item.id === question.id);
      const applied =
        original !== undefined &&
        original.rowVersion > unknown.startingVersion &&
        original.status === expectedStatus[unknown.action];
      if (applied && original) {
        let authoritative = original;
        if (unknown.action === 'SUPERSEDE' && original.supersededByQuestionId) {
          authoritative =
            detail.questions.find(
              (item) => item.id === original.supersededByQuestionId,
            ) ?? original;
        }
        setQuestion(authoritative);
        onQuestionChange(unknown.action, authoritative, question.id);
        setMessage(`已核验为${statusLabel(original.status)}`);
        setRetry(null);
      } else {
        setRetry({
          action: unknown.action,
          idempotencyKey: unknown.idempotencyKey,
        });
        setMessage('未发现已生效操作，可以重新提交。');
      }
      setUnknown(null);
    } catch (error) {
      setMessage(questionError(error));
    } finally {
      setPendingAction(null);
    }
  }

  const showRole =
    question.status === 'OPEN' ||
    question.status === 'ANSWERED' ||
    question.status === 'CONFIRMED';

  return (
    <div className="question-drawer-backdrop" role="presentation">
      <aside
        aria-labelledby={titleId}
        aria-modal="true"
        className="question-drawer"
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="question-drawer-header">
          <div>
            <p className="eyebrow">问题状态 · {statusLabel(question.status)}</p>
            <h2 id={titleId}>问题与决定</h2>
          </div>
          <button
            aria-label="关闭问题与决定"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        <div className="question-drawer-body">
          {message ? (
            <div
              className={`drawer-message ${unknown ? 'warning' : ''}`}
              role="status"
            >
              <span>{message}</span>
              {unknown ? (
                <button
                  className="secondary-button"
                  disabled={pendingAction !== null}
                  onClick={() => void verifyUnknownMutation()}
                  type="button"
                >
                  核验问题状态
                </button>
              ) : null}
            </div>
          ) : null}

          <section className="question-summary">
            <div className="question-status-line">
              <StatusPill value={question.status} />
              <span>负责人 {question.ownerId}</span>
            </div>
            <h3>{question.prompt}</h3>
            {question.reason ? <p>{question.reason}</p> : null}
            <dl className="question-meta">
              <div>
                <dt>基线</dt>
                <dd>{question.baselineId}</dd>
              </div>
              <div>
                <dt>最晚关闭</dt>
                <dd>{question.closeByStage}</dd>
              </div>
            </dl>
          </section>

          <section className="question-drawer-section">
            <h3>决定历史</h3>
            <DecisionHistory question={question} />
          </section>

          {showRole ? (
            <fieldset className="responsibility-choice">
              <legend>确认责任</legend>
              <label>
                <input
                  checked={confirmedRole === 'PRODUCT_OWNER'}
                  name={roleName}
                  onChange={() => setConfirmedRole('PRODUCT_OWNER')}
                  type="radio"
                />
                产品负责人
              </label>
              <label>
                <input
                  checked={confirmedRole === 'BUSINESS_OWNER'}
                  name={roleName}
                  onChange={() => setConfirmedRole('BUSINESS_OWNER')}
                  type="radio"
                />
                业务责任人
              </label>
            </fieldset>
          ) : null}

          {question.status === 'OPEN' ? (
            <section className="question-drawer-section action-section">
              <h3>提交原始回答</h3>
              {question.candidates.length > 0 ? (
                <div className="candidate-options">
                  {question.candidates.map((candidate) => (
                    <button
                      aria-pressed={rawAnswer === candidate}
                      key={candidate}
                      onClick={() => setRawAnswer(candidate)}
                      type="button"
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="field">
                <span>原始回答</span>
                <textarea
                  maxLength={10_000}
                  onChange={(event) => setRawAnswer(event.target.value)}
                  rows={3}
                  value={rawAnswer}
                />
              </label>
              <label className="field">
                <span>回答说明</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => setExplanation(event.target.value)}
                  rows={2}
                  value={explanation}
                />
              </label>
              <button
                className="primary-button"
                disabled={!canWrite || !rawAnswer.trim()}
                onClick={() =>
                  void runMutation('ANSWER', (key) =>
                    api.answerQuestion(
                      question.requirementId,
                      question.id,
                      {
                        rawAnswer: rawAnswer.trim(),
                        explanation: explanation.trim() || null,
                      },
                      question.rowVersion,
                      key,
                    ),
                  )
                }
                type="button"
              >
                保存原始回答
              </button>
            </section>
          ) : null}

          {question.status === 'ANSWERED' ? (
            <section className="question-drawer-section action-section">
              <h3>确认或退回</h3>
              <button
                className="primary-button"
                disabled={!canWrite || !question.currentDecisionId}
                onClick={() =>
                  void runMutation('CONFIRM', (key) =>
                    api.confirmQuestion(
                      question.requirementId,
                      question.id,
                      {
                        decisionId: question.currentDecisionId ?? '',
                        confirmedRole,
                      },
                      question.rowVersion,
                      key,
                    ),
                  )
                }
                type="button"
              >
                确认当前回答
              </button>
              <label className="field">
                <span>退回原因</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => setReturnReason(event.target.value)}
                  rows={2}
                  value={returnReason}
                />
              </label>
              <button
                className="secondary-button"
                disabled={!canWrite || !returnReason.trim()}
                onClick={() =>
                  void runMutation('RETURN', (key) =>
                    api.returnQuestion(
                      question.requirementId,
                      question.id,
                      { reason: returnReason.trim() },
                      question.rowVersion,
                      key,
                    ),
                  )
                }
                type="button"
              >
                退回答案
              </button>
            </section>
          ) : null}

          {question.status === 'CONFIRMED' ? (
            <section className="question-drawer-section action-section">
              <h3>替代当前决定</h3>
              <label className="field">
                <span>新决定</span>
                <textarea
                  maxLength={10_000}
                  onChange={(event) => setRawAnswer(event.target.value)}
                  rows={3}
                  value={rawAnswer}
                />
              </label>
              <label className="field">
                <span>替代说明</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => setExplanation(event.target.value)}
                  rows={2}
                  value={explanation}
                />
              </label>
              <button
                className="primary-button"
                disabled={!canWrite || !rawAnswer.trim()}
                onClick={() =>
                  void runMutation('SUPERSEDE', (key) =>
                    api.supersedeQuestion(
                      question.requirementId,
                      question.id,
                      {
                        rawAnswer: rawAnswer.trim(),
                        explanation: explanation.trim() || null,
                        confirmedRole,
                      },
                      question.rowVersion,
                      key,
                    ),
                  )
                }
                type="button"
              >
                确认替代决定
              </button>
            </section>
          ) : null}

          {question.status === 'OPEN' || question.status === 'ANSWERED' ? (
            <section className="question-drawer-section action-section">
              <h3>延后处理</h3>
              <label className="field">
                <span>延后原因</span>
                <textarea
                  maxLength={10_000}
                  onChange={(event) => setDeferReason(event.target.value)}
                  rows={2}
                  value={deferReason}
                />
              </label>
              <label className="field">
                <span>重新进入条件</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => setReopenCondition(event.target.value)}
                  rows={2}
                  value={reopenCondition}
                />
              </label>
              <button
                className="secondary-button"
                disabled={
                  !canWrite || !deferReason.trim() || !reopenCondition.trim()
                }
                onClick={() =>
                  void runMutation('DEFER', (key) =>
                    api.deferQuestion(
                      question.requirementId,
                      question.id,
                      {
                        reason: deferReason.trim(),
                        reopenCondition: reopenCondition.trim(),
                        confirmedRole,
                      },
                      question.rowVersion,
                      key,
                    ),
                  )
                }
                type="button"
              >
                延后问题
              </button>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
