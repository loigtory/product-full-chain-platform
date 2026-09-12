import type { ReactNode } from 'react';

export interface ScopeDiffColumn {
  label: ReactNode;
  paths: readonly string[];
  actions: readonly string[];
  maxChangedFiles: number;
  maxChangedBytes: number;
  networkAccess: boolean;
}

export function ScopeDiff({
  approved,
  requested,
}: {
  approved?: ScopeDiffColumn;
  requested: ScopeDiffColumn;
}) {
  const columns = [requested, ...(approved ? [approved] : [])];
  return (
    <div className="pfc-scope-diff">
      {columns.map((column) => (
        <section key={String(column.label)}>
          <h3>{column.label}</h3>
          <dl>
            <div>
              <dt>相对位置</dt>
              <dd>
                {column.paths.map((path) => (
                  <code key={path}>{path}</code>
                ))}
              </dd>
            </div>
            <div>
              <dt>动作</dt>
              <dd>{column.actions.join('、')}</dd>
            </div>
            <div>
              <dt>影响上限</dt>
              <dd>
                {column.maxChangedFiles} 个文件 / {column.maxChangedBytes} 字节
              </dd>
            </div>
            <div>
              <dt>网络</dt>
              <dd>{column.networkAccess ? '请求网络访问' : '禁止网络访问'}</dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}
