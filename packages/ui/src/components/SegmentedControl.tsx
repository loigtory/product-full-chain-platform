import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  icon?: ReactNode;
  label: string;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  value: T;
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  className = '',
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  return (
    <div
      aria-label={ariaLabel}
      className={`pfc-segmented ${className}`.trim()}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className="pfc-segmented__item"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon ? (
            <span aria-hidden="true" className="pfc-segmented__icon">
              {option.icon}
            </span>
          ) : null}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
