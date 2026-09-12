"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatGbp, notifyCreditChanged } from "@/lib/credit/client";
import { useCreditOptional, type CreditSnapshot } from "@/components/credit/CreditProvider";
import { TopupCard } from "@/components/credit/TopupCard";
import type { UsageItem } from "@/lib/credit/history";

interface Props {
  admin: boolean;
  email: string | null;
  summary: Omit<CreditSnapshot, "admin">;
  plan: { code: string; name: string; pricePence: number; interval: "month" | "year"; monthlyCreditPence: number } | null;
  subscription: { status: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean };
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  stripeReady: boolean;
  initialHistory: { items: UsageItem[]; nextCursor: string | null };
  welcomeWithheld: string | null;
  justToppedUp: boolean;
  justSubscribed: boolean;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Card({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function BillingClient(props: Props) {
  const ctx = useCreditOptional();
  const live = ctx?.credit ?? null;
  const summary = live ?? props.summary;
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    if (props.justToppedUp) ctx?.toast("Top-up received — thank you");
    if (props.justSubscribed) ctx?.toast("Subscription active — your plan credit is on its way");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPortal() {
    setPortalBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else ctx?.toast(data.error || "Couldn't open the billing portal.");
    } finally {
      setPortalBusy(false);
    }
  }

  const cycle = summary.cycle;
  const pct = cycle && cycle.allowancePence > 0 ? Math.min(100, Math.round((cycle.usedPence / cycle.allowancePence) * 100)) : 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Billing &amp; usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">{props.email}{props.admin ? " · admin account (usage logged, never charged)" : ""}</p>
        </div>
        <Link href="/estimate" className="text-sm font-medium text-primary hover:underline">→ Run a report</Link>
      </div>

      {!summary.enforcing && !props.admin && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Credit is being tracked but not yet enforced while we calibrate prices, so nothing is blocked right now. Balances and usage below are live.
        </div>
      )}
      {props.welcomeWithheld && <div className="mb-6 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">{props.welcomeWithheld}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Your plan">
          {props.plan ? (
            <>
              <p className="text-2xl font-semibold text-foreground">{props.plan.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatGbp(props.plan.pricePence)}/{props.plan.interval === "year" ? "year" : "month"} · {formatGbp(props.plan.monthlyCreditPence)} credit a month
                {props.subscription.status && props.subscription.status !== "active" ? ` · ${props.subscription.status.replace("_", " ")}` : ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {props.subscription.cancelAtPeriodEnd ? `Ends ${fmtDate(props.subscription.periodEnd) ?? "at the period end"}.` : props.subscription.periodEnd ? `Renews ${fmtDate(props.subscription.periodEnd)}.` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={portalBusy || !props.stripeReady} onClick={() => void openPortal()}>
                  {portalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Manage subscription
                </Button>
                <Link href="/upgrade" className="inline-flex h-7 items-center rounded-lg border border-transparent bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground hover:opacity-90">Change plan</Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold text-foreground">Pay as you go</p>
              <p className="text-sm text-muted-foreground">No subscription. Subscribe for monthly credit at the standard rate — top-up credit is spent at {summary.rates.topup}×.</p>
              <div className="mt-3">
                <Link href="/upgrade" className="inline-flex h-7 items-center rounded-lg border border-transparent bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground hover:opacity-90">See plans</Link>
              </div>
            </>
          )}
        </Card>

        <Card title="Credit balance">
          <p className="text-3xl font-semibold text-foreground">{formatGbp(summary.totalPence)}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Plan credit</dt>
            <dd className="text-right text-foreground">{formatGbp(summary.buckets.planPence)}{cycle?.endsAt && summary.buckets.planPence > 0 ? <span className="text-muted-foreground"> · resets {fmtDate(cycle.endsAt)}</span> : null}</dd>
            <dt className="text-muted-foreground">Welcome credit</dt>
            <dd className="text-right text-foreground">{formatGbp(summary.buckets.welcomePence)}</dd>
            <dt className="text-muted-foreground">Top-up credit <span className="text-xs">({summary.rates.topup}× rate)</span></dt>
            <dd className="text-right text-foreground">{formatGbp(summary.buckets.topupPence)}</dd>
            {summary.buckets.adjustmentPence !== 0 && (
              <>
                <dt className="text-muted-foreground">Promo / adjustments</dt>
                <dd className="text-right text-foreground">{formatGbp(summary.buckets.adjustmentPence)}</dd>
              </>
            )}
            {summary.reservedBasePence > 0 && (
              <>
                <dt className="text-muted-foreground">Reserved by a running report</dt>
                <dd className="text-right text-foreground">{formatGbp(summary.reservedBasePence)}</dd>
              </>
            )}
          </dl>
          {cycle && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-muted-foreground"><span>{cycle.planName ? `${cycle.planName} credit used this month` : "Welcome credit used"}</span><span>{pct}%</span></div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"><div className={`h-full ${pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <TopupCard presets={summary.topupPresetsPence} hasSavedCard={summary.hasSavedCard} topupRate={summary.rates.topup} />
          {props.card && <p className="-mt-2 text-xs text-muted-foreground">Saved card: {props.card.brand} ending {props.card.last4} (exp {String(props.card.expMonth).padStart(2, "0")}/{String(props.card.expYear).slice(-2)}). <button type="button" className="underline" onClick={() => void openPortal()}>Update card</button></p>}
          <AutoTopup presets={summary.topupPresetsPence} hasSavedCard={summary.hasSavedCard} current={summary.autoTopup} />
        </div>
        <div className="space-y-4">
          <RedeemCode />
          <Referral />
        </div>
      </div>

      <Usage initial={props.initialHistory} />
    </div>
  );
}

function AutoTopup({ presets, hasSavedCard, current }: { presets: number[]; hasSavedCard: boolean; current: { amountPence: number | null; thresholdPence: number } }) {
  const ctx = useCreditOptional();
  const [amount, setAmount] = useState<number | null>(current.amountPence);
  const [threshold, setThreshold] = useState(current.thresholdPence);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save(next: number | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/billing/auto-topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPence: next, thresholdPence: threshold }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error || "Couldn't save that.");
        return;
      }
      setAmount(next);
      ctx?.toast(next ? `Auto top-up on: ${formatGbp(next)} when you drop below ${formatGbp(threshold)}` : "Auto top-up off");
      void ctx?.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Auto top-up">
      <p className="text-sm text-muted-foreground">Never see the out-of-credit screen: charge your saved card automatically when your balance runs low. Off by default.</p>
      {!hasSavedCard && <p className="mt-2 text-xs text-muted-foreground">Make one top-up through checkout first so we have a card to charge.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Top up</span>
        <select className="h-8 rounded-lg border border-border bg-background px-2 text-sm" value={amount ?? ""} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : null)} disabled={!hasSavedCard || busy}>
          <option value="">Off</option>
          {presets.map((p) => (
            <option key={p} value={p}>{formatGbp(p).replace(".00", "")}</option>
          ))}
        </select>
        <span className="text-muted-foreground">when below</span>
        <Input type="number" min={1} max={100} step={1} className="h-8 w-20" value={threshold / 100} onChange={(e) => setThreshold(Math.round(Number(e.target.value) * 100))} disabled={!hasSavedCard || busy} />
        <Button type="button" size="sm" disabled={!hasSavedCard || busy} onClick={() => void save(amount)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </Button>
      </div>
      {msg && <p className="mt-2 text-xs text-destructive">{msg}</p>}
    </Card>
  );
}

function RedeemCode() {
  const ctx = useCreditOptional();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function redeem() {
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/billing/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; amountPence?: number; error?: string };
      if (!res.ok || !data.ok) {
        setMsg({ ok: false, text: data.error || "That code isn't valid." });
        return;
      }
      setMsg({ ok: true, text: `${formatGbp(data.amountPence ?? 0)} added to your credit.` });
      setCode("");
      notifyCreditChanged();
      ctx?.toast(`${formatGbp(data.amountPence ?? 0)} of credit added`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Have a code?">
      <p className="text-sm text-muted-foreground">Promo and referral codes add credit to your account (spent at the top-up rate).</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void redeem();
        }}
      >
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. WEBINAR10" className="h-8 uppercase" maxLength={40} />
        <Button type="submit" size="sm" disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Redeem
        </Button>
      </form>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-primary" : "text-destructive"}`}>{msg.text}</p>}
    </Card>
  );
}

function Referral() {
  const ctx = useCreditOptional();
  const [data, setData] = useState<{ code: string; url: string; rewardPence: number; earnedPence: number; redemptions: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/billing/referral")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.code) setData(d);
        else setError(d.error || "Unavailable right now.");
      })
      .catch(() => alive && setError("Unavailable right now."));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Card title="Give credit, get credit">
      {data ? (
        <>
          <p className="text-sm text-muted-foreground">Share your link. When someone signs up and redeems it, you both get {formatGbp(data.rewardPence)} of credit.</p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={data.url} className="h-8 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(data.url);
                ctx?.toast("Link copied");
              }}
            >
              Copy
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Code <span className="font-mono">{data.code}</span> · {data.redemptions} referral{data.redemptions === 1 ? "" : "s"} · {formatGbp(data.earnedPence)} earned</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{error ?? "Loading your referral link…"}</p>
      )}
    </Card>
  );
}

function Usage({ initial }: { initial: { items: UsageItem[]; nextCursor: string | null } }) {
  const ctx = useCreditOptional();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/credit/usage?limit=40", { cache: "no-store" });
      if (!res.ok) return;
      const page = (await res.json()) as { items: UsageItem[]; nextCursor: string | null };
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch {
      /* keep */
    }
  }, []);
  // Refresh the table whenever the balance changes (top-up, code, report).
  const balanceKey = ctx?.credit?.totalPence;
  useEffect(() => {
    if (balanceKey === undefined) return;
    void reload();
  }, [balanceKey, reload]);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/credit/usage?limit=40&before=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      if (!res.ok) return;
      const page = (await res.json()) as { items: UsageItem[]; nextCursor: string | null };
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-foreground">Usage &amp; credit history</h2>
      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Nothing yet. Your welcome credit and every report will show here.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">What</th>
                <th className="px-4 py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const debit = it.kind === "debit";
                const isOpen = open.has(it.id);
                const fromTopup = debit && it.basePence !== null && Math.abs(it.amountPence) > it.basePence + 0.01;
                return (
                  <FragmentRow key={it.id}>
                    <tr className="border-t border-border">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{fmtWhen(it.at)}</td>
                      <td className="px-4 py-2">
                        {debit && it.lines.length > 0 ? (
                          <button type="button" onClick={() => toggle(it.id)} className="inline-flex items-center gap-1 text-left text-foreground hover:underline">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {it.description}
                            <span className="text-xs text-muted-foreground">· {it.lines.length} call{it.lines.length === 1 ? "" : "s"}</span>
                          </button>
                        ) : (
                          <span className="text-foreground">{it.description}</span>
                        )}
                        {it.kind === "grant" && it.expiresAt && <span className="ml-2 text-xs text-muted-foreground">expires {fmtDate(it.expiresAt)}</span>}
                        {fromTopup && <span className="ml-2 text-xs text-muted-foreground">({formatGbp(it.basePence ?? 0)} at the top-up rate)</span>}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-2 text-right ${it.amountPence < 0 ? "text-foreground" : "text-primary"}`}>{it.amountPence > 0 ? "+" : ""}{formatGbp(it.amountPence)}</td>
                    </tr>
                    {debit && isOpen &&
                      it.lines.map((l, i) => (
                        <tr key={`${it.id}-${i}`} className="bg-muted/40 text-xs">
                          <td className="px-4 py-1 text-muted-foreground">{fmtWhen(l.at)}</td>
                          <td className="px-4 py-1 text-muted-foreground">
                            {l.description ?? `${l.provider} ${l.unit}`}
                            {l.quantity !== null && l.quantity !== 1 ? ` × ${l.quantity.toLocaleString("en-GB")}` : ""}
                          </td>
                          <td className="px-4 py-1 text-right text-muted-foreground">{formatGbp(l.amountPence)}</td>
                        </tr>
                      ))}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void more()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load more
          </Button>
        </div>
      )}
    </section>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
