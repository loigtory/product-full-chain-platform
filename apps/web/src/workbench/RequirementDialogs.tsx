import { LoaderCircle } from 'lucide-react';
import type { FormEvent } from 'react';

import { Dialog } from './Dialog.tsx';
import { RegistrationFields } from './RegistrationFields.tsx';
import type { CreateForm, RegistrationForm } from './model.tsx';

export function CreateRequirementDialog({
  banner,
  createForm,
  experienceMode,
  formErrors,
  submitting,
  unknownKey,
  onChange,
  onClose,
  onSubmit,
  onVerify,
}: {
  banner: string | null;
  createForm: CreateForm;
  experienceMode: boolean;
  formErrors: Readonly<Record<string, string>>;
  submitting: boolean;
  unknownKey: string | null;
  onChange: (next: CreateForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onVerify: () => void;
}) {
  return (
    <Dialog onClose={onClose} title="新建需求">
      <form onSubmit={onSubmit}>
        <div className="dialog-body">
          {banner ? (
            <div className="notice-banner warning" role="status">
              <strong>{banner}</strong>
              {unknownKey ? (
                <button
                  className="secondary-button"
                  disabled={submitting}
                  onClick={onVerify}
                  type="button"
                >
                  核验保存结果
                </button>
              ) : null}
            </div>
          ) : null}
          <label className="field field-wide required">
            <span>需求名称</span>
            <input
              aria-label="需求名称"
              data-dialog-initial-focus
              maxLength={200}
              onChange={(event) =>
                onChange({ ...createForm, name: event.target.value })
              }
              value={createForm.name}
            />
            {formErrors.name ? (
              <small className="field-error">{formErrors.name}</small>
            ) : null}
          </label>
          <label className="field field-wide required">
            <span>原始想法</span>
            <textarea
              aria-label="原始想法"
              maxLength={10000}
              onChange={(event) =>
                onChange({ ...createForm, originalIdea: event.target.value })
              }
              rows={4}
              value={createForm.originalIdea}
            />
            {formErrors.originalIdea ? (
              <small className="field-error">{formErrors.originalIdea}</small>
            ) : null}
          </label>
          <details className="optional-registration">
            <summary>同时填写 G0 登记信息</summary>
            <RegistrationFields
              onChange={(registration) =>
                onChange({ ...createForm, ...registration })
              }
              readOnlyBusinessOwner={experienceMode}
              value={createForm}
            />
            {formErrors.sourceDescription ? (
              <small className="field-error">
                {formErrors.sourceDescription}
              </small>
            ) : null}
          </details>
        </div>
        <footer className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={submitting || Boolean(unknownKey)}
            type="submit"
          >
            {submitting ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="spinning-icon"
                  size={16}
                  strokeWidth={1.8}
                />
                保存中...
              </>
            ) : (
              '保存草稿'
            )}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export function CompleteRegistrationDialog({
  banner,
  detailName,
  experienceMode,
  formErrors,
  originalIdea,
  registrationForm,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  banner: string | null;
  detailName: string;
  experienceMode: boolean;
  formErrors: Readonly<Record<string, string>>;
  originalIdea: string;
  registrationForm: RegistrationForm;
  submitting: boolean;
  onChange: (next: RegistrationForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog onClose={onClose} title="补齐 G0 登记信息">
      <form onSubmit={onSubmit}>
        <div className="dialog-body">
          {banner ? (
            <div className="notice-banner error" role="alert">
              {banner}
            </div>
          ) : null}
          <RegistrationFields
            name={detailName}
            onChange={onChange}
            originalIdea={originalIdea}
            readOnlyBusinessOwner={experienceMode}
            readOnlyIdentity
            value={registrationForm}
          />
          {Object.values(formErrors).length ? (
            <div className="field-error error-summary">
              {Object.values(formErrors).join('；')}
            </div>
          ) : null}
        </div>
        <footer className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={submitting}
            type="submit"
          >
            {submitting ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="spinning-icon"
                  size={16}
                  strokeWidth={1.8}
                />
                保存中...
              </>
            ) : (
              '保存补充'
            )}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
