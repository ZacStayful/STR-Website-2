"use client";

import { useState } from "react";
import type { LineItemState } from "./lineItemDefaults";
import { CATEGORY_ORDER } from "./lineItemDefaults";

interface Props {
  items: LineItemState[];
  propertyAddress: string;
  bedrooms: number;
  furnishingLabel: string;
  onReset: () => void;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function QuoteSummary({ items, propertyAddress, bedrooms, furnishingLabel, onReset }: Props) {
  const [copied, setCopied] = useState(false);
  const activeItems = items.filter((i) => i.active && i.qty > 0 && i.unitCost > 0);
  const grandTotal = activeItems.reduce((sum, i) => sum + i.qty * i.unitCost, 0);

  // Subtotals per category
  const subtotals = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    total: activeItems.filter((i) => i.category === cat).reduce((s, i) => s + i.qty * i.unitCost, 0),
  })).filter((s) => s.total > 0);

  const handleReset = () => {
    if (window.confirm("Reset all line items to defaults for the current furnishing state? Manual edits will be lost.")) {
      onReset();
    }
  };

  const handleCopy = async () => {
    const lines: string[] = [
      `Stayful Setup Cost Quote`,
      propertyAddress ? `Property: ${propertyAddress}` : "",
      `${furnishingLabel} · ${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`,
      "",
    ].filter(Boolean);

    for (const cat of CATEGORY_ORDER) {
      const catItems = activeItems.filter((i) => i.category === cat);
      if (catItems.length === 0) continue;
      lines.push(`== ${cat} ==`);
      for (const it of catItems) {
        const total = it.qty * it.unitCost;
        lines.push(`  ${it.name}: ${it.qty} × ${gbp(it.unitCost)} = ${gbp(total)}`);
      }
      lines.push("");
    }
    lines.push(`TOTAL: ${gbp(grandTotal)} (${activeItems.length} items)`);

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied — silently ignore
    }
  };

  return (
    <div className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
        Setup Cost Summary
      </p>

      {/* Subtotals */}
      <div className="mt-3 space-y-1.5">
        {subtotals.map((s) => (
          <div key={s.category} className="flex justify-between text-xs">
            <span className="text-primary-foreground/70">{s.category}</span>
            <span className="font-semibold text-primary-foreground">{gbp(s.total)}</span>
          </div>
        ))}
        {subtotals.length === 0 && (
          <p className="text-xs text-primary-foreground/50 italic">No items selected</p>
        )}
      </div>

      {/* Grand total */}
      <div className="mt-4 border-t border-primary-foreground/20 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-primary-foreground">Grand Total</span>
          <span className="text-2xl font-bold text-primary-foreground">{gbp(grandTotal)}</span>
        </div>
        <p className="mt-1 text-right text-[10px] text-primary-foreground/60">
          {activeItems.length} item{activeItems.length === 1 ? "" : "s"} included
        </p>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          disabled={activeItems.length === 0}
          className="flex-1 rounded-md border border-primary-foreground/25 bg-primary-foreground/10 px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/20 disabled:opacity-40"
        >
          {copied ? "Copied ✓" : "Copy quote"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="flex-1 rounded-md border border-primary-foreground/25 px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
        >
          Reset defaults
        </button>
      </div>
    </div>
  );
}
