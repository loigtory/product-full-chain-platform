import type {
  AppendArtifactVersionRequest,
  ArtifactDto,
  RegisterArtifactRequest,
} from '@pfc/contracts';

import { createUiIdempotencyKey } from '../idempotency.ts';
import { platformRequest } from '../platform/api-client.ts';

export const artifactApi = {
  list: (requirementId: string) =>
    platformRequest<readonly ArtifactDto[]>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/artifacts`,
    ),
  create: (requirementId: string, input: RegisterArtifactRequest) =>
    platformRequest<{ replayed: boolean; artifact: ArtifactDto }>(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/artifacts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('REGISTER_ARTIFACT'),
        },
        body: JSON.stringify(input),
      },
    ),
  append: (
    artifactId: string,
    rowVersion: number,
    input: AppendArtifactVersionRequest,
  ) =>
    platformRequest<{ replayed: boolean; artifact: ArtifactDto }>(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('APPEND_ARTIFACT_VERSION'),
          'If-Match': `"${rowVersion}"`,
        },
        body: JSON.stringify(input),
      },
    ),
};
