import type { CurrentActorDto } from '@pfc/contracts';

import {
  AgentRunsPage,
  AgentRunsUnavailablePage,
} from './agent-runs/AgentRunsPage.tsx';
import { ArtifactCatalogPage } from './artifacts/ArtifactCatalogPage.tsx';
import { ArtifactWorkspacePage } from './artifact-workspace/ArtifactWorkspacePage.tsx';
import { BudgetPage } from './budget/BudgetPage.tsx';
import { RequirementWorkbenchApp } from './RequirementWorkbenchApp.tsx';
import { TeamAdminPage } from './team-admin/TeamAdminPage.tsx';
import { ProductWorkSessionPage } from './work-sessions/ProductWorkSessionPage.tsx';

export function AuthenticatedPlatformRoutes({
  actor,
  jobsEnabled,
  onLogout,
}: {
  actor: CurrentActorDto;
  jobsEnabled: boolean;
  onLogout: () => void;
}) {
  if (window.location.pathname === '/budget') {
    return <BudgetPage />;
  }
  if (window.location.pathname === '/team-admin') {
    return (
      <TeamAdminPage
        actor={actor}
        jobsEnabled={jobsEnabled}
        onLogout={onLogout}
      />
    );
  }
  if (window.location.pathname.startsWith('/jobs')) {
    return jobsEnabled ? (
      <AgentRunsPage actor={actor} onLogout={onLogout} />
    ) : (
      <AgentRunsUnavailablePage actor={actor} onLogout={onLogout} />
    );
  }
  const workSessionMatch = /^\/requirements\/([^/]+)\/work$/.exec(
    window.location.pathname,
  );
  if (workSessionMatch) {
    return (
      <ProductWorkSessionPage
        actor={actor}
        jobsEnabled={jobsEnabled}
        onLogout={onLogout}
        requirementId={decodeURIComponent(workSessionMatch[1]!)}
      />
    );
  }
  const artifactWorkspaceMatch =
    /^\/requirements\/([^/]+)\/artifacts\/([^/]+)$/.exec(
      window.location.pathname,
    );
  if (artifactWorkspaceMatch) {
    return (
      <ArtifactWorkspacePage
        actor={actor}
        artifactId={decodeURIComponent(artifactWorkspaceMatch[2]!)}
        jobsEnabled={jobsEnabled}
        onLogout={onLogout}
        requirementId={decodeURIComponent(artifactWorkspaceMatch[1]!)}
      />
    );
  }
  const artifactMatch = /^\/requirements\/([^/]+)\/artifacts$/.exec(
    window.location.pathname,
  );
  if (artifactMatch) {
    return (
      <ArtifactCatalogPage
        actor={actor}
        jobsEnabled={jobsEnabled}
        onLogout={onLogout}
        requirementId={decodeURIComponent(artifactMatch[1]!)}
      />
    );
  }
  return (
    <RequirementWorkbenchApp
      actor={actor}
      jobsEnabled={jobsEnabled}
      onLogout={onLogout}
    />
  );
}
