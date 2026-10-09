"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notForMeAction, undoNotForMeAction } from "../actions";

/** How long "Undo" stays on screen after "Not for me". */
const UNDO_MS = 5_000;

/**
 * Batch 25: a My deals row that Stayful Intelligence saved for the member.
 * It carries the label until they open the deal or move its stage, and a
 * one-tap "Not for me" — no confirm screen — that takes the row away with an
 * Undo for five seconds. "Not for me" is the member's own Pass (it teaches
 * tailoring, and counts as activity); Undo puts the save and the label back.
 */
export function SavedForYou({ dealId, children }: { dealId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"saved" | "removed" | "error">("saved");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (state !== "removed") return;
    // Once Undo has gone, the page catches up (the deal is in Passed).
    const t = setTimeout(() => router.refresh(), UNDO_MS);
    return () => clearTimeout(t);
  }, [state, router]);

  if (state === "removed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3 text-sm" role="status">
        <span className="text-muted-foreground">Removed from your deals. I&rsquo;ll learn from that.</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await undoNotForMeAction(dealId);
              setState(r.ok ? "saved" : "error");
              router.refresh();
            })
          }
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">Saved for you by Stayful Intelligence</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await notForMeAction(dealId);
              setState(r.ok ? "removed" : "error");
            })
          }
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          Not for me
        </button>
      </div>
      {state === "error" && <p className="mb-1 text-xs text-destructive">That didn&rsquo;t save. Please try again.</p>}
      {children}
    </div>
  );
}
