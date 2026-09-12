import {
  ArrowLeft,
  ArrowRightCircle,
  ClipboardList,
  Milestone,
  RefreshCw,
  UserRound,
} from 'lucide-react';

import type { RequirementDetailDto } from '@pfc/contracts';

import { GateRunPanel } from '../GateRunPanel.tsx';
import { MaterialImpactPanel } from '../MaterialImpactPanel.tsx';
import type { RequirementsApi } from '../requirements-api.ts';
import { AgentRunLaunchPanel } from '../agent-runs/AgentRunLaunchPanel.tsx';
import { StatusPill } from '../StatusPill.tsx';
import { TimelinePanel } from '../TimelinePanel.tsx';
import {
  friendlyTimestamp,
  missingFieldLabels,
  purposeOptions,
  sensitivityOptions,
  sourceOptions,
  stages,
} from './model.tsx';

export function RequirementDetail({
  api,
  detail,
  error,
  loading,
  onBack,
  onComplete,
  onDetailChange,
  onOpenQuestion,
  onReload,
  lastLoadedAt,
  backLabel,
  jobsEnabled = false,
}: {
  api: RequirementsApi;
  detail: RequirementDetailDto | null;
  error: string | null;
  loading: boolean;
  onBack: () => void;
  onComplete: () => void;
  onDetailChange: (detail: RequirementDetailDto) => void;
  onOpenQuestion: (questionId: string) => void;
  onReload: () => Promise<void>;
  lastLoadedAt: string | null;
  backLabel: string;
  jobsEnabled?: boolean;
}) {
  if (loading) {
    return (
      <div
        aria-label="正在读取需求详情"
        className="detail-state detail-skeleton"
        role="status"
      >
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (error) {
    return (
      <div className="detail-state error-state">
        <strong>{error}</strong>
        {lastLoadedAt ? (
          <span>最近成功读取：{friendlyTimestamp(lastLoadedAt)}</span>
        ) : null}
        <button
          className="primary-button"
          onClick={() => void onReload()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
          重新加载
        </button>
        <button className="secondary-button" onClick={onBack} type="button">
          返回{backLabel}
        </button>
      </div>
    );
  }
  if (!detail) return null;
  const registrationComplete = Boolean(detail.currentBaseline);
  const currentStageIndex = stages.indexOf(detail.currentStage);
  const nextAction = !registrationComplete
    ? '完成缺失的登记字段'
    : detail.gateProjection === 'PROCESSING' ||
        detail.gateProjection === 'UNKNOWN'
      ? '核验当前门禁结果'
      : detail.gateProjection === 'BLOCK'
        ? '处理当前阻断项'
        : detail.gateProjection === 'WARN'
          ? '复核当前门禁警告'
          : `运行 ${detail.currentStage} 阶段门禁`;
  return (
    <article className="detail-page">
      <button className="back-button" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
        返回{backLabel}
      </button>
      <header className="detail-heading">
        <div className="detail-title">
          <div>
            <p className="eyebrow">需求编号 · {detail.id}</p>
            <h1>{detail.name}</h1>
            <p>{detail.originalIdea}</p>
            <a
              className="artifact-catalog-link"
              href={`/requirements/${encodeURIComponent(detail.id)}/artifacts`}
            >
              <ClipboardList aria-hidden="true" size={15} strokeWidth={1.8} />
              查看产物目录
            </a>
          </div>
          {registrationComplete ? (
            <StatusPill value={detail.gateProjection} />
          ) : null}
        </div>
        <dl className="detail-summary">
          <div>
            <dt>
              <Milestone aria-hidden="true" size={16} strokeWidth={1.8} />
              当前阶段
            </dt>
            <dd>{detail.currentStage}</dd>
          </div>
          <div>
            <dt>
              <UserRound aria-hidden="true" size={16} strokeWidth={1.8} />
              当前责任人
            </dt>
            <dd title={detail.businessOwnerId ?? detail.initiatorId}>
              {detail.businessOwnerId ?? detail.initiatorId}
            </dd>
          </div>
          <div>
            <dt>
              <ArrowRightCircle
                aria-hidden="true"
                size={16}
                strokeWidth={1.8}
              />
              下一步
            </dt>
            <dd>{nextAction}</dd>
          </div>
        </dl>
      </header>
      <nav aria-label="需求生命周期" className="lifecycle-track">
        {stages.map((stage, index) => {
          const state =
            index < currentStageIndex
              ? 'completed'
              : index > currentStageIndex
                ? 'future'
                : detail.gateProjection === 'BLOCK'
                  ? 'blocked'
                  : 'current';
          return (
            <span
              aria-current={index === currentStageIndex ? 'step' : undefined}
              className={`lifecycle-stage lifecycle-${state}`}
              data-state={state}
              key={stage}
            >
              {stage}
            </span>
          );
        })}
      </nav>
      <section className="detail-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">G0 · 需求登记</p>
            <h2>
              {registrationComplete ? 'G0 登记已完整' : '补齐 G0 登记信息'}
            </h2>
          </div>
          {!registrationComplete ? (
            <button
              className="primary-button"
              onClick={onComplete}
              type="button"
            >
              补齐 G0 信息
            </button>
          ) : null}
        </div>
        {registrationComplete && detail.currentBaseline ? (
          <dl className="detail-grid">
            <div>
              <dt>来源</dt>
              <dd>
                {
                  sourceOptions.find(
                    ([value]) => value === detail.currentBaseline?.sourceType,
                  )?.[1]
                }
              </dd>
            </div>
            <div>
              <dt>业务责任人</dt>
              <dd title={detail.businessOwnerId ?? undefined}>
                {detail.businessOwnerId}
              </dd>
            </div>
            <div>
              <dt>材料用途</dt>
              <dd>
                {
                  purposeOptions.find(
                    ([value]) =>
                      value === detail.currentBaseline?.materialPurpose,
                  )?.[1]
                }
              </dd>
            </div>
            <div>
              <dt>敏感级别</dt>
              <dd>
                {
                  sensitivityOptions.find(
                    ([value]) => value === detail.currentBaseline?.sensitivity,
                  )?.[1]
                }
              </dd>
            </div>
            {detail.currentBaseline.sourceDescription ? (
              <div className="detail-wide">
                <dt>来源说明</dt>
                <dd>{detail.currentBaseline.sourceDescription}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <div className="missing-summary">
            <StatusPill value="BLOCK" />
            <div>
              <p>补齐前不会执行 G0 门禁，当前缺少：</p>
              <ul>
                {detail.missingFields.map((field) => (
                  <li key={field}>{missingFieldLabels[field] ?? field}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
      {registrationComplete ? (
        <GateRunPanel
          api={api}
          detail={detail}
          onDetailChange={onDetailChange}
        />
      ) : null}
      {registrationComplete ? (
        <MaterialImpactPanel api={api} detail={detail} onReload={onReload} />
      ) : null}
      {registrationComplete && jobsEnabled ? (
        <AgentRunLaunchPanel requirementId={detail.id} />
      ) : null}
      <section className="detail-section question-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">当前基线 · 问题</p>
            <h2>问题与决定</h2>
          </div>
          <span className="question-count">
            {
              detail.questions.filter(
                (question) =>
                  question.status === 'OPEN' || question.status === 'ANSWERED',
              ).length
            }{' '}
            项待处理
          </span>
        </div>
        {detail.questions.length === 0 ? (
          <p className="question-empty">当前基线没有待处理问题</p>
        ) : (
          <div className="question-list">
            {detail.questions.map((question) => (
              <article className="question-row" key={question.id}>
                <div>
                  <div className="question-row-heading">
                    <StatusPill value={question.status} />
                    <span>最晚 {question.closeByStage} 关闭</span>
                  </div>
                  <h3>{question.prompt}</h3>
                  {question.reason ? <p>{question.reason}</p> : null}
                </div>
                <button
                  aria-label={`处理问题：${question.prompt}`}
                  className="secondary-button"
                  onClick={() => onOpenQuestion(question.id)}
                  type="button"
                >
                  查看与处理
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
      <TimelinePanel
        api={api}
        key={detail.id}
        onAuthorityRefresh={onReload}
        requirementId={detail.id}
      />
    </article>
  );
}
