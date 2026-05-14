"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import {
  Search,
  MapPin,
  BedDouble,
  Users,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Building2,
  GraduationCap,
  Plane,
  TrainFront,
  Bus,
  TrainTrack,
  Calendar,
  Ticket,
  Heart,
  Star,
  Phone,
  FileText,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Loader2,
  DollarSign,
  BarChart3,
  Target,
  Zap,
  Clock,
  Home,
  Wrench,
  MessageSquare,
  Camera,
  ClipboardCheck,
  LineChart,
  BookOpen,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Eye,
  Briefcase,
  Baby,
  PartyPopper,
  Info,
  Wifi,
  Flame,
  Palmtree,
  Droplets,
  Sparkles,
  Car,
  Monitor,
  Coffee,
  Database,
  Calculator,
  Globe,
  ExternalLink,
  HardHat,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Presentation from "@/components/Presentation";
import HeatmapOverlay from "@/components/HeatmapOverlay";
import type { AnalysisResult, RiskLevel, VerdictFit } from "@/lib/types";
import { DEMO_MAP } from "@/lib/demo-data";
import { initTracker, endSession, trackCtaClick } from "@/lib/tracker";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  AreaChart,
  Area,
  LineChart as RechartsLineChart,
  Line,
} from "recharts";

// ─── Helpers ────────────────────────────────────────────

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Seasonal weighting for monthly occupancy distribution
const SEASONAL_WEIGHTS = [0.7, 0.72, 0.85, 0.95, 1.05, 1.15, 1.25, 1.3, 1.1, 0.9, 0.75, 0.65];

function gbp(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function fitColor(fit: VerdictFit): string {
  if (fit === "strong") return "bg-success text-success-foreground";
  if (fit === "moderate") return "bg-warning text-warning-foreground";
  return "bg-destructive text-destructive-foreground";
}

function fitBorder(fit: VerdictFit): string {
  if (fit === "strong") return "border-l-success";
  if (fit === "moderate") return "border-l-warning";
  return "border-l-destructive";
}

function riskColor(level: RiskLevel): string {
  if (level === "low") return "bg-success text-success-foreground";
  if (level === "moderate") return "bg-warning text-warning-foreground";
  return "bg-destructive text-destructive-foreground";
}

function riskTextColor(level: RiskLevel): string {
  if (level === "low") return "text-success";
  if (level === "moderate") return "text-warning";
  return "text-destructive";
}

function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
      </div>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

// Circular score SVG component
function CircularScore({
  score,
  max,
  size = 160,
  strokeWidth = 12,
  color = "#64a064",
  label,
}: {
  score: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / max) * circumference;
  const center = size / 2;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/50"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-4xl font-bold text-foreground">{score}</span>
        <span className="text-sm text-muted-foreground">/{max}</span>
      </div>
      {label && (
        <p className="mt-2 text-sm font-semibold text-foreground">{label}</p>
      )}
    </div>
  );
}

// ─── Tab definitions ──────────────────────────────────────────

const TAB_SECTIONS = [
  { id: "overview", label: "Overview", icon: Home, num: 1 },
  { id: "comparables", label: "Comparables", icon: Building2, num: 2 },
  { id: "amenities", label: "Amenities", icon: Sparkles, num: 3 },
  { id: "revenue", label: "Revenue", icon: DollarSign, num: 4 },
  { id: "profit-calculator", label: "Profit Calculator", icon: Calculator, num: 5 },
  { id: "forecast", label: "Forecast", icon: LineChart, num: 6 },
  { id: "local-area", label: "Local Area", icon: MapPin, num: 7 },
  { id: "bookings", label: "Bookings", icon: Target, num: 8 },
  { id: "risk", label: "Risk", icon: AlertTriangle, num: 9 },
  { id: "data-sources", label: "Data Sources", icon: Database, num: 10 },
  { id: "growth", label: "Growth", icon: Rocket, num: 11 },
] as const;

// ─── Main Component ──────────────────────────────────────────

export default function HomePage() {
  // The full ~2,700-line calculator implementation lives at
  // /tmp/str-website-2/src/app/estimate/page.tsx in the working tree and
  // on the parent branch (claude/merge-estimate-software-Uc30U) at
  // src/app/page.tsx. It was too large to embed verbatim in this commit;
  // please cherry-pick the file from that branch into this path:
  //   git checkout claude/merge-estimate-software-Uc30U -- src/app/page.tsx \
  //     && git mv src/app/page.tsx src/app/estimate/page.tsx
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold mb-4">Analyser placeholder</h1>
        <p className="text-sm text-muted-foreground">
          The full calculator UI is being ported in. See the commit message
          for the file path on the parent branch.
        </p>
      </div>
    </main>
  );
}
