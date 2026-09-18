import { useEffect, useState } from 'react';

type LedgerSummary = {
  packageId: string;
  limits: { maxTurns: number; maxSeconds: number };
  usage: { turns: number; seconds: number; remainingTurns: number };
  byStatus: Record<string, number>;
  byDay: { date: string; turns: number; seconds: number }[];
  byStage: { stage: string; turns: number; seconds: number }[];
  recent: {
    attemptId: string;
    status: string;
    stage: string | null;
    tool: string | null;
    seconds: number;
    createdAt: string;
  }[];
};

type BudgetDto = {
  ledgers: { remediation: LedgerSummary; exec: LedgerSummary };
  overall: { turns: number; seconds: number; remainingExecTurns: number };
};

function LedgerCard({
  title,
  ledger,
}: {
  title: string;
  ledger: LedgerSummary;
}) {
  const pct = Math.min(
    100,
    Math.round((ledger.usage.turns / ledger.limits.maxTurns) * 100),
  );
  return (
    <section className="budget-card">
      <h3>{title}</h3>
      <div className="budget-progress">
        <div className="budget-progress-track">
          <div
            className="budget-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span>
          {ledger.usage.turns} / {ledger.limits.maxTurns} turns（{pct}%）
        </span>
      </div>
      <dl className="budget-facts">
        <div>
          <dt>已用秒</dt>
          <dd>{ledger.usage.seconds}s</dd>
        </div>
        <div>
          <dt>剩余 turns</dt>
          <dd>{ledger.usage.remainingTurns}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{JSON.stringify(ledger.byStatus)}</dd>
        </div>
      </dl>
      {ledger.byStage.length ? (
        <table className="budget-table">
          <caption>按阶段</caption>
          <thead>
            <tr>
              <th>阶段</th>
              <th>turns</th>
              <th>秒</th>
            </tr>
          </thead>
          <tbody>
            {ledger.byStage.map((s) => (
              <tr key={s.stage}>
                <td>{s.stage}</td>
                <td>{s.turns}</td>
                <td>{s.seconds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {ledger.byDay.length ? (
        <table className="budget-table">
          <caption>按日期</caption>
          <thead>
            <tr>
              <th>日期</th>
              <th>turns</th>
              <th>秒</th>
            </tr>
          </thead>
          <tbody>
            {ledger.byDay.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.turns}</td>
                <td>{d.seconds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export function BudgetPage() {
  const [data, setData] = useState<BudgetDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/agent/budget', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="budget-page">
      <header className="budget-header">
        <a href="/">← 返回工作台</a>
        <h1>预算 / 资源耗用报表</h1>
        <p>事实源：本地预算账本（remediation + host-exec），汇总现算不缓存。</p>
      </header>
      {error ? <p className="budget-error">加载失败：{error}</p> : null}
      {!data && !error ? <p>加载中…</p> : null}
      {data ? (
        <>
          <section className="budget-overall">
            <h2>总体</h2>
            <dl className="budget-facts budget-facts--overall">
              <div>
                <dt>总 turns</dt>
                <dd>{data.overall.turns}</dd>
              </div>
              <div>
                <dt>总秒</dt>
                <dd>{data.overall.seconds}s</dd>
              </div>
              <div>
                <dt>EXEC 剩余</dt>
                <dd>{data.overall.remainingExecTurns} turns</dd>
              </div>
            </dl>
          </section>
          <div className="budget-ledgers">
            <LedgerCard ledger={data.ledgers.exec} title="EXEC 作业账本（上限 80）" />
            <LedgerCard
              ledger={data.ledgers.remediation}
              title="Remediation 账本"
            />
          </div>
          {data.ledgers.exec.recent.length ? (
            <section className="budget-card">
              <h3>最近 EXEC 明细</h3>
              <table className="budget-table">
                <thead>
                  <tr>
                    <th>attempt</th>
                    <th>状态</th>
                    <th>阶段</th>
                    <th>工具</th>
                    <th>秒</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledgers.exec.recent.map((x) => (
                    <tr key={x.attemptId}>
                      <td>{x.attemptId}</td>
                      <td>{x.status}</td>
                      <td>{x.stage ?? '—'}</td>
                      <td>{x.tool ?? '—'}</td>
                      <td>{x.seconds}</td>
                      <td>{x.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
