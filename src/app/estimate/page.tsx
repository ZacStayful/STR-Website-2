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
  HelpCircle,
  PoundSterling,
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
import { AddressAutocomplete, splitAddressAndPostcode } from "@/components/AddressAutocomplete";
import { AccuracyPanel } from "@/components/AccuracyPanel";
import { SetupCalculator } from "@/components/SetupCalculator";
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

// ─── Helpers ──────────────────────────────────────────────────────

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

function roundReviewRating(rating: number): string {
  return (Math.round(rating * 100) / 100).toFixed(2);
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "just now";
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
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
    <div className="mb-6 text-center">
      <div className="flex items-center justify-center gap-2">
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

// ─── Tab definitions ─────────────────────────────────────────────

const TAB_SECTIONS = [
  { id: "overview", label: "Overview", icon: Home, num: 1 },
  { id: "comparables", label: "Comparables", icon: Building2, num: 2 },
  { id: "amenities", label: "Amenities", icon: Sparkles, num: 3 },
  { id: "revenue", label: "Revenue", icon: PoundSterling, num: 4 },
  { id: "forecast", label: "Forecast", icon: LineChart, num: 5 },
  { id: "local-area", label: "Local Area", icon: MapPin, num: 6 },
  { id: "bookings", label: "Bookings", icon: Target, num: 7 },
  { id: "risk", label: "Risk", icon: AlertTriangle, num: 8 },
  { id: "growth", label: "Growth", icon: Rocket, num: 9 },
  { id: "faq", label: "FAQ", icon: HelpCircle, num: 11 },
] as const;

// ─── Main Component ─────────────────────────────────────────────

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [email, setEmail] = useState("");
  const [bedrooms, setBedrooms] = useState("2");
  const [guests, setGuests] = useState("6"); // Auto-calculated: (bedrooms × 2) + 2
  const [bathrooms, setBathrooms] = useState("1");
  const [propertyType, setPropertyType] = useState("Flat");
  const [parking, setParking] = useState("no_parking");
  const [outdoorSpace, setOutdoorSpace] = useState("none");
  const [monthlyMortgage, setMonthlyMortgage] = useState("");
  const [monthlyBills, setMonthlyBills] = useState("");

  // ── Session timer: pushed to Monday via sendBeacon on tab close ──
  const sessionStartRef = useRef(Date.now());
  const emailRef = useRef(email);
  emailRef.current = email;

  useEffect(() => {
    const pushTime = () => {
      const seconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
      const currentEmail = emailRef.current;
      if (seconds > 0 && currentEmail && currentEmail.includes("@")) {
        navigator.sendBeacon(
          "/api/track",
          new Blob(
            [JSON.stringify({ type: "time_on_site", email: currentEmail, seconds })],
            { type: "application/json" },
          ),
        );
      }
    };
    const onVisChange = () => { if (document.visibilityState === "hidden") pushTime(); };
    window.addEventListener("beforeunload", pushTime);
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      window.removeEventListener("beforeunload", pushTime);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, []);

  // Address input mode: "auto" uses Google Places autocomplete (default),
  // "manual" falls back to the original two freeform fields. selectedAutoAddress
  // tracks the last picked suggestion so we can render a compact confirmation
  // row with a Change button instead of the search input.
  const [entryMode, setEntryMode] = useState<"auto" | "manual">("auto");
  const [selectedAutoAddress, setSelectedAutoAddress] = useState<{ address: string; postcode: string } | null>(null);

  // User-adjustable expense formula. null means "use default".
  //   Platform default: 15 %
  //   Management default: 15 %
  //   Cleaning default: 18 % of gross, per month → seeded from Top Market gross
  // These inputs feed BOTH hero net-revenue columns and downstream sections
  // (Revenue Breakdown, Profit Calculator). Reset on every fresh analysis.
  const [expensesExpanded, setExpensesExpanded] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [platformFeePct, setPlatformFeePct] = useState<number | null>(null);
  const [mgmtFeePct, setMgmtFeePct] = useState<number | null>(null);
  const [cleaningMonthly, setCleaningMonthly] = useState<number | null>(null);
  const [overheadMortgage, setOverheadMortgage] = useState<number | null>(null);
  const [overheadBills, setOverheadBills] = useState<number | null>(null);
  const [overheadOther, setOverheadOther] = useState<number | null>(null);
  const setupSnapshotRef = useRef<import("@/components/SetupCalculator").SetupCalculatorSnapshot | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showPresentation, setShowPresentation] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [currentMessage, setCurrentMessage] = useState("");

  // Tab / scroll tracking state
  const [activeTab, setActiveTab] = useState("overview");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // User-curated comp exclusions — keyed by comp index in r.shortLet.comparables.
  // Excluded comps are dimmed in the grid and removed from all aggregate stats
  // (avg ADR/Occ/Revenue, Top 5, Decision Engine, Filtered Estimate). The V4
  // PMI "Top Market Potential" headline is unaffected — it shows what a top-
  // performer in the full market pool can earn.
  const [excludedComps, setExcludedComps] = useState<Set<number>>(new Set());

  // FAQ accordion state — only one item open at a time; null = all collapsed.
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Reset exclusions + expense overrides whenever a fresh analysis result
  // arrives so users don't accidentally carry filters or cost inputs from
  // a previous property into a new one.
  useEffect(() => {
    setExcludedComps(new Set());
    setPlatformFeePct(null);
    setMgmtFeePct(null);
    setCleaningMonthly(null);
    setExpensesExpanded(false);
  }, [result]);

  const setSectionRef = useCallback((id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  }, []);

  // IntersectionObserver for active tab tracking
  useEffect(() => {
    if (!result) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }
        if (bestEntry && bestEntry.target.id) {
          setActiveTab(bestEntry.target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: [0, 0.25, 0.5] }
    );

    const timer = setTimeout(() => {
      TAB_SECTIONS.forEach(({ id }) => {
        const el = sectionRefs.current[id];
        if (el) observer.observe(el);
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [result]);

  // Auto-recalculate guests when bedrooms changes: (beds * 2) + 2
  useEffect(() => {
    const numBeds = Number(bedrooms);
    if (!isNaN(numBeds) && numBeds > 0) {
      setGuests(String(numBeds * 2 + 2));
    }
  }, [bedrooms]);

  // Auto-collapse sidebar on mobile
  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  // Load demo data when ?demo=<key> is in the URL
  // Supports: ?demo=true (Newcastle), ?demo=manchester, ?demo=newcastle
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demoKey = params.get("demo");
    if (demoKey && DEMO_MAP[demoKey]) {
      const demoData = DEMO_MAP[demoKey];
      setResult(demoData);
      setAddress(demoData.property.address);
      setPostcode(demoData.property.postcode);
      setBedrooms(String(demoData.property.bedrooms));
      setGuests(String(demoData.property.guests));
    }
  }, []);

  // Session analytics tracker
  useEffect(() => {
    if (result) {
      initTracker(result.property.address, result.property.postcode);
      return () => { endSession(); };
    }
  }, [result]);

  const scrollToSection = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) {
      const yOffset = -20;
      const y = el.getBoundingClientRect().top + window.scrollY + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const ANALYSIS_STAGES = [
    { key: "geocoding", label: "Locating property..." },
    { key: "short_let", label: "Fetching short-let data..." },
    { key: "long_let", label: "Fetching long-let valuation..." },
    { key: "amenities", label: "Finding nearby amenities..." },
    { key: "events", label: "Discovering local events..." },
    { key: "analysis", label: "Running analysis..." },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setProgress(0);
    setCompletedStages(new Set());
    setCurrentMessage("Starting analysis...");

    try {
      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          postcode,
          email,
          bedrooms: Number(bedrooms),
          guests: Number(guests),
          bathrooms: Number(bathrooms),
          parking,
          outdoorSpace,
          propertyType,
          ...(monthlyMortgage !== "" && { monthlyMortgage: Number(monthlyMortgage) }),
          ...(monthlyBills !== "" && { monthlyBills: Number(monthlyBills) }),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      if (!res.body) {
        setError("Streaming not supported by this browser.");
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));

              if (event.stage === "error") {
                setError(event.message);
                setLoading(false);
                return;
              }

              if (event.progress != null) {
                setProgress(event.progress);
              }
              if (event.message) {
                setCurrentMessage(event.message);
              }

              if (event.stage === "geocoding" && event.progress >= 20) {
                setCompletedStages((prev) => new Set(prev).add("geocoding"));
              }
              if (event.stage === "short_let") {
                setCompletedStages((prev) => new Set(prev).add("short_let"));
              }
              if (event.stage === "long_let") {
                setCompletedStages((prev) => new Set(prev).add("long_let"));
              }
              if (event.stage === "amenities" && event.progress >= 75) {
                setCompletedStages((prev) => new Set(prev).add("amenities"));
              }
              if (event.stage === "events") {
                setCompletedStages((prev) => new Set(prev).add("events"));
              }
              if (event.stage === "analysis") {
                setCompletedStages((prev) => new Set(prev).add("analysis"));
              }

              if (event.stage === "complete" && event.data) {
                setResult(event.data as AnalysisResult);
                setLoading(false);
                return;
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      if (!result) {
        setError("Analysis stream ended unexpectedly. Please try again.");
        setLoading(false);
      }
    } catch {
      setError(
        "Could not reach the server. Please check your connection and try again."
      );
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setAddress("");
    setPostcode("");
    setEntryMode("auto");
    setSelectedAutoAddress(null);
  };

  // ─── Loading State ──────────────────────────────────────────────

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <Image
            alt="Stayful"
            width={140}
            height={45}
            className="h-10 w-auto"
            src="/images/stayful-logo.png"
            priority
          />
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-lg font-medium text-foreground">
              Analysing your property...
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{currentMessage}</span>
              <span className="font-mono font-semibold">{progress}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Stage checklist */}
          <div className="w-full space-y-2 text-left">
            {ANALYSIS_STAGES.map((stage) => {
              const done = completedStages.has(stage.key);
              return (
                <div
                  key={stage.key}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ring-1 transition-colors duration-300 ${
                    done
                      ? "bg-success/10 text-success ring-success/20"
                      : "bg-card text-card-foreground ring-foreground/10"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0 animate-pulse rounded-full border-2 border-muted-foreground/30" />
                  )}
                  <span className={done ? "line-through opacity-70" : ""}>
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="max-w-md text-xs text-muted-foreground">
            Gathering data from Airbtics, PropertyData, Google Places, and
            Ticketmaster. This usually takes 10-20 seconds.
          </p>
        </div>
      </main>
    );
  }

  // ─── Report State ───────────────────────────────────────────────

  if (result) {
    const r = result;
    const f = r.financials;
    const v = r.verdict;
    const risk = r.risk;

    // Monthly chart data
    const chartData = MONTHS.map((month, i) => ({
      month,
      "Short Let": r.shortLet.monthlyRevenue[i],
      "Long Let": Math.round(r.longLet.monthlyRent),
    }));

    // Revenue cost breakdown — user-adjustable via the "Customise expenses"
    // panel in the hero. Each override is null until the user edits that row,
    // at which point the typed value sticks. Defaults:
    //   platform 15 % · management 15 % · cleaning 18 % of gross (per month)
    // The cleaning default is seeded off the V4 PMI Top Market gross so it
    // doesn't jump when the user excludes comps (Filtered gross moves).
    const grossAnnual = f.shortLetGrossAnnual;
    const DEFAULT_PLATFORM_PCT = 15;
    const DEFAULT_MGMT_PCT = 15;
    const DEFAULT_CLEANING_PCT_OF_GROSS = 0.18;
    const effPlatformPct = platformFeePct ?? DEFAULT_PLATFORM_PCT;
    const effMgmtPct = mgmtFeePct ?? DEFAULT_MGMT_PCT;
    const effCleaningMonthly = cleaningMonthly
      ?? Math.max(0, Math.round((grossAnnual / 12) * DEFAULT_CLEANING_PCT_OF_GROSS));
    const cleaningAnnual = effCleaningMonthly * 12;

    // Central helper — every Net Revenue figure on the page flows through this.
    const computeNet = (gross: number): number => {
      const platformAnnual = gross * (effPlatformPct / 100);
      const mgmtAnnual = gross * (effMgmtPct / 100);
      return Math.max(0, Math.round(gross - platformAnnual - mgmtAnnual - cleaningAnnual));
    };

    const totalMonthlyOverheads = (overheadMortgage ?? 0) + (overheadBills ?? 0) + (overheadOther ?? 0);
    const totalAnnualOverheads = totalMonthlyOverheads * 12;
    const computeProfit = (gross: number): number => computeNet(gross) - totalAnnualOverheads;

    const platformFees = Math.round(grossAnnual * (effPlatformPct / 100));
    const managementFees = Math.round(grossAnnual * (effMgmtPct / 100));
    const cleaningLaundry = cleaningAnnual;
    const totalOperatingCosts = platformFees + managementFees + cleaningLaundry;
    const stlNetAnnual = computeNet(grossAnnual);

    const ltlGrossAnnual = f.longLetGrossAnnual;
    const ltlAgentFees = Math.round(ltlGrossAnnual * 0.10);
    const ltlNetAnnual = ltlGrossAnnual - ltlAgentFees;

    const stlTrueAnnualProfit = stlNetAnnual - totalAnnualOverheads;
    const ltlTrueAnnualProfit = ltlNetAnnual - ((overheadMortgage ?? 0) * 12);
    const revDifference = stlTrueAnnualProfit - ltlTrueAnnualProfit;
    const revDifferenceMonthly = Math.round(revDifference / 12);
    const revDifferencePct = ltlTrueAnnualProfit > 0 ? Math.round((revDifference / ltlTrueAnnualProfit) * 100) : (ltlNetAnnual > 0 ? Math.round(((stlNetAnnual - ltlNetAnnual) / ltlNetAnnual) * 100) : 0);
    const profitDifference = revDifference;

    // Monthly occupancy with seasonal weighting
    const avgOcc = r.shortLet.occupancyRate;
    const totalWeight = SEASONAL_WEIGHTS.reduce((s, w) => s + w, 0);
    const monthlyOccupancy = SEASONAL_WEIGHTS.map((w) =>
      Math.min(1, (avgOcc * 12 * w) / totalWeight)
    );

    // Net monthly for STL — apply the user's adjustable expense formula per
    // month. Cleaning is a flat monthly figure (not % of month's revenue) so
    // it deducts equally across all months.
    const stlMonthlyNet = r.shortLet.monthlyRevenue.map((rev) => {
      const platform = rev * (effPlatformPct / 100);
      const mgmt = rev * (effMgmtPct / 100);
      return Math.max(0, Math.round(rev - platform - mgmt - effCleaningMonthly));
    });
    const ltlMonthlyNet = Math.round(ltlNetAnnual / 12);

    // Peak months = top 3 by STL revenue, Low = bottom 3, Below LTL = months where STL < LTL
    const peakMonthCount = 3;
    const belowLtlCount = stlMonthlyNet.filter((net) => net < ltlMonthlyNet).length;

    // Best/worst month
    const bestMonthIdx = stlMonthlyNet.indexOf(Math.max(...stlMonthlyNet));
    const worstMonthIdx = stlMonthlyNet.indexOf(Math.min(...stlMonthlyNet));

    // Long-let monthly net baseline for badge logic
    const ltlMonthlyBaseline = Math.round((f.longLetGrossAnnual / 12) * 0.90);

    // Bottom 3 months by STL revenue (for "Below Average" badge)
    const sortedMonthIndices = [...Array(12).keys()].sort((a, b) => stlMonthlyNet[a] - stlMonthlyNet[b]);
    const bottom3Months = new Set(sortedMonthIndices.slice(0, 3));

    // Badge logic: based on STL's own seasonal variation (top 3 = Peak, bottom 3 = Low, rest = Average/no badge)
    const top3Months = new Set([...Array(12).keys()].sort((a, b) => stlMonthlyNet[b] - stlMonthlyNet[a]).slice(0, 3));

    const getMonthBadge = (i: number): { label: string; className: string } | null => {
      if (top3Months.has(i)) {
        return { label: "Peak", className: "bg-success/10 text-success" };
      }
      if (bottom3Months.has(i)) {
        return { label: "Low", className: "bg-destructive/10 text-destructive" };
      }
      return null;
    };

    // Demand scoring helper
    function demandLevel(count: number): {
      label: string;
      color: string;
    } {
      if (count >= 3) return { label: "High", color: "bg-success text-success-foreground" };
      if (count >= 1) return { label: "Moderate", color: "bg-warning text-warning-foreground" };
      return { label: "Low", color: "bg-destructive/10 text-destructive" };
    }

    const demandCategories = [
      {
        key: "hospitals" as const,
        label: "Healthcare Facilities",
        icon: Heart,
        iconBg: "bg-red-100",
        iconColor: "text-red-500",
        items: r.demandDrivers.hospitals,
      },
      {
        key: "universities" as const,
        label: "Educational Institutions",
        icon: GraduationCap,
        iconBg: "bg-blue-100",
        iconColor: "text-blue-500",
        items: r.demandDrivers.universities,
      },
      {
        key: "airports" as const,
        label: "Construction Projects",
        icon: HardHat,
        iconBg: "bg-amber-100",
        iconColor: "text-amber-600",
        items: r.demandDrivers.airports,
      },
      {
        key: "trainStations" as const,
        label: "Events & Entertainment",
        icon: PartyPopper,
        iconBg: "bg-purple-100",
        iconColor: "text-purple-500",
        items: r.demandDrivers.trainStations,
      },
    ];

    // Risk dimensions grouped
    const financialRisks = [
      { label: "Income Volatility", level: risk.incomeVolatility },
      { label: "Seasonality", level: risk.seasonality },
      { label: "Competition", level: risk.competition },
    ];
    const operationalRisks = [
      { label: "Setup Cost", level: risk.setupCost },
      { label: "Guest Damage", level: risk.guestDamage },
      { label: "Platform Dependency", level: risk.platformDependency },
    ];
    const complianceRisks = [
      { label: "Regulatory", level: risk.regulatory },
      { label: "Location Demand", level: risk.locationDemand },
    ];

    // Risk level to /100 score
    const riskToScore = (level: RiskLevel): number => {
      if (level === "low") return 25;
      if (level === "moderate") return 50;
      return 75;
    };

    // Overall risk on /100 scale (0 = low risk, 100 = high risk)
    const overallRiskScore = risk.overallScore * 10;
    const riskLabel = v.riskLevel === "low" ? "Low Risk" : v.riskLevel === "moderate" ? "Low-Medium Risk" : "High Risk";

    // Risk factor breakdown for 2x2 grid
    const riskFactors = [
      {
        name: "Revenue Consistency",
        score: riskToScore(risk.incomeVolatility),
        desc: "How stable and predictable the monthly revenue is throughout the year.",
      },
      {
        name: "Long-Term Comparison",
        score: riskToScore(risk.competition),
        desc: "How the short-term rental income compares to guaranteed long-term rental income.",
      },
      {
        name: "Seasonal Variance",
        score: riskToScore(risk.seasonality),
        desc: "The degree of fluctuation in bookings and revenue across different seasons.",
      },
      {
        name: "Market Demand",
        score: riskToScore(risk.locationDemand),
        desc: "Overall strength of booking demand drivers in your local area.",
      },
    ];

    // Direct booking score calculation
    const hospitals = r.demandDrivers.hospitals.length;
    const universities = r.demandDrivers.universities.length;
    const totalTransport = r.demandDrivers.trainStations.length + r.demandDrivers.busStations.length + r.demandDrivers.subwayStations.length;
    const totalEvents = r.nearbyEvents.totalEvents;
    const demandDriverCount = [hospitals > 0, universities > 0, totalTransport > 0, totalEvents > 0].filter(Boolean).length;

    let bookingScore = 0;
    const bookingFactors: { label: string; icon: React.ElementType; iconBg: string; iconColor: string; detail: string; scoreLbl: string }[] = [];

    const hospScore = hospitals > 0 ? 15 : 0;
    bookingScore += hospScore;
    bookingFactors.push({ label: "Hospitals & Medical", icon: Heart, iconBg: "bg-red-100", iconColor: "text-red-500", detail: `${hospitals} nearby`, scoreLbl: hospScore >= 10 ? "High" : hospScore > 0 ? "Medium" : "Low" });

    const uniScore = universities > 0 ? 15 : 0;
    bookingScore += uniScore;
    bookingFactors.push({ label: "Universities & Education", icon: GraduationCap, iconBg: "bg-blue-100", iconColor: "text-blue-500", detail: `${universities} nearby`, scoreLbl: uniScore >= 10 ? "High" : uniScore > 0 ? "Medium" : "Low" });

    const transportScore = totalTransport >= 3 ? 20 : totalTransport >= 1 ? 12 : 0;
    bookingScore += transportScore;
    bookingFactors.push({ label: "Construction Projects", icon: HardHat, iconBg: "bg-amber-100", iconColor: "text-amber-600", detail: `${totalTransport} nearby`, scoreLbl: transportScore >= 15 ? "High" : transportScore > 0 ? "Medium" : "Low" });

    const eventScore = totalEvents >= 100 ? 25 : totalEvents >= 50 ? 15 : totalEvents > 0 ? 5 : 0;
    bookingScore += eventScore;
    bookingFactors.push({ label: "Events & Conferences", icon: PartyPopper, iconBg: "bg-purple-100", iconColor: "text-purple-500", detail: `${totalEvents} events`, scoreLbl: eventScore >= 15 ? "High" : eventScore > 0 ? "Medium" : "Low" });

    const driverBonus = demandDriverCount >= 3 ? 10 : demandDriverCount >= 2 ? 5 : 0;
    bookingScore += driverBonus;
    bookingScore += 15; // base

    const bookingRating = bookingScore >= 80 ? "Excellent" : bookingScore >= 60 ? "Strong" : bookingScore >= 40 ? "Good" : "Limited";
    const bookingScoreColor = bookingScore >= 60 ? "#64a064" : bookingScore >= 40 ? "#c8b464" : "#b45050";

    // Demand drivers narrative
    const nearbyTypes: string[] = [];
    if (hospitals > 0) nearbyTypes.push("hospitals");
    if (universities > 0) nearbyTypes.push("universities");
    if (totalTransport > 0) nearbyTypes.push("transport hubs");
    if (totalEvents > 30) nearbyTypes.push("event venues");

    const guestTypes: string[] = [];
    if (hospitals > 0) guestTypes.push("families visiting patients", "medical professionals");
    if (universities > 0) guestTypes.push("students", "visiting academics");
    if (totalTransport > 0) guestTypes.push("business travellers", "contractors");
    if (totalEvents > 30) guestTypes.push("event attendees");
    if (guestTypes.length === 0) guestTypes.push("leisure travellers", "weekend visitors");

    const narrative = `Your ${r.property.bedrooms}-bedroom property accommodating ${r.property.guests} guests is well-positioned to attract ${guestTypes.slice(0, 3).join(", ")}${nearbyTypes.length > 0 ? ` based on nearby ${nearbyTypes.join(", ")}` : ""}. The local area provides ${demandDriverCount >= 3 ? "strong" : demandDriverCount >= 2 ? "moderate" : "emerging"} demand diversity which supports consistent occupancy throughout the year.`;

    // Y3 extra monthly profit from direct bookings (save 15% platform fees on 50% of bookings)
    const y3ExtraMonthlyProfit = Math.round((grossAnnual * 0.5 * 0.15) / 12);

    // Current active tab info for progress indicator
    const activeTabInfo = TAB_SECTIONS.find((t) => t.id === activeTab);
    const sidebarWidth = sidebarCollapsed ? 48 : 200;

    // Average rating and reviews from comparables
    const allComps = r.shortLet.comparables;
    const hasComparables = allComps.length > 0;
    // User-filtered subset: all comps minus the ones the user excluded via
    // the per-card Exclude button. Every aggregate below derives from this
    // subset so the UI updates live as the user curates.
    const includedComps = allComps.filter((_, i) => !excludedComps.has(i));
    const hasIncluded = includedComps.length > 0;
    const comps = includedComps;

    // Sort comparables by annual revenue descending (highest first)
    const compsSortedByRevenue = [...comps].sort((a, b) => b.annualRevenue - a.annualRevenue);
    // Top 5 performers for projection averages
    const top5Comps = compsSortedByRevenue.slice(0, 5);
    const top5Set = new Set(top5Comps);
    const hasTop5 = top5Comps.length >= 5;

    const compsWithRating = comps.filter((c) => c.rating > 0);
    const avgRating = compsWithRating.length > 0 ? Math.round(compsWithRating.reduce((s, c) => s + c.rating, 0) / compsWithRating.length * 100) / 100 : 0;
    const compsWithReviews = comps.filter((c) => c.reviewCount > 0);
    const avgReviews = compsWithReviews.length > 0 ? Math.round(compsWithReviews.reduce((s, c) => s + c.reviewCount, 0) / compsWithReviews.length) : 0;
    const compsWithAge = comps.filter((c) => c.listingAge > 0);
    const avgListingAge = compsWithAge.length > 0 ? Math.round(compsWithAge.reduce((s, c) => s + c.listingAge, 0) / compsWithAge.length * 10) / 10 : 0;

    // Full pool averages (filtered comps) for Decision Engine "Match" box
    const poolAvgAdr = hasIncluded ? Math.round(comps.reduce((s, c) => s + c.averageDailyRate, 0) / comps.length) : r.shortLet.averageDailyRate;
    const poolAvgOccupancy = hasIncluded ? comps.reduce((s, c) => s + c.occupancyRate, 0) / comps.length : r.shortLet.occupancyRate;
    const poolAvgRevenue = hasIncluded ? Math.round(comps.reduce((s, c) => s + c.annualRevenue, 0) / comps.length) : r.shortLet.annualRevenue;

    // Top 25% comps for Decision Engine "Beat" box
    const top25PctCount = hasIncluded ? Math.max(1, Math.ceil(comps.length * 0.25)) : 0;
    const top25Comps = compsSortedByRevenue.slice(0, top25PctCount);
    const beatAvgAdr = top25Comps.length > 0 ? Math.round(top25Comps.reduce((s, c) => s + c.averageDailyRate, 0) / top25Comps.length) : 0;
    const beatAvgOccupancy = top25Comps.length > 0 ? top25Comps.reduce((s, c) => s + c.occupancyRate, 0) / top25Comps.length : 0;
    const beatAvgRevenue = top25Comps.length > 0 ? Math.round(top25Comps.reduce((s, c) => s + c.annualRevenue, 0) / top25Comps.length) : 0;

    // "Your Filtered Estimate" — mirrors the V4 PMI "Top Market Potential"
    // when no comps are excluded (snap behaviour, so the first impression
    // shows identical numbers in both columns). As soon as the user removes
    // any comp it switches to the arithmetic MEAN of the kept comps across
    // annualRevenue / ADR / occupancy. If the user excludes every comp, all
    // filtered values collapse to 0.
    //
    // Net revenue is now user-adjustable — see computeNet helper above, which
    // subtracts platform %, management % and cleaning £/month from gross.
    // Both hero columns and every downstream section share the same helper.
    const excludedCount = allComps.length - includedComps.length;
    const hasFilters = excludedCount > 0;
    const topGross = r.shortLet.annualRevenue;
    const topAdr = r.shortLet.averageDailyRate;
    const topOcc = r.shortLet.occupancyRate;
    const topNet = computeNet(topGross);

    let filteredGross: number;
    let filteredAdr: number;
    let filteredOcc: number;
    if (!hasIncluded) {
      // All comps excluded (or no comps at all).
      filteredGross = 0;
      filteredAdr = 0;
      filteredOcc = 0;
    } else if (!hasFilters) {
      // No user filter yet — snap to V4 PMI Top Market Potential values so
      // both columns read identically on first load.
      filteredGross = topGross;
      filteredAdr = topAdr;
      filteredOcc = topOcc;
    } else {
      // At least one comp excluded — recompute from the kept-comps mean.
      // Mean of 1 kept comp = that single comp's values (matches user spec).
      filteredGross = Math.round(includedComps.reduce((s, c) => s + c.annualRevenue, 0) / includedComps.length);
      filteredAdr = Math.round(includedComps.reduce((s, c) => s + c.averageDailyRate, 0) / includedComps.length);
      filteredOcc = includedComps.reduce((s, c) => s + c.occupancyRate, 0) / includedComps.length;
    }
    const filteredNet = computeNet(filteredGross);
    // Kept for the Section 2 banner wording that references it downstream.
    const filteredEstimate = filteredGross;

    // 36-month growth chart data
    const growthData = Array.from({ length: 36 }, (_, i) => {
      const month = i + 1;
      const directPct = Math.min(0.5, (month / 36) * 0.5);
      const monthlyGross = grossAnnual / 12;
      const platformFeeRate = 0.15 * (1 - directPct);
      const revenue = monthlyGross * (1 - platformFeeRate - 0.15 - 0.18);
      const expenses = totalMonthlyOverheads;
      return {
        month: `M${month}`,
        Revenue: Math.round(revenue),
        Expenses: Math.round(expenses),
        Profit: Math.round(revenue - expenses),
      };
    });

    // Data sources list removed — replaced by FAQ section

    return (
      <>
      <HeatmapOverlay />
      {showPresentation && (
        <Presentation data={r} onClose={() => setShowPresentation(false)} />
      )}
      <main className="min-h-screen bg-background">
        {/* ─── LEFT SIDEBAR ─────────────────────────────────── */}
        <aside
          className={`fixed left-0 top-0 z-40 h-full border-r border-border bg-card transition-all duration-300 ${
            sidebarCollapsed ? "w-12" : "w-[200px]"
          }`}
        >
          {/* Sidebar header */}
          <div className={`flex items-center border-b border-border ${sidebarCollapsed ? "justify-center px-2 py-3" : "justify-between px-4 py-3"}`}>
            {!sidebarCollapsed && (
              <Image
                alt="Stayful"
                width={100}
                height={32}
                className="h-7 w-auto"
                src="/images/stayful-logo.png"
                priority
              />
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Nav items */}
          <nav className="flex-1 overflow-y-auto py-2">
            {TAB_SECTIONS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => scrollToSection(tab.id)}
                  className={`flex w-full items-center gap-3 transition-colors ${
                    sidebarCollapsed ? "justify-center px-2 py-2.5" : "px-4 py-2.5"
                  } ${
                    isActive
                      ? "bg-primary/10 text-primary font-semibold border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  title={sidebarCollapsed ? tab.label : undefined}
                >
                  <TabIcon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                  {!sidebarCollapsed && (
                    <span className="text-sm truncate">{tab.label}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Calendly CTA */}
          {!sidebarCollapsed && (
            <div className="px-4 pb-2.5">
              <button
                type="button"
                onClick={() => { trackCtaClick("sidebar_book_call"); window.open("https://calendly.com/zac-stayful/call", "_blank"); }}
                style={{ background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 12, fontWeight: 600, width: "100%", padding: "10px 0", borderRadius: 8, marginBottom: 10, border: "none", cursor: "pointer" }}
              >
                Book your action plan
              </button>
            </div>
          )}

          {/* Progress at bottom */}
          <div className={`border-t border-border ${sidebarCollapsed ? "px-2 py-3" : "px-4 py-3"}`}>
            {!sidebarCollapsed && (
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Progress</p>
            )}
            <div className="flex items-center gap-2">
              {!sidebarCollapsed && (
                <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                  {activeTabInfo ? `${activeTabInfo.num} of 11` : ""}
                </span>
              )}
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-success transition-all duration-300"
                  style={{ width: `${activeTabInfo ? (activeTabInfo.num / 11) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </aside>

        {/* ─── MAIN CONTENT AREA ────────────────────────────── */}
        <div
          className="transition-all duration-300"
          style={{ marginLeft: sidebarWidth }}
        >
          {/* Top header with action buttons */}
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-b border-border bg-card/50">
            <Button variant="secondary" size="sm" onClick={handleReset}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              New Analysis
            </Button>
          </div>

          <div className="px-6 py-8 pb-28 max-w-5xl mx-auto">

          {/* ══════════════════════════════════════════════════════════
              Section 1: Overview
              ══════════════════════════════════════════════════════════ */}
          <section id="overview" ref={setSectionRef("overview")} className="mb-12">
            {/* Green Hero Card */}
            <div className="rounded-xl bg-primary p-6 text-primary-foreground">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-medium">Analysis Complete</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10 bg-transparent"
                  disabled={pdfLoading}
                  onClick={async () => {
                    if (!result) return;
                    trackCtaClick("download_pdf");
                    setPdfLoading(true);
                    try {
                      const res = await fetch("/api/generate-pdf", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ...result,
                          setup: setupSnapshotRef.current
                            ? {
                                furnishing: setupSnapshotRef.current.furnishing,
                                bedrooms: setupSnapshotRef.current.bedrooms,
                                items: setupSnapshotRef.current.items,
                              }
                            : undefined,
                        }),
                      });
                      if (!res.ok) throw new Error("PDF generation failed");
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `Stayful_Property_Analysis.pdf`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      // silently fail — user sees button re-enable
                    } finally {
                      setPdfLoading(false);
                    }
                  }}
                >
                  {pdfLoading ? "Generating report…" : "↓ Download as PDF"}
                </Button>
              </div>
              {/* Property title — centered above the two estimate columns */}
              <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold">{r.property.address}</h1>
                <p className="mt-1 text-sm text-primary-foreground/80">
                  {r.property.bedrooms} bed &middot; bath &middot; Sleeps {r.property.guests}
                </p>
              </div>

              {grossAnnual > 0 ? (
                <>
                  {/* Two estimate columns — side-by-side on lg, stacked on mobile.
                      Mobile: natural vertical stack (Top, then Filtered, then EPV).
                      Desktop: grid with a vertical divider between the two columns. */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-primary-foreground/15">
                    {/* ── Top Market Potential (V4 PMI headline — unaffected by exclusions) ── */}
                    <div className="lg:pr-8">
                      <p className="text-xs text-primary-foreground/70 uppercase tracking-wider">Top Market Potential</p>
                      <p className="text-sm text-primary-foreground/80 mb-3">
                        What a top-performer in this area can earn
                      </p>
                      <p className="text-3xl font-bold leading-tight">
                        {gbp(topGross)}{" "}
                        <span className="text-base font-normal text-primary-foreground/80">{gbp(Math.round(topGross / 12))}/mo</span>
                      </p>
                      <p className="mt-4 text-xs text-primary-foreground/70 uppercase tracking-wider">Net Revenue</p>
                      <p className="text-3xl font-bold leading-tight">
                        {gbp(topNet)}{" "}
                        <span className="text-base font-normal text-primary-foreground/80">{gbp(Math.round(topNet / 12))}/mo</span>
                      </p>
                      <p className="mt-2 text-[11px] text-primary-foreground/70 leading-relaxed max-w-xs">
                        After booking platform fees, cleaning, laundry and property management
                      </p>
                      <div className="mt-4 flex items-start gap-6">
                        <div>
                          <p className="text-[11px] text-primary-foreground/70 uppercase tracking-wider">ADR</p>
                          <p className="mt-0.5 text-xl font-bold">{gbp(topAdr)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-primary-foreground/70 uppercase tracking-wider">Occupancy</p>
                          <p className="mt-0.5 text-xl font-bold">{pct(topOcc)}</p>
                        </div>
                      </div>
                    </div>

                    {/* ── Your Filtered Estimate (mean of kept comps; snaps to Top at 0 excluded) ── */}
                    <div className="lg:pl-8">
                      <p className="text-xs text-primary-foreground/70 uppercase tracking-wider">Your Filtered Estimate</p>
                      <p className="text-sm text-primary-foreground/80 mb-3">
                        {!hasIncluded
                          ? `All ${allComps.length} comps excluded — reset filters to restore`
                          : "Average of comps you kept"}
                      </p>
                      <p className="text-3xl font-bold leading-tight">
                        {gbp(filteredGross)}
                        {filteredGross > 0 && (
                          <>
                            {" "}
                            <span className="text-base font-normal text-primary-foreground/80">{gbp(Math.round(filteredGross / 12))}/mo</span>
                          </>
                        )}
                      </p>
                      <p className="mt-4 text-xs text-primary-foreground/70 uppercase tracking-wider">Net Revenue</p>
                      <p className="text-3xl font-bold leading-tight">
                        {gbp(filteredNet)}
                        {filteredNet > 0 && (
                          <>
                            {" "}
                            <span className="text-base font-normal text-primary-foreground/80">{gbp(Math.round(filteredNet / 12))}/mo</span>
                          </>
                        )}
                      </p>
                      <p className="mt-2 text-[11px] text-primary-foreground/70 leading-relaxed max-w-xs">
                        After booking platform fees, cleaning, laundry and property management
                      </p>
                      <div className="mt-4 flex items-start gap-6">
                        <div>
                          <p className="text-[11px] text-primary-foreground/70 uppercase tracking-wider">ADR</p>
                          <p className="mt-0.5 text-xl font-bold">{gbp(filteredAdr)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-primary-foreground/70 uppercase tracking-wider">Occupancy</p>
                          <p className="mt-0.5 text-xl font-bold">{pct(filteredOcc)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Centered property value range block under both columns ── */}
                  {r.propertyValuation && (() => {
                    const lower = r.propertyValuation.estimatedValue;
                    const upper = Math.round(lower * 1.25);
                    return (
                      <div className="mt-6 border-t border-primary-foreground/15 pt-6 text-center">
                        <p className="text-xs text-primary-foreground/70 uppercase tracking-wider">Est. Property Value Range</p>
                        <div className="mt-3 flex items-center justify-center gap-3">
                          <div className="text-center">
                            <p className="text-[10px] text-primary-foreground/50 uppercase tracking-wider mb-0.5">Conservative</p>
                            <p className="text-xl font-semibold" style={{ color: "rgba(255,255,255,0.65)" }}>{gbp(lower)}</p>
                          </div>
                          <div className="flex-1" style={{ maxWidth: 120, height: 3, borderRadius: 2, background: "linear-gradient(to right, rgba(255,255,255,0.25), rgba(255,255,255,0.65))" }} />
                          <div className="text-center">
                            <p className="text-[10px] text-primary-foreground/50 uppercase tracking-wider mb-0.5">Upper estimate</p>
                            <p className="text-2xl font-bold text-primary-foreground">{gbp(upper)}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-primary-foreground/30" style={{ fontSize: 10 }}>Range reflects current market uplift potential in this postcode</p>
                        <p className="mt-1 text-[11px] text-primary-foreground/60">Source: PropertyData</p>
                      </div>
                    );
                  })()}

                  {/* Refinement tagline */}
                  <p className="mt-4 text-center text-sm italic text-primary-foreground/75">
                    Refine your competition data for a more direct, accurate analysis of this property&apos;s income potential
                  </p>

                  {/* ── Customise expenses — user-adjustable net-revenue formula ── */}
                  <div className="mt-5 border-t border-primary-foreground/15 pt-4">
                    <button
                      type="button"
                      onClick={() => setExpensesExpanded((v) => !v)}
                      className="flex w-full items-center justify-center gap-2 text-xs font-medium text-primary-foreground/80 hover:text-primary-foreground transition-colors"
                      aria-expanded={expensesExpanded}
                    >
                      {expensesExpanded ? "Hide" : "Estimate"} profit
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expensesExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                    {expensesExpanded && (
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {/* Platform fee % */}
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
                            Booking platform fees
                          </label>
                          <div className="mt-1 flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={platformFeePct ?? effPlatformPct}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                if (v === "") { setPlatformFeePct(null); return; }
                                const n = Number(v);
                                if (Number.isFinite(n) && n >= 0 && n <= 100) setPlatformFeePct(n);
                              }}
                              className="w-16 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-sm font-semibold text-primary-foreground outline-none focus:border-primary-foreground/60"
                            />
                            <span className="text-sm text-primary-foreground/80">%</span>
                          </div>
                          <p className="mt-1 text-[11px] text-primary-foreground/60">
                            {gbp(Math.round(grossAnnual * (effPlatformPct / 100) / 12))}/mo · {gbp(Math.round(grossAnnual * (effPlatformPct / 100)))}/yr
                          </p>
                        </div>

                        {/* Management fee % */}
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
                            Management fees
                          </label>
                          <div className="mt-1 flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={mgmtFeePct ?? effMgmtPct}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                if (v === "") { setMgmtFeePct(null); return; }
                                const n = Number(v);
                                if (Number.isFinite(n) && n >= 0 && n <= 100) setMgmtFeePct(n);
                              }}
                              className="w-16 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-sm font-semibold text-primary-foreground outline-none focus:border-primary-foreground/60"
                            />
                            <span className="text-sm text-primary-foreground/80">%</span>
                          </div>
                          <p className="mt-1 text-[11px] text-primary-foreground/60">
                            {gbp(Math.round(grossAnnual * (effMgmtPct / 100) / 12))}/mo · {gbp(Math.round(grossAnnual * (effMgmtPct / 100)))}/yr
                          </p>
                        </div>

                        {/* Cleaning & laundry £ per month */}
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
                            Cleaning &amp; laundry
                          </label>
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-sm text-primary-foreground/80">£</span>
                            <input
                              type="number"
                              min={0}
                              step={10}
                              value={cleaningMonthly ?? effCleaningMonthly}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                if (v === "") { setCleaningMonthly(null); return; }
                                const n = Number(v);
                                if (Number.isFinite(n) && n >= 0) setCleaningMonthly(Math.round(n));
                              }}
                              className="w-24 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-sm font-semibold text-primary-foreground outline-none focus:border-primary-foreground/60"
                            />
                            <span className="text-sm text-primary-foreground/80">/mo</span>
                          </div>
                          <p className="mt-1 text-[11px] text-primary-foreground/60">
                            × 12 = {gbp(cleaningAnnual)}/yr
                          </p>
                        </div>
                      </div>
                    )}
                    {/* ── Overhead inputs (bills, mortgage, other) ── */}
                    {expensesExpanded && (
                      <div className="mt-4 border-t border-primary-foreground/15 pt-4">
                        <p className="mb-3 text-center text-xs font-medium text-primary-foreground/80">Your monthly overheads</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {/* Mortgage / Rent */}
                          <div className="rounded-lg bg-primary-foreground/10 p-3">
                            <label className="text-[11px] font-medium text-primary-foreground/70">
                              Mortgage / Rent
                            </label>
                            <div className="mt-1 flex items-center gap-1">
                              <span className="text-sm text-primary-foreground/80">£</span>
                              <input
                                type="number"
                                min={0}
                                step={50}
                                value={overheadMortgage ?? ""}
                                placeholder="0"
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  if (v === "") { setOverheadMortgage(null); return; }
                                  const n = Number(v);
                                  if (Number.isFinite(n) && n >= 0) setOverheadMortgage(Math.round(n));
                                }}
                                className="w-24 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-sm font-semibold text-primary-foreground outline-none focus:border-primary-foreground/60"
                              />
                              <span className="text-sm text-primary-foreground/80">/mo</span>
                            </div>
                          </div>
                          {/* Bills */}
                          <div className="rounded-lg bg-primary-foreground/10 p-3">
                            <label className="text-[11px] font-medium text-primary-foreground/70">
                              Bills (council tax, utilities, broadband)
                            </label>
                            <div className="mt-1 flex items-center gap-1">
                              <span className="text-sm text-primary-foreground/80">£</span>
                              <input
                                type="number"
                                min={0}
                                step={10}
                                value={overheadBills ?? ""}
                                placeholder="0"
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  if (v === "") { setOverheadBills(null); return; }
                                  const n = Number(v);
                                  if (Number.isFinite(n) && n >= 0) setOverheadBills(Math.round(n));
                                }}
                                className="w-24 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-sm font-semibold text-primary-foreground outline-none focus:border-primary-foreground/60"
                              />
                              <span className="text-sm text-primary-foreground/80">/mo</span>
                            </div>
                          </div>
                          {/* Other */}
                          <div className="rounded-lg bg-primary-foreground/10 p-3">
                            <label className="text-[11px] font-medium text-primary-foreground/70">
                              Other / miscellaneous
                            </label>
                            <div className="mt-1 flex items-center gap-1">
                              <span className="text-sm text-primary-foreground/80">£</span>
                              <input
                                type="number"
                                min={0}
                                step={10}
                                value={overheadOther ?? ""}
                                placeholder="0"
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  if (v === "") { setOverheadOther(null); return; }
                                  const n = Number(v);
                                  if (Number.isFinite(n) && n >= 0) setOverheadOther(Math.round(n));
                                }}
                                className="w-24 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-sm font-semibold text-primary-foreground outline-none focus:border-primary-foreground/60"
                              />
                              <span className="text-sm text-primary-foreground/80">/mo</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── True Profit display ── */}
                    {expensesExpanded && totalMonthlyOverheads > 0 && (
                      <div className="mt-4 border-t border-primary-foreground/15 pt-4">
                        <p className="mb-3 text-center text-xs font-medium text-primary-foreground/80">Your true profit (after all overheads)</p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="rounded-lg bg-primary-foreground/10 p-4 text-center">
                            <p className="text-[11px] font-medium text-primary-foreground/70 mb-1">Top Market Profit</p>
                            <p className="text-2xl font-bold text-primary-foreground">
                              {gbp(computeProfit(topGross))}
                              <span className="text-sm font-normal text-primary-foreground/60">/yr</span>
                            </p>
                            <p className="mt-1 text-sm text-primary-foreground/80">
                              {gbp(Math.round(computeProfit(topGross) / 12))}/mo
                            </p>
                            <p className="mt-2 text-[10px] text-primary-foreground/50">
                              Net {gbp(computeNet(topGross))} − Overheads {gbp(totalAnnualOverheads)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-primary-foreground/10 p-4 text-center">
                            <p className="text-[11px] font-medium text-primary-foreground/70 mb-1">Your Filtered Profit</p>
                            <p className="text-2xl font-bold text-primary-foreground">
                              {gbp(computeProfit(filteredGross))}
                              <span className="text-sm font-normal text-primary-foreground/60">/yr</span>
                            </p>
                            <p className="mt-1 text-sm text-primary-foreground/80">
                              {gbp(Math.round(computeProfit(filteredGross) / 12))}/mo
                            </p>
                            <p className="mt-2 text-[10px] text-primary-foreground/50">
                              Net {gbp(computeNet(filteredGross))} − Overheads {gbp(totalAnnualOverheads)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {expensesExpanded && (
                      <p className="mt-3 text-center text-[11px] text-primary-foreground/60">
                        Your inputs flow through to both Net Revenue figures and the Revenue Breakdown &amp; Profit Calculator sections.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-primary-foreground/80">Limited market data available</p>
                  <p className="text-xs text-primary-foreground/60 mt-1">Book a call with Stayful for a personalised estimate</p>
                </div>
              )}
            </div>

            {/* Estimate setup costs — collapsible calculator */}
            <div className="mt-6">
              <SetupCalculator
                defaultBedrooms={r.property.bedrooms}
                propertyAddress={r.property.address}
                onSnapshot={(snap) => { setupSnapshotRef.current = snap; }}
              />
            </div>

            {/* Is this information accurate? — data-source confidence panel */}
            <div className="mt-6">
              <AccuracyPanel />
            </div>

            {/* Calendly CTA banner */}
            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 rounded-xl bg-primary p-6 sm:p-7">
              <div>
                <p className="text-base font-semibold text-primary-foreground" style={{ marginBottom: 6 }}>
                  Book your profitability action plan
                </p>
                <p className="text-[13px] text-primary-foreground/60">
                  A free consultation to review the risks in your property and analyse your realistic profitability.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { trackCtaClick("overview_book_call"); window.open("https://calendly.com/zac-stayful/call", "_blank"); }}
                className="shrink-0 whitespace-nowrap rounded-lg px-5 py-3 text-[13px] font-bold text-primary"
                style={{ background: "#B9D5C6", border: "none", cursor: "pointer" }}
              >
                Book your plan →
              </button>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 2: Comparables
              ══════════════════════════════════════════════════════════ */}
          <section id="comparables" ref={setSectionRef("comparables")} className="mb-12">
            <SectionHeading
              icon={MapPin}
              title={r.dataQuality?.comparablesFound ? `${r.dataQuality.comparablesFound} Comparable Properties Analysed` : (hasComparables ? `${r.shortLet.comparables.length} Comparable Properties Analysed` : "Market Analysis")}
              subtitle={`Similar ${r.property.bedrooms}-bedroom properties accommodating ${r.property.guests} guests within your area.${r.dataQuality?.searchBroadened ? ` Search broadened to ${r.dataQuality.searchRadiusKm}km.` : ""}${hasTop5 ? " Revenue projections based on top-performing comparable properties." : ""}`}
            />

            {r.dataQuality?.disclaimer && (
              <div className={`mb-4 rounded-lg border p-3 text-sm ${
                r.dataQuality.level === "low"
                  ? "border-warning/50 bg-warning/10 text-warning-foreground"
                  : "border-primary/30 bg-primary/5 text-foreground"
              }`}>
                <p className="font-medium mb-1">
                  {r.dataQuality.level === "low" ? "Limited Data Available" : "Data Note"}
                </p>
                <p className="text-xs">{r.dataQuality.disclaimer}</p>
                {r.dataQuality.level === "low" && (
                  <a href="https://calendly.com/zac-stayful/call" target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs font-medium text-primary underline"
                    onClick={() => trackCtaClick("book_call")}>
                    Book your profitability action plan
                  </a>
                )}
              </div>
            )}

            {!r.dataQuality?.disclaimer && (
              <p className="mb-4 text-xs text-muted-foreground">
                Note: {r.dataQuality?.comparablesFound ?? (hasComparables ? r.shortLet.comparables.length : 8)} comparable properties found in this market. Analysis is based on available data.
              </p>
            )}

            {/* ─ Financial summary row ─ */}
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] text-muted-foreground">Avg. Nightly Rate</p>
                <p className="mt-1 text-xl font-bold text-foreground">{gbp(poolAvgAdr)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] text-muted-foreground">Avg. Occupancy</p>
                <p className="mt-1 text-xl font-bold text-foreground">{pct(poolAvgOccupancy)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] text-muted-foreground">Avg. Annual Revenue</p>
                <p className="mt-1 text-xl font-bold text-foreground">{gbp(poolAvgRevenue)}</p>
              </div>
            </div>

            {/* ─ Comp Set Benchmarks banner ─ */}
            {hasComparables && (
              <div className="mb-6 rounded-lg border border-border bg-card p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-foreground">Comp Set Benchmarks</p>
                  <p className="text-xs text-muted-foreground">What your listing needs to match the market</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">Avg. Rating</p>
                    <p className="mt-1 text-xl font-bold text-foreground flex items-center gap-1">
                      {avgRating > 0 ? (
                        <><Star className="h-4 w-4 text-warning fill-warning" />{roundReviewRating(avgRating)}</>
                      ) : (
                        <span className="text-base font-semibold text-muted-foreground/50">N/A</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">Avg. Reviews</p>
                    <p className="mt-1 text-xl font-bold text-foreground">
                      {avgReviews > 0 ? avgReviews : <span className="text-base font-semibold text-muted-foreground/50">N/A</span>}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">Avg. Listing Age</p>
                    <p className="mt-1 text-xl font-bold text-foreground">
                      {avgListingAge > 0 ? `${avgListingAge} yrs` : <span className="text-base font-semibold text-muted-foreground/50">N/A</span>}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ─ Methodology snapshot + source attribution ─ */}
            {r.shortLet.comparables.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Based on{" "}
                  <span className="font-semibold text-foreground">{r.dataQuality?.comparablesFound ?? r.shortLet.comparables.length}</span>
                  {r.shortLet.activeListings > 0 && (
                    <> of <span className="font-semibold text-foreground">{r.shortLet.activeListings}</span></>
                  )}
                  {" "}active Airbnb listings
                  {r.dataQuality?.searchRadiusKm ? <> within <span className="font-semibold text-foreground">{r.dataQuality.searchRadiusKm} km</span></> : null}
                  {" "}· Median-aggregated · Updated {formatRelativeTime(r.updatedAt)}
                  {r.dataQuality?.searchBroadened && (
                    <span className="text-muted-foreground/80"> (search radius broadened)</span>
                  )}
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                  <Home className="h-3 w-3" aria-hidden="true" />
                  Sourced from Airbnb · via Airbtics
                </span>
              </div>
            )}

            {/* ─ Filter banner (always visible when comps exist) ─ */}
            {r.shortLet.comparables.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  {hasFilters ? (
                    <span className="text-foreground">
                      Showing <span className="font-semibold">{includedComps.length} of {allComps.length}</span> comparables ·
                      {" "}Filtered Estimate: <span className="font-semibold">{gbp(filteredEstimate)}/yr</span>
                    </span>
                  ) : (
                    <span className="text-foreground">
                      Refine your estimate: exclude any comparable that doesn&apos;t match your property (wrong size, luxury outlier, sparse listing) to see a tailored figure.
                    </span>
                  )}
                </div>
                {hasFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExcludedComps(new Set())}
                    className="shrink-0"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Reset filters
                  </Button>
                )}
              </div>
            )}

            {/* ─ PMI-style comp cards + Decision Engine ─ */}
            {r.shortLet.comparables.length > 0 ? (
              <>
                <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...r.shortLet.comparables.entries()]
                    .sort(([a], [b]) => {
                      const aEx = excludedComps.has(a);
                      const bEx = excludedComps.has(b);
                      return aEx === bEx ? 0 : aEx ? 1 : -1;
                    })
                    .map(([i, comp]) => {
                    const isExcluded = excludedComps.has(i);
                    const isTopPerformer = !isExcluded && hasTop5 && top5Set.has(comp);
                    const ratingDisplay = comp.rating > 0 ? roundReviewRating(comp.rating) : null;
                    const ratingAboveAvg = !isExcluded && avgRating > 0 && comp.rating > 0 && comp.rating > avgRating + 0.05;
                    const ratingBelowAvg = !isExcluded && avgRating > 0 && comp.rating > 0 && comp.rating < avgRating - 0.05;
                    return (
                      <Card
                        key={i}
                        className={`relative overflow-hidden transition-all ${isTopPerformer ? "ring-1 ring-success" : ""} ${isExcluded ? "opacity-50 grayscale" : ""}`}
                      >
                        {isTopPerformer && (
                          <div className="absolute left-0 right-0 top-0 h-0.5 bg-success" />
                        )}
                        {comp.thumbnailUrl && (
                          <div className="aspect-[16/9] w-full overflow-hidden">
                            <img
                              src={comp.thumbnailUrl}
                              alt={comp.title || `Listing ${i + 1}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <CardContent className={comp.thumbnailUrl ? "p-4 pt-3" : "p-4"}>
                          {/* Header */}
                          <div className="mb-3 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className={`truncate text-sm font-semibold leading-tight text-foreground ${isExcluded ? "line-through" : ""}`}>
                                {comp.title || `Listing ${i + 1}`}
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {comp.bedrooms}b · {comp.accommodates}g{comp.distance != null ? ` · ${comp.distance} km` : ""}
                              </p>
                            </div>
                            {isExcluded ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
                                Excluded
                              </span>
                            ) : isTopPerformer ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success whitespace-nowrap">
                                Top
                              </span>
                            ) : null}
                          </div>

                          {/* Primary metrics */}
                          <div className="mb-3 grid grid-cols-3 divide-x divide-border/50 rounded-lg bg-muted/40 px-2 py-2.5">
                            <div className="px-1 text-center">
                              <p className="text-[10px] text-muted-foreground">Nightly</p>
                              <p className="mt-0.5 text-sm font-bold text-foreground">{gbp(comp.averageDailyRate)}</p>
                            </div>
                            <div className="px-1 text-center">
                              <p className="text-[10px] text-muted-foreground">Occupancy</p>
                              <p className="mt-0.5 text-sm font-bold text-foreground">{pct(comp.occupancyRate)}</p>
                            </div>
                            <div className="px-1 text-center">
                              <p className="text-[10px] text-muted-foreground">Annual</p>
                              <p className="mt-0.5 text-sm font-bold text-foreground">{gbp(comp.annualRevenue)}</p>
                            </div>
                          </div>

                          {/* Secondary: rating + review count */}
                          <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                            {ratingDisplay ? (
                              <>
                                <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                                <span className="text-sm font-medium">{ratingDisplay}</span>
                                {comp.reviewCount > 0 && (
                                  <>
                                    <span className="text-[11px] text-muted-foreground">·</span>
                                    <span className="text-xs text-muted-foreground">{comp.reviewCount} review{comp.reviewCount === 1 ? "" : "s"}</span>
                                  </>
                                )}
                                {ratingAboveAvg && (
                                  <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">↑ above avg</span>
                                )}
                                {ratingBelowAvg && (
                                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">↓ below avg</span>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">No rating yet</span>
                            )}
                          </div>

                          {/* Listing activity: days available + listing age */}
                          {(() => {
                            const daysEff = comp.daysAvailable > 0
                              ? comp.daysAvailable
                              : Math.round(comp.occupancyRate * 365);
                            const hasAge = comp.listingAge > 0;
                            if (daysEff <= 0 && !hasAge) return null;
                            return (
                              <div className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                                {daysEff > 0 && (
                                  <span className="inline-flex items-center gap-1">
                                    <Calendar className="h-3 w-3" aria-hidden="true" />
                                    {daysEff} days/yr
                                  </span>
                                )}
                                {daysEff > 0 && hasAge && <span className="text-muted-foreground/60">·</span>}
                                {hasAge && (
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3" aria-hidden="true" />
                                    {comp.listingAge} yr{comp.listingAge === 1 ? "" : "s"} old
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          {/* Airbnb-branded action button */}
                          {comp.url ? (
                            comp.url.startsWith("https://www.airbnb.") ? (
                              <a
                                href={comp.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#FF385C]/10 px-3 py-1.5 text-xs font-semibold text-[#FF385C] transition-colors hover:bg-[#FF385C]/20"
                              >
                                View on Airbnb
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            ) : (
                              <a
                                href={comp.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                              >
                                View listing
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            )
                          ) : (
                            <div className="flex w-full items-center justify-center rounded-md bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                              Listing URL unavailable
                            </div>
                          )}

                          {/* Exclude / Include toggle */}
                          <button
                            type="button"
                            onClick={() => {
                              setExcludedComps((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i);
                                else next.add(i);
                                return next;
                              });
                            }}
                            className={
                              isExcluded
                                ? "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                                : "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                            }
                            aria-pressed={isExcluded}
                            aria-label={isExcluded ? "Include this comp in your estimate" : "Exclude this comp from your estimate"}
                          >
                            {isExcluded ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Include
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                Exclude from estimate
                              </>
                            )}
                          </button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* ─ Decision Engine ─ */}
                <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* To Match the Market */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-foreground">To Match the Market</p>
                      <p className="text-xs text-muted-foreground">
                        Benchmark from all {comps.length} comparable propert{comps.length === 1 ? "y" : "ies"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Target Nightly Rate</span>
                        <span className="text-sm font-bold text-foreground">{gbp(poolAvgAdr)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Target Occupancy</span>
                        <span className="text-sm font-bold text-foreground">{pct(poolAvgOccupancy)}</span>
                      </div>
                      {avgRating > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Target Rating</span>
                          <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                            <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                            {roundReviewRating(avgRating)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-primary/20 pt-2">
                        <span className="text-xs font-medium text-muted-foreground">Target Annual Revenue</span>
                        <span className="text-base font-bold text-foreground">{gbp(poolAvgRevenue)}</span>
                      </div>
                    </div>
                  </div>

                  {/* To Beat the Market */}
                  <div className="rounded-xl border border-success/30 bg-success/5 p-4">
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-foreground">To Beat the Market</p>
                      <p className="text-xs text-muted-foreground">
                        Based on top {top25PctCount} propert{top25PctCount === 1 ? "y" : "ies"} (top 25%)
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Target Nightly Rate</span>
                        <span className="text-sm font-bold text-success">{gbp(beatAvgAdr)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Target Occupancy</span>
                        <span className="text-sm font-bold text-success">{pct(beatAvgOccupancy)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-success/20 pt-2">
                        <span className="text-xs font-medium text-muted-foreground">Target Annual Revenue</span>
                        <span className="text-base font-bold text-success">{gbp(beatAvgRevenue)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <Card className="border-l-4 border-l-primary">
                <CardContent className="py-6">
                  <div className="flex items-start gap-3">
                    <BarChart3 className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Market Data Summary
                      </p>
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        {r.shortLet.annualRevenue > 0 ? (
                          <>Analysis based on comparable {r.property.bedrooms}-bedroom properties near <span className="font-medium text-foreground">{r.property.postcode}</span>. Data represents performance from the local short-term rental market.</>
                        ) : (
                          <>Limited short-term rental data available near <span className="font-medium text-foreground">{r.property.postcode}</span>. This may be a rural or unique area with low competition, which can be advantageous for short-term letting.</>
                        )}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                        For individual comparable listings with direct Airbnb links, contact Stayful for a comprehensive property assessment.
                      </p>
                      <a
                        href="https://calendly.com/stayful"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                        onClick={() => trackCtaClick("book_call")}
                      >
                        <Phone className="h-3 w-3" />
                        Book your profitability action plan
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Data Note */}
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold">Data Note:</span> Revenue estimates are based on current market data and comparable property performance. Actual results may vary depending on property quality, pricing strategy, and market conditions.
                </p>
              </div>
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 3: Advised Amenities
              ══════════════════════════════════════════════════════════ */}
          <section id="amenities" ref={setSectionRef("amenities")} className="mb-12">
            <SectionHeading
              icon={Sparkles}
              title="Advised Amenities"
              subtitle="Based on the top 5 performing properties in your area, these amenities are recommended."
            />

            {/* Essential Amenities */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Essential Amenities</h3>
                <Badge className="bg-success text-success-foreground">Must Have</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Wifi, label: "WiFi", note: "5/5 top properties" },
                  { icon: Flame, label: "Kitchen", note: "5/5 top properties" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-lg border border-border border-l-4 border-l-success bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{item.note}</span>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommended Amenities */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Recommended Amenities</h3>
                <Badge className="bg-primary/10 text-primary">Competitive Edge</Badge>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {[
                  { label: "Garden", score: "3/5" },
                  { label: "Workspace", score: "2/5" },
                  { label: "Free Parking", score: "1/5" },
                  { label: "Smart TV", score: "1/5" },
                  { label: "Coffee Machine", score: "1/5" },
                  { label: "High-Speed Internet", score: "1/5" },
                  { label: "Printer", score: "1/5" },
                  { label: "Meeting Space", score: "1/5" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-[11px] text-muted-foreground">{item.score}</p>
                    </div>
                    <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* Unique Differentiators */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-warning" />
                  Unique Differentiators
                </CardTitle>
                <CardDescription>
                  Properties with these amenities command rate premiums of 15-30%
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Hot Tub",
                    "EV Charger",
                    "Pet Friendly",
                    "Pool",
                    "Smart Lock",
                    "High-Speed Internet",
                  ].map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full bg-warning/10 px-4 py-2 text-sm font-semibold text-warning ring-1 ring-warning/20"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 4: Revenue (Short-Term vs Long-Term Breakdown)
              ══════════════════════════════════════════════════════════ */}
          <section id="revenue" ref={setSectionRef("revenue")} className="mb-12">
            <SectionHeading
              icon={DollarSign}
              title="Revenue Breakdown"
              subtitle="Detailed cost analysis: Short-Term vs Long-Term letting"
            />


            <div className="grid gap-6 lg:grid-cols-2">
              {/* Short-Term Rental Estimate */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-success" />
                    Short-Term Rental Estimate
                  </CardTitle>
                  <CardDescription>Annual projection based on comparable Airbnb properties</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                      <span className="text-sm font-medium">Gross Revenue</span>
                      <div className="text-right">
                        <span className="text-sm font-bold text-foreground">{gbp(grossAnnual)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({gbp(Math.round(grossAnnual / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">Platform Fees (15%)</span>
                      <div className="text-right">
                        <span className="text-sm font-medium text-destructive">-{gbp(platformFees)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(Math.round(platformFees / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">Management Fees (15%)</span>
                      <div className="text-right">
                        <span className="text-sm font-medium text-destructive">-{gbp(managementFees)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(Math.round(managementFees / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">Cleaning &amp; Laundry (18%)</span>
                      <div className="text-right">
                        <span className="text-sm font-medium text-destructive">-{gbp(cleaningLaundry)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(Math.round(cleaningLaundry / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-destructive/5 px-4 py-3">
                      <span className="text-sm font-medium">Total Operating Costs (48%)</span>
                      <div className="text-right">
                        <span className="text-sm font-bold text-destructive">-{gbp(totalOperatingCosts)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(Math.round(totalOperatingCosts / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-success/10 px-4 py-3">
                      <span className="text-sm font-bold text-foreground">Net Annual Revenue</span>
                      <div className="text-right">
                        <span className="text-lg font-bold text-success">{gbp(stlNetAnnual)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({gbp(Math.round(stlNetAnnual / 12))}/mo)</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Long-Term Let Comparison */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingDown className="h-4 w-4 text-muted-foreground" />
                    Long-Term Let Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                      <span className="text-sm font-medium">Gross Rental Income</span>
                      <div className="text-right">
                        <span className="text-sm font-bold text-foreground">{gbp(ltlGrossAnnual)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({gbp(Math.round(ltlGrossAnnual / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">Letting Agent Fees (10%)</span>
                      <div className="text-right">
                        <span className="text-sm font-medium text-destructive">-{gbp(ltlAgentFees)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(Math.round(ltlAgentFees / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                      <span className="text-sm font-bold text-foreground">Net Annual Revenue</span>
                      <div className="text-right">
                        <span className="text-lg font-bold text-foreground">{gbp(ltlNetAnnual)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({gbp(Math.round(ltlNetAnnual / 12))}/mo)</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Difference Card */}
            <Card className={`mt-6 border-l-4 ${revDifference >= 0 ? "border-l-success" : "border-l-destructive"}`}>
              <CardContent className="flex flex-col items-center gap-2 py-6 text-center sm:flex-row sm:justify-center sm:gap-8 sm:text-left">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Short-Term vs Long-Term Difference
                  </p>
                  <p className={`text-3xl font-bold ${revDifference >= 0 ? "text-success" : "text-destructive"}`}>
                    {revDifference >= 0 ? "+" : ""}{gbp(revDifference)}
                    <span className="text-base font-normal text-muted-foreground">/year ({revDifference >= 0 ? "+" : ""}{gbp(revDifferenceMonthly)}/mo)</span>
                  </p>
                </div>
                <div className="hidden h-12 w-px bg-border sm:block" />
                <div>
                  <p className={`text-xl font-bold ${revDifference >= 0 ? "text-success" : "text-destructive"}`}>
                    {revDifference >= 0 ? "+" : ""}{gbp(revDifferenceMonthly)}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ({revDifferencePct >= 0 ? "+" : ""}{revDifferencePct}% vs long-term let)
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 5: 12-Month Forecast
              ══════════════════════════════════════════════════════════ */}
          <section id="forecast" ref={setSectionRef("forecast")} className="mb-12">
            <SectionHeading
              icon={LineChart}
              title="12-Month Forecast"
              subtitle="Monthly revenue projections with seasonal adjustments"
            />

            {/* Stats row */}
            <div className="mb-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Peak Months</p>
                  <p className="mt-1 text-2xl font-bold text-success">{peakMonthCount}</p>
                  <p className="text-[10px] text-muted-foreground">STL beats LTL</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Below Long-Let</p>
                  <p className="mt-1 text-2xl font-bold text-destructive">{belowLtlCount}</p>
                  <p className="text-[10px] text-muted-foreground">months</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Best Month</p>
                  <p className="mt-1 text-lg font-bold text-success">{MONTH_NAMES[bestMonthIdx]}</p>
                  <p className="text-xs font-semibold text-success">{gbp(stlMonthlyNet[bestMonthIdx])}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Worst Month</p>
                  <p className="mt-1 text-lg font-bold text-destructive">{MONTH_NAMES[worstMonthIdx]}</p>
                  <p className="text-xs font-semibold text-destructive">{gbp(stlMonthlyNet[worstMonthIdx])}</p>
                </CardContent>
              </Card>
            </div>

            {/* Chart */}
            <Card className="mb-6">
              <CardContent className="pt-4">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={chartData}>
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 12, fill: "#6e9164" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#6e9164" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                        width={50}
                      />
                      <Tooltip
                        formatter={(value) => [gbp(Number(value ?? 0)), ""]}
                        contentStyle={{
                          backgroundColor: "#e6ebd7",
                          border: "1px solid #aab99b",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                      />
                      <ReferenceLine y={0} stroke="#aab99b" />
                      <Line
                        type="monotone"
                        dataKey="Short Let"
                        stroke="#5d8156"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: "#5d8156", stroke: "#5d8156" }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="linear"
                        dataKey="Long Let"
                        stroke="#c3cdaf"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={{ r: 3, fill: "#c3cdaf", stroke: "#c3cdaf" }}
                      />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Monthly breakdown table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Monthly Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Month</th>
                        <th className="pb-2 font-medium">Short-Term Net</th>
                        <th className="pb-2 font-medium">Long-Term Net</th>
                        <th className="pb-2 font-medium">Difference</th>
                        <th className="pb-2 font-medium">Occupancy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MONTHS.map((month, i) => {
                        const stlNet = stlMonthlyNet[i];
                        const diff = stlNet - ltlMonthlyNet;
                        const badge = getMonthBadge(i);
                        return (
                          <tr
                            key={month}
                            className={`border-b border-border/50 last:border-0 ${badge?.label === "Peak" ? "bg-success/5" : badge?.label === "Below Average" ? "bg-destructive/5" : ""}`}
                          >
                            <td className="py-2 pr-4 font-medium">
                              <span className="flex items-center gap-2">
                                {MONTH_NAMES[i]}
                                {badge && (
                                  <Badge className={badge.className}>{badge.label}</Badge>
                                )}
                              </span>
                            </td>
                            <td className="py-2 pr-4 font-semibold">{gbp(stlNet)}</td>
                            <td className="py-2 pr-4">{gbp(ltlMonthlyNet)}</td>
                            <td className={`py-2 pr-4 font-semibold ${diff >= 0 ? "text-success" : "text-destructive"}`}>
                              {diff >= 0 ? "+" : ""}{gbp(diff)}
                            </td>
                            <td className="py-2">{Math.round(monthlyOccupancy[i] * 100)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 7: Local Area Intelligence
              ══════════════════════════════════════════════════════════ */}
          <section id="local-area" ref={setSectionRef("local-area")} className="mb-12">
            <SectionHeading
              icon={MapPin}
              title="Local Area Intelligence"
              subtitle="Demand drivers and attractions near that will generate bookings"
            />

            {/* Narrative */}
            <Card className="mb-6">
              <CardContent className="py-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground mb-1">
                      Why People Would Book Your Property
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {narrative}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Demand Drivers 2x2 Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              {demandCategories.map((cat) => {
                const nearest = cat.items.length > 0 ? cat.items[0] : null;
                const impact = cat.items.length >= 3 ? "high impact" : cat.items.length >= 1 ? "medium impact" : "low impact";
                const impactColor = cat.items.length >= 3 ? "bg-success/10 text-success" : cat.items.length >= 1 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground";

                return (
                  <Card key={cat.key}>
                    <CardContent className="pt-4">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${cat.iconBg}`}>
                          <cat.icon className={`h-5 w-5 ${cat.iconColor}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-foreground">
                              {cat.label}
                            </p>
                            <Badge className={impactColor}>{impact}</Badge>
                          </div>
                          {nearest && (
                            <>
                              <p className="mt-1 text-sm text-foreground">{nearest.name}</p>
                              <p className="text-xs text-muted-foreground">{nearest.distance} km away</p>
                            </>
                          )}
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {cat.items.length > 0
                              ? `${cat.items.length} ${cat.label.toLowerCase()} found nearby, providing consistent booking demand.`
                              : `No ${cat.label.toLowerCase()} found nearby.`
                            }
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 8: Long-Term Direct Booking Potential
              ══════════════════════════════════════════════════════════ */}
          <section id="bookings" ref={setSectionRef("bookings")} className="mb-12">
            <SectionHeading
              icon={Target}
              title="Long-Term Direct Booking Potential"
              subtitle="Assessment of your property's ability to attract direct bookings from hospitals, universities, contractors and events."
            />

            {/* Score + Contributing Factors side by side */}
            <div className="grid gap-6 lg:grid-cols-2 mb-6">
              {/* Left: Circular score */}
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <div className="relative">
                    <CircularScore
                      score={bookingScore}
                      max={100}
                      size={160}
                      strokeWidth={12}
                      color={bookingScoreColor}
                    />
                  </div>
                  <p className={`mt-3 text-lg font-bold ${bookingScore >= 60 ? "text-success" : bookingScore >= 40 ? "text-warning" : "text-destructive"}`}>
                    {bookingRating}
                  </p>
                  <p className="text-xs text-muted-foreground">Direct Booking Potential</p>
                </CardContent>
              </Card>

              {/* Right: Contributing Factors */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Contributing Factors</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {bookingFactors.map((factor) => (
                      <div key={factor.label} className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${factor.iconBg}`}>
                          <factor.icon className={`h-4 w-4 ${factor.iconColor}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{factor.label}</span>
                            <Badge className={
                              factor.scoreLbl === "High" ? "bg-success text-success-foreground" :
                              factor.scoreLbl === "Medium" ? "bg-warning text-warning-foreground" :
                              "bg-muted text-muted-foreground"
                            }>{factor.scoreLbl}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{factor.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Direct Booking Tip */}
            <Card className="border-l-4 border-l-primary">
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <span className="font-bold text-foreground">Direct Booking Tip: </span>
                  Building direct booking relationships takes time. Stayful focuses on converting platform guests into repeat direct customers, reducing platform fees from 15% to near-zero on direct bookings. By year 3, properties typically achieve 30-50% direct bookings, significantly boosting profitability.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 9: Risk Profile Assessment
              ══════════════════════════════════════════════════════════ */}
          <section id="risk" ref={setSectionRef("risk")} className="mb-12">
            <SectionHeading
              icon={AlertTriangle}
              title="Risk Profile Assessment"
              subtitle="Investment risk score based on revenue consistency and long-term comparison (0 = Low Risk, 100 = High Risk)"
            />

            {/* Score + Risk label side by side */}
            <div className="grid gap-6 lg:grid-cols-2 mb-6">
              {/* Left: Circular gauge */}
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <div className="relative">
                    <CircularScore
                      score={overallRiskScore}
                      max={100}
                      size={160}
                      strokeWidth={12}
                      color={v.riskLevel === "low" ? "#64a064" : v.riskLevel === "moderate" ? "#c8b464" : "#b45050"}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Right: Risk label card */}
              <Card>
                <CardContent className="flex flex-col justify-center py-8">
                  <div className="flex items-center gap-3 mb-3">
                    {v.riskLevel === "low" ? (
                      <CheckCircle2 className="h-6 w-6 text-success" />
                    ) : v.riskLevel === "moderate" ? (
                      <AlertTriangle className="h-6 w-6 text-warning" />
                    ) : (
                      <XCircle className="h-6 w-6 text-destructive" />
                    )}
                    <h3 className="text-xl font-bold text-foreground">{riskLabel}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {v.riskLevel === "low"
                      ? "This property shows strong fundamentals with consistent revenue potential and manageable risk factors."
                      : v.riskLevel === "moderate"
                        ? "This property shows moderate risk factors. Revenue is achievable but may be subject to seasonal variation."
                        : "This property carries higher risk factors that should be carefully considered before proceeding."}
                  </p>

                  {revDifference < 0 && (
                    <div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3">
                      <p className="text-sm text-destructive">
                        Short-term letting produces {gbp(Math.abs(revDifference))} less annually than long-term letting after operating costs.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Risk Factor Breakdown */}
            <div className="mb-4 flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Risk Factor Breakdown</h3>
              <Info className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              {riskFactors.map((rf) => (
                <Card key={rf.name}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-foreground">{rf.name}</span>
                      <span className="text-sm font-bold text-foreground">{rf.score}/100</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted mb-2">
                      <div
                        className={`h-full rounded-full transition-all ${rf.score <= 30 ? "bg-success" : rf.score <= 60 ? "bg-warning" : "bg-destructive"}`}
                        style={{ width: `${rf.score}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{rf.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Disclaimer */}
            <Card className="border-l-4 border-l-warning bg-warning/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Risk scores are estimates based on available market data and location analysis. Individual circumstances may vary. We recommend discussing your specific situation with a Stayful advisor.
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 10: Data Sources & Methodology
              ══════════════════════════════════════════════════════════ */}
          {/* ══════════════════════════════════════════════════════════
              FAQ Section (replaced Data Sources)
              ══════════════════════════════════════════════════════════ */}
          <section id="faq" ref={setSectionRef("faq")} className="mb-12">
            <SectionHeading
              icon={HelpCircle}
              title="Frequently Asked Questions"
              subtitle="Everything you need to know about short-term letting with Stayful"
            />

            <div className="space-y-3">
              {[
                {
                  emoji: "💷",
                  question: "Will I actually earn these numbers?",
                  short: "Based on real active Airbnb listings in your postcode, median-aggregated — not national averages.",
                  answer: (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      These projections are built from active Airbnb listings within the search radius of the property. The methodology uses the median revenue across comparable listings — not the top performers — so the figure shown represents what a typical, well-managed property in this area earns. The user can refine the figure on the Comparables tab by excluding listings that don&apos;t match their property, and the estimate updates in real time.
                    </p>
                  ),
                },
                {
                  emoji: "⏱",
                  question: "What does this actually involve day to day?",
                  short: "With Stayful managing, your involvement is zero. Here is what that means in practice.",
                  answer: (
                    <div>
                      <div className="grid gap-2 sm:grid-cols-2 mb-4">
                        {["Guest enquiries and messaging", "Check-in and check-out coordination", "Dynamic pricing and calendar management", "Cleaning and laundry between stays", "Maintenance issues and repairs", "Review management and guest feedback", "Listing optimisation and photography", "Monthly income statements"].map((task) => (
                          <div key={task} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                              <span className="text-xs text-foreground">{task}</span>
                            </div>
                            <span className="text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded">Stayful</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Your role as the property owner is to be available for significant maintenance decisions and to receive your monthly income. You can review everything through your owner dashboard at any time.
                      </p>
                    </div>
                  ),
                },
                {
                  emoji: "💼",
                  question: "What does management cost and what do I get for it?",
                  short: "15% of revenue. Only charged on booked nights. No hidden fees.",
                  answer: (
                    <div>
                      <div className="mb-4 flex items-baseline gap-3">
                        <span className="text-3xl font-bold text-foreground">15%</span>
                        <span className="text-sm text-muted-foreground">of revenue · only charged on nights that are booked</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 mb-4">
                        {["Professional listing setup and photography", "Dynamic pricing updated daily", "24/7 guest communication", "Cleaning and linen coordination", "Maintenance network and coordination", "Multi-platform distribution (Airbnb, Booking.com, direct)", "Monthly owner statements", "Dedicated property manager"].map((item) => (
                          <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                            {item}
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3">
                        <p className="text-xs font-semibold text-foreground">No lock-in contracts.</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Stayful operates on a rolling monthly basis. You can pause or end management with 30 days notice.</p>
                      </div>
                    </div>
                  ),
                },
                {
                  emoji: "⚠",
                  question: "What are the realistic risks for this property?",
                  short: "Low-medium overall risk profile. STR outperforms long-let in every month of the year for this postcode.",
                  answer: (
                    <div>
                      <div className="grid gap-3 sm:grid-cols-2 mb-4">
                        {([
                          { name: "Seasonal variation", level: "Medium", color: "warning", text: "Income varies by month. Summer earns more. The quietest month in this postcode still outperforms long-let." },
                          { name: "Void periods", level: "Low", color: "success", text: "This postcode has strong year-round demand from hospitals, universities and local employers." },
                          { name: "Property damage", level: "Low", color: "success", text: "All bookings include guest damage protection. Stayful holds a security deposit on every booking." },
                          { name: "Regulation changes", level: "Low", color: "success", text: "No current Article 4 restrictions apply to this postcode. Stayful monitors regulatory changes continuously." },
                        ] as const).map((risk) => (
                          <div key={risk.name} className="rounded-lg border border-border bg-card p-3">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs font-semibold text-foreground">{risk.name}</p>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded bg-${risk.color}/10 text-${risk.color}`}>{risk.level}</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{risk.text}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">See the Risk section for a full breakdown of revenue consistency, seasonal variance and market demand scores.</p>
                    </div>
                  ),
                },
                {
                  emoji: "🔓",
                  question: "Can I get my property back if I need it?",
                  short: "6-month fixed term with 3 months notice. Block out any dates in your calendar anytime you want to use the property yourself.",
                  answer: (
                    <div>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        {([
                          { label: "Contract type", value: "6-month fixed term" },
                          { label: "Notice period", value: "3 months" },
                          { label: "Owner calendar access", value: "Anytime" },
                          { label: "Block-out days", value: "Unlimited" },
                        ]).map((item) => (
                          <div key={item.label} className="rounded-lg bg-muted/50 p-3 text-center">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                            <p className="mt-0.5 text-sm font-bold text-foreground">{item.value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        You have full access to the property&apos;s calendar at any time through your owner dashboard — block out any dates you want to stay yourself, host family, or take the property offline temporarily. The management agreement is a 6-month fixed term with 3 months notice after that, so your income and guest experience are stable while you retain full control of when you want to use the property. Existing confirmed bookings at the point of notice are honoured to protect guests, and Stayful handles all guest communication throughout.
                      </p>
                    </div>
                  ),
                },
                {
                  emoji: "📅",
                  question: "How long does it actually take to get up and running?",
                  short: "Kick-off call once the agreement is signed, then 7–21 days before your property is live.",
                  answer: (
                    <div>
                      <div className="mb-4 space-y-3 border-l-2 border-success/30 pl-4">
                        {([
                          { day: "Day 0", task: "Management agreement signed" },
                          { day: "Day 1", task: "Kick-off call with your dedicated property manager" },
                          { day: "Day 7–21", task: "Property goes live and starts taking bookings" },
                        ]).map((step) => (
                          <div key={step.day} className="flex gap-3">
                            <span className="text-xs font-bold text-success whitespace-nowrap w-16">{step.day}</span>
                            <span className="text-xs text-muted-foreground">{step.task}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        The 7–21 day window depends on the current condition of the property, access availability, cleaning team scheduling, and any snagging that needs addressing before launch. Stayful keeps you informed at every stage — you&apos;ll always know what&apos;s happening, what&apos;s next, and when your listing is expected to go live.
                      </p>
                    </div>
                  ),
                },
                {
                  emoji: "🏠",
                  question: "Does Stayful manage properties in my area?",
                  short: "Stayful operates across the UK. Your postcode is within our active coverage area.",
                  answer: (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Stayful manages properties across all major UK cities, towns and coastal areas. The fact that this analysis has been run for your postcode confirms it sits within our active service area. Book your profitability action plan to confirm availability and discuss your specific property.
                    </p>
                  ),
                },
              ].map((faq, i) => {
                const isOpen = openFaqIndex === i;
                return (
                  <div key={i} className={`rounded-lg border bg-card overflow-hidden transition-colors ${isOpen ? "border-primary" : "border-border"}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                      onClick={() => setOpenFaqIndex(isOpen ? null : i)}
                      aria-expanded={isOpen}
                    >
                      <span className="text-lg" aria-hidden="true">{faq.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{faq.question}</p>
                        {!isOpen && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{faq.short}</p>
                        )}
                      </div>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-0 border-t border-border/50">
                        <div className="pt-3">{faq.answer}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 11: Growth (Our Plan for Profitability)
              ══════════════════════════════════════════════════════════ */}
          <section id="growth" ref={setSectionRef("growth")} className="mb-12">
            {/* Heading with Stayful logo */}
            <div className="mb-6 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold text-success">Our Plan for Profitability</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  How we build direct bookings to increase your profits over time
                </p>
              </div>
              <Image
                alt="Stayful"
                width={80}
                height={28}
                className="h-6 w-auto opacity-80"
                src="/images/stayful-logo.png"
              />
            </div>

            {/* The Direct Booking Funnel */}
            <Card className="mb-6 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base">The Direct Booking Funnel</CardTitle>
                <CardDescription>How we convert platform guests into profitable direct bookings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-0 py-2">
                  {/* Row 1: Platform Sources */}
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-[#FF5A5F] px-5 py-2 text-sm font-bold text-white shadow-md">
                      Airbnb
                    </div>
                    <span className="text-lg font-bold text-muted-foreground">+</span>
                    <div className="rounded-full bg-[#003580] px-5 py-2 text-sm font-bold text-white shadow-md">
                      Booking.com
                    </div>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1">Platform Bookings</div>

                  {/* Arrow down */}
                  <div className="flex flex-col items-center my-2">
                    <div className="h-6 w-0.5 bg-border" />
                    <ChevronDown className="h-5 w-5 text-primary -mt-1" />
                  </div>

                  {/* Row 2: Your Listing */}
                  <div className="w-full max-w-xs rounded-xl border-2 border-primary bg-primary/5 px-6 py-4 text-center shadow-sm">
                    <p className="text-sm font-bold text-primary">Your Listing</p>
                    <div className="mt-1 flex items-center justify-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className="h-3.5 w-3.5 text-warning fill-warning" />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">5-star guest reviews</p>
                  </div>

                  {/* Arrow down */}
                  <div className="flex flex-col items-center my-2">
                    <div className="h-6 w-0.5 bg-border" />
                    <ChevronDown className="h-5 w-5 text-primary -mt-1" />
                  </div>

                  {/* Row 3: Data Collection via monday.com */}
                  <div className="rounded-xl border border-warning/30 bg-warning/5 px-6 py-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Data Collection via</p>
                    <p className="text-base font-bold text-warning">monday.com</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Guest data, preferences, booking patterns</p>
                  </div>

                  {/* Arrow splits */}
                  <div className="flex flex-col items-center my-2">
                    <div className="h-6 w-0.5 bg-border" />
                    <ChevronDown className="h-5 w-5 text-primary -mt-1" />
                  </div>

                  {/* Row 4: Stayful → Direct Bookings + Repeat Guests */}
                  <div className="flex items-center gap-4">
                    <div className="rounded-xl border-2 border-success bg-success/5 px-5 py-3 text-center shadow-sm">
                      <Image
                        alt="Stayful"
                        width={70}
                        height={24}
                        className="mx-auto h-5 w-auto mb-1"
                        src="/images/stayful-logo.png"
                      />
                      <p className="text-xs font-semibold text-success">Direct Bookings</p>
                    </div>
                    <span className="text-lg font-bold text-muted-foreground">+</span>
                    <div className="rounded-xl border-2 border-success bg-success/5 px-5 py-3 text-center shadow-sm">
                      <RefreshCw className="mx-auto h-5 w-5 text-success mb-1" />
                      <p className="text-xs font-semibold text-success">Repeat Guests</p>
                    </div>
                  </div>
                </div>

                {/* Callout */}
                <div className="mt-6 rounded-lg bg-success/10 border border-success/20 px-4 py-3 text-center">
                  <p className="text-sm font-bold text-success">
                    &ldquo;30% of our bookings are now direct customers&rdquo;
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Average across Stayful managed properties by Year 2
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 4 numbered steps */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  num: 1,
                  title: "Platform Bookings",
                  desc: "Launch on Airbnb and Booking.com to build early demand, bookings and reviews",
                },
                {
                  num: 2,
                  title: "Data Collection",
                  desc: "Learn which guest types, lengths of stay and price points perform best",
                },
                {
                  num: 3,
                  title: "Direct Bookings",
                  desc: "Turn repeat guests into lower-cost direct customers",
                },
                {
                  num: 4,
                  title: "The Result",
                  desc: "Higher share of profitable, repeat and lower-friction bookings",
                },
              ].map((step) => (
                <Card key={step.num}>
                  <CardContent className="flex flex-col items-center px-4 py-6 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {step.num}
                    </div>
                    <p className="mt-3 text-sm font-bold text-foreground">
                      {step.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {step.desc}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Benefits: 4 cards with green dots */}
            <div className="mb-6 grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[
                "Cheaper cleaning",
                "Longer stays",
                "Cheaper fees",
                "Less maintenance",
              ].map((benefit) => (
                <div key={benefit} className="flex items-center gap-2 rounded-lg bg-card px-3 py-2.5 ring-1 ring-border">
                  <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
                  <span className="text-sm font-medium text-foreground">{benefit}</span>
                </div>
              ))}
            </div>

            {/* Income Growth Over Time - 36-month chart */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Income Growth Over Time</CardTitle>
                <CardDescription>Projected revenue, expenses and profit over 36 months</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={growthData}>
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "#6e9164" }}
                        axisLine={false}
                        tickLine={false}
                        interval={5}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#6e9164" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                        width={50}
                      />
                      <Tooltip
                        formatter={(value) => [gbp(Number(value ?? 0)), ""]}
                        contentStyle={{
                          backgroundColor: "#e6ebd7",
                          border: "1px solid #aab99b",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                      <Area
                        type="monotone"
                        dataKey="Revenue"
                        stroke="#5d8156"
                        fill="#5d8156"
                        fillOpacity={0.2}
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="Expenses"
                        stroke="#b45050"
                        fill="#b45050"
                        fillOpacity={0.1}
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="Profit"
                        stroke="#64a064"
                        fill="#64a064"
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Milestone pills */}
                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                  {["M1 Launch", "M6", "M12", "M18", "M24", "M30", "M36"].map((milestone) => (
                    <span key={milestone} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {milestone}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 4 stat cards */}
            <div className="mb-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Direct Bookings</p>
                  <p className="mt-1 text-2xl font-bold text-success">50%</p>
                  <p className="text-[10px] text-muted-foreground">by Month 36</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Repeat Customers</p>
                  <p className="mt-1 text-2xl font-bold text-primary">126</p>
                  <p className="text-[10px] text-muted-foreground">built over 3 years</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Platform Fee Savings</p>
                  <p className="mt-1 text-2xl font-bold text-success">15%</p>
                  <p className="text-[10px] text-muted-foreground">eliminated on direct</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Extra Monthly Profit</p>
                  <p className="mt-1 text-2xl font-bold text-success">+{gbp(y3ExtraMonthlyProfit)}</p>
                  <p className="text-[10px] text-muted-foreground">by Year 3</p>
                </CardContent>
              </Card>
            </div>

            {/* CTA Card */}
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
                <h2 className="text-2xl font-bold">Ready to maximise your rental income?</h2>
                <p className="max-w-lg text-sm text-primary-foreground/80">
                  Let Stayful handle the hard work while you earn more from your
                  property. Book your profitability action plan to get started.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary-foreground/80">
                    <Phone className="h-4 w-4" />
                    <span>07471 321 997</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => {
                      trackCtaClick("book_call");
                      window.open(
                        "https://calendly.com/zac-stayful/call",
                        "_blank"
                      );
                    }}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    Book a Free Consultation
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          </div>

          {/* Footer */}
          <footer className="border-t border-border bg-muted/30 py-8">
            <div className="mx-auto max-w-5xl px-6 text-center text-sm text-muted-foreground">
              <Image
                alt="Stayful"
                loading="lazy"
                width={100}
                height={35}
                className="mx-auto mb-4 h-8 w-auto opacity-60"
                src="/images/stayful-logo.png"
              />
              <p>
                &copy; {new Date().getFullYear()} Stayful. All rights reserved.
              </p>
            </div>
          </footer>
        </div>
      </main>
      </>
    );
  }

  // ─── Form State (Default) ────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-primary py-12 sm:py-16 lg:py-20">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center text-center">
            <Image
              alt="Stayful"
              width={180}
              height={60}
              className="mb-6 h-12 w-auto sm:h-14"
              src="/images/stayful-logo.png"
              priority
            />
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl lg:text-5xl">
              Short-Term Rental Property Analyser
            </h1>
            <p className="mb-8 max-w-2xl text-lg text-primary-foreground/80">
              Get a comprehensive revenue analysis for your property. Compare
              short-term rental potential against traditional letting with real
              market data.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works — compact 3-step explainer */}
      <section className="relative z-10 -mt-4 pb-4">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-foreground">How this works</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Enter your property.</span> Address, bedrooms, guest capacity, parking and outdoor space.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">We pull live Airbnb data.</span> Up to 12 comparable properties near you with their actual 12-month earnings, via Airbtics.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Refine with your judgement.</span> Exclude any comp that doesn&apos;t match your property — the estimate updates instantly so you see your realistic figure alongside the market&apos;s top potential.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Form Section */}
      <section className="relative z-10 -mt-8 pb-12">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <Card className="mx-auto max-w-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" aria-hidden="true" />
                Analyse Your Property
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Row 1: Address entry — auto (Google Places) or manual fallback */}
                {entryMode === "auto" && !selectedAutoAddress && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Search className="h-4 w-4" aria-hidden="true" />
                      Find your property
                    </Label>
                    <AddressAutocomplete
                      onSelect={(r) => {
                        setAddress(r.address);
                        setPostcode(r.postcode);
                        setSelectedAutoAddress(r);
                      }}
                      onUseManual={(typedQuery) => {
                        const parsed = splitAddressAndPostcode(typedQuery);
                        setAddress(parsed.address || typedQuery);
                        setPostcode(parsed.postcode);
                        setEntryMode("manual");
                      }}
                    />
                  </div>
                )}

                {entryMode === "auto" && selectedAutoAddress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                          <p className="text-sm font-medium text-foreground truncate">
                            {selectedAutoAddress.address}
                          </p>
                        </div>
                        {selectedAutoAddress.postcode && (
                          <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
                            {selectedAutoAddress.postcode}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAutoAddress(null);
                          setAddress("");
                          setPostcode("");
                        }}
                      >
                        Change
                      </Button>
                    </div>
                    {/* If postcode wasn't detected, show an inline input so the user can supply it */}
                    {!selectedAutoAddress.postcode && (
                      <div className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2.5 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">
                          We couldn&apos;t detect the postcode from the selected address.
                        </p>
                        <div className="flex items-center gap-2">
                          <Label htmlFor="postcode-fallback" className="text-xs text-muted-foreground shrink-0">
                            Postcode:
                          </Label>
                          <Input
                            id="postcode-fallback"
                            placeholder="e.g. M4 7FE"
                            required
                            value={postcode}
                            onChange={(e) => setPostcode(e.target.value)}
                            className="max-w-[140px]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {entryMode === "manual" && (
                  <div className="space-y-2">
                    <Label htmlFor="address" className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      Full Property Address
                    </Label>
                    <Input
                      id="address"
                      placeholder="e.g. 123 High Street"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => { setEntryMode("auto"); setSelectedAutoAddress(null); }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Use address search instead
                    </button>
                  </div>
                )}

                {/* Row 2: Postcode (manual or auto-with-missing-postcode) | Property Type */}
                <div className="grid grid-cols-2 gap-4">
                  {entryMode === "manual" ? (
                    <div className="space-y-2">
                      <Label htmlFor="postcode" className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                        Postcode
                      </Label>
                      <Input
                        id="postcode"
                        placeholder="e.g. M4 7FE"
                        required
                        value={postcode}
                        onChange={(e) => setPostcode(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div />
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="propertyType" className="flex items-center gap-2">
                      <Home className="h-4 w-4" aria-hidden="true" />
                      Property Type
                    </Label>
                    <select
                      id="propertyType"
                      value={propertyType}
                      onChange={(e) => setPropertyType(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="Flat">Flat</option>
                      <option value="Terraced">Terraced</option>
                      <option value="Semi-detached">Semi-detached</option>
                      <option value="Detached">Detached</option>
                    </select>
                  </div>
                </div>

                {/* Row 3: Bedrooms | Bathrooms | Max Guests (auto) */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bedrooms" className="flex items-center gap-2">
                      <BedDouble className="h-4 w-4" aria-hidden="true" />
                      Bedrooms
                    </Label>
                    <Input
                      type="number"
                      id="bedrooms"
                      min={0}
                      max={5}
                      required
                      value={bedrooms}
                      onChange={(e) => setBedrooms(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="guests" className="flex items-center gap-2">
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Max Guests
                    </Label>
                    <Input
                      type="number"
                      id="guests"
                      min={1}
                      max={16}
                      required
                      value={guests}
                      onChange={(e) => setGuests(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">Auto-calculated from bedrooms</p>
                  </div>
                </div>

                {/* Row 3b: Bathrooms */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bathrooms" className="flex items-center gap-2">
                      <Droplets className="h-4 w-4" aria-hidden="true" />
                      Bathrooms
                    </Label>
                    <Input
                      type="number"
                      id="bathrooms"
                      min={0}
                      max={5}
                      required
                      value={bathrooms}
                      onChange={(e) => setBathrooms(e.target.value)}
                    />
                  </div>
                </div>

                {/* Row 4: Parking | Outdoor Space */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="parking" className="flex items-center gap-2">
                      <Car className="h-4 w-4" aria-hidden="true" />
                      Parking
                    </Label>
                    <select
                      id="parking"
                      value={parking}
                      onChange={(e) => setParking(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="no_parking">No parking available</option>
                      <option value="on_street">Free on-street only</option>
                      <option value="allocated">Allocated space (flat/apartment bay)</option>
                      <option value="garage">Single garage</option>
                      <option value="driveway_1">Driveway (1 car)</option>
                      <option value="driveway_2">Driveway (2+ cars)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="outdoorSpace" className="flex items-center gap-2">
                      <Palmtree className="h-4 w-4" aria-hidden="true" />
                      Outdoor Space
                    </Label>
                    <select
                      id="outdoorSpace"
                      value={outdoorSpace}
                      onChange={(e) => setOutdoorSpace(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="none">None</option>
                      <option value="balcony">Balcony or terrace</option>
                      <option value="garden">Private garden</option>
                      <option value="roof_terrace">Roof terrace</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                  Get Free Analysis
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          <Image
            alt="Stayful"
            loading="lazy"
            width={100}
            height={35}
            className="mx-auto mb-4 h-8 w-auto opacity-60"
            src="/images/stayful-logo.png"
          />
          <p>
            &copy; {new Date().getFullYear()} Stayful. All rights reserved.
          </p>
          <p className="mt-2">
            Data sourced from Airbtics, PropertyData, Google Places, Ticketmaster,
            and public market research.
          </p>
        </div>
      </footer>
    </main>
  );
}
