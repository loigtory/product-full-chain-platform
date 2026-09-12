import { useState, type FormEvent } from 'react';

import { Button } from '@pfc/ui';

const repositoryFingerprintInputPattern = 'sha256:[0-9a-f]{64}';
const repositoryFingerprintPattern = /^sha256:[0-9a-f]{64}$/;

export type WorkspaceRegistrationInput = Readonly<{
  name: string;
  repositoryLabel: string;
  repositoryFingerprint: string;
}>;

export function WorkspaceRegistrationForm({
  onCreate,
}: {
  onCreate: (input: WorkspaceRegistrationInput) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const repositoryFingerprint = String(
      form.get('repositoryFingerprint') ?? '',
    );
    if (!repositoryFingerprintPattern.test(repositoryFingerprint)) {
      setError('仓库指纹格式不正确，请输入 sha256: 加 64 位小写十六进制字符。');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: String(form.get('name') ?? ''),
        repositoryLabel: String(form.get('repositoryLabel') ?? ''),
        repositoryFingerprint,
      });
      formElement.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工作区登记失败。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-form" onSubmit={(event) => void submit(event)}>
      <header>
        <div>
          <h2>登记工作区</h2>
          <p>保存逻辑名称和不可执行的仓库指纹。</p>
        </div>
      </header>
      <label>
        <span>工作区名称</span>
        <input name="name" required />
      </label>
      <label>
        <span>仓库标识</span>
        <input name="repositoryLabel" required />
      </label>
      <label>
        <span>仓库指纹</span>
        <input
          aria-label="仓库指纹"
          aria-describedby="repository-fingerprint-hint"
          maxLength={71}
          name="repositoryFingerprint"
          onInvalid={() =>
            setError(
              '仓库指纹格式不正确，请输入 sha256: 加 64 位小写十六进制字符。',
            )
          }
          pattern={repositoryFingerprintInputPattern}
          placeholder="sha256:..."
          required
          title="请输入 sha256: 加 64 位小写十六进制字符"
        />
        <small className="admin-form__hint" id="repository-fingerprint-hint">
          格式：sha256: 加 64 位小写十六进制字符
        </small>
      </label>
      {error ? (
        <p className="module-message error" role="alert">
          {error}
        </p>
      ) : null}
      <Button disabled={submitting} type="submit">
        {submitting ? '登记中...' : '登记工作区'}
      </Button>
    </form>
  );
}
