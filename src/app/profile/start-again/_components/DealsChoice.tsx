"use client";

import { useState } from "react";
import type { DealSummary } from "@/app/my-deals/_lib/rows";

type Choice = "keep_all" | "clear_all" | "choose";

/**
 * Batch 22d: what happens to the deals tracked for this profile. Every listed
 * deal is posted as `shown` (only those can be cleared); under "Choose which
 * to keep" the ticked ones are posted as `keep`.
 */
export function DealsChoice({ deals }: { deals: DealSummary[] }) {
  const [choice, setChoice] = useState<Choice>("keep_all");
  const option = (value: Choice, label: string, hint?: string) => (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type="radio" name="deals" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1 h-4 w-4" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
  return (
    <div className="space-y-2">
      {deals.map((d) => (
        <input key={d.key} type="hidden" name="shown" value={d.key} />
      ))}
      {option("keep_all", "Keep all")}
      {option("clear_all", "Clear all")}
      {option("choose", "Choose which to keep", "Ticked ones stay.")}
      {choice === "choose" && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {deals.map((d) => (
            <li key={d.key}>
              <label className="flex min-h-12 items-center gap-3 px-3 py-2">
                <input type="checkbox" name="keep" value={d.key} defaultChecked className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{d.title}</span>
                  <span className="block text-xs text-muted-foreground">{d.stage}</span>
                </span>
                {d.price && <span className="shrink-0 text-sm font-semibold text-foreground">{d.price}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
