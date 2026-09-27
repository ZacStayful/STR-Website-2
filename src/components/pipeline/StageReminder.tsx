"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Storage blocked: show it.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Batch 10: once a deal has moved past Kept without a Full analysis, an
 * advisory line with the priced button and a Dismiss. It never blocks
 * anything. A dismissal holds for that stage only, so the next stage move
 * brings it back; at Offer it recommends PMI's second opinion too (the box
 * on the analysis is still never ticked for the member).
 */
export function StageReminder({ itemKey, stage, href, price, recommendPmi = false, metered = false }: { itemKey: string; stage: string; href: string; price: string; recommendPmi?: boolean; metered?: boolean }) {
  const key = `sf:analysis-reminder:${itemKey}:${stage}`;
  // Read from storage on the client; hidden on the server, so a dismissed reminder never flashes.
  const dismissed = useSyncExternalStore(subscribe, () => readDismissed(key), () => true);
  const [hidden, setHidden] = useState(false);
  if (dismissed || hidden) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* storage blocked: hide it for now */
    }
    setHidden(true);
  };
  const what = metered ? "a full report" : "the Full analysis";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground" role="note">
      <p className="min-w-0 flex-1 basis-56">
        {recommendPmi
          ? `Making an offer? Run ${what} first, with a second opinion from PMI: the exact figures for this property before you commit.`
          : `You haven’t run ${what} on this deal yet: the exact figures for this property, not the area estimate.`}
      </p>
      <Link href={href} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
        {metered ? "Full report" : "Full analysis"}{price ? ` · ${price}` : ""}
      </Link>
      <button type="button" onClick={dismiss} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted">
        Dismiss
      </button>
    </div>
  );
}
