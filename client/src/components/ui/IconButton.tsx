import { Icon } from '../icons';

export interface IconButtonProps {
  icon: string;
  size?: number;
  onClick?: (e?: any) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  variant?: 'default' | 'ghost' | 'danger';
}

/**
 * Icon-only button component
 * Cleaner API for icon buttons without text
 */
export function IconButton({
  icon,
  size = 16,
  onClick,
  disabled = false,
  className = '',
  title,
  variant = 'default',
}: IconButtonProps) {
  const variantClass = `icon-btn-${variant}`;
  const classes = ['icon-btn', variantClass, className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
