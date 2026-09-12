"use client";

import Link from "next/link";
import { formatGbp, openOutOfCredit } from "@/lib/credit/client";
import { useCreditOptional } from "./CreditProvider";

/**
 * Sticky strip under the app nav: a warning once 80% of the cycle's credit
 * is used, a red one at £0. Both link to top-up and upgrade.
 */
export function CreditBanner() {
  const ctx = useCreditOptional();
  const c = ctx?.credit;
  if (!c || c.admin) return null;
  if (c.state === "ok") return null;
  const out = c.state === "out";
  const cycle = c.cycle;
  const pct = cycle && cycle.allowancePence > 0 ? Math.min(100, Math.round((cycle.usedPence / cycle.allowancePence) * 100)) : null;
  const message = out
    ? c.enforcing
      ? "You're out of credit. Top up or upgrade to keep running reports."
      : "You've used all your credit. Top up or upgrade — new usage will count against your next credit."
    : `Running low: ${pct !== null ? `${pct}% of your ${cycle?.planName ? `${cycle.planName} plan` : "welcome"} credit is used` : `${formatGbp(c.totalPence)} left`}${cycle?.planName ? "" : " · upgrade for monthly credit"}.`;
  return (
    <div className="sticky top-0 z-40 w-full border-b border-black/10 shadow-sm" style={{ backgroundColor: out ? "#991b1b" : "#b45309" }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-center text-sm font-medium text-white">
        <span>{message}</span>
        <span className="flex gap-2">
          <button type="button" onClick={() => openOutOfCredit({ mode: "topup" })} className="inline-flex items-center rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/25">
            Top up
          </button>
          <Link href="/upgrade" className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-white/90" style={{ color: out ? "#991b1b" : "#b45309" }}>
            Upgrade plan
          </Link>
        </span>
      </div>
    </div>
  );
}
