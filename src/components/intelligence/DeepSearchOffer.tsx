"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatPence } from "@/lib/credit/deal-pricing";
import { notifyCreditChanged } from "@/lib/credit/client";
import { recordSiViewAction } from "./actions";

/**
 * Batch 22, Part G: the paid deep search, offered as one quiet line when
 * there is no strong match. The quote is the server's; starting re-quotes it
 * and reserves the "up to" first.
 */
export function DeepSearchOffer({ aboutBasePence, upToBasePence, firstDiscount, surface }: { aboutBasePence: number; upToBasePence: number; firstDiscount: boolean; surface: "reveal" | "header" }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    recordSiViewAction({ surface, step: "deep_line" }).catch(() => {});
  }, [surface]);
  return (
    <div id="si-deep-search" className="scroll-mt-20 rounded-xl bg-white/5 p-4 text-sm text-white">
      <p>
        Want me to check the latest listings in your areas and nearby? About {formatPence(aboutBasePence)}, up to {formatPence(upToBasePence)}
        {firstDiscount ? " — half price the first time" : ""}.
      </p>
      {msg && (
        <p className="mt-2 text-[#B9D5C6]" role="status">
          {msg}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        className="mt-3 rounded-md bg-[#B9D5C6] px-3 py-1.5 text-xs font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await fetch("/api/deep-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", upToBasePence }) });
            const body = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
            if (body.ok) {
              setMsg("I’m on it. I’ll add anything better here and in Today.");
              notifyCreditChanged();
              router.refresh();
            } else if (body.reason === "credit") setMsg("You need a little more credit for this. Top up in Account → Billing.");
            else if (body.reason === "busy") setMsg("I’m already searching for you — it won’t be long.");
            else if (body.reason === "quote_changed") {
              setMsg("The price has changed — here’s the new one.");
              router.refresh();
            } else setMsg("That didn’t start. Please try again in a minute.");
          })
        }
      >
        Run it
      </button>
    </div>
  );
}
