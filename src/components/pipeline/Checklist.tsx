"use client";

import { useState, useTransition } from "react";
import type { StepKind } from "@/lib/pipeline/types";
import { setChecklistItemAction } from "@/app/my-deals/next-step-actions";

/** A checklist whose ticks are saved per deal, straight away, and put back if the save fails. */
export function Checklist({ itemKey, stage, kind, items }: { itemKey: string; stage: "viewing" | "secured"; kind: StepKind; items: { id: string; text: string; ticked: boolean }[] }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(items.filter((i) => i.ticked).map((i) => i.id)));
  const [error, setError] = useState(false);
  const [, start] = useTransition();

  function toggle(id: string) {
    const next = !ticked.has(id);
    const apply = (on: boolean) =>
      setTicked((prev) => {
        const s = new Set(prev);
        if (on) s.add(id);
        else s.delete(id);
        return s;
      });
    apply(next);
    setError(false);
    start(async () => {
      const res = await setChecklistItemAction(itemKey, stage, kind, id, next);
      if (!res.ok) {
        apply(!next);
        setError(true);
      }
    });
  }

  return (
    <div>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={ticked.has(i.id)} onChange={() => toggle(i.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
              <span className={ticked.has(i.id) ? "text-muted-foreground line-through" : "text-foreground"}>{i.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {ticked.size} of {items.length} done{error ? " · that tick didn’t save, please try again" : ""}
      </p>
    </div>
  );
}
