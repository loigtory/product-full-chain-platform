import {
  useDeferredValue,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';

import type {
  CurrentActorDto,
  QuestionDto,
  QuestionMutationAction,
  RequirementDetailDto,
  RequirementListItemDto,
  RequirementListScope,
  RequirementListView,
} from '@pfc/contracts';
import { PageIntro } from '@pfc/ui';

import {
  RequirementSubmissionUnknownError,
  requirementsApi,
  type RequirementsApi,
} from './requirements-api.ts';
import { GateCenterPage, MaterialLibraryPage } from './operations/index.ts';
import { QuestionDrawer } from './QuestionDrawer.tsx';
import { WorkbenchPreviewPage } from './WorkbenchPreviewPage.tsx';
import {
  compactRegistration,
  emptyCreate,
  emptyRegistration,
  errorMessage,
  experienceActorId,
  idempotencyKey,
  pageTitle,
  routeListState,
  routeRequirementId,
  routeWorkspacePage,
  type CreateForm,
  type RegistrationForm,
  type WorkspacePage,
} from './workbench/model.tsx';
import {
  CompleteRegistrationDialog,
  CreateRequirementDialog,
} from './workbench/RequirementDialogs.tsx';
import { RequirementDetail } from './workbench/RequirementDetail.tsx';
import { WorkbenchHeader } from './workbench/WorkbenchHeader.tsx';
import { WorklistSection } from './workbench/WorklistSection.tsx';

export function RequirementWorkbenchApp({
  api = requirementsApi,
  experienceMode = import.meta.env.MODE === 'experience',
  actor,
  jobsEnabled = false,
  onLogout,
}: {
  api?: RequirementsApi;
  experienceMode?: boolean;
  actor?: CurrentActorDto;
  jobsEnabled?: boolean;
  onLogout?: () => void;
}) {
  if (window.location.pathname === '/ui-preview/workbench') {
    return <WorkbenchPreviewPage api={api} experienceMode={experienceMode} />;
  }
  return (
    <LifecycleApp
      actor={actor}
      api={api}
      experienceMode={experienceMode}
      jobsEnabled={jobsEnabled}
      onLogout={onLogout}
    />
  );
}

function LifecycleApp({
  api = requirementsApi,
  experienceMode = import.meta.env.MODE === 'experience',
  actor,
  jobsEnabled = false,
  onLogout,
}: {
  api?: RequirementsApi;
  experienceMode?: boolean;
  actor?: CurrentActorDto;
  jobsEnabled?: boolean;
  onLogout?: () => void;
}) {
  const [initial] = useState(() => routeListState());
  const [page, setPage] = useState<WorkspacePage>(routeWorkspacePage);
  const [scope, setScope] = useState<RequirementListScope>(initial.scope);
  const [view, setView] = useState<RequirementListView>(initial.view);
  const [search, setSearch] = useState(initial.search);
  const deferredSearch = useDeferredValue(search);
  const [items, setItems] = useState<readonly RequirementListItemDto[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [listRevision, setListRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    routeRequirementId,
  );
  const [detail, setDetail] = useState<RequirementDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(selectedId));
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLastLoadedAt, setDetailLastLoadedAt] = useState<string | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);
  const [registrationForm, setRegistrationForm] =
    useState<RegistrationForm>(emptyRegistration);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [unknownKey, setUnknownKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (selectedId || page !== 'WORKBENCH') return;
    const controller = new AbortController();
    void api
      .listRequirements(
        { scope, search: deferredSearch, limit: 50 },
        controller.signal,
      )
      .then((response) => {
        setItems(response.items);
        setLastCheckedAt(response.checkedAt);
        setListError(null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setListError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [api, deferredSearch, listRevision, page, scope, selectedId]);

  const reloadDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      const next = await api.getRequirement(selectedId);
      setDetail(next);
      setDetailError(null);
      setDetailLastLoadedAt(new Date().toISOString());
    } catch (error) {
      setDetail(null);
      setDetailError(errorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  }, [api, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    api
      .getRequirement(selectedId, controller.signal)
      .then((next) => {
        setDetail(next);
        setDetailError(null);
        setDetailLastLoadedAt(new Date().toISOString());
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setDetail(null);
          setDetailError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [api, selectedId]);

  useEffect(() => {
    const from =
      page === 'GATE_CENTER'
        ? 'gate-center'
        : page === 'MATERIAL_LIBRARY'
          ? 'material-library'
          : null;
    const nextUrl = selectedId
      ? `/requirements/${encodeURIComponent(selectedId)}${from ? `?from=${from}` : ''}`
      : page === 'GATE_CENTER'
        ? '/gate-center'
        : page === 'MATERIAL_LIBRARY'
          ? '/material-library'
          : `/?${new URLSearchParams({ scope, view, ...(search ? { search } : {}) }).toString()}`;
    window.history.replaceState(null, '', nextUrl);
  }, [page, scope, search, selectedId, view]);

  useEffect(() => {
    document.getElementById('main-workspace')?.focus({ preventScroll: true });
  }, [page, selectedId]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        'pfc.workbench.view.v1',
        JSON.stringify({ scope, view, search }),
      );
    } catch {
      // The URL remains the fallback when session storage is unavailable.
    }
  }, [scope, search, view]);

  function openDetail(id: string) {
    setDetail(null);
    setDetailLoading(true);
    setSelectedId(id);
    setDetailError(null);
    setDetailLastLoadedAt(null);
  }

  function closeDetail() {
    setSelectedQuestionId(null);
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }

  function navigate(nextPage: WorkspacePage) {
    if (nextPage === 'TEAM_ADMIN') {
      window.location.assign('/team-admin');
      return;
    }
    if (nextPage === 'AGENT_RUNS') {
      window.location.assign('/jobs');
      return;
    }
    setSelectedQuestionId(null);
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setPage(nextPage);
  }

  function applyQuestionMutation(
    action: QuestionMutationAction,
    nextQuestion: QuestionDto,
    originalQuestionId: string,
  ) {
    setDetail((current) => {
      if (!current) return current;
      if (action === 'SUPERSEDE') {
        return {
          ...current,
          questions: [
            ...current.questions.map((item) =>
              item.id === originalQuestionId
                ? {
                    ...item,
                    status: 'SUPERSEDED' as const,
                    supersededByQuestionId: nextQuestion.id,
                    rowVersion: item.rowVersion + 1,
                  }
                : item,
            ),
            nextQuestion,
          ],
        };
      }
      return {
        ...current,
        questions: current.questions.map((item) =>
          item.id === originalQuestionId ? nextQuestion : item,
        ),
      };
    });
    if (action === 'SUPERSEDE') setSelectedQuestionId(nextQuestion.id);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!createForm.name.trim()) errors.name = '请填写需求名称';
    if (!createForm.originalIdea.trim()) errors.originalIdea = '请填写原始想法';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const key = idempotencyKey('CREATE');
    setSubmitting(true);
    setBanner(null);
    try {
      const response = await api.createRequirement(
        {
          name: createForm.name.trim(),
          originalIdea: createForm.originalIdea.trim(),
          registration: compactRegistration(createForm),
        },
        key,
      );
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      setDetail(response.requirement);
      setSelectedId(response.requirement.id);
    } catch (error) {
      if (error instanceof RequirementSubmissionUnknownError) {
        setUnknownKey(error.idempotencyKey);
        setBanner('保存结果待核验');
      } else {
        setBanner(`草稿未创建。${errorMessage(error)}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyUnknownSubmission() {
    if (!unknownKey) return;
    setSubmitting(true);
    try {
      const result = await api.getRequirementSubmission(unknownKey);
      if (result.status === 'CREATED' && result.existingResourceId) {
        setCreateOpen(false);
        setUnknownKey(null);
        setBanner(null);
        openDetail(result.existingResourceId);
      } else {
        if (result.status === 'NOT_FOUND') {
          setUnknownKey(null);
          setBanner('未发现已保存的需求，可以重新提交');
        } else {
          setBanner('保存结果仍无法确认');
        }
      }
    } catch (error) {
      setBanner(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function beginCompletion() {
    if (!detail) return;
    setRegistrationForm({
      sourceType: detail.registration.sourceType ?? '',
      sourceDescription: detail.registration.sourceDescription ?? '',
      businessOwnerId:
        detail.registration.businessOwnerId ??
        (experienceMode ? experienceActorId : ''),
      materialPurpose: detail.registration.materialPurpose ?? '',
      sensitivity: detail.registration.sensitivity ?? '',
    });
    setFormErrors({});
    setBanner(null);
    setCompleteOpen(true);
  }

  async function submitCompletion(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const errors: Record<string, string> = {};
    if (!registrationForm.sourceType) errors.sourceType = '请选择来源';
    if (
      registrationForm.sourceType === 'OTHER' &&
      !registrationForm.sourceDescription.trim()
    )
      errors.sourceDescription = '选择其他来源时请填写来源说明';
    if (!registrationForm.businessOwnerId.trim())
      errors.businessOwnerId = '请填写业务责任人';
    if (!registrationForm.materialPurpose)
      errors.materialPurpose = '请选择材料用途';
    if (!registrationForm.sensitivity) errors.sensitivity = '请选择敏感级别';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const response = await api.completeG0Registration(
        detail.id,
        compactRegistration(registrationForm),
        detail.rowVersion,
        idempotencyKey('COMPLETE'),
      );
      setDetail(response.requirement);
      setCompleteOpen(false);
    } catch (error) {
      setBanner(
        error instanceof RequirementSubmissionUnknownError
          ? '补充结果待核验，请刷新详情确认当前版本'
          : errorMessage(error),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedQuestion =
    detail?.questions.find((item) => item.id === selectedQuestionId) ?? null;
  const operationsRoute = page === 'GATE_CENTER' || page === 'MATERIAL_LIBRARY';

  return (
    <>
      <a className="skip-link" href="#main-workspace">
        跳到主要内容
      </a>
      <div aria-live="polite" className="desktop-width-notice" role="status">
        当前工作台需要至少 1120px 的桌面显示宽度
      </div>
      <div className="app-shell">
        <WorkbenchHeader
          actor={actor}
          experienceMode={experienceMode}
          jobsEnabled={jobsEnabled}
          onCreate={() => {
            setFormErrors({});
            setBanner(null);
            setUnknownKey(null);
            setCreateForm({
              ...emptyCreate,
              businessOwnerId: experienceMode ? experienceActorId : '',
            });
            setCreateOpen(true);
          }}
          onLogout={onLogout}
          onNavigate={navigate}
          operationsRoute={operationsRoute}
          page={page}
        />

        <main
          className={`workspace ${!selectedId && page === 'WORKBENCH' ? 'workspace--workbench' : ''}`.trim()}
          id="main-workspace"
          tabIndex={-1}
        >
          {!selectedId && page === 'WORKBENCH' ? (
            <PageIntro
              context={
                <span className="page-context">
                  CAP-PFC-01 · 本地工作区
                  {experienceMode ? (
                    <span className="experience-badge">本地数据库体验</span>
                  ) : null}
                </span>
              }
              density="compact"
              description="集中登记、筛选并推动产品需求进入可审计的全链路流程。"
              module="requirements"
              title="需求工作台"
            />
          ) : null}

          {banner && !createOpen && !completeOpen ? (
            <div className="notice-banner" role="status">
              {banner}
            </div>
          ) : null}

          {selectedId ? (
            <RequirementDetail
              api={api}
              detail={detail}
              error={detailError}
              loading={detailLoading}
              onBack={closeDetail}
              onComplete={beginCompletion}
              onDetailChange={setDetail}
              onOpenQuestion={setSelectedQuestionId}
              onReload={reloadDetail}
              lastLoadedAt={detailLastLoadedAt}
              backLabel={pageTitle(page)}
              jobsEnabled={jobsEnabled}
            />
          ) : page === 'GATE_CENTER' ? (
            <GateCenterPage api={api} onOpenRequirement={openDetail} />
          ) : page === 'MATERIAL_LIBRARY' ? (
            <MaterialLibraryPage api={api} onOpenRequirement={openDetail} />
          ) : (
            <WorklistSection
              items={items}
              lastCheckedAt={lastCheckedAt}
              listError={listError}
              listLoading={listLoading}
              onOpen={openDetail}
              onRetry={() => {
                setListError(null);
                setListLoading(true);
                setListRevision((value) => value + 1);
              }}
              onScopeChange={(value) => {
                setListError(null);
                setListLoading(true);
                setScope(value);
              }}
              onSearchChange={(value) => {
                setListError(null);
                setListLoading(true);
                setSearch(value);
              }}
              onViewChange={setView}
              scope={scope}
              search={deferredSearch}
              view={view}
            />
          )}
        </main>

        {createOpen ? (
          <CreateRequirementDialog
            banner={banner}
            createForm={createForm}
            experienceMode={experienceMode}
            formErrors={formErrors}
            onChange={setCreateForm}
            onClose={() => setCreateOpen(false)}
            onSubmit={submitCreate}
            onVerify={() => void verifyUnknownSubmission()}
            submitting={submitting}
            unknownKey={unknownKey}
          />
        ) : null}

        {completeOpen && detail ? (
          <CompleteRegistrationDialog
            banner={banner}
            detailName={detail.name}
            experienceMode={experienceMode}
            formErrors={formErrors}
            onChange={setRegistrationForm}
            onClose={() => setCompleteOpen(false)}
            onSubmit={submitCompletion}
            originalIdea={detail.originalIdea}
            registrationForm={registrationForm}
            submitting={submitting}
          />
        ) : null}

        {selectedQuestion ? (
          <QuestionDrawer
            api={api}
            key={selectedQuestionId}
            onClose={() => setSelectedQuestionId(null)}
            onQuestionChange={applyQuestionMutation}
            question={selectedQuestion}
          />
        ) : null}
      </div>
    </>
  );
}
