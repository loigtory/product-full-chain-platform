import { Check, Pencil, X } from 'lucide-react';

import type { ArtifactVersionContentDto } from '@pfc/contracts';
import { Badge, Button } from '@pfc/ui';

export function ArtifactContentPanel({
  busy,
  content,
  draft,
  editing,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
  onVersionLabelChange,
  versionLabel,
}: {
  busy: boolean;
  content: ArtifactVersionContentDto | null;
  draft: string;
  editing: boolean;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onVersionLabelChange: (value: string) => void;
  versionLabel: string;
}) {
  return (
    <section className="artifact-content-panel" aria-label="制品正文区">
      <header>
        <div>
          <span>正文</span>
          <Badge
            variant={
              content?.availability === 'AVAILABLE' ? 'success' : 'warning'
            }
          >
            {content?.availability === 'AVAILABLE' ? '可读取' : '正文未归档'}
          </Badge>
        </div>
        {editing ? (
          <div className="artifact-content-panel__actions">
            <Button
              icon={<X aria-hidden="true" size={15} />}
              onClick={onCancel}
              size="sm"
              variant="secondary"
            >
              取消
            </Button>
            <Button
              icon={<Check aria-hidden="true" size={15} />}
              loading={busy}
              onClick={onSave}
              size="sm"
            >
              保存为新版本
            </Button>
          </div>
        ) : (
          <Button
            disabled={content?.availability !== 'AVAILABLE'}
            icon={<Pencil aria-hidden="true" size={15} />}
            onClick={onEdit}
            size="sm"
            variant="secondary"
          >
            编辑正文
          </Button>
        )}
      </header>
      {editing ? (
        <div className="artifact-content-panel__editor">
          <label>
            <span>新版本号</span>
            <input
              aria-label="新版本号"
              onChange={(event) => onVersionLabelChange(event.target.value)}
              placeholder="V0.3"
              value={versionLabel}
            />
          </label>
          <label>
            <span>制品正文</span>
            <textarea
              aria-label="制品正文"
              className="pfc-artifact-code"
              onChange={(event) => onDraftChange(event.target.value)}
              rows={24}
              value={draft}
            />
          </label>
        </div>
      ) : content?.content ? (
        <div className="artifact-content-panel__document">
          {content.content.split('\n').map((line, index) => (
            <span data-line={index + 1} key={`${index}-${line}`}>
              {line || ' '}
            </span>
          ))}
        </div>
      ) : (
        <p className="artifact-workspace-empty">
          该版本只有受控引用，没有可在线读取的正文。
        </p>
      )}
    </section>
  );
}
