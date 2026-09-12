import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('operations module boundaries', () => {
  it('keeps independently routed frontend pages in separate feature modules', async () => {
    const webRoot = path.join(root, 'apps', 'web', 'src');
    const [
      app,
      routes,
      workbench,
      gatePage,
      gateTable,
      gateFilters,
      materialPage,
      materialTable,
      materialFilters,
      shared,
      model,
      entry,
    ] = await Promise.all([
      readFile(path.join(webRoot, 'App.tsx'), 'utf8'),
      readFile(path.join(webRoot, 'AuthenticatedPlatformRoutes.tsx'), 'utf8'),
      readFile(path.join(webRoot, 'RequirementWorkbenchApp.tsx'), 'utf8'),
      readFile(
        path.join(webRoot, 'operations', 'gate-center', 'GateCenterPage.tsx'),
        'utf8',
      ),
      readFile(
        path.join(webRoot, 'operations', 'gate-center', 'GateCenterTable.tsx'),
        'utf8',
      ),
      readFile(
        path.join(webRoot, 'operations', 'gate-center', 'filters.ts'),
        'utf8',
      ),
      readFile(
        path.join(
          webRoot,
          'operations',
          'material-library',
          'MaterialLibraryPage.tsx',
        ),
        'utf8',
      ),
      readFile(
        path.join(
          webRoot,
          'operations',
          'material-library',
          'MaterialLibraryTable.tsx',
        ),
        'utf8',
      ),
      readFile(
        path.join(webRoot, 'operations', 'material-library', 'filters.ts'),
        'utf8',
      ),
      readFile(path.join(webRoot, 'operations', 'shared.tsx'), 'utf8'),
      readFile(path.join(webRoot, 'operations', 'model.ts'), 'utf8'),
      readFile(path.join(webRoot, 'operations', 'index.ts'), 'utf8'),
    ]);

    expect(app).toContain("from './AuthenticatedPlatformRoutes.tsx'");
    expect(app.split('\n').length).toBeLessThan(130);
    expect(routes).toContain("from './team-admin/TeamAdminPage.tsx'");
    expect(routes).toContain("from './artifacts/ArtifactCatalogPage.tsx'");
    expect(routes).toContain(
      "from './work-sessions/ProductWorkSessionPage.tsx'",
    );
    expect(routes.split('\n').length).toBeLessThan(100);
    expect(workbench).toContain("from './operations/index.ts'");
    expect(workbench).toContain("from './workbench/RequirementDetail.tsx'");
    expect(workbench).toContain("from './workbench/WorklistSection.tsx'");
    expect(workbench.split('\n').length).toBeLessThan(600);
    expect(gatePage).toContain('export function GateCenterPage');
    expect(gatePage).toContain("from './GateCenterTable.tsx'");
    expect(gatePage).not.toContain('MaterialLibraryPage');
    expect(gatePage.split('\n').length).toBeLessThan(350);
    expect(gateTable).not.toContain('listGateCenter');
    expect(gateFilters).toContain('initialGateFilters');
    expect(materialPage).toContain('export function MaterialLibraryPage');
    expect(materialPage).toContain("from './MaterialLibraryTable.tsx'");
    expect(materialPage).not.toContain('GateCenterPage');
    expect(materialPage.split('\n').length).toBeLessThan(350);
    expect(materialTable).not.toContain('listMaterialLibrary');
    expect(materialFilters).toContain('initialMaterialFilters');
    expect(shared).not.toContain('listGateCenter');
    expect(shared).not.toContain('listMaterialLibrary');
    expect(model).not.toContain('function OperationsState');
    expect(model).not.toContain('function OperationsFreshness');
    expect(entry).toContain("from './gate-center/GateCenterPage.tsx'");
    expect(entry).toContain(
      "from './material-library/MaterialLibraryPage.tsx'",
    );
    await expect(
      access(path.join(webRoot, 'OperationsPages.tsx')),
    ).rejects.toThrow();
  });

  it('keeps backend transport, application logic, and persistence contracts separate', async () => {
    const operationsRoot = path.join(
      root,
      'apps',
      'server',
      'src',
      'operations',
    );
    const [routes, service, repositoryPort] = await Promise.all([
      readFile(path.join(operationsRoot, 'routes.ts'), 'utf8'),
      readFile(path.join(operationsRoot, 'application-service.ts'), 'utf8'),
      readFile(path.join(operationsRoot, 'repository-port.ts'), 'utf8'),
    ]);

    expect(routes).toContain('registerOperationsRoutes');
    expect(routes).toContain('OperationsApplicationService');
    expect(service).toContain('OperationsRepositoryPort');
    expect(repositoryPort).toContain(
      'export interface OperationsRepositoryPort',
    );
    expect(repositoryPort).not.toContain('FastifyInstance');
  });

  it('keeps workspace registration behavior out of the Team Admin page composer', async () => {
    const teamAdminRoot = path.join(root, 'apps', 'web', 'src', 'team-admin');
    const [page, registrationForm] = await Promise.all([
      readFile(path.join(teamAdminRoot, 'TeamAdminPage.tsx'), 'utf8'),
      readFile(
        path.join(teamAdminRoot, 'WorkspaceRegistrationForm.tsx'),
        'utf8',
      ),
    ]);

    expect(page).toContain("from './WorkspaceRegistrationForm.tsx'");
    expect(page).not.toContain('name="repositoryFingerprint"');
    expect(registrationForm).toContain(
      'export function WorkspaceRegistrationForm',
    );
    expect(registrationForm).not.toContain("from './api.ts'");
    expect(page.split('\n').length).toBeLessThan(430);
  });

  it('keeps AI workspace readiness state, rendering, and page composition separate', async () => {
    const workSessionRoot = path.join(
      root,
      'apps',
      'web',
      'src',
      'work-sessions',
    );
    const [page, hook, panel, conversation] = await Promise.all([
      readFile(
        path.join(workSessionRoot, 'ProductWorkSessionPage.tsx'),
        'utf8',
      ),
      readFile(path.join(workSessionRoot, 'useProductWorkSession.ts'), 'utf8'),
      readFile(path.join(workSessionRoot, 'WorkReadinessPanel.tsx'), 'utf8'),
      readFile(path.join(workSessionRoot, 'WorkConversation.tsx'), 'utf8'),
    ]);

    expect(page).toContain("from './WorkReadinessPanel.tsx'");
    expect(page).toContain("from './useProductWorkSession.ts'");
    expect(page.split('\n').length).toBeLessThan(220);
    expect(hook).not.toContain('<ReadinessPanel');
    expect(panel).not.toContain("from './api.ts'");
    expect(conversation).not.toContain('getReadiness');
  });

  it('keeps AI workspace readiness orchestration out of the session lifecycle service', async () => {
    const workSessionRoot = path.join(
      root,
      'apps',
      'server',
      'src',
      'work-sessions',
    );
    const [lifecycleService, readinessService] = await Promise.all([
      readFile(path.join(workSessionRoot, 'application-service.ts'), 'utf8'),
      readFile(
        path.join(workSessionRoot, 'readiness-application-service.ts'),
        'utf8',
      ),
    ]);

    expect(lifecycleService).toContain(
      "from './readiness-application-service.ts'",
    );
    expect(lifecycleService).not.toContain('readinessBlockerCopy');
    expect(lifecycleService).not.toContain('sameTransmissionGrant');
    expect(lifecycleService.split('\n').length).toBeLessThan(800);
    expect(readinessService).toContain(
      'export class WorkSessionReadinessApplicationService',
    );
    expect(readinessService).not.toContain('FastifyInstance');
  });
});
