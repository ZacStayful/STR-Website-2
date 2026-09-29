"use client";

import { useEffect, useMemo, useState } from "react";
import { DISTANCE_MILES, MAX_RENT_PCM_RANGE, normalisePostcode, sliderMiles } from "@/lib/market/goals";
import { MIN_PROFIT_RANGE, type Option, type WhereAnswer } from "@/lib/profile/questions";
import type { QuizArea } from "@/lib/onboarding/server";
import { QuizPhoto } from "./QuizPhoto";

const gbp = (n: number) => `£${n.toLocaleString("en-GB")}`;

const CARD = "w-full min-h-14 rounded-xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-60";
const ON = "border-primary bg-primary/5";
const OFF = "border-border bg-card hover:bg-muted";

export function PrimaryButton({ children, onClick, disabled, type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="min-h-12 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
      {children}
    </button>
  );
}

/** One big tap card. With a photo it is a picture card (the risk and property-type questions). */
function ChoiceCard({ option, on, onClick, disabled }: { option: Option; on: boolean; onClick: () => void; disabled?: boolean }) {
  const photo = option.image && option.image !== "plain" ? option.image : null;
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} className={`${CARD} ${on ? ON : OFF}`}>
      {photo && (
        <div className="-mx-1 mb-2">
          <QuizPhoto image={photo} compact />
        </div>
      )}
      <span className="block text-base font-semibold text-foreground">{option.label}</span>
      {option.help ? <span className="mt-0.5 block text-sm text-muted-foreground">{option.help}</span> : null}
    </button>
  );
}

/** Tap one: it saves at once. */
export function SingleChoice({ options, value, onPick, busy }: { options: readonly Option[]; value: string | null; onPick: (value: string) => void; busy: boolean }) {
  const pictures = options.some((o) => o.image);
  return (
    <div className={pictures ? "grid grid-cols-2 gap-3" : "space-y-3"}>
      {options.map((o) => (
        <ChoiceCard key={o.value} option={o} on={value === o.value} onClick={() => onPick(o.value)} disabled={busy} />
      ))}
    </div>
  );
}

/** Tick all that apply, then Continue. */
/**
 * Tick all that apply. `allValue`: the option that ticks every other one
 * ("All of them"); it reads as ticked when they all are, and never goes
 * into the answer itself.
 */
export function MultiChoice({ options, value, onSubmit, busy, allValue }: { options: readonly Option[]; value: string[]; onSubmit: (values: string[]) => void; busy: boolean; allValue?: string }) {
  const others = options.filter((o) => o.value !== allValue).map((o) => o.value);
  const [picked, setPicked] = useState<string[]>(value.filter((v) => v !== allValue));
  const allOn = allValue !== undefined && others.length > 0 && others.every((v) => picked.includes(v));
  const toggle = (v: string) => {
    if (allValue !== undefined && v === allValue) return setPicked(allOn ? [] : others);
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };
  return (
    <div className="space-y-3">
      {options.map((o) => (
        <ChoiceCard key={o.value} option={o} on={o.value === allValue ? allOn : picked.includes(o.value)} onClick={() => toggle(o.value)} disabled={busy} />
      ))}
      <PrimaryButton onClick={() => onSubmit(picked)} disabled={busy || picked.length === 0}>
        Continue
      </PrimaryButton>
    </div>
  );
}

/** Presets or a typed amount (a rent ceiling, a minimum profit), then Continue. */
export function AmountChoice({ presets, value, min, max, step, suffix, placeholder, onSubmit, busy }: { presets: readonly number[]; value: number | null; min: number; max: number; step: number; suffix: string; placeholder: string; onSubmit: (value: number) => void; busy: boolean }) {
  const [raw, setRaw] = useState<string>(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const n = Number(raw.replace(/[£,\s]/g, ""));
  const valid = raw.trim() !== "" && Number.isFinite(n) && n >= min && n <= max;
  const submit = () => {
    if (!valid) return setError(`Enter an amount between ${gbp(min)} and ${gbp(max)}.`);
    setError(null);
    onSubmit(Math.round(n));
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button key={p} type="button" disabled={busy} aria-pressed={String(p) === raw} onClick={() => setRaw(String(p))} className={`min-h-12 rounded-lg border-2 px-3 text-sm font-semibold transition-colors ${String(p) === raw ? ON : OFF}`}>
            {gbp(p)}
            {suffix}
          </button>
        ))}
      </div>
      <label className="flex h-12 items-center rounded-lg border border-border bg-input/50 px-3">
        <span className="text-sm text-muted-foreground">£</span>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Amount"
          className="h-full w-full bg-transparent pl-1 text-base outline-none"
        />
        <span className="text-sm text-muted-foreground">{suffix.trim()}</span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <PrimaryButton onClick={submit} disabled={busy}>
        Continue
      </PrimaryButton>
    </div>
  );
}

export const RENT_INPUT = { min: MAX_RENT_PCM_RANGE.min, max: MAX_RENT_PCM_RANGE.max, step: 50 } as const;
export const PROFIT_INPUT = { min: MIN_PROFIT_RANGE.min, max: MIN_PROFIT_RANGE.max, step: 50 } as const;

/** Deposit % and mortgage rate, prefilled with the member's numbers (or ours). */
export function FinanceChoice({ value, onSubmit, busy }: { value: { depositPct: number; mortgageRatePct: number }; onSubmit: (v: { depositPct: number; mortgageRatePct: number }) => void; busy: boolean }) {
  const [deposit, setDeposit] = useState(String(value.depositPct));
  const [rate, setRate] = useState(String(value.mortgageRatePct));
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const d = Number(deposit);
    const r = Number(rate);
    if (!Number.isFinite(d) || d < 0 || d > 100) return setError("Enter a deposit between 0% and 100%.");
    if (!Number.isFinite(r) || r < 0 || r > 25) return setError("Enter a mortgage rate between 0% and 25%.");
    setError(null);
    onSubmit({ depositPct: d, mortgageRatePct: r });
  };
  const field = "mt-1 flex h-12 items-center rounded-lg border border-border bg-input/50 px-3";
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-foreground">Deposit</span>
        <span className={field}>
          <input type="number" inputMode="decimal" min={0} max={100} step={1} value={deposit} onChange={(e) => setDeposit(e.target.value)} className="h-full w-full bg-transparent text-base outline-none" />
          <span className="text-sm text-muted-foreground">%</span>
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Mortgage rate</span>
        <span className={field}>
          <input type="number" inputMode="decimal" min={0} max={25} step={0.1} value={rate} onChange={(e) => setRate(e.target.value)} className="h-full w-full bg-transparent text-base outline-none" />
          <span className="text-sm text-muted-foreground">%</span>
        </span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <PrimaryButton onClick={submit} disabled={busy}>
        Continue
      </PrimaryButton>
    </div>
  );
}

/** A searchable list of postcode areas with tick boxes: the ranked ones first. */
export function AreaPicker({ areas, picked, onChange, label }: { areas: QuizArea[]; picked: string[]; onChange: (codes: string[]) => void; label: string }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase() === q);
  }, [areas, query]);
  const toggle = (code: string) => onChange(picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code]);
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="quiz-area-search" className="text-sm font-medium text-foreground">
          {label}
        </label>
        <span className="text-xs text-muted-foreground">{picked.length} chosen</span>
      </div>
      <input id="quiz-area-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by town or postcode area" className="mt-1 h-12 w-full rounded-lg border border-border bg-input/50 px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
      <ul className="mt-2 max-h-64 divide-y divide-border overflow-auto rounded-lg border border-border bg-card">
        {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No area matches that.</li>}
        {shown.map((a) => {
          const on = picked.includes(a.code);
          return (
            <li key={a.code}>
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 ${on ? "bg-primary/5" : "hover:bg-muted"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(a.code)} className="h-5 w-5" />
                <span className="flex-1 text-sm font-medium text-foreground">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.code}</span>
                {a.score !== null && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{Math.round(a.score)}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {picked.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {picked.map((code) => {
            const a = areas.find((x) => x.code === code);
            return (
              <button key={code} type="button" onClick={() => toggle(code)} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/70" title="Remove">
                {a?.name ?? code} ×
              </button>
            );
          })}
        </p>
      )}
    </div>
  );
}

/** Pick areas, then Continue (where your units are, the cities you operate in). */
export function AreasChoice({ areas, value, onSubmit, busy, label }: { areas: QuizArea[]; value: string[]; onSubmit: (codes: string[]) => void; busy: boolean; label: string }) {
  const [picked, setPicked] = useState<string[]>(value);
  return (
    <div className="space-y-3">
      <AreaPicker areas={areas} picked={picked} onChange={setPicked} label={label} />
      <PrimaryButton onClick={() => onSubmit(picked)} disabled={busy || picked.length === 0}>
        Continue
      </PrimaryButton>
    </div>
  );
}

/**
 * "Where should we look?": a mode, then what it needs. Near me: a postcode
 * and a radius slider (10 to 100 miles in tens) whose every step re-counts
 * the matching deals through `onPreview`, before anything is saved.
 */
export function WhereChoice({ options, value, areas, onSubmit, onPreview, busy }: { options: readonly Option[]; value: WhereAnswer | null; areas: QuizArea[]; onSubmit: (v: WhereAnswer) => void; onPreview: (v: WhereAnswer) => void; busy: boolean }) {
  const [mode, setMode] = useState<string | null>(value?.mode ?? null);
  const [postcode, setPostcode] = useState<string>(value?.postcode ?? "");
  const [miles, setMiles] = useState<number>(sliderMiles(typeof value?.miles === "number" ? value.miles : null));
  const [picked, setPicked] = useState<string[]>(value?.areas ?? []);
  const [error, setError] = useState<string | null>(null);
  const needsHome = mode === "near" || mode === "near_plus_best";
  const pc = normalisePostcode(postcode);

  // The count follows the slider and the postcode, a moment after they settle (onPreview is stable: the quiz memoises it).
  useEffect(() => {
    if (!needsHome || !pc || !mode) return;
    const t = setTimeout(() => onPreview({ mode, postcode: pc, miles }), 300);
    return () => clearTimeout(t);
  }, [needsHome, pc, miles, mode, onPreview]);

  const choose = (m: string) => {
    setMode(m);
    setError(null);
    if (m === "anywhere") onSubmit({ mode: m });
  };
  const submit = () => {
    if (!mode) return setError("Choose where you want to look.");
    if (needsHome) {
      if (!pc) return setError("Enter a full UK postcode, like NG2 5GB.");
      return onSubmit({ mode, postcode: pc, miles });
    }
    if (mode === "areas") {
      if (picked.length === 0) return setError("Pick at least one area.");
      return onSubmit({ mode, areas: picked });
    }
    onSubmit({ mode });
  };

  return (
    <div className="space-y-3">
      {options.map((o) => (
        <ChoiceCard key={o.value} option={o} on={mode === o.value} onClick={() => choose(o.value)} disabled={busy} />
      ))}
      {needsHome && (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <label htmlFor="quiz-postcode" className="block text-sm font-medium text-foreground">
            Your postcode
          </label>
          <input id="quiz-postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} autoComplete="postal-code" autoCapitalize="characters" placeholder="e.g. NG2 5GB" className="mt-1 h-12 w-full rounded-lg border border-border bg-input/50 px-3 text-base uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          <label htmlFor="quiz-miles" className="mt-4 flex items-center justify-between text-sm font-medium text-foreground">
            <span>How far would you go?</span>
            <span className="font-semibold">Up to {miles} miles</span>
          </label>
          <input id="quiz-miles" type="range" min={DISTANCE_MILES.min} max={DISTANCE_MILES.max} step={DISTANCE_MILES.step} value={miles} onChange={(e) => setMiles(Number(e.target.value))} className="mt-2 h-10 w-full accent-primary" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{DISTANCE_MILES.min} miles</span>
            <span>{DISTANCE_MILES.max} miles</span>
          </div>
        </div>
      )}
      {mode === "areas" && <AreaPicker areas={areas} picked={picked} onChange={setPicked} label="Pick your areas" />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {mode && mode !== "anywhere" && (
        <PrimaryButton onClick={submit} disabled={busy}>
          Continue
        </PrimaryButton>
      )}
    </div>
  );
}

