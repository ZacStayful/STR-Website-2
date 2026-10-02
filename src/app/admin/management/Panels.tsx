"use client";

import { useActionState, useState, useTransition } from "react";
import { dryRunFunnelNoticeAction, sendFunnelNoticeAction, setTestMonthAction, type MonthState, type NoticeActionResult } from "./actions";

/** The funnel-price notice: a dry run first, then the send (Batch 22f). Not the members' pricing notice. */
export function FunnelNoticePanel() {
  const [result, setResult] = useState<NoticeActionResult | null>(null);
  const [pending, start] = useTransition();
  const body = result?.body ?? null;
  const canSend = Boolean(body && (body.canSend === true || (body.dry === false && Number(body.remaining ?? 0) > 0)));
  const run = (fn: () => Promise<NoticeActionResult>) => start(async () => setResult(await fn()));
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Funnel owners’ notice of tier pricing</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Goes to every owner whose first lead form is from before tier pricing and who has not had it. Their leads stay on the old metered price until 30 days after their email; new owners are on tiers from the start. This is its own email and stamp (funnel_price_notice_sent_at), not the members’ pricing notice.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(dryRunFunnelNoticeAction)} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
          {pending ? "Working…" : "Dry run the notice"}
        </button>
        {canSend && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Send the funnel price notice to ${String(body?.dry === false ? body?.remaining : body?.audience)} owners?`)) run(sendFunnelNoticeAction);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {body?.dry === false ? `Send the rest (${String(body?.remaining)})` : `Send to ${String(body?.audience)} owners`}
          </button>
        )}
      </div>
      {result && (
        <div className="mt-3 space-y-2 text-xs">
          <p className={result.ok ? "text-foreground" : "text-destructive"}>{result.message}</p>
          {body && Array.isArray(body.sample) && <p className="text-muted-foreground">Sample: {(body.sample as string[]).join(", ")}</p>}
          {body && typeof body.subject === "string" && <p className="font-medium text-foreground">Subject: {body.subject}</p>}
          {body && typeof body.preview === "string" && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px] text-foreground">{body.preview}</pre>}
          {body && Array.isArray(body.failures) && (body.failures as string[]).length > 0 && <p className="text-destructive">Failed: {(body.failures as string[]).join(", ")}</p>}
        </div>
      )}
    </section>
  );
}

const MONTH_INITIAL: MonthState = { ok: false, message: "" };

/** Testing the tiers: set an owner's month (e.g. 20, so the next lead is £4.00). */
export function TestMonthPanel() {
  const [state, action, pending] = useActionState(setTestMonthAction, MONTH_INITIAL);
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Set a test month</h2>
      <p className="mt-1 text-xs text-muted-foreground">Sets an owner’s charged leads for this UK month. Their next leads are priced from there. For test accounts.</p>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          Owner email
          <input name="email" type="email" required className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs">
          Leads this month
          <input name="leads" type="number" min={0} defaultValue={20} required className="mt-1 block w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
          {pending ? "Saving…" : "Set"}
        </button>
      </form>
      {state.message ? <p className={`mt-2 text-xs ${state.ok ? "text-foreground" : "text-destructive"}`}>{state.message}</p> : null}
    </section>
  );
}
