"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { lineCost, type LineStatus, type WorksLine } from "@/lib/project/costing";
import { evaluateMember, nextOwnKey, MAX_OWN_LINES, OWN_LABEL_MAX, type MemberContext } from "@/lib/project/member-figures";
import { saveProjectWorkingAction, unlockProjectWorkingAction } from "../project-actions";
import { pingProject } from "./ProjectViewPing";

/**
 * The member's own working on a Project deal (Batch 17, Part G): change any
 * line's quantity, cost a unit or whether it is needed, add lines of their
 * own, and see the figures move as they type (the same sums as our
 * estimate). Save keeps a version; Lock keeps one version as their figures
 * (the Full analysis uses it). Private to the member, and free.
 */

const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
const span = (low: number, high: number) => (Math.round(low) === Math.round(high) ? gbp(high) : `${gbp(low)}–${gbp(high)}`);

const STATUS_OPTIONS: { value: LineStatus; label: string }[] = [
  { value: "needed", label: "Needed" },
  { value: "cant_tell", label: "Not sure" },
  { value: "not_needed", label: "Not needed" },
];

export function ProjectWorking({ dealId, baseLines, savedLines, savedVersion, locked: lockedAtLoad, ctx }: { dealId: string; baseLines: WorksLine[]; savedLines: WorksLine[] | null; savedVersion: number | null; locked: boolean; ctx: MemberContext }) {
  const [lines, setLines] = useState<WorksLine[]>(() => (savedLines ?? baseLines).map((l) => ({ ...l, photos: [...l.photos] })));
  const [version, setVersion] = useState<number | null>(savedVersion);
  const [locked, setLocked] = useState(lockedAtLoad);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const opened = useRef(false);
  const edited = useRef(new Set<string>());

  const figures = useMemo(() => evaluateMember(lines, ctx), [lines, ctx]);
  const ours = useMemo(() => evaluateMember(baseLines, ctx), [baseLines, ctx]);

  const touch = () => {
    if (!opened.current) {
      opened.current = true;
      pingProject(dealId, "working");
    }
  };
  const change = (key: string, patch: Partial<Pick<WorksLine, "quantity" | "unitCost" | "status" | "label">>) => {
    touch();
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
    setNote(null);
    if (!edited.current.has(key)) {
      edited.current.add(key);
      pingProject(dealId, "line_edit", key);
    }
  };
  const add = () => {
    touch();
    const key = nextOwnKey(lines);
    setLines((prev) => [...prev, { key, label: "Your line", unit: "job", unitCost: 0, quantity: 1, status: "needed", valueRole: "hidden", reason: null, photos: [], own: true }]);
    setDirty(true);
    pingProject(dealId, "line_add", key);
  };
  const remove = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setDirty(true);
  };
  const reset = () => {
    setLines(baseLines.map((l) => ({ ...l, photos: [...l.photos] })));
    setDirty(true);
    setNote(null);
  };
  const save = (lock: boolean) =>
    start(async () => {
      const payload = lines.map((l) => ({ key: l.key, label: l.own ? l.label : undefined, quantity: l.quantity, unitCost: l.unitCost, status: l.status }));
      const res = await saveProjectWorkingAction(dealId, payload, lock);
      if (!res.ok) {
        setNote(res.error === "bad_lines" ? "Something in a line did not read: check the numbers and the names of your own lines." : "We could not save your figures just now. Try again in a moment.");
        return;
      }
      setVersion(res.version);
      setLocked(res.locked);
      setDirty(false);
      setNote(lock ? "Locked. Your Full analysis uses these figures." : "Saved.");
    });
  const unlock = () =>
    start(async () => {
      const res = await unlockProjectWorkingAction(dealId);
      if (!res.ok) {
        setNote("We could not unlock your figures just now.");
        return;
      }
      setLocked(false);
      setNote("Unlocked. Your saved versions are kept.");
    });

  const own = lines.filter((l) => l.own).length;
  return (
    <div className="mt-5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Your working</h3>
        <p className="text-[11px] text-muted-foreground">
          Private to you. {locked ? `Locked (version ${version}).` : version ? `Saved (version ${version})${dirty ? ", with changes not saved" : ""}.` : dirty ? "Not saved yet." : "Our estimate, until you change it."}
        </p>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Line</th>
              <th className="pr-2 font-medium">Quantity</th>
              <th className="pr-2 font-medium">£ a unit</th>
              <th className="pr-2 font-medium">Needed?</th>
              <th className="pr-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-border align-middle">
                <td className="py-1 pr-2">
                  {l.own ? (
                    <input aria-label="Your line" value={l.label} maxLength={OWN_LABEL_MAX} disabled={locked} onChange={(ev) => change(l.key, { label: ev.target.value })} className="w-full rounded border border-border bg-background px-1.5 py-1" />
                  ) : (
                    <span className="font-medium text-foreground">{l.label}</span>
                  )}
                </td>
                <td className="pr-2">
                  <input aria-label={`${l.label}: quantity`} type="number" inputMode="decimal" min={0} max={999} step="any" value={l.quantity} disabled={locked} onChange={(ev) => change(l.key, { quantity: Math.max(0, Number(ev.target.value) || 0) })} className="w-16 rounded border border-border bg-background px-1.5 py-1" />
                </td>
                <td className="pr-2">
                  <input aria-label={`${l.label}: pounds a unit`} type="number" inputMode="numeric" min={0} max={250000} step={10} value={l.unitCost} disabled={locked} onChange={(ev) => change(l.key, { unitCost: Math.max(0, Math.round(Number(ev.target.value) || 0)) })} className="w-24 rounded border border-border bg-background px-1.5 py-1" />
                </td>
                <td className="pr-2">
                  <select aria-label={`${l.label}: needed`} value={l.status} disabled={locked} onChange={(ev) => change(l.key, { status: ev.target.value as LineStatus })} className="rounded border border-border bg-background px-1 py-1">
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {l.own && !locked && (
                    <button type="button" onClick={() => remove(l.key)} className="ml-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline">Remove</button>
                  )}
                </td>
                <td className={"pr-2 text-right " + (l.status === "not_needed" ? "text-muted-foreground line-through" : "text-foreground")}>{gbp(lineCost(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!locked && own < MAX_OWN_LINES && (
        <button type="button" onClick={add} className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Add a line</button>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dd className="text-sm font-bold text-foreground">{span(figures.works.low, figures.works.high)}</dd>
          <dt className="text-muted-foreground">Works (ours {span(ours.works.low, ours.works.high)})</dt>
        </div>
        <div>
          <dd className="text-sm font-bold text-foreground">{gbp(figures.value.value)}</dd>
          <dt className="text-muted-foreground">Value after works</dt>
        </div>
        <div>
          <dd className={"text-sm font-bold " + (figures.test.passes ? "text-foreground" : "text-destructive")}>{gbp(figures.test.valueAdded)}</dd>
          <dt className="text-muted-foreground">Value added{figures.test.passes ? "" : ": under the bar"}</dt>
        </div>
        <div>
          <dd className="text-sm font-bold text-foreground">{span(figures.finance.cash.low, figures.finance.cash.high)}</dd>
          <dt className="text-muted-foreground">Cash needed</dt>
        </div>
        {figures.finance.refinance && (
          <div>
            <dd className="text-sm font-bold text-foreground">{span(figures.finance.refinance.moneyLeftIn.low, figures.finance.refinance.moneyLeftIn.high)}</dd>
            <dt className="text-muted-foreground">Money left in after refinance</dt>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {locked ? (
          <button type="button" disabled={pending} onClick={unlock} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">Unlock my figures</button>
        ) : (
          <>
            <button type="button" disabled={pending} onClick={() => save(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">Save</button>
            <button type="button" disabled={pending} onClick={() => save(true)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">Lock these figures</button>
            <button type="button" disabled={pending} onClick={reset} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Back to our estimate</button>
          </>
        )}
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Saving and locking are free. Every version is kept; one is locked at a time.</p>
    </div>
  );
}
