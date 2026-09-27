"use client";

import { useState } from "react";
import { creditFetch, notifyCreditChanged } from "@/lib/credit/client";
import { priceText, type PriceLabel } from "@/lib/credit/deal-pricing";

/**
 * "Add a second opinion from PMI" on a finished Full analysis
 * (POST /api/reports/[id]/pmi). The price is this member's own
 * (src/lib/credit/quote-server.ts) and is sent back as confirmed: a changed
 * price is refused rather than charged. Out of credit opens the usual modal.
 */
export function PmiAddonCard({ reportId, label }: { reportId: string; label: PriceLabel }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const price = priceText(label);

  async function add() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await creditFetch(`/api/reports/${encodeURIComponent(reportId)}/pmi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label.state === "admin" ? { quotedBasePence: 0 } : { quotedBasePence: label.basePence, quotedFacePence: label.facePence }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.ok) {
        notifyCreditChanged();
        window.location.reload();
        return;
      }
      setMessage(data.error ?? "Something went wrong. Nothing was charged; please try again.");
      if (data.code === "price_changed" || data.code === "already_done") setTimeout(() => window.location.reload(), 2500);
    } catch {
      setMessage("We couldn’t reach the server. Nothing was charged; please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <p className="text-sm font-semibold text-foreground">Add a second opinion from PMI{price ? ` · ${price}` : ""}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        An independent revenue estimate for this property from Property Market Intel, set beside ours. Recommended before you make an offer. Charged only if PMI gives one.
      </p>
      {label.split && <p className="mt-1 text-xs text-muted-foreground">Paid as {label.split}.</p>}
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Asking PMI…" : label.state === "short" ? `Top up to add it · ${label.main}` : `Add it${price ? ` · ${price}` : ""}`}
      </button>
      {message && <p className="mt-2 text-sm text-destructive">{message}</p>}
    </div>
  );
}
