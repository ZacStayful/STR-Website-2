"use client";

import { useState, useTransition } from "react";
import { dryRunPricingNoticeAction, sendPricingNoticeAction, type NoticeActionResult } from "./actions";

/**
 * The members' notice of the new prices (Batch 10): a dry run first (who,
 * how many on each plan, a sample, the email itself), then the send, which
 * only appears after a dry run that says it may go. A send does as many as
 * fit in one press; press again for the rest.
 */
export function PricingNoticePanel({ planned, announced, earliest }: { planned: string | null; announced: string | null; earliest: string }) {
  const [result, setResult] = useState<NoticeActionResult | null>(null);
  const [pending, start] = useTransition();
  const body = result?.body ?? null;
  const canSend = Boolean(body && (body.canSend === true || (body.dry === false && Number(body.remaining ?? 0) > 0)));
  const run = (fn: () => Promise<NoticeActionResult>) => start(async () => setResult(await fn()));

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Members’ notice of the new prices</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {planned ? `New pricing date saved: ${planned.slice(0, 10)}.` : "No new pricing date saved yet."} {announced ? `Announced for ${announced.slice(0, 10)}: it takes effect then.` : "Not announced yet: nothing changes until the notice has gone out."} The notice must go at least 14 days before the date (earliest date now: {earliest}). It goes to everyone who has signed in, team members included, outside the one-a-day email cap.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(dryRunPricingNoticeAction)} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
          {pending ? "Working…" : "Dry run the notice"}
        </button>
        {canSend && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Send the price notice to ${String(body?.dry === false ? body?.remaining : body?.audience)} members?`)) run(sendPricingNoticeAction);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {body?.dry === false ? `Send the next batch (${String(body?.remaining)} left)` : `Send the notice to ${String(body?.audience)} members`}
          </button>
        )}
      </div>
      {result && (
        <div className="mt-3 space-y-2 text-xs">
          <p className={result.ok ? "text-foreground" : "text-destructive"}>{result.message}</p>
          {body && (
            <>
              {typeof body.audience === "number" && <p className="text-muted-foreground">Audience not yet sent it: {body.audience}</p>}
              {body.byPlan !== undefined && <p className="text-muted-foreground">By plan: {Object.entries(body.byPlan as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
              {body.reason !== undefined && <p className="text-destructive">{String(body.reason)}</p>}
              {Array.isArray(body.sample) && <p className="text-muted-foreground">Sample: {(body.sample as string[]).join(", ")}</p>}
              {typeof body.subject === "string" && <p className="font-medium text-foreground">Subject: {body.subject}</p>}
              {typeof body.preview === "string" && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px] text-foreground">{body.preview}</pre>}
              {Array.isArray(body.failures) && (body.failures as string[]).length > 0 && <p className="text-destructive">Failed: {(body.failures as string[]).join(", ")}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
