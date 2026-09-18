import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';

import { platformRequest } from '../platform/api-client.ts';

export interface StageCapabilityRow {
  name: string;
  source: 'local' | 'github' | 'company';
  sourceUrl: string | null;
  description: string | null;
  enabled: boolean;
  priority: number;
  updatedAt: string;
}

export interface StageCapabilityStage {
  stage: string;
  name: string;
  goal: string;
  guide: string;
  skills: StageCapabilityRow[];
  tools: StageCapabilityRow[];
  mcps: StageCapabilityRow[];
  execution: string;
}

interface CapabilitiesResponse {
  stages: StageCapabilityStage[];
}

const STAGE_ORDER = [
  'idea',
  'req',
  'design',
  'dev',
  'test',
  'accept',
  'release',
  'observe',
];

const SOURCE_LABEL: Record<StageCapabilityRow['source'], string> = {
  local: '本机',
  github: 'GitHub',
  company: '公司',
};

function SourceBadge({ source }: { source: StageCapabilityRow['source'] }) {
  return (
    <span
      className={`stage-cap-source stage-cap-source-${source}`}
      title={source === 'local' ? '本机已装' : source === 'github' ? 'GitHub 生态' : '公司 ai-dev 市场'}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

interface EditableRow extends StageCapabilityRow {
  dirty?: boolean;
}

export function StageCapabilityConfigPanel() {
  const [stages, setStages] = useState<readonly StageCapabilityStage[]>([]);
  const [active, setActive] = useState<string>('idea');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 编辑态：阶段 → 行副本（含新增行标记）
  const [edits, setEdits] = useState<Record<string, Record<string, EditableRow>>>({});
  const [newRows, setNewRows] = useState<Record<string, Array<{ kind: string; name: string; source: string; priority: number }>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformRequest<CapabilitiesResponse>(
        '/api/agent/stage-capabilities',
      );
      setStages(response.stages);
      if (!response.stages.some((s) => s.stage === active))
        setActive(response.stages[0]?.stage ?? 'idea');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '阶段能力读取失败。');
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeStage = useMemo(
    () => stages.find((s) => s.stage === active),
    [stages, active],
  );

  const currentRows = useMemo(() => {
    if (!activeStage) return { skills: [], tools: [], mcps: [] };
    const key = (row: StageCapabilityRow) => row.name;
    const edited = edits[activeStage.stage] ?? {};
    const merge = (rows: StageCapabilityRow[]) =>
      rows.map((row) => edited[key(row)] ?? row);
    return {
      skills: merge(activeStage.skills),
      tools: merge(activeStage.tools),
      mcps: merge(activeStage.mcps),
    };
  }, [activeStage, edits]);

  function patchRow(stage: string, kind: 'skill' | 'tool' | 'mcp', name: string, patch: Partial<EditableRow>) {
    setEdits((prev) => {
      const key = `${kind}:${name}`;
      const stageEdits = { ...(prev[stage] ?? {}) };
      const existing = stageEdits[key];
      const base =
        existing ??
        (activeStage
          ? (kind === 'skill'
              ? activeStage.skills
              : kind === 'tool'
                ? activeStage.tools
                : activeStage.mcps
            ).find((r) => r.name === name)
          : undefined);
      if (!base) return prev;
      stageEdits[key] = { ...base, ...patch, dirty: true };
      return { ...prev, [stage]: stageEdits };
    });
  }

  function addNewRow(stage: string, kind: 'skill' | 'tool' | 'mcp') {
    setNewRows((prev) => ({
      ...prev,
      [stage]: [...(prev[stage] ?? []), { kind, name: '', source: 'local', priority: 100 }],
    }));
  }

  function updateNewRow(stage: string, index: number, patch: Partial<{ kind: string; name: string; source: string; priority: number }>) {
    setNewRows((prev) => {
      const rows = [...(prev[stage] ?? [])];
      if (!rows[index]) return prev;
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, [stage]: rows };
    });
  }

  function removeRow(stage: string, kind: string, name: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[stage];
      return next;
    });
    void platformRequest(
      `/api/agent/stage-capabilities/${encodeURIComponent(stage)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    )
      .then(() => {
        setNotice(`已移除 ${stage}/${kind}/${name}`);
        void load();
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '移除失败。'),
      );
  }

  async function saveStage() {
    if (!activeStage) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const entries: Array<Record<string, unknown>> = [];
      for (const kind of ['skill', 'tool', 'mcp'] as const) {
        for (const row of currentRows[kind]) {
          entries.push({
            kind,
            name: row.name,
            source: row.source,
            sourceUrl: row.sourceUrl,
            description: row.description,
            enabled: row.enabled,
            priority: row.priority,
          });
        }
      }
      for (const row of newRows[activeStage.stage] ?? []) {
        const name = row.name.trim();
        if (!name) continue;
        entries.push({ kind: row.kind, name, source: row.source, priority: row.priority });
      }
      await platformRequest(
        `/api/agent/stage-capabilities/${encodeURIComponent(activeStage.stage)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
        },
      );
      setNotice(`${activeStage.stage} 阶段配置已保存，下一个作业按新配置装载。`);
      setEdits((prev) => ({ ...prev, [activeStage.stage]: {} }));
      setNewRows((prev) => ({ ...prev, [activeStage.stage]: [] }));
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  function renderRows(kind: 'skill' | 'tool' | 'mcp', rows: EditableRow[]) {
    const label = kind === 'skill' ? 'Skills' : kind === 'tool' ? 'Tools' : 'MCPs';
    return (
      <section className="stage-cap-group">
        <div className="stage-cap-group-head">
          <h4>{label}</h4>
          <button
            className="stage-cap-add"
            onClick={() => addNewRow(activeStage?.stage ?? '', kind)}
            type="button"
          >
            <Plus aria-hidden="true" size={14} strokeWidth={2} /> 添加
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="stage-cap-empty">未配置 {label}（可添加）</p>
        ) : (
          <ul className="stage-cap-rows">
            {rows.map((row) => (
              <li className="stage-cap-row" key={row.name}>
                <span className="stage-cap-name" title={row.description ?? undefined}>
                  {row.name}
                </span>
                <SourceBadge source={row.source} />
                <label className="stage-cap-toggle">
                  <input
                    checked={row.enabled}
                    onChange={(event) =>
                      patchRow(activeStage?.stage ?? '', kind, row.name, {
                        enabled: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  启用
                </label>
                <input
                  aria-label={`${row.name} 优先级`}
                  className="stage-cap-priority"
                  max={999}
                  min={1}
                  onChange={(event) =>
                    patchRow(activeStage?.stage ?? '', kind, row.name, {
                      priority: Number(event.target.value),
                    })
                  }
                  type="number"
                  value={row.priority}
                />
                <button
                  aria-label={`移除 ${row.name}`}
                  className="stage-cap-del"
                  onClick={() => removeRow(activeStage?.stage ?? '', kind, row.name)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (loading && stages.length === 0) {
    return (
      <div className="stage-cap-state" role="status">
        正在读取阶段能力配置...
      </div>
    );
  }

  return (
    <div className="stage-cap-panel">
      <div className="stage-cap-tabs" role="tablist" aria-label="阶段">
        {STAGE_ORDER.map((key) => {
          const stage = stages.find((s) => s.stage === key);
          return (
            <button
              aria-selected={active === key}
              className={`stage-cap-tab${active === key ? ' is-active' : ''}`}
              key={key}
              onClick={() => setActive(key)}
              role="tab"
              type="button"
            >
              {stage?.name ?? key}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="stage-cap-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="stage-cap-notice" role="status">
          <CheckCircle2 aria-hidden="true" size={16} strokeWidth={1.8} />
          {notice}
        </div>
      ) : null}

      {activeStage ? (
        <div className="stage-cap-body">
          <p className="stage-cap-goal">
            <strong>目标：</strong>
            {activeStage.goal}
          </p>
          <p className="stage-cap-guide">{activeStage.guide}</p>

          {renderRows('skill', currentRows.skills)}
          {renderRows('tool', currentRows.tools)}
          {renderRows('mcp', currentRows.mcps)}

          {(newRows[activeStage.stage] ?? []).map((row, index) => (
            <div className="stage-cap-newrow" key={`new-${index}`}>
              <select
                aria-label="类型"
                onChange={(event) =>
                  updateNewRow(activeStage.stage, index, { kind: event.target.value })
                }
                value={row.kind}
              >
                <option value="skill">skill</option>
                <option value="tool">tool</option>
                <option value="mcp">mcp</option>
              </select>
              <input
                aria-label="名称"
                onChange={(event) =>
                  updateNewRow(activeStage.stage, index, { name: event.target.value })
                }
                placeholder="skill / tool / mcp 名称"
                value={row.name}
              />
              <select
                aria-label="来源"
                onChange={(event) =>
                  updateNewRow(activeStage.stage, index, { source: event.target.value })
                }
                value={row.source}
              >
                <option value="local">本机</option>
                <option value="github">GitHub</option>
                <option value="company">公司</option>
              </select>
              <button
                onClick={() =>
                  setNewRows((prev) => ({
                    ...prev,
                    [activeStage.stage]: (prev[activeStage.stage] ?? []).filter(
                      (_, i) => i !== index,
                    ),
                  }))
                }
                type="button"
              >
                取消
              </button>
            </div>
          ))}

          <div className="stage-cap-actions">
            <button
              className="stage-cap-save"
              disabled={saving}
              onClick={() => void saveStage()}
              type="button"
            >
              <Save aria-hidden="true" size={15} strokeWidth={2} />
              {saving ? '保存中...' : '保存阶段配置'}
            </button>
            <span className="stage-cap-hint">
              热插拔：保存后下一个作业按新配置装载，无需重启服务。
            </span>
          </div>
        </div>
      ) : (
        <p className="stage-cap-state">未找到阶段配置。</p>
      )}
    </div>
  );
}
