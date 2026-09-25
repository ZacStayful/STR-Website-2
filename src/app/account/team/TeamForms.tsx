"use client";

import { useActionState, useState } from "react";
import {
  inviteAction,
  revokeInviteAction,
  removeMemberAction,
  leaveTeamAction,
  type TeamState,
} from "./actions";

const INITIAL: TeamState = {};
const input = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm";
const button = "rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60";

function Status({ state }: { state: TeamState }) {
  if (state.error) return <p className="mt-2 text-xs text-destructive" role="alert">{state.error}</p>;
  if (state.notice) return <p className="mt-2 text-xs text-muted-foreground" role="status">{state.notice}</p>;
  return null;
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAction, INITIAL);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Each member costs £10 a month from your credit, first charged when they accept. Send the invite?")) {
          e.preventDefault();
        }
      }}
      className="mt-3"
    >
      <div className="flex flex-wrap gap-2">
        <label className="min-w-56 flex-1">
          <span className="sr-only">Email address</span>
          <input type="email" name="email" required placeholder="colleague@company.co.uk" className={`${input} w-full`} />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function RevokeInviteButton({ inviteId, email }: { inviteId: string; email: string }) {
  const [state, action, pending] = useActionState(revokeInviteAction, INITIAL);
  const [resendState, resend, resending] = useActionState(inviteAction, INITIAL);
  return (
    <div className="text-right">
      <div className="flex gap-2">
        <form action={resend}>
          <input type="hidden" name="email" value={email} />
          <button type="submit" disabled={resending} className={button}>{resending ? "Sending…" : "Resend"}</button>
        </form>
        <form action={action}>
          <input type="hidden" name="inviteId" value={inviteId} />
          <button type="submit" disabled={pending} className={button}>{pending ? "…" : "Withdraw"}</button>
        </form>
      </div>
      <Status state={state.error || state.notice ? state : resendState} />
    </div>
  );
}

export function RemoveMemberForm({ memberId, name, deletesLogin }: { memberId: string; name: string; deletesLogin: boolean }) {
  const [state, action, pending] = useActionState(removeMemberAction, INITIAL);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className={button} onClick={() => setOpen(true)}>Remove</button>
    );
  }
  return (
    <form action={action} className="w-full max-w-sm rounded-lg border border-border p-3 text-xs sm:w-auto">
      <input type="hidden" name="memberId" value={memberId} />
      <p className="text-foreground">
        Remove {name}? Seat charges stop, with no refund for this month.
        {deletesLogin ? <strong> Their login was created for your team and will be deleted.</strong> : " Their own Stayful account stays."}
      </p>
      <label className="mt-2 block text-muted-foreground">
        Type REMOVE to confirm
        <input name="confirm" autoComplete="off" className={`${input} mt-1 block w-full`} />
      </label>
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={pending} className={`${button} border-destructive text-destructive`}>{pending ? "Removing…" : "Remove"}</button>
        <button type="button" className={button} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function LeaveTeamForm() {
  const [state, action, pending] = useActionState(leaveTeamAction, INITIAL);
  return (
    <form action={action} className="mt-2 text-sm">
      <p className="text-muted-foreground">
        You&apos;ll lose access to the team&apos;s leads. If your login was created for this team, it will be deleted.
      </p>
      <label className="mt-3 block text-xs text-muted-foreground">
        Type LEAVE to confirm
        <input name="confirm" autoComplete="off" className={`${input} mt-1 block w-full max-w-xs`} />
      </label>
      <button type="submit" disabled={pending} className={`${button} mt-3 border-destructive text-destructive`}>
        {pending ? "Leaving…" : "Leave team"}
      </button>
      <Status state={state} />
    </form>
  );
}
