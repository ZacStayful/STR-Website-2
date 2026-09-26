"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, X } from "lucide-react";
import { nextReaction, type DealReaction } from "@/lib/marketplace/reaction-state";
import type { ReasonGroupView } from "@/lib/marketplace/reactions";
import { savePassReasonsAction, setDealReactionAction, type ReactionActionResult } from "../actions";

type Stage = "card" | "why" | "thanks" | "gone";

const ERRORS: Record<Exclude<ReactionActionResult, { ok: true }>["error"], string> = {
  signed_out: "Sign in again to do that.",
  missing: "This deal is no longer available.",
  gone: "This deal has gone off the market.",
  failed: "That didn’t save. Please try again.",
};

/**
 * The interactive shell of a DealCard: Keep and Pass, and after a Pass the
 * optional "why?" picker in the card's place. The card body is rendered on
 * the server and handed in as `children`; nothing about the deal except its
 * id reaches this component.
 *
 * Every tap sends the state the member is asking for, never "toggle", and the
 * buttons are disabled while a request is in flight, so a double tap cannot
 * flip a reaction back or write it twice. Nothing here costs credit.
 */
export function DealCardFrame({
  dealId,
  initialReaction,
  reasonGroups,
  share,
  children,
}: {
  dealId: string;
  initialReaction: DealReaction | null;
  reasonGroups: ReasonGroupView[];
  /** The share button, rendered by the caller. */
  share?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [reaction, setReaction] = useState<DealReaction | null>(initialReaction);
  const [stage, setStage] = useState<Stage>("card");
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function react(tapped: DealReaction) {
    if (pending) return;
    const before = reaction;
    const target = nextReaction(before, tapped);
    setError(null);
    setReaction(target);
    // A new pass takes the card off the grid and asks why, straight away.
    if (target === "pass") setStage("why");
    startTransition(async () => {
      const res = await setDealReactionAction(dealId, target);
      if (!res.ok) {
        setReaction(before);
        setStage("card");
        setError(ERRORS[res.error]);
      }
    });
  }

  function undoPass() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await setDealReactionAction(dealId, null);
      if (res.ok) {
        setReaction(null);
        setReasons([]);
        setStage("card");
      } else {
        setError(ERRORS[res.error]);
      }
    });
  }

  function saveReasons() {
    if (pending || reasons.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await savePassReasonsAction(dealId, reasons);
      if (res.ok) setStage("thanks");
      else setError(ERRORS.failed);
    });
  }

  if (stage === "gone") return null;

  if (stage === "why" || stage === "thanks") {
    return (
      <li className="relative flex flex-col rounded-xl border border-dashed border-border bg-card p-3" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Passed ·{" "}
            <button type="button" onClick={undoPass} disabled={pending} className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50">
              Undo
            </button>
          </p>
          <button type="button" onClick={() => setStage("gone")} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
        {stage === "thanks" ? (
          <p className="mt-3 text-sm font-medium text-foreground">Thanks, this shapes your daily picks.</p>
        ) : (
          <>
            <p className="mt-2 text-sm font-semibold text-foreground">Why? Helps us find better deals</p>
            <div className="mt-2 space-y-2">
              {reasonGroups.map((g) => (
                <div key={g.key}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {g.reasons.map((r) => {
                      const on = reasons.includes(r.key);
                      return (
                        <button
                          key={r.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setReasons((cur) => (on ? cur.filter((k) => k !== r.key) : [...cur, r.key]))}
                          className={"rounded-full border px-2 py-0.5 text-[11px] " + (on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={saveReasons} disabled={pending || reasons.length === 0} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
                Save
              </button>
              <button type="button" onClick={() => setStage("gone")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                Skip
              </button>
            </div>
          </>
        )}
        {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      </li>
    );
  }

  const kept = reaction === "keep";
  const passed = reaction === "pass";
  const btn = "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50";
  return (
    <li className="relative overflow-hidden rounded-xl border border-border bg-card">
      {children}
      {kept && <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground shadow">Kept</span>}
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
        <button type="button" onClick={() => react("keep")} disabled={pending} aria-pressed={kept} className={btn + (kept ? " border-primary bg-primary/10 text-primary" : " border-border hover:bg-muted")}>
          {kept ? <BookmarkCheck size={13} aria-hidden /> : <Bookmark size={13} aria-hidden />}
          {kept ? "Kept" : "Keep"}
        </button>
        <button type="button" onClick={() => react("pass")} disabled={pending} aria-pressed={passed} className={btn + (passed ? " border-primary bg-primary/10 text-primary" : " border-border hover:bg-muted")}>
          <X size={13} aria-hidden />
          {passed ? "Passed · undo" : "Pass"}
        </button>
        {share && <span className="ml-auto">{share}</span>}
      </div>
      {error && <p className="px-3 pb-2 text-[11px] text-destructive">{error}</p>}
    </li>
  );
}
