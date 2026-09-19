"use client";

import { useActionState } from "react";
import { createFunnelAction, type FunnelState } from "../actions";

const INITIAL: FunnelState = {};

export function CreateFunnelForm() {
  const [state, action, pending] = useActionState(createFunnelAction, INITIAL);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <input
        name="name"
        type="text"
        maxLength={80}
        required
        placeholder="e.g. Website enquiry form"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create funnel"}
      </button>
      {state.error ? (
        <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
