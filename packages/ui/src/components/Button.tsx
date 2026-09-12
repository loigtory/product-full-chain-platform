import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className = '',
      disabled,
      icon,
      loading = false,
      size = 'md',
      type = 'button',
      variant = 'primary',
      ...props
    },
    ref,
  ) {
    const classes = [
      'pfc-button',
      `pfc-button--${variant}`,
      `pfc-button--${size}`,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        {...props}
        aria-busy={loading || undefined}
        className={classes}
        disabled={disabled || loading}
        ref={ref}
        type={type}
      >
        {loading ? (
          <span aria-hidden="true" className="pfc-button__spinner" />
        ) : (
          icon
        )}
        {children === undefined ? null : (
          <span className="pfc-button__label">{children}</span>
        )}
      </button>
    );
  },
);
