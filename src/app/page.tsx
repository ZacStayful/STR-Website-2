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

// ─── Tab definitions ─────────────────────────────────────────────

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

// ─── Main Component ─────────────────────────────────────────────

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [bedrooms, setBedrooms] = useState("2");
  const [guests, setGuests] = useState("6"); // Auto-calculated: (bedrooms × 2) + 2
  const [bathrooms, setBathrooms] = useState("1");
  const [propertyType, setPropertyType] = useState("Flat");
  const [parking, setParking] = useState("no_parking");
  const [outdoorSpace, setOutdoorSpace] = useState("none");
  const [monthlyMortgage, setMonthlyMortgage] = useState("");
  const [monthlyBills, setMonthlyBills] = useState("");

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

  // Profit calculator state
  const [calcMortgage, setCalcMortgage] = useState(0);
  const [calcBills, setCalcBills] = useState(400);

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

    // Revenue cost breakdown calculations
    const grossAnnual = f.shortLetGrossAnnual;
    const platformFees = Math.round(grossAnnual * 0.15);
    const managementFees = Math.round(grossAnnual * 0.15);
    const cleaningLaundry = Math.round(grossAnnual * 0.18);
    const totalOperatingCosts = platformFees + managementFees + cleaningLaundry;
    const stlNetAnnual = grossAnnual - totalOperatingCosts;

    const ltlGrossAnnual = f.longLetGrossAnnual;
    const ltlAgentFees = Math.round(ltlGrossAnnual * 0.10);
    const ltlNetAnnual = ltlGrossAnnual - ltlAgentFees;

    const revDifference = stlNetAnnual - ltlNetAnnual;
    const revDifferenceMonthly = Math.round(revDifference / 12);
    const revDifferencePct = ltlNetAnnual > 0 ? Math.round((revDifference / ltlNetAnnual) * 100) : 0;

    // Profit calculator values
    const stlTrueAnnualProfit = stlNetAnnual - (calcMortgage * 12) - (calcBills * 12);
    const ltlTrueAnnualProfit = ltlNetAnnual - (calcMortgage * 12); // tenants pay bills
    const profitDifference = stlTrueAnnualProfit - ltlTrueAnnualProfit;

    // Monthly occupancy with seasonal weighting
    const avgOcc = r.shortLet.occupancyRate;
    const totalWeight = SEASONAL_WEIGHTS.reduce((s, w) => s + w, 0);
    const monthlyOccupancy = SEASONAL_WEIGHTS.map((w) =>
      Math.min(1, (avgOcc * 12 * w) / totalWeight)
    );

    // Net monthly for STL (after 48% costs)
    const stlMonthlyNet = r.shortLet.monthlyRevenue.map((rev) => Math.round(rev * 0.52));
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
    const hasComparables = r.shortLet.comparables.length > 0;
    const comps = r.shortLet.comparables;

    // Sort comparables by annual revenue descending (highest first)
    const compsSortedByRevenue = [...comps].sort((a, b) => b.annualRevenue - a.annualRevenue);
    // Top 5 performers for projection averages
    const top5Comps = compsSortedByRevenue.slice(0, 5);
    const top5Set = new Set(top5Comps);
    const hasTop5 = top5Comps.length >= 5;

    // Calculate averages from top 5 performers (or all if < 5)
    const avgSource = hasTop5 ? top5Comps : comps;
    const compAvgNightlyRate = hasComparables ? Math.round(avgSource.reduce((s, c) => s + c.averageDailyRate, 0) / avgSource.length) : r.shortLet.averageDailyRate;
    const compAvgOccupancy = hasComparables ? avgSource.reduce((s, c) => s + c.occupancyRate, 0) / avgSource.length : r.shortLet.occupancyRate;
    const compAvgRevenue = hasComparables ? Math.round(avgSource.reduce((s, c) => s + c.annualRevenue, 0) / avgSource.length) : r.shortLet.annualRevenue;
    const compsWithRating = comps.filter((c) => c.rating > 0);
    const avgRating = compsWithRating.length > 0 ? Math.floor(compsWithRating.reduce((s, c) => s + c.rating, 0) / compsWithRating.length * 10) / 10 : 0;
    const compsWithReviews = comps.filter((c) => c.reviewCount > 0);
    const avgReviews = compsWithReviews.length > 0 ? Math.round(compsWithReviews.reduce((s, c) => s + c.reviewCount, 0) / compsWithReviews.length) : 0;
    const compsWithAge = comps.filter((c) => c.listingAge > 0);
    const avgListingAge = compsWithAge.length > 0 ? Math.round(compsWithAge.reduce((s, c) => s + c.listingAge, 0) / compsWithAge.length * 10) / 10 : 0;

    // 36-month growth chart data
    const growthData = Array.from({ length: 36 }, (_, i) => {
      const month = i + 1;
      const directPct = Math.min(0.5, (month / 36) * 0.5);
      const monthlyGross = grossAnnual / 12;
      const platformFeeRate = 0.15 * (1 - directPct);
      const revenue = monthlyGross * (1 - platformFeeRate - 0.15 - 0.18);
      const expenses = (calcMortgage || 0) + (calcBills || 0);
      return {
        month: `M${month}`,
        Revenue: Math.round(revenue),
        Expenses: Math.round(expenses),
        Profit: Math.round(revenue - expenses),
      };
    });

    // Data sources list
    const dataSources = [
      {
        title: "UK STR Market Report 2025",
        source: "Airbtics",
        desc: "Comprehensive short-term rental market analytics for the UK market.",
        bullets: ["Market occupancy trends", "Revenue benchmarking data"],
        updated: "March 2025",
        url: "#",
      },
      {
        title: `${r.property.postcode.split(" ")[0]} Airbnb Market Data 2026`,
        source: "Airbtics",
        desc: "Local area Airbnb performance data including comparable properties.",
        bullets: [`${r.dataQuality?.comparablesFound || r.shortLet.activeListings || "Market"} comparable properties analysed`, "Nightly rate and occupancy data"],
        updated: "March 2026",
        url: "#",
      },
      {
        title: "OpenRent Rent Calculator",
        source: "OpenRent",
        desc: "UK rental market platform providing long-term let comparable data.",
        bullets: ["Market rent benchmarking", "Comparable rental analysis"],
        updated: "March 2026",
        url: "#",
      },
      {
        title: "Birmingham Airbnb Market Data",
        source: "Airbtics",
        desc: "Regional market intelligence for revenue estimation.",
        bullets: ["Regional occupancy rates", "Seasonal demand patterns"],
        updated: "February 2026",
        url: "#",
      },
      {
        title: "AirDNA UK Market Analytics",
        source: "AirDNA",
        desc: "Advanced short-term rental analytics and market intelligence.",
        bullets: ["Supply and demand metrics", "Revenue optimization data"],
        updated: "March 2026",
        url: "#",
      },
      {
        title: "Home.co.uk Market Rents",
        source: "Home.co.uk",
        desc: "UK property market rent data for accurate long-term comparisons.",
        bullets: ["Local rent trends", "Area-specific valuations"],
        updated: "March 2026",
        url: "#",
      },
      {
        title: "Holiday Let Management Costs",
        source: "Stayful",
        desc: "Internal cost data from Stayful's managed property portfolio.",
        bullets: ["Cleaning and laundry costs", "Management fee structures"],
        updated: "March 2026",
        url: "#",
      },
      {
        title: "UK Accommodation Occupancy Statistics",
        source: "VisitBritain",
        desc: "Official UK tourism statistics for accommodation occupancy.",
        bullets: ["National occupancy benchmarks", "Regional tourism data"],
        updated: "January 2026",
        url: "#",
      },
    ];

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
                  onClick={() => { trackCtaClick("view_presentation"); setShowPresentation(true); }}
                >
                  <Monitor className="mr-1.5 h-3.5 w-3.5" />
                  View Presentation
                </Button>
              </div>
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                <div>
                  <h1 className="text-2xl font-bold">{r.property.address}</h1>
                  <p className="mt-1 text-sm text-primary-foreground/80">
                    {r.property.bedrooms} bed, bath &middot; Sleeps {r.property.guests}
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:items-end">
                  {grossAnnual > 0 ? (
                    <>
                      <div>
                        <p className="text-xs text-primary-foreground/70 uppercase tracking-wider">Gross Revenue</p>
                        <p className="text-2xl font-bold">
                          {gbp(grossAnnual)}{" "}
                          <span className="text-base font-normal text-primary-foreground/80">({gbp(Math.round(grossAnnual / 12))}/mo)</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-primary-foreground/70 uppercase tracking-wider">Net Revenue</p>
                        <p className="text-2xl font-bold">
                          {gbp(stlNetAnnual)}{" "}
                          <span className="text-base font-normal text-primary-foreground/80">({gbp(Math.round(stlNetAnnual / 12))}/mo)</span>
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="text-right">
                      <p className="text-sm text-primary-foreground/80">Limited market data available</p>
                      <p className="text-xs text-primary-foreground/60 mt-1">Book a call with Stayful for a personalised estimate</p>
                    </div>
                  )}
                  <p className="text-[11px] text-primary-foreground/60">
                    After booking platform fees, cleaning, laundry and property management
                  </p>
                </div>
              </div>
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
                    Book a Free Assessment with Stayful
                  </a>
                )}
              </div>
            )}

            {!r.dataQuality?.disclaimer && (
              <p className="mb-4 text-xs text-muted-foreground">
                Note: {r.dataQuality?.comparablesFound ?? (hasComparables ? r.shortLet.comparables.length : 8)} comparable properties found in this market. Analysis is based on available data.
              </p>
            )}

            {/* Stat cards — always show core 3, conditionally show rating/reviews/age */}
            <div className={`mb-6 grid gap-3 grid-cols-2 sm:grid-cols-3 ${hasComparables ? "lg:grid-cols-6" : "lg:grid-cols-3"}`}>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] text-muted-foreground">{hasTop5 ? "Top 5 Avg. Nightly Rate" : "Avg. Nightly Rate"}</p>
                <p className="mt-1 text-xl font-bold text-foreground">{gbp(compAvgNightlyRate)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] text-muted-foreground">{hasTop5 ? "Top 5 Avg. Occupancy" : "Avg. Occupancy"}</p>
                <p className="mt-1 text-xl font-bold text-foreground">{pct(compAvgOccupancy)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] text-muted-foreground">{hasTop5 ? "Top 5 Avg. Revenue" : "Avg. Annual Revenue"}</p>
                <p className="mt-1 text-xl font-bold text-foreground">{gbp(compAvgRevenue)}</p>
              </div>
              {hasComparables && (
                <>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">Avg. Rating</p>
                    <p className="mt-1 text-xl font-bold text-foreground flex items-center gap-1">
                      {avgRating > 0 ? <><Star className="h-4 w-4 text-warning fill-warning" />{avgRating} / 5</> : "N/A"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">Avg. Reviews</p>
                    <p className="mt-1 text-xl font-bold text-foreground">{avgReviews > 0 ? avgReviews : "N/A"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">Avg. Listing Age</p>
                    <p className="mt-1 text-xl font-bold text-foreground">{avgListingAge > 0 ? `${avgListingAge} yrs` : "N/A"}</p>
                  </div>
                </>
              )}
            </div>

            {/* Property table */}
            {r.shortLet.comparables.length > 0 ? (
              <Card>
                <CardContent className="py-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2 font-medium">Property</th>
                          <th className="pb-2 font-medium text-center">Beds</th>
                          <th className="pb-2 font-medium text-center">Guests</th>
                          <th className="pb-2 font-medium">Nightly Rate</th>
                          <th className="pb-2 font-medium">Occupancy</th>
                          <th className="pb-2 font-medium">Days Available</th>
                          <th className="pb-2 font-medium">Est. Revenue</th>
                          <th className="pb-2 font-medium">Rating</th>
                          <th className="pb-2 font-medium">View</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.shortLet.comparables.map((comp, i) => {
                          const isTopPerformer = hasTop5 && top5Set.has(comp);
                          return (
                          <tr
                            key={i}
                            className={`border-b border-border/50 last:border-0 ${isTopPerformer ? "border-l-2 border-l-success bg-success/5" : i % 2 === 1 ? "bg-muted/20" : ""}`}
                          >
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-2">
                                <p className="font-medium truncate max-w-[180px]">
                                  {comp.title || `Listing ${i + 1}`}
                                </p>
                                {isTopPerformer && (
                                  <span className="inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success whitespace-nowrap">Top performer</span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {comp.distance != null ? `${comp.distance} km away` : ""}
                              </p>
                            </td>
                            <td className="py-2.5 text-center">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-xs font-semibold text-success">
                                {comp.bedrooms}
                              </span>
                            </td>
                            <td className="py-2.5 text-center">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-xs font-semibold text-success">
                                {comp.accommodates}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 font-semibold">
                              {gbp(comp.averageDailyRate)}
                            </td>
                            <td className="py-2.5 pr-4">{pct(comp.occupancyRate)}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">
                              {comp.daysAvailable > 0 ? comp.daysAvailable : Math.round(comp.occupancyRate * 365)}
                            </td>
                            <td className="py-2.5 pr-4 font-semibold">
                              {gbp(comp.annualRevenue)}
                            </td>
                            <td className="py-2.5 pr-4">
                              {comp.rating > 0 ? (
                                <div className="flex items-center gap-1">
                                  <Star className="h-3 w-3 text-warning fill-warning" />
                                  <span className="text-sm">{comp.rating.toFixed(1)}</span>
                                  {comp.reviewCount > 0 && (
                                    <span className="text-[11px] text-muted-foreground">({comp.reviewCount})</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">N/A</span>
                              )}
                            </td>
                            <td className="py-2.5">
                              {comp.url ? (
                                <a
                                  href={comp.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline text-xs font-medium"
                                >
                                  View
                                </a>
                              ) : (
                                <span className="text-muted-foreground text-xs">-</span>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
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
                        Book a Free Assessment
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
              Section 5: True Profit Calculator
              ══════════════════════════════════════════════════════════ */}
          <section id="profit-calculator" ref={setSectionRef("profit-calculator")} className="mb-12">
            <SectionHeading
              icon={Calculator}
              title="True Profit Calculator"
              subtitle="Enter your monthly costs to see your actual take-home profit"
            />

            {/* Inputs side by side */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="calc-mortgage" className="text-sm font-semibold">
                  Monthly Mortgage Cost
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                  <Input
                    id="calc-mortgage"
                    type="number"
                    min={0}
                    className="pl-7"
                    value={calcMortgage}
                    onChange={(e) => setCalcMortgage(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="calc-bills" className="text-sm font-semibold">
                    Monthly Bills
                  </Label>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                  <Input
                    id="calc-bills"
                    type="number"
                    min={0}
                    className="pl-7"
                    value={calcBills}
                    onChange={(e) => setCalcBills(Number(e.target.value) || 0)}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Recommended: £400 (Council Tax, Utilities, WiFi)
                </p>
              </div>
            </div>

            {/* Three cards: STL, LTL, Extra Profit */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Short-Term Let */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Short-Term Let</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between px-2 py-1.5">
                      <span className="text-sm">Net Revenue</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold">{gbp(stlNetAnnual)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({gbp(Math.round(stlNetAnnual / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex justify-between px-2 py-1.5">
                      <span className="text-sm text-muted-foreground">- Mortgage</span>
                      <div className="text-right">
                        <span className="text-sm text-destructive">-{gbp(calcMortgage * 12)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(calcMortgage)}/mo)</span>
                      </div>
                    </div>
                    <div className="flex justify-between px-2 py-1.5">
                      <span className="text-sm text-muted-foreground">- Bills</span>
                      <div className="text-right">
                        <span className="text-sm text-destructive">-{gbp(calcBills * 12)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(calcBills)}/mo)</span>
                      </div>
                    </div>
                    <div className="border-t border-border" />
                    <div className="rounded-lg bg-success/10 px-3 py-3 text-center">
                      <p className="text-sm font-bold text-foreground">True Annual Profit</p>
                      <p className={`text-2xl font-bold ${stlTrueAnnualProfit >= 0 ? "text-success" : "text-destructive"}`}>
                        {gbp(stlTrueAnnualProfit)} <span className="text-base font-normal text-muted-foreground">({gbp(Math.round(stlTrueAnnualProfit / 12))}/mo)</span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Long-Term Let */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Long-Term Let</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between px-2 py-1.5">
                      <span className="text-sm">Net Revenue</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold">{gbp(ltlNetAnnual)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({gbp(Math.round(ltlNetAnnual / 12))}/mo)</span>
                      </div>
                    </div>
                    <div className="flex justify-between px-2 py-1.5">
                      <span className="text-sm text-muted-foreground">- Mortgage</span>
                      <div className="text-right">
                        <span className="text-sm text-destructive">-{gbp(calcMortgage * 12)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">(-{gbp(calcMortgage)}/mo)</span>
                      </div>
                    </div>
                    <div className="flex justify-between px-2 py-1.5">
                      <span className="text-sm text-muted-foreground">- Bills</span>
                      <span className="text-sm font-medium text-success">Tenant pays</span>
                    </div>
                    <div className="border-t border-border" />
                    <div className="rounded-lg bg-muted/50 px-3 py-3 text-center">
                      <p className="text-sm font-bold text-foreground">True Annual Profit</p>
                      <p className={`text-2xl font-bold ${ltlTrueAnnualProfit >= 0 ? "text-foreground" : "text-destructive"}`}>
                        {gbp(ltlTrueAnnualProfit)} <span className="text-base font-normal text-muted-foreground">({gbp(Math.round(ltlTrueAnnualProfit / 12))}/mo)</span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Extra Profit Card */}
              <Card className={`border-2 ${profitDifference >= 0 ? "border-success" : "border-destructive"}`}>
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Extra Profit with Short-Term Let
                  </p>
                  <p className={`mt-2 text-3xl font-bold ${profitDifference >= 0 ? "text-success" : "text-destructive"}`}>
                    {profitDifference >= 0 ? "+" : ""}{gbp(profitDifference)}
                  </p>
                  <p className={`text-lg font-semibold ${profitDifference >= 0 ? "text-success" : "text-destructive"}`}>
                    {profitDifference >= 0 ? "+" : ""}{gbp(Math.round(profitDifference / 12))}/month
                  </p>
                  {profitDifference > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Short-term letting generates more profit even after bills.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-destructive">
                      Long-term letting may be more profitable with these costs.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <p className="mt-3 text-xs text-muted-foreground text-center">
              Note: Short-term let bills (council tax, utilities, WiFi) are your responsibility. With long-term lets, tenants typically pay their own bills.
            </p>
          </section>

          {/* ══════════════════════════════════════════════════════════
              Section 6: 12-Month Forecast
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
          <section id="data-sources" ref={setSectionRef("data-sources")} className="mb-12">
            <SectionHeading
              icon={Database}
              title="Data Sources & Methodology"
              subtitle="How we calculate our estimates and where the data comes from"
            />

            {/* Methodology card */}
            <Card className="mb-6">
              <CardContent className="py-6">
                <h3 className="text-sm font-bold text-foreground mb-2">Methodology</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Our property analysis combines data from multiple industry-leading sources to provide accurate revenue estimates. We analyse comparable properties in your area, local demand drivers, seasonal patterns, and market trends. Revenue projections account for platform fees (15%), property management (15%), and cleaning/laundry costs (18%), totalling 48% in operating expenses. Long-term let comparisons use a 10% letting agent fee. All figures are based on current market data and may vary based on property presentation, pricing strategy, and market conditions.
                </p>
              </CardContent>
            </Card>

            {/* Source cards 2-column grid */}
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              {dataSources.map((source) => (
                <Card key={source.title}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-bold text-foreground">{source.title}</p>
                        <p className="text-xs text-muted-foreground">{source.source}</p>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0 text-xs h-7 px-2">
                        View
                      </Button>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground mb-2">
                      {source.desc}
                    </p>
                    <ul className="space-y-1 mb-2">
                      {source.bullets.map((bullet, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <TrendingUp className="h-3 w-3 text-success shrink-0" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-muted-foreground">
                      Last updated: {source.updated}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Important Disclaimer */}
            <Card className="border-l-4 border-l-warning bg-warning/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Important Disclaimer</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      All revenue projections and financial estimates are based on current market data and historical trends. Actual results may vary based on property condition, local regulations, market changes, and management quality. These estimates should not be considered guaranteed income. We recommend consulting with a tax professional regarding your specific financial situation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                  property. Book a free consultation to get started.
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
                {/* Row 1: Address (full width) */}
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
                </div>

                {/* Row 2: Postcode | Property Type */}
                <div className="grid grid-cols-2 gap-4">
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
