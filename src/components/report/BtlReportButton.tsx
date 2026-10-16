"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { creditFetch, notifyCreditChanged, openOutOfCredit } from "@/lib/credit/client";
import { priceText, type PriceLabel } from "@/lib/credit/deal-pricing";

/**
 * Batch 28, Part G: "Buy-to-let report · £2" (POST /api/btl-report). The
 * price is this member's own (the welcome price where it applies) and is
 * sent back as confirmed: a changed price is refused, never charged. Charged
 * once, only when the report is made. Out of credit opens the usual modal.
 * With a report already made: a link to it instead.
 */
export function BtlReportButton({ dealId = null, url = null, label, note = null, reportId = null }: { dealId?: string | null; url?: string | null; label: PriceLabel; note?: string | null; reportId?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const price = priceText(label);
  if (reportId) {
    return (
      <Link href={`/btl-report/${reportId}`} className="inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
        Open your buy-to-let report
      </Link>
    );
  }

  async function run() {
    if (busy) return;
    if (label.state === "short") {
      openOutOfCredit({ action: "btl_report", requiredPence: label.basePence, mode: "topup" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await creditFetch("/api/btl-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(dealId ? { dealId } : { url }), ...(label.state === "admin" ? { quotedBasePence: 0 } : { quotedBasePence: label.basePence, quotedFacePence: label.facePence }) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; reportId?: string };
      if (res.ok && data.reportId) {
        notifyCreditChanged();
        router.push(`/btl-report/${data.reportId}`);
        return;
      }
      setMessage(data.error ?? "Something went wrong. Nothing was charged; please try again.");
      if (data.code === "price_changed") setTimeout(() => window.location.reload(), 2500);
    } catch {
      setMessage("We couldn’t reach the server. Nothing was charged; please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-foreground">Buy-to-let report{price ? ` · ${price}` : ""}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">A rent valuation, a sale valuation, sold prices nearby, the EPC, flood and planning checks, and the buy-to-let figures with all of it in. Charged only once it’s made.</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">Your {note}.</p>}
      {label.split && <p className="mt-0.5 text-xs text-muted-foreground">Paid as {label.split}.</p>}
      <button type="button" onClick={run} disabled={busy} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {busy ? "Making your report…" : label.state === "short" ? `Top up to run it · ${label.main}` : `Run it${price ? ` · ${price}` : ""}`}
      </button>
      {message && <p className="mt-2 text-xs text-destructive">{message}</p>}
    </div>
  );
}
