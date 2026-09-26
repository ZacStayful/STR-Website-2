"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronUp, Circle } from "lucide-react";
import { notifyCreditChanged } from "@/lib/credit/client";
import type { ChecklistView } from "@/lib/today/checklist-server";
import { refreshChecklistAction } from "../actions";

interface ChecklistState {
  view: ChecklistView;
  /** Re-check the steps (after a Keep on this page); shows the "+£1" line if one landed. */
  refresh: () => void;
}

const ChecklistContext = createContext<ChecklistState | null>(null);

export function useChecklist(): ChecklistState | null {
  return useContext(ChecklistContext);
}

/** Holds the checklist for the whole Today page, so the cards can tell it when a Keep may have finished a step. */
export function ChecklistProvider({ initial, children }: { initial: ChecklistView; children: React.ReactNode }) {
  const [view, setView] = useState(initial);
  const [, startTransition] = useTransition();
  const refresh = useCallback(() => {
    // Nothing to check once the card has gone (all done, or past the first week).
    if (!view.visible) return;
    startTransition(async () => {
      const next = await refreshChecklistAction();
      if (!next) return;
      setView(next);
      if (next.reward) notifyCreditChanged();
    });
  }, [view.visible]);
  // A step paid while this page was rendering: the badge in the nav was drawn
  // before it, so tell it to look again.
  useEffect(() => {
    if (initial.reward) notifyCreditChanged();
  }, [initial.reward]);
  const value = useMemo(() => ({ view, refresh }), [view, refresh]);
  return <ChecklistContext.Provider value={value}>{children}</ChecklistContext.Provider>;
}

const COLLAPSED_KEY = "today-checklist-collapsed";

/** This device's remembered choice. Storage can be missing or blocked: then the card starts open. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function onStorage(changed: () => void): () => void {
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
}

/**
 * The first-week checklist card: five steps ticked from what the member
 * actually did, £1 each while they are new. Collapsible; the choice is kept
 * on this device only. Gone for good once every step is done or the first
 * week is over.
 */
export function Checklist() {
  const state = useChecklist();
  // The server draws it open; the browser then applies this device's choice.
  const remembered = useSyncExternalStore(onStorage, readCollapsed, () => false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const collapsed = chosen ?? remembered;

  if (!state || !state.view.visible) return null;
  const { view } = state;
  const toggle = () => {
    const next = !collapsed;
    setChosen(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* the choice just won't be remembered */
    }
  };

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby="first-week">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={!collapsed}>
        <span>
          <span id="first-week" className="block text-sm font-semibold text-foreground">
            Your first week · {view.doneCount} of {view.steps.length} done
          </span>
          {view.rewarded && <span className="block text-xs text-muted-foreground">£1 of credit for each step, this week only.</span>}
        </span>
        {collapsed ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
      </button>
      {view.reward && (
        <p className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground" role="status">
          {view.reward}
        </p>
      )}
      {!collapsed && (
        <ol className="mt-3 space-y-1.5">
          {view.steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              {s.done ? <CheckCircle2 size={16} className="shrink-0 text-primary" aria-hidden /> : <Circle size={16} className="shrink-0 text-muted-foreground" aria-hidden />}
              {s.done ? (
                <span className="text-muted-foreground line-through decoration-muted-foreground/50">{s.label}</span>
              ) : (
                <Link href={s.href} className="font-medium text-foreground underline-offset-4 hover:underline">
                  {s.label}
                </Link>
              )}
              <span className="sr-only">{s.done ? "(done)" : "(not done yet)"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
