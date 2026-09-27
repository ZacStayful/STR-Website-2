'use client';

import { useActionState } from 'react';
import { backfillAction, retentionCheckAction, type BackfillState, type RetentionState } from './actions';

/**
 * The backfill and the retention count on /admin/weekly-active. Both answer
 * in place (useActionState), so nothing is stored in the browser. The real
 * backfill is offered only after a dry run on this page, and asks first.
 */

const SOURCE_LABELS: Record<string, string> = {
  deal_opens: 'Deal opens',
  deal_reactions: 'Keep / Pass (the latest of each)',
  saved_searches: 'Reports run',
  deal_shares: 'Deal shares',
  credit_grants: 'Top-ups (recorded as "before tracking")',
  sourcing_sent: 'Answers to daily-pick emails',
  pipeline_step_events: 'Next steps and stage moves',
  subscription_events: 'Plan starts, changes, pauses and cancellations',
};

const button = 'rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function BackfillPanel() {
  const [state, action, pending] = useActionState<BackfillState, FormData>(backfillAction, null);
  const outcome = state?.outcome ?? null;
  const dryRunDone = Boolean(outcome?.ok && outcome.result.dry);
  const result = outcome?.ok ? outcome.result : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <button type="submit" name="apply" value="0" disabled={pending} className={button}>
          {pending ? 'Working…' : 'Dry run'}
        </button>
        <button
          type="submit"
          name="apply"
          value="1"
          disabled={pending || !dryRunDone}
          className={button}
          onClick={(e) => {
            if (!window.confirm('Copy this history into the activity log? Rows already there are skipped, so running it again adds nothing.')) e.preventDefault();
          }}
        >
          Copy the history
        </button>
        <span className="text-xs text-muted-foreground">{dryRunDone ? 'The counts below are what a real run would add.' : 'Run the dry run first: it counts and changes nothing.'}</span>
      </form>

      {outcome && !outcome.ok && <p className="mt-4 text-sm text-destructive">Failed: {outcome.message}</p>}

      {result?.error === 'not_live' && (
        <p className="mt-4 text-sm text-foreground">
          Not run: nothing has been logged live in production yet. The real run waits for the release&rsquo;s first event, so a preview can never fix the cutoff too early. The dry run works any time.
        </p>
      )}

      {result && result.error === null && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            {result.dry ? 'Dry run' : 'Done'} at {when(state?.at ?? null)}. History from {when(result.floor)} to {result.cutoff ? when(result.cutoff) : 'the first live event (not logged yet)'}
            {result.cutoffFixed ? ' (the cutoff is fixed for good)' : result.cutoff ? ' (the cutoff is fixed by the first real run)' : ''}.
            {!result.dry && ` ${result.inserted.toLocaleString('en-GB')} rows added.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-medium">From</th>
                  <th className="py-1 pr-4 text-right font-medium">Found</th>
                  <th className="py-1 text-right font-medium">{result.dry ? 'Would add' : 'Not in the log before this run'}</th>
                </tr>
              </thead>
              <tbody>
                {result.sources.length === 0 ? (
                  <tr>
                    <td className="py-1 text-muted-foreground" colSpan={3}>Nothing to copy.</td>
                  </tr>
                ) : (
                  result.sources.map((s) => (
                    <tr key={s.table} className="border-t border-border/60">
                      <td className="py-1 pr-4">{SOURCE_LABELS[s.table] ?? s.table}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{s.found.toLocaleString('en-GB')}</td>
                      <td className="py-1 text-right tabular-nums">{s.fresh.toLocaleString('en-GB')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function RetentionCheck() {
  const [state, action, pending] = useActionState<RetentionState, FormData>(retentionCheckAction, null);
  const outcome = state?.outcome ?? null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Counting…' : 'Count what would be deleted'}
        </button>
        <span className="text-xs text-muted-foreground">Counts only. The nightly run (02:35 UTC) does the deleting.</span>
      </form>
      {outcome && !outcome.ok && <p className="mt-4 text-sm text-destructive">Failed: {outcome.message}</p>}
      {outcome?.ok && (
        <p className="mt-4 text-sm text-foreground">
          Older than {when(outcome.result.before)}: {outcome.result.events.toLocaleString('en-GB')} events and {outcome.result.visits.toLocaleString('en-GB')} visits.
        </p>
      )}
    </div>
  );
}
