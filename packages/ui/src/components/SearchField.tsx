import type { InputHTMLAttributes, ReactNode } from 'react';

export interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'aria-label' | 'onChange' | 'type' | 'value'
> {
  ariaLabel: string;
  clearAriaLabel?: string;
  clearIcon?: ReactNode;
  onChange: (value: string) => void;
  searchIcon?: ReactNode;
  value: string;
}

export function SearchField({
  ariaLabel,
  className = '',
  clearAriaLabel,
  clearIcon,
  onChange,
  searchIcon,
  value,
  ...props
}: SearchFieldProps) {
  return (
    <div className={`pfc-search-field ${className}`.trim()}>
      {searchIcon ? (
        <span aria-hidden="true" className="pfc-search-field__icon">
          {searchIcon}
        </span>
      ) : null}
      <input
        {...props}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label={clearAriaLabel ?? `清除${ariaLabel}`}
          className="pfc-search-field__clear"
          onClick={() => onChange('')}
          type="button"
        >
          {clearIcon ?? <span aria-hidden="true">×</span>}
        </button>
      ) : null}
    </div>
  );
}
