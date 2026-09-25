"use client";

import { useActionState, useMemo, useState } from "react";
import { completeWelcomeAction, skipWelcomeAction, type WelcomeState } from "./actions";
import { BUDGET_LABELS, type Budget } from "@/lib/market/filters";
import { normalisePostcode, parseMaxRentPcm, MAX_RENT_PCM_RANGE, type MaxDistance, type SourcingKind } from "@/lib/market/goals";
import { WELCOME_FIELDS as F, DISTANCE_OPTIONS, RENT_PRESETS_PCM, WHERE_LABELS, type WhereChoice, type WelcomeArea } from "@/lib/onboarding/answers";

const KIND_OPTIONS: { value: SourcingKind; label: string; help: string }[] = [
  { value: "sale", label: "Properties to buy", help: "Buy-to-let deals that earn more as a short let" },
  { value: "rent", label: "Rent-to-rent", help: "Rent from a landlord and let it short-term" },
  { value: "both", label: "Both", help: "Show me everything that stacks up" },
];

const BUDGET_BANDS: Exclude<Budget, "any">[] = ["u200", "200-350", "350-500", "500+"];

const WHERE_OPTIONS: { value: WhereChoice; help: string }[] = [
  { value: "near", help: "Deals within 25, 50 or 100 miles of home" },
  { value: "areas", help: "Choose from Stayful’s ranked areas" },
  { value: "anywhere", help: "No area limit, just the strongest numbers" },
];

const gbp = (n: number) => `£${n.toLocaleString("en-GB")}`;

const initial: WelcomeState = { error: null };

/** Big, full-width choice. `on` is the selected state. */
function Choice({ on, onClick, label, help }: { on: boolean; onClick: () => void; label: string; help?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`w-full min-h-14 rounded-xl border-2 px-4 py-3 text-left transition-colors ${on ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}
    >
      <span className="block text-base font-semibold text-foreground">{label}</span>
      {help ? <span className="mt-0.5 block text-sm text-muted-foreground">{help}</span> : null}
    </button>
  );
}

/** Smaller pill for a row of values (distances, rent presets). */
function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`min-h-12 flex-1 rounded-lg border-2 px-3 text-sm font-semibold transition-colors ${on ? "border-primary bg-primary/5 text-foreground" : "border-border bg-card text-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

export function WelcomeWizard({ next, areas }: { next: string; areas: WelcomeArea[] }) {
  const [state, formAction, pending] = useActionState(completeWelcomeAction, initial);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<SourcingKind | null>(null);
  // null = not answered yet; "" = "Not sure yet".
  const [budget, setBudget] = useState<string | null>(null);
  const [rent, setRent] = useState<string | null>(null);
  const [where, setWhere] = useState<WhereChoice | null>(null);
  const [postcode, setPostcode] = useState("");
  const [distance, setDistance] = useState<MaxDistance | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [areaQuery, setAreaQuery] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const wantsSale = kind !== null && kind !== "rent";
  const wantsRent = kind !== null && kind !== "sale";

  const shownAreas = useMemo(() => {
    const q = areaQuery.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase() === q);
  }, [areas, areaQuery]);

  const togglePicked = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  const go = (to: 1 | 2 | 3) => {
    setLocalError(null);
    setStep(to);
  };

  const chooseKind = (k: SourcingKind) => {
    setKind(k);
    go(2);
  };

  const continueFromBudget = () => {
    if (wantsSale && budget === null) return setLocalError("Choose a budget, or “Not sure yet”.");
    if (wantsRent) {
      if (rent === null) return setLocalError("Choose a rent ceiling, or “Not sure yet”.");
      if (rent !== "" && parseMaxRentPcm(rent) === null) return setLocalError(`Enter a monthly rent between ${gbp(MAX_RENT_PCM_RANGE.min)} and ${gbp(MAX_RENT_PCM_RANGE.max)}.`);
    }
    go(3);
  };

  /** The last check before the server does the same again. */
  const validateFinal = (): string | null => {
    if (!kind) return "Choose what you are looking for.";
    if (!where) return "Choose where you want to look.";
    if (where === "near") {
      if (!normalisePostcode(postcode)) return "Enter a full UK postcode, like NG2 5GB.";
      if (!distance) return "Choose how far you would go.";
    }
    if (where === "areas" && picked.length === 0) return "Pick at least one area.";
    return null;
  };

  const error = localError ?? state.error;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {step} of 3</p>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      <form
        action={formAction}
        onSubmit={(e) => {
          const problem = validateFinal();
          if (problem) {
            e.preventDefault();
            setLocalError(problem);
          }
        }}
        className="mt-6"
      >
        <input type="hidden" name={F.next} value={next} />
        <input type="hidden" name={F.kind} value={kind ?? ""} />
        <input type="hidden" name={F.budget} value={wantsSale ? (budget ?? "") : ""} />
        <input type="hidden" name={F.maxRentPcm} value={wantsRent ? (rent ?? "") : ""} />
        <input type="hidden" name={F.where} value={where ?? ""} />
        <input type="hidden" name={F.maxDistanceMiles} value={where === "near" && distance ? String(distance) : ""} />
        <input type="hidden" name={F.areas} value={where === "areas" ? picked.join(",") : ""} />
        {where !== "near" ? <input type="hidden" name={F.postcode} value="" /> : null}

        {step === 1 && (
          <section>
            <h1 className="text-2xl font-semibold text-foreground">What are you looking for?</h1>
            <p className="mt-1 text-sm text-muted-foreground">Three quick questions and we’ll show you deals that fit. Under a minute.</p>
            <div className="mt-5 space-y-3">
              {KIND_OPTIONS.map((o) => (
                <Choice key={o.value} on={kind === o.value} onClick={() => chooseKind(o.value)} label={o.label} help={o.help} />
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h1 className="text-2xl font-semibold text-foreground">What’s your budget?</h1>
            {wantsSale && (
              <div className="mt-5">
                {wantsRent && <p className="mb-2 text-sm font-medium text-foreground">To buy</p>}
                <div className="space-y-3">
                  {BUDGET_BANDS.map((b) => (
                    <Choice key={b} on={budget === b} onClick={() => setBudget(b)} label={BUDGET_LABELS[b]} />
                  ))}
                  <Choice on={budget === ""} onClick={() => setBudget("")} label="Not sure yet" />
                </div>
              </div>
            )}
            {wantsRent && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-medium text-foreground">{wantsSale ? "Rent-to-rent: maximum monthly rent" : "Maximum monthly rent you’d pay a landlord"}</p>
                <div className="flex flex-wrap gap-2">
                  {RENT_PRESETS_PCM.map((p) => (
                    <Pill key={p} on={rent === String(p)} onClick={() => setRent(String(p))}>
                      {gbp(p)}
                    </Pill>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <label htmlFor="welcome-rent" className="text-sm text-muted-foreground">
                    Or enter one:
                  </label>
                  <div className="flex h-12 flex-1 items-center rounded-lg border border-border bg-input/50 px-3">
                    <span className="text-sm text-muted-foreground">£</span>
                    <input
                      id="welcome-rent"
                      type="number"
                      inputMode="numeric"
                      min={MAX_RENT_PCM_RANGE.min}
                      max={MAX_RENT_PCM_RANGE.max}
                      step={50}
                      value={rent && rent !== "" ? rent : ""}
                      onChange={(e) => setRent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          continueFromBudget();
                        }
                      }}
                      placeholder="1,250"
                      className="h-full w-full bg-transparent pl-1 text-base outline-none"
                    />
                    <span className="text-sm text-muted-foreground">pcm</span>
                  </div>
                </div>
                <div className="mt-3">
                  <Choice on={rent === ""} onClick={() => setRent("")} label="Not sure yet" />
                </div>
              </div>
            )}
            <div className="mt-6 flex items-center gap-3">
              <button type="button" onClick={() => go(1)} className="min-h-12 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
                Back
              </button>
              <button type="button" onClick={continueFromBudget} className="min-h-12 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h1 className="text-2xl font-semibold text-foreground">Where?</h1>
            <div className="mt-5 space-y-3">
              {WHERE_OPTIONS.map((o) => (
                <Choice key={o.value} on={where === o.value} onClick={() => { setWhere(o.value); setLocalError(null); }} label={WHERE_LABELS[o.value]} help={o.help} />
              ))}
            </div>

            {where === "near" && (
              <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
                <label htmlFor="welcome-postcode" className="block text-sm font-medium text-foreground">
                  Your postcode
                </label>
                <input
                  id="welcome-postcode"
                  name={F.postcode}
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  autoComplete="postal-code"
                  autoCapitalize="characters"
                  placeholder="e.g. NG2 5GB"
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-input/50 px-3 text-base uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <p className="mt-3 text-sm font-medium text-foreground">How far would you go?</p>
                <div className="mt-2 flex gap-2">
                  {DISTANCE_OPTIONS.map((d) => (
                    <Pill key={d} on={distance === d} onClick={() => setDistance(d)}>
                      {d} miles
                    </Pill>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Used only to pick areas near you.</p>
              </div>
            )}

            {where === "areas" && (
              <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="welcome-area-search" className="text-sm font-medium text-foreground">
                    Pick your areas
                  </label>
                  <span className="text-xs text-muted-foreground">{picked.length} chosen</span>
                </div>
                <input
                  id="welcome-area-search"
                  value={areaQuery}
                  onChange={(e) => setAreaQuery(e.target.value)}
                  placeholder="Search by town or postcode area"
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-input/50 px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <ul className="mt-2 max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border bg-card">
                  {shownAreas.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No area matches that.</li>}
                  {shownAreas.map((a) => {
                    const on = picked.includes(a.code);
                    return (
                      <li key={a.code}>
                        <label className={`flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 ${on ? "bg-primary/5" : "hover:bg-muted"}`}>
                          <input type="checkbox" checked={on} onChange={() => togglePicked(a.code)} className="h-5 w-5" />
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
                        <button key={code} type="button" onClick={() => togglePicked(code)} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/70" title="Remove">
                          {a?.name ?? code} ×
                        </button>
                      );
                    })}
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button type="button" onClick={() => go(2)} className="min-h-12 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
                Back
              </button>
              <button type="submit" disabled={pending} className="min-h-12 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {pending ? "Finding your deals…" : "Show me my deals"}
              </button>
            </div>
          </section>
        )}

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      </form>

      <form action={skipWelcomeAction} className="mt-5 text-center">
        <input type="hidden" name={F.next} value={next} />
        <button type="submit" className="min-h-10 px-3 text-sm text-muted-foreground underline-offset-4 hover:underline">
          Skip for now
        </button>
      </form>
    </div>
  );
}
