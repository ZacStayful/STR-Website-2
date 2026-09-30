'use client';

import { useActionState, useState } from 'react';
import { mobileBackfillAction, saveLifecycleAction, type MobileState, type SaveState } from './actions';
import type { ClashAccount } from '@/lib/credit/mobile-backfill-server';

const button = 'rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
const input = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm';

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function day(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
}

function gbp(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export interface SettingsFormValues {
  starterPackFromLocal: string;
  inactivityFromLocal: string;
  starterPackPricePence: number;
  starterPackCreditPence: number;
  starterPackSnoozeDays: number;
  lowCreditPence: number;
  inactiveReengageDays: number;
  picksPauseInactiveDays: number;
}

function Field({ label, name, defaultValue, hint, type = 'number' }: { label: string; name: string; defaultValue: string | number; hint?: string; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <input className={`${input} mt-1`} type={type} name={name} defaultValue={defaultValue} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 1 : undefined} />
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function DateField({ label, name, defaultValue, hint }: { label: string; name: string; defaultValue: string; hint: string }) {
  const [now, setNow] = useState(false);
  return (
    <div className="text-sm">
      <label className="block">
        <span className="font-medium text-foreground">{label}</span>
        <input className={`${input} mt-1`} type="datetime-local" name={name} defaultValue={defaultValue} disabled={now} />
      </label>
      <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name={`${name}_now`} value="1" checked={now} onChange={(e) => setNow(e.target.checked)} /> Start now
      </label>
      <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

export function SettingsForm({ values }: { values: SettingsFormValues }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveLifecycleAction, null);
  return (
    <form action={action} className="rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField label="Starter pack from (UK time)" name="starter_pack_from" defaultValue={values.starterPackFromLocal} hint="Accounts created from this moment get the pack offer and no welcome credit. Empty: off, and new members get the welcome credit as before." />
        <DateField label="Inactivity counted from (UK time)" name="inactivity_from" defaultValue={values.inactivityFromLocal} hint="Nobody is inactive for longer than the time since this moment. Empty: nobody is paused or moved to Re-engage." />
        <Field label="Pack price (pence)" name="starter_pack_price_pence" defaultValue={values.starterPackPricePence} hint="Must match the Stripe price in STRIPE_PRICE_STARTER_PACK." />
        <Field label="Pack credit in total (pence)" name="starter_pack_credit_pence" defaultValue={values.starterPackCreditPence} hint="What it pays for, plus the bonus. At least the price." />
        <Field label={'"Not now" hides the Today card for (days)'} name="starter_pack_snooze_days" defaultValue={values.starterPackSnoozeDays} />
        <Field label="Low-credit decision at (pence)" name="low_credit_pence" defaultValue={values.lowCreditPence} hint="Members with no plan at or below this see Starter or a £10 top-up." />
        <Field label="Re-engage after (days inactive)" name="inactive_reengage_days" defaultValue={values.inactiveReengageDays} />
        <Field label="Pause daily picks after (days inactive)" name="picks_pause_inactive_days" defaultValue={values.picksPauseInactiveDays} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state ? <span className={`text-sm ${state.ok ? 'text-foreground' : 'text-destructive'}`}>{state.message}</span> : null}
      </div>
    </form>
  );
}

function AccountLine({ a, keeps }: { a: ClashAccount; keeps: boolean }) {
  return (
    <tr className="border-t border-border/60">
      <td className="py-1 pr-4">{keeps ? 'Keeps it' : 'Listed'}</td>
      <td className="py-1 pr-4">{a.email ?? '—'}</td>
      <td className="py-1 pr-4">{day(a.created)}</td>
      <td className="py-1 pr-4 text-right tabular-nums">{gbp(a.welcomePence)}</td>
      <td className="py-1 text-right tabular-nums">{gbp(a.spentPence)}</td>
    </tr>
  );
}

export function MobilePanel() {
  const [state, action, pending] = useActionState<MobileState, FormData>(mobileBackfillAction, null);
  const outcome = state?.outcome ?? null;
  const result = outcome?.ok ? outcome.result : null;
  const dryRunDone = Boolean(result?.dry);
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
            if (!window.confirm('Record these numbers? The oldest account keeps a shared number; nothing else on any account changes.')) e.preventDefault();
          }}
        >
          Record the numbers
        </button>
        <span className="text-xs text-muted-foreground">{dryRunDone ? 'The list below is what a real run would do.' : 'Run the dry run first: it reads and changes nothing.'}</span>
      </form>
      {outcome && !outcome.ok ? <p className="mt-4 text-sm text-destructive">Failed: {outcome.message}</p> : null}
      {result ? (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            {result.dry ? 'Dry run' : 'Done'} at {when(state?.at ?? null)}: {result.accounts} accounts, {result.withNumber} with a number ({result.unreadable} unreadable), {result.numbers} numbers, {result.alreadyHeld} already recorded,{' '}
            {result.dry ? `${result.toWrite} to record.` : `${result.written} recorded${result.failed.length ? `, ${result.failed.length} failed` : ''}${result.more ? ' (ran out of time: run it again)' : ''}.`}
          </p>
          {result.failed.length > 0 ? <p className="text-destructive">Failed: {result.failed.map((f) => `${f.number} (${f.error})`).join('; ')}</p> : null}
          {result.skipped.length > 0 ? <p className="text-muted-foreground">Left alone (the oldest holder already has another number): {result.skipped.map((s) => s.number).join(', ')}</p> : null}
          <h3 className="font-medium text-foreground">Shared numbers ({result.clashes.length})</h3>
          {result.clashes.length === 0 ? (
            <p className="text-muted-foreground">No number is shared.</p>
          ) : (
            result.clashes.map((c) => (
              <div key={c.number} className="overflow-x-auto">
                <p className="text-xs text-muted-foreground">Number ending {c.number}</p>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-medium" />
                      <th className="py-1 pr-4 font-medium">Account</th>
                      <th className="py-1 pr-4 font-medium">Created</th>
                      <th className="py-1 pr-4 text-right font-medium">Welcome credit</th>
                      <th className="py-1 text-right font-medium">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AccountLine a={c.keeps} keeps />
                    {c.others.map((o, i) => (
                      <AccountLine key={`${c.number}-${i}`} a={o} keeps={false} />
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
