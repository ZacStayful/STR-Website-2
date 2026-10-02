"use client";

import { useState } from "react";
import { formatPence } from "@/lib/credit/deal-pricing";
import { notifyCreditChanged } from "@/lib/credit/client";

/** The one tap: switch on with a saved card, or a top-up Checkout that saves the card and switches it on. */
export function AutoTopupOneTap({ amountPence, thresholdPence, savedCard }: { amountPence: number; thresholdPence: number; savedCard: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "on" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setState("busy");
    setError(null);
    try {
      if (savedCard) {
        const res = await fetch("/api/billing/auto-topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPence, thresholdPence }) });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't switch it on.");
        setState("on");
        notifyCreditChanged();
        return;
      }
      const res = await fetch("/api/billing/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPence, autoTopup: true, nonce: crypto.randomUUID() }) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; savedCard?: boolean };
      if (data.savedCard) {
        window.location.reload();
        return;
      }
      if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't open the payment page.");
      window.location.assign(data.url);
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  if (state === "on") {
    return (
      <p role="status" className="text-[15px] text-[#1f2a1d]">
        Auto top-up is on: {formatPence(amountPence)} whenever you drop below {formatPence(thresholdPence)}.
      </p>
    );
  }
  return (
    <div>
      <p className="text-[15px] text-[#1f2a1d]">
        Turn on auto top-up: {formatPence(amountPence)} when you drop below {formatPence(thresholdPence)}, so your searches never stop.
      </p>
      {!savedCard && <p className="mt-2 text-sm text-[#6b7280]">You&rsquo;ll top up {formatPence(amountPence)} now, which saves your card for next time.</p>}
      <button
        type="button"
        onClick={go}
        disabled={state === "busy"}
        className="mt-4 w-full rounded-xl bg-[#2E3D2B] px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {state === "busy" ? "One moment…" : savedCard ? "Turn on auto top-up" : `Top up ${formatPence(amountPence)} and turn on auto top-up`}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[#a33a2b]">
          {error}
        </p>
      )}
    </div>
  );
}
