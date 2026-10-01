"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordSiViewAction } from "./actions";
import { undoWhatIfAction, applyWhatIfAction } from "./what-if-actions";

export interface WhatIfItem {
  key: string;
  line: string;
  mustHave: boolean;
  /** 'use': saved for them; 'budget': a band they change themselves. */
  save: "use" | "budget";
  /** The best deal it would find (for "Show me"). */
  bestHref: string | null;
}

/**
 * Batch 22, Part F: "here's what would find you one". Up to three one-change
 * suggestions with real counts; Show me (a look), Use this (saved through the
 * quiz, then the list is chosen again) and Undo. When nothing helps, the plain
 * line.
 */
export function WhatIfSuggestions({ items, none, surface, tone = "dark", changeHref }: { items: WhatIfItem[]; none: string; surface: "reveal" | "header" | "today"; tone?: "dark" | "light"; changeHref: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [done, setDone] = useState<{ text: string; undo: { questionId: string; value: unknown } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = tone === "dark";
  const box = dark ? "rounded-xl bg-white/5 p-4 text-sm text-white" : "rounded-xl border border-border bg-card p-4 text-sm text-foreground";
  const btn = dark ? "rounded-md bg-[#B9D5C6] px-3 py-1.5 text-xs font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-50" : "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";
  const ghost = dark ? "rounded-md border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10" : "rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted";

  if (items.length === 0) return <p className={box}>{none}</p>;
  return (
    <section className={`${box} space-y-3`} aria-label="What would find you one">
      <p className="font-semibold">I couldn’t find a close match for everything you asked for.</p>
      {done && (
        <p role="status" className="font-semibold">
          {done.text}{" "}
          {done.undo && (
            <button
              type="button"
              disabled={busy}
              className="underline underline-offset-4"
              onClick={() =>
                start(async () => {
                  const r = await undoWhatIfAction(done.undo!);
                  if (!r.ok) setError(r.error);
                  else {
                    setDone(null);
                    router.refresh();
                  }
                })
              }
            >
              Undo
            </button>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.key} className="space-y-2">
            <p>{it.line}</p>
            {it.mustHave && <p className={dark ? "text-xs text-[#B9D5C6]" : "text-xs text-muted-foreground"}>This changes one of your must-haves.</p>}
            <div className="flex flex-wrap gap-2">
              {it.bestHref && (
                <Link href={it.bestHref} className={ghost} onClick={() => recordSiViewAction({ surface, step: "show_me" }).catch(() => {})}>
                  Show me
                </Link>
              )}
              {it.save === "use" ? (
                <button
                  type="button"
                  disabled={busy}
                  className={btn}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await applyWhatIfAction(it.key);
                      if (!r.ok) setError(r.error);
                      else {
                        setDone({ text: "Done — I’ve updated your answers.", undo: r.undo });
                        router.refresh();
                      }
                    })
                  }
                >
                  Use this
                </button>
              ) : (
                <Link href={changeHref} className={btn}>
                  Change my budget
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
