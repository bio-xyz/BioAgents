import { ComponentChildren } from 'preact';
import { Icon } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children?: ComponentChildren;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  iconSize?: number;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Consistent Button component for the application
 * Supports multiple variants, sizes, and states
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconSize,
  disabled = false,
  loading = false,
  onClick,
  className = '',
  title,
  type = 'button',
}: ButtonProps) {
  const variantClass = `btn-${variant}`;
  const sizeClass = `btn-${size}`;
  const loadingClass = loading ? 'btn-loading' : '';
  const iconOnlyClass = icon && !children ? 'btn-icon-only' : '';

  const classes = [
    'btn',
    variantClass,
    sizeClass,
    loadingClass,
    iconOnlyClass,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const actualIconSize = iconSize || (size === 'sm' ? 14 : size === 'lg' ? 20 : 16);

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
    >
      {icon && <Icon name={icon} size={actualIconSize} />}
      {children && <span className="btn-text">{children}</span>}
    </button>
  );
}
