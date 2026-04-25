"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  TrendingUp,
  Shield,
  ShieldCheck,
  Heart,
  GraduationCap,
  Plane,
  TrainFront,
  Bus,
  TrainTrack,
  Phone,
  Rocket,
  Eye,
  Wrench,
  MessageSquare,
  Camera,
  ClipboardCheck,
  LineChart,
  BookOpen,
  Layers,
  RefreshCw,
  Star,
  Globe,
  Zap,
  Clock,
  Home,
  Wifi,
  Database,
  Calculator,
  CheckCircle2,
  Users,
  BarChart3,
  Target,
  Sparkles,
  Percent,
  Building2,
  MapPin,
  CreditCard,
  FileText,
  CheckCircle,
  Headphones,
  DollarSign,
  PenTool,
  Settings,
  Search,
  Calendar,
  Package,
  Award,
} from "lucide-react";
import type { AnalysisResult, RiskLevel } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

const TOTAL_SLIDES = 14;
const GREEN = "#5d8156";
const CARD_BG = "#e6ebd7";
const RED = "#b45050";

// Sidebar icons for each slide
const SLIDE_ICONS = [
  Home, BarChart3, LineChart, Calculator, Calendar, MapPin,
  Shield, Rocket, ShieldCheck, Users, Package, ClipboardCheck,
  Star, Phone,
];

// ─── Component ───────────────────────────────────────────────────

interface PresentationProps {
  data: AnalysisResult;
  onClose: () => void;
}

export default function Presentation({ data, onClose }: PresentationProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fadeIn, setFadeIn] = useState(true);

  const r = data;
  const f = r.financials;

  // Computed values
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
  const revDifferencePct = ltlNetAnnual > 0 ? Math.round((revDifference / ltlNetAnnual) * 100) : 0;

  // Monthly net
  const stlMonthlyNet = r.shortLet.monthlyRevenue.map((rev) => Math.round(rev * 0.52));
  const ltlMonthlyNet = Math.round(ltlNetAnnual / 12);

  // Peak months
  const peakMonthIndices = stlMonthlyNet
    .map((net, i) => ({ net, i }))
    .filter((m) => m.net > ltlMonthlyNet)
    .map((m) => m.i);

  // Demand drivers
  const hospitals = r.demandDrivers.hospitals.length;
  const universities = r.demandDrivers.universities.length;
  const totalTransport = r.demandDrivers.trainStations.length + r.demandDrivers.busStations.length + r.demandDrivers.subwayStations.length;
  const totalEvents = r.nearbyEvents.totalEvents;
  const demandDriverCount = [hospitals > 0, universities > 0, totalTransport > 0, totalEvents > 0].filter(Boolean).length;

  // Booking score
  let bookingScore = 15;
  if (hospitals > 0) bookingScore += 15;
  if (universities > 0) bookingScore += 15;
  bookingScore += totalTransport >= 3 ? 20 : totalTransport >= 1 ? 12 : 0;
  bookingScore += totalEvents >= 100 ? 25 : totalEvents >= 50 ? 15 : totalEvents > 0 ? 5 : 0;
  bookingScore += demandDriverCount >= 3 ? 10 : demandDriverCount >= 2 ? 5 : 0;

  // Risk scores
  const riskToScore = (level: RiskLevel): number => {
    if (level === "low") return 85;
    if (level === "moderate") return 55;
    return 25;
  };
  const revenueConsistency = Math.round((riskToScore(r.risk.incomeVolatility) + riskToScore(r.risk.seasonality)) / 2);
  const longTermComparison = revDifference >= 0 ? Math.min(95, 60 + Math.round(revDifferencePct * 0.3)) : Math.max(15, 50 + Math.round(revDifferencePct * 0.3));
  const marketDemand = Math.round((riskToScore(r.risk.locationDemand) + riskToScore(r.risk.competition)) / 2);
  const overallRisk = r.risk.overallScore;

  // Demand drivers list for slide 6
  const allDemandDrivers = [
    ...r.demandDrivers.hospitals.map((a) => ({ ...a, category: "Hospital", icon: Heart, desc: "NHS hospital providing medical services" })),
    ...r.demandDrivers.universities.map((a) => ({ ...a, category: "University", icon: GraduationCap, desc: "Higher education institution" })),
    ...r.demandDrivers.airports.map((a) => ({ ...a, category: "Airport", icon: Plane, desc: "Airport with domestic and international flights" })),
    ...r.demandDrivers.trainStations.map((a) => ({ ...a, category: "Train Station", icon: TrainFront, desc: "Rail station with regional connections" })),
    ...r.demandDrivers.busStations.map((a) => ({ ...a, category: "Bus Station", icon: Bus, desc: "Bus station with local and national routes" })),
    ...r.demandDrivers.subwayStations.map((a) => ({ ...a, category: "Metro", icon: TrainTrack, desc: "Metro/subway station" })),
  ].sort((a, b) => a.distance - b.distance).slice(0, 4);

  // Navigation
  const goTo = useCallback((idx: number) => {
    setFadeIn(false);
    setTimeout(() => {
      setCurrentSlide(idx);
      setFadeIn(true);
    }, 150);
  }, []);

  const goNext = useCallback(() => {
    if (currentSlide < TOTAL_SLIDES - 1) goTo(currentSlide + 1);
  }, [currentSlide, goTo]);

  const goPrev = useCallback(() => {
    if (currentSlide > 0) goTo(currentSlide - 1);
  }, [currentSlide, goTo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onClose]);

  // SVG donut chart for risk
  const renderDonut = (score: number) => {
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    const color = score >= 60 ? GREEN : score >= 40 ? "#d97706" : RED;

    return (
      <svg width="200" height="200" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="14" />
        <circle
          cx="100" cy="100" r={radius} fill="none"
          stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          transform="rotate(-90 100 100)"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
        <text x="100" y="92" textAnchor="middle" className="text-4xl font-bold" fill="#1f2937" fontSize="40" fontWeight="700">{score}</text>
        <text x="100" y="118" textAnchor="middle" fill="#9ca3af" fontSize="14">out of 100</text>
      </svg>
    );
  };

  // Slide rendering
  const renderSlide = () => {
    switch (currentSlide) {
      // ─── Slide 1: Title ────────────────────────────────────────
      case 0:
        return (
          <div className="flex h-full flex-col items-center justify-center text-center px-4">
            <div className="mb-8">
              <Image
                src="/images/stayful-logo.png"
                alt="Stayful"
                width={200}
                height={60}
                className="mx-auto h-14 w-auto"
              />
            </div>
            <h1 className="mb-8 text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: GREEN, fontFamily: "Georgia, 'Times New Roman', serif" }}>
              Property Income Analysis
            </h1>
            <div className="mb-8 rounded-xl border border-gray-200 bg-white px-8 py-5 shadow-sm">
              <p className="text-xl font-medium text-gray-800">{r.property.address}</p>
              <p className="mt-1 text-base text-gray-500">{r.property.postcode}</p>
            </div>
            <div className="flex items-center gap-4 text-base text-gray-600">
              <span className="flex items-center gap-2">
                <Home className="h-5 w-5" style={{ color: GREEN }} />
                {r.property.bedrooms} Bedrooms
              </span>
              <span className="text-gray-300">&bull;</span>
              <span className="flex items-center gap-2">
                <Users className="h-5 w-5" style={{ color: GREEN }} />
                {r.property.guests} Guests
              </span>
            </div>
          </div>
        );

      // ─── Slide 2: Executive Summary ────────────────────────────
      case 1: {
        const isNeg = revDifference < 0;
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-10 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Executive Summary</h2>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2">
              {/* Gross Annual Revenue */}
              <div className="rounded-xl p-6" style={{ backgroundColor: CARD_BG }}>
                <p className="text-sm font-medium text-gray-600">Gross Annual Revenue</p>
                <p className="mt-2 text-3xl font-bold" style={{ color: GREEN }}>{gbp(grossAnnual)}</p>
                <p className="mt-1 text-sm text-gray-500">Short-term rental potential</p>
              </div>
              {/* Net Annual Revenue */}
              <div className="rounded-xl p-6" style={{ backgroundColor: CARD_BG }}>
                <p className="text-sm font-medium text-gray-600">Net Annual Revenue</p>
                <p className="mt-2 text-3xl font-bold" style={{ color: GREEN }}>{gbp(stlNetAnnual)}</p>
                <p className="mt-1 text-sm text-gray-500">After 48% operating costs</p>
              </div>
              {/* Long-Term Let (Net) */}
              <div className="rounded-xl p-6" style={{ backgroundColor: CARD_BG }}>
                <p className="text-sm font-medium text-gray-600">Long-Term Let (Net)</p>
                <p className="mt-2 text-3xl font-bold text-gray-800">{gbp(ltlNetAnnual)}</p>
                <p className="mt-1 text-sm text-gray-500">After 10% agent fees</p>
              </div>
              {/* Additional Income */}
              <div
                className="rounded-xl border-2 p-6"
                style={{
                  backgroundColor: isNeg ? "#fef2f2" : CARD_BG,
                  borderColor: isNeg ? RED : GREEN,
                }}
              >
                <p className="text-sm font-medium text-gray-600">Additional Income</p>
                <p className="mt-2 text-3xl font-bold" style={{ color: isNeg ? RED : GREEN }}>
                  {revDifference >= 0 ? "+" : ""}{gbp(revDifference)}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {Math.abs(revDifferencePct)}% {revDifference >= 0 ? "more" : "less"} than long-let
                </p>
              </div>
            </div>
          </div>
        );
      }

      // ─── Slide 3: Market Analysis ──────────────────────────────
      case 2:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-2 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Market Analysis</h2>
            <p className="mb-10 text-center text-base text-gray-500">Based on comparable Airbnb properties nearby</p>
            <div className="mx-auto grid max-w-4xl grid-cols-2 gap-5 sm:grid-cols-4">
              <MarketCard icon={Percent} label="Avg Nightly Rate" value={gbp(r.shortLet.averageDailyRate)} />
              <MarketCard icon={BarChart3} label="Avg Occupancy" value={pct(r.shortLet.occupancyRate)} />
              <MarketCard icon={Star} label="Avg Rating" value="4.5" />
              <MarketCard icon={Building2} label="Properties Analysed" value={r.shortLet.activeListings > 0 ? String(r.shortLet.activeListings) : "Market data"} />
            </div>
            <div className="mx-auto mt-10 max-w-2xl rounded-xl px-6 py-3 text-center" style={{ backgroundColor: CARD_BG }}>
              <p className="text-sm text-gray-600">
                Data sourced from Airbtics, AirDNA, and live Airbnb listings
              </p>
            </div>
          </div>
        );

      // ─── Slide 4: Operating Cost Breakdown ─────────────────────
      case 3:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-10 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Operating Cost Breakdown</h2>
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <CostRow pctVal={15} label="Platform Fees (Airbnb/Booking.com)" amount={platformFees} />
              <CostRow pctVal={15} label="Management Fees (Stayful)" amount={managementFees} />
              <CostRow pctVal={18} label="Cleaning & Laundry" amount={cleaningLaundry} />
              <div className="my-4 border-t border-gray-200" />
              <div className="flex items-center gap-4">
                <span
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                  style={{ backgroundColor: GREEN }}
                >
                  48%
                </span>
                <span className="flex-1 text-lg font-bold text-gray-900">Total Operating Costs</span>
                <span className="text-lg font-bold text-gray-900">{gbp(totalOperatingCosts)}</span>
              </div>
            </div>
            <div className="mx-auto mt-8 w-full max-w-3xl rounded-xl p-5 text-center" style={{ backgroundColor: CARD_BG }}>
              <p className="text-sm font-medium text-gray-600">Your Net Annual Revenue</p>
              <p className="mt-1 text-3xl font-bold" style={{ color: GREEN }}>{gbp(stlNetAnnual)}</p>
            </div>
          </div>
        );

      // ─── Slide 5: Seasonal Performance ─────────────────────────
      case 4:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-8 text-center text-3xl font-bold text-gray-900 sm:text-4xl" style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic" }}>
              Seasonal Performance
            </h2>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2">
              {/* Peak Months card */}
              <div className="rounded-xl border-2 bg-white p-6" style={{ borderColor: GREEN }}>
                <h3 className="mb-4 text-lg font-bold text-gray-900">Peak Months</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {peakMonthIndices.map((i) => (
                    <span
                      key={i}
                      className="rounded-full px-3 py-1 text-sm font-semibold text-white"
                      style={{ backgroundColor: GREEN }}
                    >
                      {MONTHS[i]}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-gray-500">Months where short-let net revenue exceeds long-let</p>
              </div>
              {/* Monthly Breakdown card */}
              <div className="rounded-xl p-6" style={{ backgroundColor: CARD_BG }}>
                <h3 className="mb-4 text-lg font-bold text-gray-900">Monthly Breakdown</h3>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {MONTHS.map((month, i) => (
                    <div key={month} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{month}</span>
                      <span className="font-semibold text-gray-900">{gbp(stlMonthlyNet[i])}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-gray-400">
              Peak months typically see 20-40% higher revenue than off-peak periods
            </p>
          </div>
        );

      // ─── Slide 6: Local Demand Drivers ─────────────────────────
      case 5:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-2 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Local Demand Drivers</h2>
            <p className="mb-8 text-center text-base text-gray-500">Why guests will book your property</p>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2">
              {allDemandDrivers.map((driver, i) => {
                const Icon = driver.icon;
                return (
                  <div key={i} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: CARD_BG }}>
                      <MapPin className="h-5 w-5" style={{ color: GREEN }} />
                    </div>
                    <p className="font-bold text-gray-900">{driver.name}</p>
                    <p className="text-sm text-gray-500">{(driver.distance / 1000).toFixed(1)} miles away</p>
                    <p className="mt-1 text-sm text-gray-400">{driver.desc}</p>
                  </div>
                );
              })}
              {allDemandDrivers.length === 0 && (
                <p className="col-span-2 text-center text-gray-400">No specific demand drivers found nearby</p>
              )}
            </div>
            <div className="mx-auto mt-8 rounded-xl px-6 py-3 text-center" style={{ backgroundColor: CARD_BG }}>
              <p className="text-sm font-semibold text-gray-700">
                Direct Booking Potential Score: <span style={{ color: GREEN }} className="font-bold">{bookingScore}/100</span>
              </p>
            </div>
          </div>
        );

      // ─── Slide 7: Risk Assessment ──────────────────────────────
      case 6:
        return (
          <div className="flex h-full flex-col items-center justify-center px-4">
            <h2 className="mb-8 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Risk Assessment</h2>
            <div className="mb-8">
              {renderDonut(overallRisk)}
            </div>
            <div className="mx-auto w-full max-w-xl space-y-5">
              <ProgressBar label="Revenue Consistency" score={revenueConsistency} />
              <ProgressBar label="Long-Term Comparison" score={longTermComparison} />
              <ProgressBar label="Market Demand" score={marketDemand} />
            </div>
            <p className="mt-8 max-w-md text-center text-sm text-gray-500">
              {overallRisk >= 60
                ? "Low risk - strong and consistent earning potential."
                : overallRisk >= 40
                  ? "Moderate risk - some seasonal variation"
                  : "Higher risk - detailed strategy recommended"}
            </p>
          </div>
        );

      // ─── Slide 8: Our Plan for Profitability ──────────────────
      case 7:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-2 text-center text-3xl font-bold sm:text-4xl" style={{ color: GREEN }}>Our Plan for Profitability</h2>
            <p className="mb-10 text-center text-base text-gray-500">A proven 4-phase approach to maximise your rental income</p>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2">
              {[
                { num: 1, title: "Momentum", desc: "Launch on Airbnb and Booking.com to build early demand, bookings and reviews", icon: Rocket },
                { num: 2, title: "Data", desc: "Learn which guest types, lengths of stay and price points perform best for your property", icon: Database },
                { num: 3, title: "Direct Bookings", desc: "Convert repeat guests into direct customers where it makes sense", icon: Target },
                { num: 4, title: "Expand", desc: "Access Stayful's wider guest network and more repeat-booking opportunities over time", icon: Globe },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.num} className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                      <span
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: GREEN }}
                      >
                        {step.num}
                      </span>
                      <Icon className="h-5 w-5 text-gray-400" />
                    </div>
                    <h3 className="mb-2 text-lg font-bold text-gray-900">{step.title}</h3>
                    <p className="text-sm text-gray-500">{step.desc}</p>
                  </div>
                );
              })}
            </div>
            <div className="mx-auto mt-8 max-w-2xl rounded-xl px-6 py-3 text-center" style={{ backgroundColor: CARD_BG }}>
              <p className="text-sm font-semibold" style={{ color: GREEN }}>
                30% of our bookings are now direct customers, saving platform fees
              </p>
            </div>
          </div>
        );

      // ─── Slide 9: How We Protect Your Property ────────────────
      case 8:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-2 text-center text-3xl font-bold sm:text-4xl" style={{ color: GREEN }}>How We Protect Your Property</h2>
            <p className="mb-10 text-center text-base text-gray-500">Comprehensive vetting and protection for every booking</p>
            <div className="mx-auto grid max-w-5xl grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { value: "£200", label: "Security Deposit", icon: CreditCard },
                { value: "30%", label: "Direct Customers", icon: RefreshCw },
                { value: "Quarterly", label: "Property Inspections", icon: Eye },
                { value: "£100K", label: "Guest Insurance", icon: ShieldCheck },
                { value: "100%", label: "ID Verified", icon: Users },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex flex-col items-center rounded-xl border border-gray-100 bg-white p-5 text-center shadow-sm">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: CARD_BG }}>
                      <Icon className="h-5 w-5" style={{ color: GREEN }} />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{item.value}</p>
                    <p className="mt-1 text-sm text-gray-500">{item.label}</p>
                  </div>
                );
              })}
            </div>
            <div className="mx-auto mt-8 max-w-2xl rounded-xl px-6 py-3 text-center" style={{ backgroundColor: CARD_BG }}>
              <p className="text-sm text-gray-600">
                Every guest is ID checked and insured up to £100,000
              </p>
            </div>
          </div>
        );

      // ─── Slide 10: Responsibilities ───────────────────────────
      case 9:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-10 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Landlord & Stayful Responsibilities</h2>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2">
              {/* Stayful */}
              <div className="rounded-xl border-2 bg-white p-6" style={{ borderColor: GREEN }}>
                <h3 className="mb-5 text-xl font-bold" style={{ color: GREEN }}>Stayful Responsibilities</h3>
                <ul className="space-y-3">
                  {[
                    "Cleaning & Laundry",
                    "Maintenance",
                    "Guest Communication",
                    "Key Management",
                    "Dynamic Pricing",
                    "Direct Booking Management",
                  ].map((text, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <CheckCircle className="h-5 w-5 flex-shrink-0" style={{ color: GREEN }} />
                      <span className="text-sm font-medium text-gray-800">{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* Landlord */}
              <div className="rounded-xl p-6" style={{ backgroundColor: CARD_BG }}>
                <h3 className="mb-5 text-xl font-bold text-gray-700">Landlord Responsibilities</h3>
                <ul className="space-y-3">
                  {[
                    { text: "Utilities", note: null },
                    { text: "Mortgage", note: null },
                    { text: "WiFi & Council Tax", note: "Council tax can be exempt for STL" },
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-400">
                        <div className="h-2 w-2 rounded-full bg-gray-400" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-700">{item.text}</span>
                        {item.note && <p className="text-xs text-gray-400 mt-0.5">{item.note}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );

      // ─── Slide 11: What's Included ────────────────────────────
      case 10:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-2 text-center text-3xl font-bold text-gray-900 sm:text-4xl">What&apos;s Included in Stayful Service</h2>
            <p className="mb-8 text-center text-lg font-bold" style={{ color: GREEN }}>Only 15% + VAT</p>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Layers, title: "Central Channel Manager", desc: "Manage all platforms from one place" },
                { icon: MessageSquare, title: "Slack Messaging", desc: "Real-time communication channel" },
                { icon: LineChart, title: "Monthly Property Reports", desc: "Detailed performance insights" },
                { icon: Phone, title: "Quarterly Performance Calls", desc: "Strategic review sessions" },
                { icon: BookOpen, title: "Market Report Newsletter", desc: "Stay ahead of market trends" },
                { icon: TrendingUp, title: "Dynamic Pricing", desc: "Maximise revenue automatically" },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: CARD_BG }}>
                      <Icon className="h-5 w-5" style={{ color: GREEN }} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{item.title}</p>
                      <p className="text-sm text-gray-500">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      // ─── Slide 12: Onboarding ─────────────────────────────────
      case 11:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <h2 className="mb-2 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Onboarding with Stayful</h2>
            <p className="mb-10 text-center text-base text-gray-500">3 weeks from kick-off to go live</p>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { num: 1, title: "Contract Signed", desc: "Contract signed and onboarding form filled", icon: FileText },
                { num: 2, title: "Kick-Off Call", desc: "Discuss plans, create your Slack channel", icon: Phone },
                { num: 3, title: "Furnishing & Photos", desc: "End-to-end service or DIY with free setup guide", icon: Camera },
                { num: 4, title: "Inspection & Snagging", desc: "Team visits site with detailed checklist", icon: ClipboardCheck },
                { num: 5, title: "Listing Setup", desc: "All platforms configured and optimised", icon: Settings },
                { num: 6, title: "Go Live!", desc: "Start receiving bookings", icon: Rocket },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.num} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-3">
                      <span
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: GREEN }}
                      >
                        {step.num}
                      </span>
                      <Icon className="h-5 w-5 text-gray-400" />
                    </div>
                    <h3 className="mb-1 font-bold text-gray-900">{step.title}</h3>
                    <p className="text-sm text-gray-500">{step.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );

      // ─── Slide 13: Why Choose Stayful? ────────────────────────
      case 12:
        return (
          <div className="flex h-full flex-col justify-center px-4">
            <div className="mb-6 flex justify-center">
              <Image
                src="/images/stayful-logo.png"
                alt="Stayful"
                width={160}
                height={48}
                className="h-10 w-auto"
              />
            </div>
            <h2 className="mb-10 text-center text-3xl font-bold text-gray-900 sm:text-4xl">Why Choose Stayful?</h2>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { title: "Only 15% Management Fee", desc: "One of the lowest in the industry" },
                { title: "Nationwide Coverage", desc: "We manage properties across the UK" },
                { title: "Dynamic Pricing", desc: "Maximise revenue with smart pricing" },
                { title: "Full Service Management", desc: "Guests, cleaning, maintenance, all handled" },
                { title: "24/7 Guest Support", desc: "Round-the-clock assistance for guests" },
                { title: "4.8 Star Google Rating", desc: "Trusted by property owners nationwide" },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: GREEN }} />
                  <div>
                    <p className="font-bold text-gray-900">{item.title}</p>
                    <p className="text-sm text-gray-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // ─── Slide 14: Ready to Get Started? ──────────────────────
      case 13:
        return (
          <div className="flex h-full flex-col items-center justify-center text-center px-4">
            <h2 className="mb-4 text-4xl font-bold text-gray-900 sm:text-5xl">Ready to Get Started?</h2>
            <p className="mb-8 max-w-lg text-lg text-gray-500">
              Let Stayful help you maximise your property&apos;s income potential
            </p>
            <div className="mb-8 inline-flex items-center rounded-full px-6 py-2" style={{ backgroundColor: CARD_BG }}>
              <span className="text-base font-bold" style={{ color: GREEN }}>Potential: {gbp(stlNetAnnual)}/year</span>
            </div>
            <button
              onClick={() => window.open("https://calendly.com/zac-stayful/call", "_blank")}
              className="mb-4 rounded-xl px-8 py-4 text-lg font-bold text-white shadow-lg transition-transform hover:scale-105"
              style={{ backgroundColor: GREEN }}
            >
              Get Your Free Consultation
            </button>
            <button
              onClick={() => window.open("tel:01134790251")}
              className="mb-8 flex items-center gap-2 rounded-xl border-2 px-6 py-3 text-base font-semibold transition-colors hover:bg-gray-50"
              style={{ borderColor: GREEN, color: GREEN }}
            >
              <Phone className="h-5 w-5" />
              0113 479 0251
            </button>
            <Image
              src="/images/stayful-logo.png"
              alt="Stayful"
              width={140}
              height={42}
              className="h-8 w-auto opacity-60"
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-white">
      {/* Left sidebar */}
      <div
        className="flex flex-col border-r border-gray-200 bg-white transition-all duration-200"
        style={{ width: sidebarOpen ? 64 : 48 }}
      >
        <div className="flex-1 overflow-y-auto py-2">
          {SLIDE_ICONS.map((Icon, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className="flex w-full items-center justify-center py-2.5 transition-colors"
              style={{
                backgroundColor: i === currentSlide ? CARD_BG : "transparent",
                color: i === currentSlide ? GREEN : "#9ca3af",
              }}
              title={`Slide ${i + 1}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center border-t border-gray-200 py-3 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronRight className="h-4 w-4" style={{ transform: sidebarOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-2.5">
          <div className="flex items-center gap-3">
            <Image
              src="/images/stayful-logo.png"
              alt="Stayful"
              width={100}
              height={30}
              className="h-6 w-auto"
            />
            <span className="text-sm font-medium text-gray-600">Property Presentation</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <Play className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Slide content */}
        <div className="relative flex-1 overflow-y-auto" style={{ backgroundColor: "#fafafa" }}>
          <div
            className="mx-auto h-full max-w-5xl px-6 py-8 sm:px-10"
            style={{
              opacity: fadeIn ? 1 : 0,
              transition: "opacity 0.15s ease-in-out",
            }}
          >
            {renderSlide()}
          </div>
        </div>

        {/* Bottom navigation */}
        <div className="border-t border-gray-200 bg-white px-5 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={goPrev}
              disabled={currentSlide === 0}
              className="flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>

            <div className="flex flex-col items-center gap-2">
              {/* Dots */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className="h-2 w-2 rounded-full transition-all"
                    style={{
                      backgroundColor: i === currentSlide ? GREEN : "#d1d5db",
                      transform: i === currentSlide ? "scale(1.3)" : "scale(1)",
                    }}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400">
                Slide {currentSlide + 1} of {TOTAL_SLIDES} | Use arrow keys or click to navigate
              </p>
            </div>

            <button
              onClick={goNext}
              disabled={currentSlide === TOTAL_SLIDES - 1}
              className="flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-30"
              style={{ backgroundColor: GREEN }}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function MarketCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-gray-100 bg-white p-5 text-center shadow-sm">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: CARD_BG }}>
        <Icon className="h-5 w-5" style={{ color: GREEN }} />
      </div>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: GREEN }}>{value}</p>
    </div>
  );
}

function CostRow({ pctVal, label, amount }: { pctVal: number; label: string; amount: number }) {
  return (
    <div className="flex items-center gap-4">
      <span
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: GREEN }}
      >
        {pctVal}%
      </span>
      <span className="flex-1 text-sm font-medium text-gray-700">{label}</span>
      <span className="text-sm font-bold text-gray-900">{gbp(amount)}</span>
    </div>
  );
}

function ProgressBar({ label, score }: { label: string; score: number }) {
  const color = score >= 65 ? GREEN : score >= 40 ? "#d97706" : RED;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>{score}/100</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: color, transition: "width 0.8s ease" }}
        />
      </div>
    </div>
  );
}
