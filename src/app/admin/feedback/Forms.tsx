"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { DEFAULT_SETTINGS, LIMITS, REPORT_STATUSES, SETTING_BOUNDS, type FeedbackSettings, type ReportKind, type ReportStatus } from "@/lib/feedback/config";
import { statusLabel } from "@/lib/feedback/rules";
import { duplicateAction, noteAction, settingsAction, statusAction, type ActionState } from "./actions";

/**
 * The forms on /admin/feedback (Batch 18). Buttons are off while an action
 * runs; what happened is said underneath. A status email is claimed before
 * it is sent, so even a second press never emails anyone twice.
 */

const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const primary = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50";

function Said({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-foreground" : "text-[#991b1b]"}`}>
      {state.message}
    </p>
  );
}

const OUTCOME: Record<string, string> = {
  send: "will be emailed",
  retry: "will be emailed (the last try failed)",
  already_told: "already told: not emailed again",
  no_email: "no email address: skipped",
};

export function StatusForm({ id, kind, status, message, locked, hasFailed }: { id: string; kind: ReportKind; status: ReportStatus; message: string | null; locked: boolean; hasFailed: boolean }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  // Which button sent the form (Enter presses the first, Preview). Not a form
  // action: React resets a form's fields when its action finishes, so after
  // Preview the status chosen would snap back and Save would save the old one.
  const intent = useRef<"preview" | "save" | "retry">("preview");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    data.set("intent", intent.current);
    startTransition(async () => setState(await statusAction(state, data)));
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={status} disabled={locked || pending} className={field}>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(kind, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          One line for the member (optional, sent with the email)
          <input name="message" maxLength={LIMITS.statusMessageMax} defaultValue={message ?? ""} disabled={locked || pending} className={field} placeholder="e.g. It’s in today’s release." />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" onClick={() => (intent.current = "preview")} disabled={locked || pending} className={secondary}>
          Preview emails
        </button>
        <button type="submit" onClick={() => (intent.current = "save")} disabled={locked || pending} className={primary}>
          {pending ? "Working…" : "Save"}
        </button>
        {hasFailed && (
          <button type="submit" onClick={() => (intent.current = "retry")} disabled={locked || pending} className={secondary}>
            Retry failed emails
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Planned, Fixed or Built, and Not doing each email the member who sent this, and anyone whose report is a duplicate of it: once per status, never twice.</p>
      <Said state={state} />
      {state?.preview && state.preview.emails && (
        <div className="space-y-3 rounded-lg border border-border bg-background p-3 text-sm">
          <ul className="space-y-1">
            {state.preview.recipients.map((r) => (
              <li key={r.ref}>
                #{r.ref} · {r.email ?? "no email"} — {OUTCOME[r.outcome] ?? r.outcome}
              </li>
            ))}
          </ul>
          {state.preview.subject && (
            <div>
              <p className="text-xs text-muted-foreground">Subject</p>
              <p className="font-medium">{state.preview.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-sans text-xs text-foreground">{state.preview.text}</pre>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

export function NoteForm({ id, note }: { id: string; note: string | null }) {
  const [state, action, pending] = useActionState(noteAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="note" rows={3} maxLength={LIMITS.adminNoteMax} defaultValue={note ?? ""} className={`${field} w-full`} placeholder="Only admins see this." />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? "Saving…" : "Save note"}
        </button>
        <Said state={state} />
      </div>
    </form>
  );
}

export function DuplicateForm({ id, duplicateOfRef }: { id: string; duplicateOfRef: number | null }) {
  const [state, action, pending] = useActionState(duplicateAction, null);
  if (duplicateOfRef) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value="undo" />
        <button type="submit" disabled={pending} className={secondary}>
          Not a duplicate after all
        </button>
        <Said state={state} />
      </form>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="intent" value="mark" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          A duplicate of report
          <input name="of" inputMode="numeric" placeholder="#12" className={`${field} w-28`} required />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
          <input type="checkbox" name="tell" defaultChecked />
          Tell the reporter now, if the original has moved on
        </label>
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? "Working…" : "Mark as duplicate"}
        </button>
      </div>
      <Said state={state} />
    </form>
  );
}

export function SettingsForm({ settings }: { settings: FeedbackSettings }) {
  const [state, action, pending] = useActionState(settingsAction, null);
  const b = SETTING_BOUNDS;
  const num = (name: keyof typeof b, label: string, value: number) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input name={name} type="number" min={b[name].min} max={b[name].max} step={1} defaultValue={value} className={`${field} w-28`} />
    </label>
  );
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {num("dailyLimit", "Reports a member may send a day", settings.dailyLimit)}
        {num("maxScreenshots", "Screenshots a report (0: none)", settings.maxScreenshots)}
        {num("screenshotMaxMb", "Biggest picture a member may pick (MB)", settings.screenshotMaxMb)}
        {num("retentionDays", "Days screenshots are kept", settings.retentionDays)}
        <label className="flex min-w-[16rem] flex-col gap-1 text-xs text-muted-foreground">
          Email every new report to
          <input name="adminEmail" type="email" defaultValue={settings.adminEmail} placeholder={DEFAULT_SETTINGS.adminEmail} className={field} required />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        The privacy policy tells members screenshots are deleted after {DEFAULT_SETTINGS.retentionDays} days: change it too if you change how long they’re kept.
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
