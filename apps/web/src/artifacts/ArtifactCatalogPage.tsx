import { useEffect, useState, type FormEvent } from 'react';
import { Archive, FilePlus2, History, Plus, RefreshCw } from 'lucide-react';

import type {
  AppendArtifactVersionRequest,
  ArtifactDto,
  ArtifactSourceType,
  CurrentActorDto,
  LifecycleStage,
  SensitivityLevel,
} from '@pfc/contracts';
import { Button } from '@pfc/ui';

import { PlatformPageShell } from '../platform/PlatformPageShell.tsx';
import { artifactApi } from './api.ts';
import './artifacts.css';

const initialVersion = {
  versionLabel: 'V0.1',
  sourceType: 'WORKSPACE_RELATIVE' as ArtifactSourceType,
  sourceRef: '',
  contentHash: '',
  sensitivity: 'INTERNAL' as SensitivityLevel,
};

export function ArtifactCatalogPage({
  actor,
  jobsEnabled = false,
  requirementId,
  onLogout,
}: {
  actor: CurrentActorDto;
  jobsEnabled?: boolean;
  requirementId: string;
  onLogout: () => void;
}) {
  const [items, setItems] = useState<readonly ArtifactDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [appendTarget, setAppendTarget] = useState<ArtifactDto | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await artifactApi.list(requirementId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产物目录读取失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void artifactApi
      .list(requirementId)
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '产物目录读取失败。',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requirementId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const version: AppendArtifactVersionRequest = {
      versionLabel: String(form.get('versionLabel') ?? ''),
      sourceType: String(form.get('sourceType')) as ArtifactSourceType,
      sourceRef: String(form.get('sourceRef') ?? ''),
      contentHash: String(form.get('contentHash') ?? ''),
      sensitivity: String(form.get('sensitivity')) as SensitivityLevel,
    };
    try {
      if (appendTarget) {
        await artifactApi.append(
          appendTarget.id,
          appendTarget.rowVersion,
          version,
        );
      } else {
        await artifactApi.create(requirementId, {
          capId: String(form.get('capId') ?? ''),
          stage: String(form.get('stage')) as LifecycleStage,
          artifactType: String(form.get('artifactType') ?? ''),
          title: String(form.get('title') ?? ''),
          ...version,
        });
      }
      setFormOpen(false);
      setAppendTarget(null);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '产物登记失败。');
    }
  }

  const empty = !loading && !error && items.length === 0;
  return (
    <PlatformPageShell
      active="requirements"
      actor={actor}
      description={`需求 ${requirementId} 的阶段产物、权威版本与受控来源。`}
      jobsEnabled={jobsEnabled}
      onLogout={onLogout}
      title="产物目录"
      actions={
        <>
          <Button
            icon={<RefreshCw aria-hidden="true" size={16} />}
            onClick={() => void reload()}
            variant="secondary"
          >
            刷新
          </Button>
          <Button
            icon={<Plus aria-hidden="true" size={16} />}
            onClick={() => {
              setAppendTarget(null);
              setFormOpen(true);
            }}
          >
            登记产物
          </Button>
        </>
      }
    >
      <a
        className="artifact-back"
        href={`/requirements/${encodeURIComponent(requirementId)}`}
      >
        返回需求详情
      </a>
      {error ? (
        <p className="module-message error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="module-loading">正在读取产物目录...</p> : null}
      {empty ? (
        <section className="artifact-empty">
          <FilePlus2 aria-hidden="true" size={28} strokeWidth={1.5} />
          <h2>当前需求尚未登记阶段产物</h2>
          <p>登记首个不可变版本后，平台会明确当前权威版本和来源。</p>
          <Button onClick={() => setFormOpen(true)}>登记首个产物</Button>
        </section>
      ) : null}
      <div className="artifact-list">
        {items.map((item) => {
          const current = item.versions.find(
            (version) => version.id === item.currentVersionId,
          );
          return (
            <article className="artifact-row" key={item.id}>
              <header>
                <span className="artifact-type">
                  <Archive aria-hidden="true" size={15} />
                  {item.artifactType}
                </span>
                <span className="artifact-stage">{item.stage}</span>
                <h2>
                  <a
                    href={`/requirements/${encodeURIComponent(requirementId)}/artifacts/${encodeURIComponent(item.id)}`}
                  >
                    {item.title}
                  </a>
                </h2>
                <Button
                  icon={<Plus aria-hidden="true" size={15} />}
                  onClick={() => {
                    setAppendTarget(item);
                    setFormOpen(true);
                  }}
                  variant="secondary"
                >
                  追加版本
                </Button>
              </header>
              <dl>
                <div>
                  <dt>当前版本</dt>
                  <dd>{current?.versionLabel ?? '未知'}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd title={current?.sourceRef}>
                    {current?.sourceRef ?? '-'}
                  </dd>
                </div>
                <div>
                  <dt>敏感级别</dt>
                  <dd>{current?.sensitivity ?? '-'}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{new Date(item.updatedAt).toLocaleString('zh-CN')}</dd>
                </div>
              </dl>
              <details>
                <summary>
                  <History aria-hidden="true" size={15} />
                  全部版本（{item.versions.length}）
                </summary>
                <ol>
                  {item.versions.map((version) => (
                    <li key={version.id}>
                      <strong>{version.versionLabel}</strong>
                      <span>{version.sourceType}</span>
                      <code>{version.contentHash}</code>
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          );
        })}
      </div>
      {formOpen ? (
        <div className="artifact-form-overlay" role="presentation">
          <form
            aria-label={appendTarget ? '追加产物版本' : '登记产物'}
            className="artifact-form"
            onSubmit={(event) => void submit(event)}
          >
            <header>
              <div>
                <p>{appendTarget ? appendTarget.title : requirementId}</p>
                <h2>{appendTarget ? '追加不可变版本' : '登记阶段产物'}</h2>
              </div>
              <button
                aria-label="关闭"
                onClick={() => {
                  setFormOpen(false);
                  setAppendTarget(null);
                }}
                type="button"
              >
                ×
              </button>
            </header>
            {!appendTarget ? (
              <div className="artifact-form-grid">
                <label>
                  <span>CAP</span>
                  <input name="capId" placeholder="CAP-PFC-02" required />
                </label>
                <label>
                  <span>阶段</span>
                  <select defaultValue="G1" name="stage">
                    {Array.from({ length: 13 }, (_, index) => (
                      <option key={index}>G{index}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>产物类型</span>
                  <input name="artifactType" placeholder="PRD" required />
                </label>
                <label>
                  <span>标题</span>
                  <input name="title" required />
                </label>
              </div>
            ) : null}
            <div className="artifact-form-grid">
              <label>
                <span>版本</span>
                <input
                  defaultValue={appendTarget ? '' : initialVersion.versionLabel}
                  name="versionLabel"
                  placeholder="V0.2"
                  required
                />
              </label>
              <label>
                <span>来源类型</span>
                <select
                  defaultValue={initialVersion.sourceType}
                  name="sourceType"
                >
                  <option value="WORKSPACE_RELATIVE">工作区相对路径</option>
                  <option value="CONTROLLED_REFERENCE">受控引用</option>
                </select>
              </label>
              <label className="wide">
                <span>来源定位</span>
                <input
                  name="sourceRef"
                  placeholder="docs/requirements/spec.md"
                  required
                />
              </label>
              <label className="wide">
                <span>内容哈希</span>
                <input
                  name="contentHash"
                  pattern="sha256:[A-Fa-f0-9]{32,64}"
                  placeholder="sha256:..."
                  required
                />
              </label>
              <label>
                <span>敏感级别</span>
                <select
                  defaultValue={initialVersion.sensitivity}
                  name="sensitivity"
                >
                  <option>INTERNAL</option>
                  <option>RESTRICTED</option>
                  <option>PUBLIC</option>
                </select>
              </label>
            </div>
            <footer>
              <Button
                onClick={() => setFormOpen(false)}
                type="button"
                variant="secondary"
              >
                取消
              </Button>
              <Button type="submit">
                {appendTarget ? '追加版本' : '登记产物'}
              </Button>
            </footer>
          </form>
        </div>
      ) : null}
    </PlatformPageShell>
  );
}
