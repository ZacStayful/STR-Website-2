"use client";

import { useActionState } from "react";
import { acceptInviteAction, type JoinState } from "./actions";

const INITIAL: JoinState = {};

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, INITIAL);
  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join the team"}
      </button>
      {state.error ? <p className="mt-3 text-sm text-destructive" role="alert">{state.error}</p> : null}
    </form>
  );
}
