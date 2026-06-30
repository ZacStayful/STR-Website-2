/**
 * Take-home waterfall bridge — reusable, rendered in TWO places:
 *   1. the qualification decision screen, and
 *   2. inside the full report (end of the Revenue/Net breakdown section).
 *
 * It explains why the full report's "Net Revenue" is higher than the
 * decision's true take-home, then compares to a managed long-let. Every row is
 * fed from getCostBreakdown() so it always reconciles to the decision maths.
 */

import { getCostBreakdown, FIXED_BILLS_MONTHLY, FIXED_SOFTWARE_MONTHLY, STR_COST_RATES } from "@/lib/qualification";

function gbpYr(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}/yr`;
}
function gbpMo(value: number): string {
  return `£${Math.round(value / 12).toLocaleString("en-GB")}/mo`;
}
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

interface TakeHomeBridgeProps {
  grossSTRAnnual: number;
  longLetNetAnnual: number;
  longLetFeePct: number; // e.g. 0.10
  className?: string;
}

export function TakeHomeBridge({ grossSTRAnnual, longLetNetAnnual, longLetFeePct, className }: TakeHomeBridgeProps) {
  const b = getCostBreakdown(grossSTRAnnual);
  const difference = b.trueTakeHome - longLetNetAnnual;
  const shortLetAhead = difference >= 0;

  return (
    <div className={`rounded-xl border border-border bg-card p-5 sm:p-6 ${className ?? ""}`}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        The full report shows Net Revenue. The recommendation goes further — taking off VAT,
        maintenance and your bills — to show what you actually keep, then compares it to a managed
        long-let.
      </p>

      <div className="space-y-1.5 text-sm">
        {/* Gross */}
        <Row label="Gross short-let income" annual={b.gross} monthly={b.gross} bold />

        {/* Report deductions */}
        <Deduction label={`Booking platform (${pct(STR_COST_RATES.platform)})`} amount={b.platform} />
        <Deduction label={`Management (${pct(STR_COST_RATES.managementBase)})`} amount={b.managementBase} />
        <Deduction label={`Cleaning (${pct(STR_COST_RATES.cleaning)})`} amount={b.cleaning} />

        <div className="my-2 border-t border-border" />

        {/* Net Revenue — the report's headline */}
        <Subtotal
          label="Net Revenue"
          annual={b.netRevenue}
          note="the figure shown in the full report"
        />

        {/* Decision-only deductions */}
        <Deduction label="VAT on management" amount={b.managementVat} />
        <Deduction label={`Maintenance (${pct(STR_COST_RATES.maintenance)})`} amount={b.maintenance} />
        <Deduction
          label={`Bills & software (£${FIXED_BILLS_MONTHLY}+£${FIXED_SOFTWARE_MONTHLY}/mo)`}
          amount={b.fixed}
        />

        <div className="my-2 border-t border-border" />

        {/* True take-home — what the decision is based on */}
        <Subtotal
          label="Short-let true take-home"
          annual={b.trueTakeHome}
          note="what the recommendation is based on"
          emphasise
        />

        <div className="my-2 border-t border-dashed border-border" />

        {/* Managed long-let comparison */}
        <Row
          label="Managed long-let take-home"
          annual={longLetNetAnnual}
          monthly={longLetNetAnnual}
          note={`after the ${pct(longLetFeePct)} management fee`}
        />

        {/* Difference */}
        <div
          className={`mt-2 flex items-center justify-between rounded-lg px-3 py-2.5 ${
            shortLetAhead ? "bg-success/10" : "bg-muted"
          }`}
        >
          <span className={`text-sm font-bold ${shortLetAhead ? "text-success" : "text-foreground"}`}>
            Difference — {shortLetAhead ? "short-let ahead" : "long-let ahead"}
          </span>
          <span className={`text-sm font-bold ${shortLetAhead ? "text-success" : "text-foreground"}`}>
            {shortLetAhead ? "+" : "−"}
            {gbpYr(Math.abs(difference))}
            <span className="ml-2 font-medium opacity-80">
              {shortLetAhead ? "+" : "−"}
              {gbpMo(Math.abs(difference))}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  annual,
  monthly,
  note,
  bold,
}: {
  label: string;
  annual: number;
  monthly: number;
  note?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-foreground ${bold ? "font-semibold" : ""}`}>
        {label}
        {note && <span className="ml-1 text-xs font-normal text-muted-foreground">({note})</span>}
      </span>
      <span className={`whitespace-nowrap text-foreground ${bold ? "font-semibold" : ""}`}>
        {gbpYr(annual)}
        <span className="ml-2 text-xs font-medium text-muted-foreground">{gbpMo(monthly)}</span>
      </span>
    </div>
  );
}

function Deduction({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-destructive">
      <span>− {label}</span>
      <span className="whitespace-nowrap">
        −{gbpYr(amount)}
        <span className="ml-2 text-xs font-medium opacity-80">−{gbpMo(amount)}</span>
      </span>
    </div>
  );
}

function Subtotal({
  label,
  annual,
  note,
  emphasise,
}: {
  label: string;
  annual: number;
  note?: string;
  emphasise?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`font-bold ${emphasise ? "text-primary" : "text-foreground"}`}>
        {label}
        {note && <span className="ml-1 block text-xs font-normal text-muted-foreground sm:inline">— {note}</span>}
      </span>
      <span className={`whitespace-nowrap font-bold ${emphasise ? "text-primary" : "text-foreground"}`}>
        {gbpYr(annual)}
        <span className="ml-2 text-xs font-medium text-muted-foreground">{gbpMo(annual)}</span>
      </span>
    </div>
  );
}
