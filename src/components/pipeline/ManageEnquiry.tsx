"use client";

import { useActionState, useState } from "react";
import type { ManageView } from "@/lib/pipeline/view";
import type { StepKind } from "@/lib/pipeline/types";
import type { EnquiryState } from "@/app/markets/actions";
import { nextStepEnquiryAction } from "@/app/my-deals/next-step-actions";

const initial: EnquiryState = { error: null, sent: false };

/**
 * The Secured stage's one low-key line, "Want Stayful to manage it for you?
 * Talk to us". The link opens a short form that goes to the same Management
 * Leads board as the Market Explorer's enquiry, labelled as from My deals.
 */
export function ManageEnquiry({ view, itemKey, kind }: { view: ManageView; itemKey: string; kind: StepKind }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(nextStepEnquiryAction, initial);
  const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

  if (state.sent) return <p className="text-xs text-muted-foreground">{view.sent}</p>;
  return (
    <div className="text-xs text-muted-foreground">
      {view.line}{" "}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-primary hover:underline">
          {view.linkText}
        </button>
      )}
      {open && (
        <form action={action} className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p>{view.formIntro}</p>
          <input type="hidden" name="area" value={view.area} />
          <input type="hidden" name="itemKey" value={itemKey} />
          <input type="hidden" name="kind" value={kind} />
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1"><span>{view.nameLabel}</span><input name="name" required defaultValue={view.name} autoComplete="name" className={field} /></label>
            <label className="space-y-1"><span>{view.emailLabel}</span><input name="email" type="email" required defaultValue={view.email} autoComplete="email" className={field} /></label>
            <label className="space-y-1"><span>{view.phoneLabel}</span><input name="phone" type="tel" autoComplete="tel" className={field} /></label>
          </div>
          <label className="block space-y-1"><span>{view.messageLabel}</span><textarea name="message" rows={3} defaultValue={view.message} className={field} /></label>
          {state.error && <p className="text-destructive">{state.error}</p>}
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {view.send}
          </button>
        </form>
      )}
    </div>
  );
}
