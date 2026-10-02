"use client";

import { useActionState } from "react";
import type { VoiceSettings } from "@/lib/voice/settings";
import { saveCallSettingsAction, syncAgentAction, type ActionState } from "./actions";

const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const primary = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50";

function Said({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div role="status" className={`text-sm ${state.ok ? "text-foreground" : "text-[#991b1b]"}`}>
      <p>{state.message}</p>
      {state.changes && state.changes.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
          {state.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CallSettingsForm({ voice, textPence, emailPence }: { voice: VoiceSettings; textPence: number; emailPence: number }) {
  const [state, action, pending] = useActionState(saveCallSettingsAction, null);
  const num = (name: string, label: string, value: number, step = 1) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input name={name} type="number" step={step} defaultValue={value} className={`${field} w-28`} />
    </label>
  );
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {num("outboundStartHour", "Calls from (UK hour)", voice.outboundStartHour)}
        {num("outboundEndHour", "Calls until (UK hour)", voice.outboundEndHour)}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Weekdays (1 = Mon … 7 = Sun)
          <input name="outboundWeekdays" defaultValue={voice.outboundWeekdays.join(",")} className={`${field} w-36`} />
        </label>
        {num("maxOutboundPerUkDay", "Outbound calls a member a day (0 or 1)", voice.maxOutboundPerUkDay)}
        {num("lowCreditSpentRatio", "Low-credit: share of the last credit spent", voice.lowCreditSpentRatio, 0.05)}
        {num("lowCreditWindowDays", "…within days of it landing", voice.lowCreditWindowDays)}
        {num("lowCreditMinMemberDays", "No low-credit call in the first days", voice.lowCreditMinMemberDays)}
        {num("maxCallSeconds", "Longest call (seconds)", voice.maxCallSeconds)}
        {num("wrapUpSeconds", "Wrap up this long before (seconds)", voice.wrapUpSeconds)}
        {num("textsPerCallMax", "Texts a call (0–2)", voice.textsPerCallMax)}
        {num("transcriptRetentionDays", "Keep transcripts (days)", voice.transcriptRetentionDays)}
        {num("smsAutoRepliesPerNumberDay", "Automatic text replies a number a day", voice.smsAutoRepliesPerNumberDay)}
        {num("siTextPence", "Price of a text (p)", textPence)}
        {num("siEmailPence", "Price of a missed-call email (p)", emailPence)}
      </div>
      <p className="text-xs text-muted-foreground">
        The price of a call minute is the <code>si:call_minute</code> row on Billing admin (raw cost × markup). The £5 trigger is Starter pack &amp; Monday&rsquo;s low-credit amount; the £25 / £5 auto top-up is Stayful Intelligence&rsquo;s. The privacy policy says transcripts are kept 90 days: change it too if you change this.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        <Said state={state} />
      </div>
    </form>
  );
}

export function SyncAgentForm() {
  const [state, action, pending] = useActionState(syncAgentAction, null);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sends the agent&rsquo;s instructions from git (the persona, call scripts, knowledge and tools) and the one Stayful Intelligence voice to ElevenLabs. Dry run first: it only reads.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" name="intent" value="dry" disabled={pending} className={secondary}>
          Dry run
        </button>
        <button type="submit" name="intent" value="apply" disabled={pending} className={primary}>
          {pending ? "Working…" : "Sync to ElevenLabs"}
        </button>
      </div>
      <Said state={state} />
    </form>
  );
}
