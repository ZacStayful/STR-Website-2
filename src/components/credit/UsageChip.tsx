"use client";

import Link from "next/link";
import { formatGbp } from "@/lib/credit/client";
import { dailyDealsDaysLeft } from "@/lib/credit/deal-pricing";
import { useCreditOptional } from "./CreditProvider";

/**
 * The usage chip in the app nav (Batch 10), in the credit badge's place and
 * with its colours (amber when low, red when out). On a plan: a ring of how
 * much of this period's plan credit is used, and the balance. Pay as you go:
 * the balance and about how many days of daily deals it covers. A team member
 * sees the team's. Both go to the Usage page.
 */
export function UsageChip() {
  const ctx = useCreditOptional();
  const c = ctx?.credit;
  if (!c) return null;
  const tone = c.admin ? { bg: "rgba(255,255,255,0.12)", fg: "#fff" } : c.outOfCredit ? { bg: "#7f1d1d", fg: "#fecaca" } : c.lowBalance ? { bg: "#78350f", fg: "#fde68a" } : { bg: "rgba(255,255,255,0.12)", fg: "#fff" };
  const style: React.CSSProperties = { background: tone.bg, color: tone.fg, borderRadius: 999, padding: "2px 10px", fontWeight: 600, textDecoration: "none", fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 };
  if (c.admin) {
    return (
      <Link href="/account/billing" title="Admin account — usage is logged but never charged" style={style}>
        Admin · unlimited
      </Link>
    );
  }
  const team = c.member ? "Team " : "";
  const plan = c.cycle?.planCode ? c.cycle : null;
  if (plan && plan.allowancePence > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((plan.usedPence / plan.allowancePence) * 100)));
    return (
      <Link href="/account/usage" title={`${pct}% of this period's plan credit used${c.member ? ` (${c.member.teamName}'s)` : ""}`} aria-label={`${team}balance ${formatGbp(c.totalPence)}, ${pct}% of plan credit used. See usage.`} style={style}>
        <Ring pct={pct} colour={tone.fg} />
        {`${team}${formatGbp(c.totalPence)}`}
      </Link>
    );
  }
  const days = dailyDealsDaysLeft(c.spendableBasePence, c.dailyDealsPence ?? 0);
  return (
    <Link href="/account/usage" title={c.member ? `${c.member.teamName}'s balance — the account owner tops it up` : "Your credit and where it goes"} style={style}>
      {`${team}${formatGbp(c.totalPence)}${days !== null ? ` · about ${days} day${days === 1 ? "" : "s"} of daily deals` : ""}`}
    </Link>
  );
}

function Ring({ pct, colour }: { pct: number; colour: string }) {
  const r = 5;
  const len = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2.5} />
      <circle cx="7" cy="7" r={r} fill="none" stroke={colour} strokeWidth={2.5} strokeDasharray={`${(len * pct) / 100} ${len}`} transform="rotate(-90 7 7)" strokeLinecap="round" />
    </svg>
  );
}
