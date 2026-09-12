import { useEffect, useState } from 'react';

import type { CurrentActorDto } from '@pfc/contracts';

import { agentRunsApi } from './agent-runs/api.ts';
import { AuthenticatedPlatformRoutes } from './AuthenticatedPlatformRoutes.tsx';
import { identityApi } from './identity/api.ts';
import { LoginPage } from './identity/LoginPage.tsx';
import { RequirementWorkbenchApp } from './RequirementWorkbenchApp.tsx';
import type { RequirementsApi } from './requirements-api.ts';

export function App({
  api,
  experienceMode = import.meta.env.MODE === 'experience',
}: {
  api?: RequirementsApi;
  experienceMode?: boolean;
}) {
  const authenticatedWorkSessionRoute = /^\/requirements\/[^/]+\/work$/.test(
    window.location.pathname,
  );
  if (
    api ||
    experienceMode ||
    (Boolean(import.meta.env.VITE_TEST_RUN_ID) &&
      !authenticatedWorkSessionRoute) ||
    window.location.pathname === '/ui-preview/workbench'
  ) {
    return (
      <RequirementWorkbenchApp api={api} experienceMode={experienceMode} />
    );
  }
  return <AuthenticatedPlatform />;
}

function AuthenticatedPlatform() {
  const [actor, setActor] = useState<CurrentActorDto | null>(null);
  const [checking, setChecking] = useState(true);
  const [jobsEnabled, setJobsEnabled] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    void identityApi
      .sessionState()
      .then(async (state) => {
        const nextActor = state.authenticated ? state.actor : null;
        setActor(nextActor);
        if (nextActor) {
          setJobsEnabled(await agentRunsApi.isAvailable().catch(() => false));
        }
      })
      .catch((error: unknown) => {
        setStartupError(
          error instanceof Error ? error.message : '服务暂时不可用。',
        );
      })
      .finally(() => setChecking(false));
  }, []);

  async function logout() {
    await identityApi.logout().catch(() => undefined);
    setActor(null);
    window.history.replaceState(null, '', '/');
  }

  if (checking) {
    return (
      <div className="platform-boot" role="status">
        正在恢复工作空间...
      </div>
    );
  }
  if (!actor) {
    return (
      <>
        {startupError ? (
          <div className="startup-error" role="alert">
            {startupError}
          </div>
        ) : null}
        <LoginPage onAuthenticated={setActor} />
      </>
    );
  }
  return (
    <AuthenticatedPlatformRoutes
      actor={actor}
      jobsEnabled={jobsEnabled}
      onLogout={() => void logout()}
    />
  );
}
