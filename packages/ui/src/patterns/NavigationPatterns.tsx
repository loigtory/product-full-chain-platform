import type { HTMLAttributes, ReactNode } from 'react';

export interface NavigationOption<T extends string> {
  icon?: ReactNode;
  label: string;
  value: T;
}

export interface PrimaryNavProps<T extends string> {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  options: readonly NavigationOption<T>[];
  value: T;
}

export function PrimaryNav<T extends string>({
  ariaLabel,
  className = '',
  onChange,
  options,
  value,
}: PrimaryNavProps<T>) {
  return (
    <nav
      aria-label={ariaLabel}
      className={`pfc-primary-nav ${className}`.trim()}
    >
      {options.map((option) => (
        <button
          aria-current={value === option.value ? 'page' : undefined}
          className="pfc-primary-nav__item"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon ? (
            <span aria-hidden="true" className="pfc-primary-nav__icon">
              {option.icon}
            </span>
          ) : null}
          {option.label}
        </button>
      ))}
    </nav>
  );
}

export interface SubNavProps<T extends string> {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  options: readonly NavigationOption<T>[];
  value: T;
}

export function SubNav<T extends string>({
  ariaLabel,
  className = '',
  onChange,
  options,
  value,
}: SubNavProps<T>) {
  return (
    <nav aria-label={ariaLabel} className={`pfc-sub-nav ${className}`.trim()}>
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className="pfc-sub-nav__item"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon ? (
            <span aria-hidden="true" className="pfc-sub-nav__icon">
              {option.icon}
            </span>
          ) : null}
          {option.label}
        </button>
      ))}
    </nav>
  );
}

export interface GlobalHeaderProps extends HTMLAttributes<HTMLElement> {
  account?: ReactNode;
  actions?: ReactNode;
  brand: ReactNode;
  density?: 'default' | 'compact';
  navigation: ReactNode;
}

export function GlobalHeader({
  account,
  actions,
  brand,
  className = '',
  density = 'default',
  navigation,
  ...props
}: GlobalHeaderProps) {
  return (
    <header
      {...props}
      className={`pfc-global-header ${className}`.trim()}
      data-density={density}
    >
      <div className="pfc-global-header__inner">
        <div className="pfc-global-header__brand">{brand}</div>
        {navigation}
        <div className="pfc-global-header__utilities">
          {actions}
          {account ? (
            <div className="pfc-global-header__account">{account}</div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export type PlatformModule = 'requirements' | 'gates' | 'materials' | 'agents';

export interface PageIntroProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  actions?: ReactNode;
  context: ReactNode;
  density?: 'default' | 'compact';
  description?: ReactNode;
  icon?: ReactNode;
  module: PlatformModule;
  title: ReactNode;
}

export function PageIntro({
  actions,
  children,
  className = '',
  context,
  density = 'default',
  description,
  icon,
  module,
  title,
  ...props
}: PageIntroProps) {
  return (
    <section
      {...props}
      className={`pfc-page-intro ${className}`.trim()}
      data-density={density}
      data-module={module}
    >
      <div className="pfc-page-intro__inner">
        <div className="pfc-page-intro__heading">
          {icon ? (
            <div aria-hidden="true" className="pfc-page-intro__icon">
              {icon}
            </div>
          ) : (
            <div aria-hidden="true" className="pfc-page-intro__accent" />
          )}
          <div>
            <div className="pfc-page-intro__context">{context}</div>
            <h1>{title}</h1>
            {description ? (
              <div className="pfc-page-intro__description">{description}</div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="pfc-page-intro__actions">{actions}</div>
        ) : null}
      </div>
      {children ? (
        <div className="pfc-page-intro__subnav">{children}</div>
      ) : null}
    </section>
  );
}

export interface ModuleAccentProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  label: ReactNode;
  module: PlatformModule;
}

export function ModuleAccent({
  className = '',
  icon,
  label,
  module,
  ...props
}: ModuleAccentProps) {
  return (
    <div
      {...props}
      className={`pfc-module-accent ${className}`.trim()}
      data-module={module}
    >
      {icon ? (
        <span aria-hidden="true" className="pfc-module-accent__icon">
          {icon}
        </span>
      ) : null}
      <span>{label}</span>
    </div>
  );
}
