"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatGbp } from "@/lib/credit/client";
import type { BillingSettings } from "@/lib/credit/unit-costs";
import { createPromoCodeAction, grantAdjustmentAction, reseedUnitCostsAction, toggleCodeAction, updateRatesAction, updateUnitCostAction, type ActionState } from "./actions";

interface Row {
  provider: string;
  unit: string;
  label: string;
  unitCostPence: number;
  markup: number;
  notes: string | null;
  stat: { calls: number; rawPence: number; chargedPence: number } | null;
}

interface Code {
  code: string;
  kind: string;
  amountPence: number;
  maxRedemptions: number | null;
  redeemedCount: number;
  expiresAt: string | null;
  active: boolean;
  createdBy: string | null;
  referral: boolean;
}

const idle: ActionState = { ok: true, message: "" };

function Msg({ s }: { s: ActionState }) {
  if (!s.message) return null;
  return <p className={`text-xs ${s.ok ? "text-primary" : "text-destructive"}`}>{s.message}</p>;
}

function CostRow({ r }: { r: Row }) {
  const [state, action, pending] = useActionState(updateUnitCostAction, idle);
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">{r.label}</div>
        <div className="text-xs text-muted-foreground">{r.provider}:{r.unit}</div>
        <Msg s={state} />
      </td>
      <td className="px-3 py-2" colSpan={3}>
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="provider" value={r.provider} />
          <input type="hidden" name="unit" value={r.unit} />
          <label className="text-xs text-muted-foreground">cost p</label>
          <Input name="unit_cost_pence" defaultValue={r.unitCostPence} type="number" step="0.0001" min={0} className="h-7 w-28 text-xs" />
          <label className="text-xs text-muted-foreground">×</label>
          <Input name="markup" defaultValue={r.markup} type="number" step="0.1" min={0.1} className="h-7 w-16 text-xs" />
          <span className="text-xs text-muted-foreground">= {formatGbp(r.unitCostPence * r.markup)}</span>
          <Input name="notes" defaultValue={r.notes ?? ""} placeholder="notes" className="h-7 w-48 text-xs" />
          <Button type="submit" size="xs" disabled={pending}>Save</Button>
        </form>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground">
        {r.stat ? (
          <>
            {r.stat.calls} · cost {formatGbp(r.stat.rawPence)} · charged {formatGbp(r.stat.chargedPence)}
          </>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export function BillingAdminClient({ rows, settings, codes }: { rows: Row[]; settings: BillingSettings; codes: Code[] }) {
  const [rates, ratesAction, ratesPending] = useActionState(updateRatesAction, idle);
  const [adj, adjAction, adjPending] = useActionState(grantAdjustmentAction, idle);
  const [promo, promoAction, promoPending] = useActionState(createPromoCodeAction, idle);
  const [reseed, setReseed] = useState<ActionState>(idle);
  const [toggling, startToggle] = useTransition();

  return (
    <>
      <h2 className="mt-8 mb-2 text-lg font-semibold text-foreground">Rates</h2>
      <form action={ratesAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 text-sm">
        {[
          ["base_markup", "Base markup ×", settings.baseMarkup, "0.1"],
          ["rate_plan", "Plan spend rate", settings.spendRates.plan, "0.05"],
          ["rate_welcome", "Welcome spend rate", settings.spendRates.welcome, "0.05"],
          ["rate_topup", "Top-up spend rate", settings.spendRates.topup, "0.05"],
          ["rate_adjustment", "Promo/adjust spend rate", settings.spendRates.adjustment, "0.05"],
          ["welcome_grant_pence", "Welcome credit (p)", settings.welcomeGrantPence, "1"],
          ["low_balance_ratio", "Low-balance ratio", settings.lowBalanceRatio, "0.05"],
          ["referral_pence", "Referral reward (p)", settings.referralPence, "1"],
        ].map(([name, label, value, step]) => (
          <label key={String(name)} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {label}
            <Input name={String(name)} defaultValue={Number(value)} type="number" step={String(step)} min={0} className="h-8 w-28" />
          </label>
        ))}
        <Button type="submit" size="sm" disabled={ratesPending}>Save rates</Button>
        <Msg s={rates} />
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Base markup is the default for new unit rows; each row&apos;s own multiplier below is what is charged. Spend rates apply to grants created after the change.</p>

      <div className="mt-8 mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Unit costs</h2>
        <form
          action={async () => {
            setReseed(await reseedUnitCostsAction());
          }}
        >
          <Button type="submit" size="sm" variant="outline">Re-seed missing rows</Button>
          <Msg s={reseed} />
        </form>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium" colSpan={3}>Our cost × markup = charge (base pence)</th>
              <th className="px-3 py-2 text-right font-medium">Last 7 days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <CostRow key={`${r.provider}:${r.unit}`} r={r} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Manual adjustment</h2>
          <p className="mt-1 text-xs text-muted-foreground">Add (or remove, with a negative amount) credit on an account. Spent at the adjustment rate.</p>
          <form action={adjAction} className="mt-3 flex flex-wrap items-center gap-2">
            <Input name="email" placeholder="member@email" className="h-8 w-56" required />
            <Input name="pence" type="number" placeholder="pence, e.g. 500" className="h-8 w-32" required />
            <Input name="note" placeholder="reason" className="h-8 w-48" />
            <Button type="submit" size="sm" disabled={adjPending}>Apply</Button>
          </form>
          <Msg s={adj} />
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">New promo code</h2>
          <p className="mt-1 text-xs text-muted-foreground">e.g. WEBINAR10 = £10 for the first 100 redemptions.</p>
          <form action={promoAction} className="mt-3 flex flex-wrap items-center gap-2">
            <Input name="code" placeholder="CODE" className="h-8 w-36 uppercase" required />
            <Input name="pence" type="number" placeholder="pence" className="h-8 w-28" required />
            <Input name="max" type="number" placeholder="max uses" className="h-8 w-28" />
            <Input name="expires" type="date" className="h-8 w-40" />
            <Button type="submit" size="sm" disabled={promoPending}>Create</Button>
          </form>
          <Msg s={promo} />
        </section>
      </div>

      <h2 className="mt-8 mb-2 text-lg font-semibold text-foreground">Codes</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Used</th>
              <th className="px-3 py-2 font-medium">Expires</th>
              <th className="px-3 py-2 font-medium">By</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 ? (
              <tr><td className="px-3 py-2 text-muted-foreground" colSpan={7}>No codes yet.</td></tr>
            ) : (
              codes.map((c) => (
                <tr key={c.code} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{c.code}</td>
                  <td className="px-3 py-2">{c.referral ? "referral" : c.kind}</td>
                  <td className="px-3 py-2">{formatGbp(c.amountPence)}</td>
                  <td className="px-3 py-2">{c.redeemedCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-GB") : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.createdBy ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" size="xs" variant="ghost" disabled={toggling} onClick={() => startToggle(async () => { await toggleCodeAction(c.code, !c.active); })}>
                      {c.active ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
