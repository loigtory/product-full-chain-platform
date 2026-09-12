import { useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, LockKeyhole, Workflow } from 'lucide-react';

import type { CurrentActorDto } from '@pfc/contracts';
import { Button } from '@pfc/ui';

import { identityApi } from './api.ts';
import './identity.css';

export function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (actor: CurrentActorDto) => void;
}) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await identityApi.login({ loginName, password });
      onAuthenticated(result.actor);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '登录失败，请稍后重试。',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <header className="login-brand">
        <span aria-hidden="true" className="login-brand-mark">
          <Workflow size={22} strokeWidth={1.8} />
        </span>
        <span>
          <strong>产品全链路</strong>
          <small>Product Flow</small>
        </span>
      </header>
      <section aria-labelledby="login-title" className="login-panel">
        <div className="login-heading">
          <span aria-hidden="true">
            <LockKeyhole size={22} strokeWidth={1.7} />
          </span>
          <div>
            <p>本地工作空间</p>
            <h1 id="login-title">登录工作台</h1>
          </div>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>账号</span>
            <input
              autoComplete="username"
              autoFocus
              maxLength={64}
              onChange={(event) => setLoginName(event.target.value)}
              required
              value={loginName}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            disabled={submitting}
            icon={
              submitting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="spinning-icon"
                  size={17}
                />
              ) : (
                <ArrowRight aria-hidden="true" size={17} />
              )
            }
            type="submit"
          >
            {submitting ? '正在验证' : '进入工作台'}
          </Button>
        </form>
      </section>
      <footer>CAP-PFC-04 · 应用账户与 PostgreSQL 会话</footer>
    </main>
  );
}
