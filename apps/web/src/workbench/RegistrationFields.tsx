import { useId } from 'react';

import type { MaterialPurpose, MaterialSourceType } from '@pfc/contracts';

import {
  purposeOptions,
  sensitivityOptions,
  sourceOptions,
  type RegistrationForm,
} from './model.tsx';

export function RegistrationFields({
  value,
  onChange,
  readOnlyIdentity,
  readOnlyBusinessOwner,
  name,
  originalIdea,
}: {
  value: RegistrationForm;
  onChange: (next: RegistrationForm) => void;
  readOnlyIdentity?: boolean;
  readOnlyBusinessOwner?: boolean;
  name?: string;
  originalIdea?: string;
}) {
  const sensitivityName = useId();
  return (
    <div className="form-grid">
      {readOnlyIdentity ? (
        <>
          <label className="field">
            <span>需求名称</span>
            <input aria-label="需求名称" readOnly value={name ?? ''} />
          </label>
          <label className="field field-wide">
            <span>原始想法</span>
            <textarea
              aria-label="原始想法"
              readOnly
              rows={3}
              value={originalIdea ?? ''}
            />
          </label>
        </>
      ) : null}
      <label className="field">
        <span>来源</span>
        <select
          aria-label="来源"
          value={value.sourceType}
          onChange={(event) =>
            onChange({
              ...value,
              sourceType: event.target.value as MaterialSourceType | '',
            })
          }
        >
          <option value="">暂不填写</option>
          {sourceOptions.map(([optionValue, label]) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {value.sourceType === 'OTHER' ? (
        <label className="field">
          <span>来源说明</span>
          <input
            aria-label="来源说明"
            value={value.sourceDescription}
            onChange={(event) =>
              onChange({ ...value, sourceDescription: event.target.value })
            }
          />
        </label>
      ) : null}
      <label className="field">
        <span>业务责任人</span>
        <input
          aria-label="业务责任人"
          readOnly={readOnlyBusinessOwner}
          value={value.businessOwnerId}
          onChange={(event) =>
            onChange({ ...value, businessOwnerId: event.target.value })
          }
          placeholder="输入平台成员 ID"
        />
      </label>
      <label className="field">
        <span>材料用途</span>
        <select
          aria-label="材料用途"
          value={value.materialPurpose}
          onChange={(event) =>
            onChange({
              ...value,
              materialPurpose: event.target.value as MaterialPurpose | '',
            })
          }
        >
          <option value="">暂不填写</option>
          {purposeOptions.map(([optionValue, label]) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field field-wide sensitivity-field">
        <legend>敏感级别</legend>
        <div className="sensitivity-options">
          {sensitivityOptions.map(([optionValue, label, description]) => (
            <label key={optionValue} className="sensitivity-option">
              <input
                aria-label={label}
                type="radio"
                name={sensitivityName}
                checked={value.sensitivity === optionValue}
                onChange={() =>
                  onChange({ ...value, sensitivity: optionValue })
                }
              />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
