"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DealReactionListenerContext, type DealReactionListener } from "@/app/deals/_components/deal-reaction-listener";
import { finishLine, isDone, tally } from "@/lib/today/day";
import type { DealReaction } from "@/lib/marketplace/reaction-state";
import { useChecklist } from "./Checklist";

/**
 * The day's cards, and the finish line that replaces them once every one has
 * been kept or passed. The cards themselves are Batch 3's DealCard, rendered
 * on the server and handed in as children; this only listens to their answers
 * (after the server has saved each one) and counts. Passing a card never
 * pulls in a replacement.
 *
 * A pass opens the card's "why?" picker. The finish line waits for it to
 * close, so the last card's reasons can still be given — they are what make
 * tomorrow's list better.
 */
export function TodayCards({
  ids,
  initial,
  children,
}: {
  /** The deals that count towards "done": every card with Keep / Pass. */
  ids: string[];
  /** Answers already given, from the server. */
  initial: Record<string, DealReaction>;
  children: React.ReactNode;
}) {
  // A Keep may finish "Keep 3 deals": the first-week checklist re-checks.
  const onKeep = useChecklist()?.refresh;
  const [answers, setAnswers] = useState<Map<string, DealReaction>>(() => new Map(Object.entries(initial)));
  const [awaiting, setAwaiting] = useState<Set<string>>(() => new Set());

  const listener = useMemo<DealReactionListener>(
    () => ({
      reacted(dealId, reaction) {
        setAnswers((prev) => {
          const next = new Map(prev);
          if (reaction) next.set(dealId, reaction);
          else next.delete(dealId);
          return next;
        });
        setAwaiting((prev) => {
          const next = new Set(prev);
          if (reaction === "pass") next.add(dealId);
          else next.delete(dealId);
          return next;
        });
        if (reaction === "keep") onKeep?.();
      },
      settled(dealId) {
        setAwaiting((prev) => {
          if (!prev.has(dealId)) return prev;
          const next = new Set(prev);
          next.delete(dealId);
          return next;
        });
      },
    }),
    [onKeep],
  );

  if (isDone(ids, answers) && awaiting.size === 0) {
    const t = tally(ids, answers);
    return (
      <section className="rounded-xl border border-border bg-card p-6 text-center" aria-live="polite">
        <p className="text-lg font-bold text-foreground">{finishLine(t)}</p>
        <p className="mt-1 text-sm text-muted-foreground">New deals tomorrow morning.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/deals" className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Browse all deals
          </Link>
          <Link href="/deals?view=kept" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
            Your kept deals
          </Link>
        </div>
      </section>
    );
  }

  return <DealReactionListenerContext.Provider value={listener}>{children}</DealReactionListenerContext.Provider>;
}
