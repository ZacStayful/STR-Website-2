import type { ReactNode } from "react";
import type { BtlSheet } from "@/lib/btl/sheet";
import type { BtlCardNumber } from "@/lib/btl/card";
import { BTL_DISCLAIMER } from "@/lib/btl/nation";

/**
 * "Buy to let" on a deal's sheet (Batch 28, Part F). Before the deal is
 * opened: its three numbers and flags, as the card shows them. Once opened:
 * every figure as a range, the lender's rent test, the benchmark it was
 * judged against and how many deals that rests on, the costs line by line,
 * the EPC note, the rules for its nation, and the disclaimer. Only the
 * stored buy-to-let card's figures: never a short-let one.
 */

function Fig({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <dd className="text-sm font-bold text-foreground">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function BuyToLetSection({ numbers, flags, sheet, widened, pending, report }: { numbers: BtlCardNumber[]; flags: string[]; sheet: BtlSheet | null; widened?: string | null; pending: boolean; report?: ReactNode }) {
  return (
    <section aria-labelledby="buy-to-let" className="mt-4 rounded-xl border border-border bg-card p-4">
      <h2 id="buy-to-let" className="text-sm font-semibold text-foreground">
        Buy to let <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">long-term tenants</span>
      </h2>
      {pending ? (
        <p className="mt-1 text-xs text-muted-foreground">The price changed, so its buy-to-let figures are being worked out again tonight.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {numbers.map((n) => (
              <Fig key={n.key} label={n.label} value={n.value} />
            ))}
          </dl>
          {flags.map((f) => (
            <p key={f} className="mt-1 text-[11px] font-medium text-warning">{f}</p>
          ))}
          {widened && <p className="mt-1 text-[11px] text-muted-foreground">{widened}</p>}
          {sheet ? (
            <>
              <p className="mt-3 text-sm font-medium text-foreground">{sheet.verdict}</p>
              {sheet.benchmark && <p className="mt-0.5 text-xs text-muted-foreground">{sheet.benchmark}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {sheet.rows.map((r) => (
                  <Fig key={r.label} label={r.label} value={r.value} sub={r.sub} />
                ))}
              </dl>
              <div className={"mt-3 rounded-lg p-3 text-xs " + (sheet.rentTest.pass ? "bg-primary/5 text-foreground" : "bg-destructive/10 text-destructive")}>
                <p className="font-semibold">{sheet.rentTest.text}</p>
                {sheet.rentTest.tight && <p className="mt-0.5 text-foreground">{sheet.rentTest.tight}</p>}
                <p className="mt-0.5 text-muted-foreground">{sheet.rate}</p>
              </div>
              <h3 className="mt-4 text-xs font-semibold text-foreground">Running costs a month, line by line</h3>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {sheet.costs.map((c) => (
                  <div key={c.label} className="flex justify-between gap-2 border-b border-border/60 py-0.5 last:border-0">
                    <dt className="text-muted-foreground">{c.label}</dt>
                    <dd className="font-medium text-foreground">{c.value}</dd>
                  </div>
                ))}
              </dl>
              {sheet.epc && <p className="mt-3 text-xs font-medium text-warning">{sheet.epc}</p>}
              <p className="mt-2 text-xs text-muted-foreground">{sheet.rules}</p>
              <p className="mt-2 text-xs font-medium text-foreground">{sheet.disclaimer}</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Open it for the costs line by line, the lender’s rent test and the deals it was judged against. {BTL_DISCLAIMER}</p>
          )}
        </>
      )}
      {report && <div className="mt-3 border-t border-border pt-3">{report}</div>}
    </section>
  );
}
