/**
 * Icon component using Lucide icons
 * https://lucide.dev/icons/
 */

import {
  User,
  Bot,
  Send,
  Paperclip,
  Copy,
  Check,
  X,
  Trash2,
  Plus,
  Search,
  LogOut,
  ChevronLeft,
  ChevronRight,
  File,
  MoreHorizontal,
} from 'lucide-preact';

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const iconMap: Record<string, any> = {
  user: User,
  bot: Bot,
  send: Send,
  attach: Paperclip,
  copy: Copy,
  check: Check,
  close: X,
  trash: Trash2,
  plus: Plus,
  search: Search,
  logout: LogOut,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  file: File,
  menu: MoreHorizontal,
};

/**
 * Icon component wrapper for Lucide icons
 * Provides consistent sizing and styling
 */
export function Icon({ name, size = 16, className = '', strokeWidth = 2 }: IconProps) {
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }

  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      className={className}
    />
  );
}
