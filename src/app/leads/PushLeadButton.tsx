"use client";

import { useActionState } from "react";
import { pushLeadAction, type CrmState } from "./integrations/actions";

const INITIAL: CrmState = {};

/**
 * Sends a held lead on by hand.
 *
 * This is the promise behind the "hold" policy: a lead that missed the
 * customer's filter is still theirs, and still theirs to change their mind
 * about. Shown only where it can work — a lead with no report yet has
 * nothing to send.
 */
export function PushLeadButton({ leadId, pushed }: { leadId: string; pushed: boolean }) {
  const [state, action, pending] = useActionState(pushLeadAction, INITIAL);

  if (pushed || state.saved) {
    return <span className="text-xs text-muted-foreground">In your CRM</span>;
  }

  return (
    <form action={action} className="text-right">
      <input type="hidden" name="leadId" value={leadId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send to CRM"}
      </button>
      {state.error ? <p className="mt-1 max-w-48 text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
