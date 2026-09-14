"use client";

import { useRef } from "react";
import { TAB_KEYS, TAB_LABELS, type TabKey } from "@/lib/market/tab-model";

/** The market page's tab strip: a real tablist with arrow-key movement. */
export function MarketTabs({ tab, onTab, dealsCount }: { tab: TabKey; onTab: (t: TabKey) => void; dealsCount: number }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = TAB_KEYS.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    onTab(TAB_KEYS[next]);
    refs.current[next]?.focus();
  };
  return (
    <nav className="mx2-tabs" role="tablist" aria-label="Market sections">
      {TAB_KEYS.map((k, i) => (
        <button
          key={k}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`mx2-tab-${k}`}
          aria-selected={tab === k}
          aria-controls="mx2-tabpanel"
          tabIndex={tab === k ? 0 : -1}
          className={"mx2-tab" + (tab === k ? " is-on" : "")}
          onClick={() => onTab(k)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {TAB_LABELS[k]}{k === "deals" && dealsCount > 0 ? <span className="mx2-tab-count">{dealsCount}</span> : null}
        </button>
      ))}
    </nav>
  );
}
