============================================================
CODE REVIEW REPORT
============================================================
Project Type : frontend
Review Scope : full
Files Reviewed: 83
Date : 2026-09-18 20:20
============================================================
------------------------------------------------------------
SUMMARY
------------------------------------------------------------
L0 : 0
L1 : 0
L2 : 0
L3 : 1
TOTAL : 1
RESULT : PASS
------------------------------------------------------------
(FAIL when L0 > 0 or L1 > 0)
============================================================
ISSUES
============================================================
[L3] FR-01: useEffect 依赖数组通过 eslint-disable 跳过 exhaustive-deps
文件 : apps/web/src/agent-runs/StageCapabilityConfigPanel.tsx
行号 : 92-95
分类 : 维护性
规则 : LOG-F04
描述 : load 回调引用 active（用于修正失效 tab），但 useEffect 以空依赖数组 + eslint-disable 抑制告警。当前仅在挂载时调用一次，active 初值 'idea' 固定，行为正确，但依赖关系不透明，后续若挂载逻辑调整易引入过期闭包。
建议 : 将 load 拆分为不依赖 active 的 fetch 主体 + 独立 setActive 修正逻辑，使 useEffect 依赖数组保持真实，避免 eslint-disable。

------------------------------------------------------------
REVIEWED FILES
============================================================
apps/web/src/agent-runs/AgentAuditPanel.tsx
apps/web/src/agent-runs/AgentRunDetail.tsx
apps/web/src/agent-runs/AgentRunLaunchPanel.tsx
apps/web/src/agent-runs/AgentRunList.tsx
apps/web/src/agent-runs/AgentRunsHeader.tsx
apps/web/src/agent-runs/AgentRunsPage.tsx
apps/web/src/agent-runs/ApprovalInbox.tsx
apps/web/src/agent-runs/BridgeCenter.tsx
apps/web/src/agent-runs/SkillCatalog.tsx
apps/web/src/agent-runs/StageCapabilityConfigPanel.tsx
apps/web/src/agent-runs/model.ts
apps/web/src/agent-runs/api.ts
apps/web/src/artifact-workspace/ArtifactContentPanel.tsx
apps/web/src/artifact-workspace/ArtifactReviewPanel.tsx
apps/web/src/artifact-workspace/ArtifactTracePanel.tsx
apps/web/src/artifact-workspace/ArtifactWorkspacePage.tsx
apps/web/src/artifacts/ArtifactCatalogPage.tsx
apps/web/src/artifacts/api.ts
apps/web/src/identity/LoginPage.tsx
apps/web/src/identity/session-store.ts
apps/web/src/operations/gate-center/GateCenterPage.tsx
apps/web/src/operations/gate-center/GateCenterTable.tsx
apps/web/src/operations/material-library/MaterialLibraryPage.tsx
apps/web/src/operations/material-library/MaterialLibraryTable.tsx
apps/web/src/platform/api-client.ts
apps/web/src/platform/PlatformPageShell.tsx
apps/web/src/team-admin/TeamAdminPage.tsx
apps/web/src/team-admin/WorkspaceRegistrationForm.tsx
apps/web/src/work-sessions/ProductWorkSessionPage.tsx
apps/web/src/work-sessions/WorkConversation.tsx
apps/web/src/work-sessions/McpToolCalls.tsx
apps/web/src/work-sessions/RequirementContextPanel.tsx
apps/web/src/work-sessions/ProposalCanvas.tsx
apps/web/src/work-sessions/WorkspaceEvidence.tsx
apps/web/src/work-sessions/WorkReadinessPanel.tsx
apps/web/src/work-sessions/useProductWorkSession.ts
apps/web/src/workbench/RequirementDetail.tsx
apps/web/src/workbench/RequirementDialogs.tsx
apps/web/src/workbench/RequirementList.tsx
apps/web/src/workbench/WorkbenchHeader.tsx
apps/web/src/workbench/WorklistSection.tsx
apps/web/src/App.tsx
apps/web/src/AuthenticatedPlatformRoutes.tsx
apps/web/src/GateRunPanel.tsx
apps/web/src/MaterialImpactPanel.tsx
apps/web/src/QuestionDrawer.tsx
apps/web/src/RequirementWorkbenchApp.tsx
apps/web/src/StatusPill.tsx
apps/web/src/TimelinePanel.tsx
apps/web/src/WorkbenchPreviewPage.tsx
apps/web/src/UiKitPage.tsx
apps/web/src/main.tsx
apps/web/src/requirements-api.ts
apps/web/src/useDialogFocus.ts
apps/web/src/styles.css
apps/web/src/agent-runs/agent-runs.css
apps/web/src/artifact-workspace/artifact-workspace.css
apps/web/src/identity/identity.css
apps/web/src/operations/gate-center/gate-center.css
apps/web/src/operations/material-library/material-library.css
apps/web/src/team-admin/team-admin.css
apps/web/src/work-sessions/work-sessions.css
apps/web/src/workbench/workbench.css
apps/web/src/workbench-preview.css
apps/web/src/platform/platform-shell.css
============================================================
{"pass": true, "L0": 0, "L1": 0, "L2": 0, "L3": 1, "total": 1, "files_reviewed": 83}
