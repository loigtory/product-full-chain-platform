import { forwardRef, type SelectHTMLAttributes } from 'react';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ariaLabel?: string;
  hideLabel?: boolean;
  label: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { ariaLabel, children, className = '', hideLabel = false, label, ...props },
    ref,
  ) {
    return (
      <label className={`pfc-select-field ${className}`.trim()}>
        <span className={hideLabel ? 'sr-only' : 'pfc-select-field__label'}>
          {label}
        </span>
        <select {...props} aria-label={ariaLabel ?? label} ref={ref}>
          {children}
        </select>
      </label>
    );
  },
);
