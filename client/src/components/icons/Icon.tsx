/**
 * Icon component using Lucide icons
 * https://lucide.dev/icons/
 */

import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Dna,
  Download,
  File,
  FlaskConical,
  GitMerge,
  Globe,
  GraduationCap,
  Image,
  Lightbulb,
  LogOut,
  MessageSquare,
  Mic,
  Microscope,
  MoreHorizontal,
  Paperclip,
  Pill,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  Syringe,
  Target,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-preact";

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
  chevronDown: ChevronDown,
  file: File,
  menu: MoreHorizontal,
  mic: Mic,
  image: Image,
  globe: Globe,
  lightbulb: Lightbulb,
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,
  share: Share2,
  refresh: RefreshCw,
  dna: Dna,
  microscope: Microscope,
  activity: Activity,
  syringe: Syringe,
  pill: Pill,
  flask: FlaskConical,
  target: Target,
  bookOpen: BookOpen,
  graduationCap: GraduationCap,
  messageSquare: MessageSquare,
  brainCircuit: BrainCircuit,
  settings: Settings,
  barChart: BarChart3,
  gitMerge: GitMerge,
  zap: Zap,
  download: Download,
};

/**
 * Icon component wrapper for Lucide icons
 * Provides consistent sizing and styling
 */
export function Icon({
  name,
  size = 16,
  className = "",
  strokeWidth = 2,
}: IconProps) {
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
