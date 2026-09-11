"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { saveMarketGoalsAction, clearMarketGoalsAction, type GoalsState } from "../../actions";
import { DEFAULT_GOALS, PRIORITY_LABELS, SOURCING_KIND_LABELS, type MarketGoals, type Priority, type SourcingKind } from "@/lib/market/goals";
import { BUDGET_LABELS } from "@/lib/market/filters";

const initial: GoalsState = { error: null, warning: null, saved: false };

function PriorityPills({ name, value, label, help }: { name: string; value: Priority; label: string; help: string }) {
  const [v, setV] = useState<Priority>(value);
  return (
    <div className="mx-goals-priority">
      <div className="mx-goals-priority-head">
        <strong>{label}</strong>
        <span>{help}</span>
      </div>
      <div className="mx-goals-pills" role="radiogroup" aria-label={label}>
        {([0, 1, 2, 3] as Priority[]).map((p) => (
          <label key={p} className={"mx-pill mx-pill--sm" + (v === p ? " on" : "")}>
            <input type="radio" name={name} value={p} checked={v === p} onChange={() => setV(p)} />
            {PRIORITY_LABELS[p]}
          </label>
        ))}
      </div>
    </div>
  );
}

export function GoalsModal({ goals, alertWeekly = true, sourcingAlerts = false, onClose }: { goals: MarketGoals | null; alertWeekly?: boolean; sourcingAlerts?: boolean; onClose: () => void }) {
  const g = goals ?? DEFAULT_GOALS;
  const [state, action, pending] = useActionState(saveMarketGoalsAction, initial);
  const [clearing, startClear] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (state.saved) {
      router.refresh();
      const t = setTimeout(onClose, state.warning ? 2500 : 250);
      return () => clearTimeout(t);
    }
  }, [state.saved, state.warning, router, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mx-cmp-overlay" role="dialog" aria-modal="true" aria-label="Your investment goals" onClick={onClose}>
      <div className="mx-cmp-modal mx-goals-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mx-cmp-modal-head">
          <div>
            <h2>What are you looking for?</h2>
            <p className="mx-goals-sub">Two minutes. Re-ranks every area as “Your fit”, beside the Stayful score. Change it any time.</p>
          </div>
          <button type="button" className="mx-cmp-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>

        <form action={action} className="mx-cmp-scroll mx-goals-form">
          <section className="mx-goals-section">
            <h3>1 · Where</h3>
            <div className="mx-goals-grid">
              <label>
                <span>Home postcode</span>
                <input name="postcode" defaultValue={g.home?.postcode ?? ""} placeholder="e.g. NG2 5GB" autoComplete="postal-code" className="mx-input" />
                <small>Used only to rank areas by distance from you.</small>
              </label>
              <label>
                <span>How far would you go?</span>
                <select name="maxDistanceMiles" defaultValue={g.maxDistanceMiles ?? ""} className="mx-select mx-select--block">
                  <option value="">Anywhere in the UK</option>
                  <option value="25">Within 25 miles</option>
                  <option value="50">Within 50 miles</option>
                  <option value="100">Within 100 miles</option>
                </select>
              </label>
            </div>
          </section>

          <section className="mx-goals-section">
            <h3>2 · What</h3>
            <div className="mx-goals-grid">
              <label>
                <span>Purchase budget</span>
                <select name="budget" defaultValue={g.budget ?? ""} className="mx-select mx-select--block">
                  <option value="">No preference</option>
                  {(["u200", "200-350", "350-500", "500+"] as const).map((b) => <option key={b} value={b}>{BUDGET_LABELS[b]}</option>)}
                </select>
              </label>
              <label>
                <span>Bedrooms</span>
                <select name="bedrooms" defaultValue={g.bedrooms ?? ""} className="mx-select mx-select--block">
                  <option value="">No preference</option>
                  <option value="1">1 bed</option>
                  <option value="2">2 bed</option>
                  <option value="3">3 bed</option>
                  <option value="4">4+ bed</option>
                </select>
              </label>
            </div>
          </section>

          <section className="mx-goals-section">
            <h3>3 · What matters most</h3>
            <PriorityPills name="p_yield" value={g.priorities.yield} label="Maximum yield" help="Return relative to what property costs there" />
            <PriorityPills name="p_revenue" value={g.priorities.revenue} label="Maximum revenue" help="Absolute income, whatever the price" />
            <PriorityPills name="p_lowCompetition" value={g.priorities.lowCompetition} label="Low competition" help="Fewer, less entrenched hosts" />
            <PriorityPills name="p_directBookings" value={g.priorities.directBookings} label="Direct bookings" help="Contractors, hospitals, universities, events" />
          </section>

          <section className="mx-goals-section">
            <h3>4 · How you’ll run it</h3>
            <div className="mx-goals-grid">
              <label>
                <span>Management</span>
                <select name="management" defaultValue={g.management} className="mx-select mx-select--block">
                  <option value="managed">Hands-off (managed)</option>
                  <option value="self">I’ll manage it myself</option>
                </select>
                <small>Self-managing weights distance higher; managed weights revenue scale higher.</small>
              </label>
              <label>
                <span>Licensing rules</span>
                <select name="riskAppetite" defaultValue={g.riskAppetite} className="mx-select mx-select--block">
                  <option value="cautious">Avoid licensed or unclear areas</option>
                  <option value="balanced">Balanced</option>
                  <option value="tolerant">Happy to work with a licence</option>
                </select>
              </label>
            </div>
          </section>

          <section className="mx-goals-section">
            <h3>5 · Alerts</h3>
            <label className="mx-check">
              <input type="checkbox" name="alertWeekly" value="1" defaultChecked={alertWeekly} />
              <span>Email me weekly when a saved area’s enquiry trend flips or its data becomes Confirmed.</span>
            </label>
            <label className="mx-check">
              <input type="checkbox" name="sourcingAlerts" value="1" defaultChecked={sourcingAlerts} />
              <span>Email me new listings that fit these goals (daily, only when there is something new). Listings you save are re-checked for price drops automatically.</span>
            </label>
            <label>
              <span>Sourcing looks for</span>
              <select name="sourcingKind" defaultValue={g.sourcingKind} className="mx-select mx-select--block">
                {(Object.keys(SOURCING_KIND_LABELS) as SourcingKind[]).map((k) => (
                  <option key={k} value={k}>{SOURCING_KIND_LABELS[k]}</option>
                ))}
              </select>
              <small>Rent-to-rent picks are priced on the advertised rent; purchases on the asking price and your finance defaults above.</small>
            </label>
          </section>

          {state.error && <p className="mx-note mx-note--error">{state.error}</p>}
          {state.warning && <p className="mx-note">{state.warning}</p>}
          {state.saved && !state.warning && <p className="mx-note mx-note--ok">Saved. Re-ranking…</p>}

          <div className="mx-goals-actions">
            {goals && (
              <button
                type="button"
                className="mx-pill"
                disabled={clearing}
                onClick={() => startClear(async () => { await clearMarketGoalsAction(); router.refresh(); onClose(); })}
              >
                Clear goals
              </button>
            )}
            <button type="button" className="mx-pill" onClick={onClose}>Skip for now</button>
            <button type="submit" className="mx-cta" disabled={pending}>{pending ? "Saving…" : "Save & rank for me"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
