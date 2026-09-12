"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatGbp, notifyCreditChanged } from "@/lib/credit/client";
import { useCreditOptional } from "./CreditProvider";

/**
 * The £10 / £25 / £50 buttons. With a saved card the charge is one click and
 * the balance updates in place; otherwise the member is sent to Stripe
 * Checkout, which saves the card for next time.
 */
export function TopupButtons({ presets, hasSavedCard, size = "default", onDone, autoFocusFirst }: { presets: number[]; hasSavedCard: boolean; size?: "default" | "lg" | "sm"; onDone?: (amountPence: number) => void; autoFocusFirst?: boolean }) {
  const credit = useCreditOptional();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function topup(amountPence: number) {
    setBusy(amountPence);
    setError(null);
    try {
      const res = await fetch("/api/billing/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPence, nonce: crypto.randomUUID() }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't complete the top-up. Please try again.");
        return;
      }
      notifyCreditChanged();
      credit?.toast(`Topped up ${formatGbp(amountPence)}`);
      onDone?.(amountPence);
    } catch {
      setError("Couldn't reach the billing service. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {presets.map((p, i) => (
          <Button key={p} type="button" variant="outline" size={size} disabled={busy !== null} onClick={() => void topup(p)} autoFocus={autoFocusFirst && i === 0}>
            {busy === p ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {formatGbp(p).replace(".00", "")}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hasSavedCard ? "Charged to your saved card in one click." : "You'll be taken to a secure checkout; your card is saved for one-click top-ups next time."}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
