/**
 * Icon component using Lucide icons
 * https://lucide.dev/icons/
 */

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  Dna,
  Download,
  File,
  FileCode,
  FlaskConical,
  Folder,
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
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  Sparkles,
  Syringe,
  Target,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
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
  fileCode: FileCode,
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
  terminal: Terminal,
  alertTriangle: AlertTriangle,
  code: Code,
  play: Play,
  sparkles: Sparkles,
  folder: Folder,
  upload: Upload,
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
