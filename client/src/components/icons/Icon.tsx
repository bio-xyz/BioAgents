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
  activity: Activity,
  alertTriangle: AlertTriangle,
  attach: Paperclip,
  barChart: BarChart3,
  bookOpen: BookOpen,
  bot: Bot,
  brainCircuit: BrainCircuit,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  close: X,
  code: Code,
  copy: Copy,
  dna: Dna,
  download: Download,
  file: File,
  fileCode: FileCode,
  flask: FlaskConical,
  folder: Folder,
  gitMerge: GitMerge,
  globe: Globe,
  graduationCap: GraduationCap,
  image: Image,
  lightbulb: Lightbulb,
  logout: LogOut,
  menu: MoreHorizontal,
  messageSquare: MessageSquare,
  mic: Mic,
  microscope: Microscope,
  pill: Pill,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  share: Share2,
  sparkles: Sparkles,
  syringe: Syringe,
  target: Target,
  terminal: Terminal,
  thumbsDown: ThumbsDown,
  thumbsUp: ThumbsUp,
  trash: Trash2,
  upload: Upload,
  user: User,
  zap: Zap,
};

/**
 * Icon component wrapper for Lucide icons
 * Provides consistent sizing and styling
 */
export function Icon({ name, size = 16, className = "", strokeWidth = 2 }: IconProps) {
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }

  return <IconComponent size={size} strokeWidth={strokeWidth} className={className} />;
}
