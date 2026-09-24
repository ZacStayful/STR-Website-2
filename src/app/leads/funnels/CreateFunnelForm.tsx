"use client";

import { useActionState } from "react";
import { createFunnelAction, type FunnelState } from "../actions";

const INITIAL: FunnelState = {};

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";
const labelCls = "block text-xs font-medium text-foreground";
const hint = "mt-1 text-xs text-muted-foreground";

/**
 * Creating a funnel asks for the two things it cannot work without.
 *
 * This form used to ask for a name alone, so the product minted a public link
 * and handed it over before it held any of what that link needs — and the
 * requirement only surfaced later, on the settings page, after the customer had
 * copied a link that could not function. Both fields are required here and
 * checked again server-side, so no funnel exists that is unable to go live.
 */
export function CreateFunnelForm() {
  const [state, action, pending] = useActionState(createFunnelAction, INITIAL);

  return (
    <form action={action} className="mt-3 grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelCls} htmlFor="new-funnel-name">Funnel name</label>
        <input
          id="new-funnel-name"
          name="name"
          type="text"
          maxLength={80}
          required
          placeholder="e.g. Website enquiry form"
          className={`${field} mt-1`}
        />
        <p className={hint}>Only you see this. Name it after where the enquiries come from.</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="new-funnel-company">Your company name</label>
        <input
          id="new-funnel-company"
          name="companyName"
          type="text"
          maxLength={80}
          required
          placeholder="e.g. Harrison Accommodations"
          className={`${field} mt-1`}
        />
        <p className={hint}>What your prospects see on the form and the report.</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="new-funnel-privacy">Privacy policy link</label>
        <input
          id="new-funnel-privacy"
          name="privacyUrl"
          type="url"
          required
          placeholder="https://yourcompany.com/privacy"
          className={`${field} mt-1`}
        />
        <p className={hint}>
          Whoever fills in your form is handing their details to you, not to us, so the policy has to be
          yours.
        </p>
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create funnel"}
        </button>
        <span className={`ml-2 ${hint}`}>
          It starts paused so you can check your branding and your daily limits first. Press{" "}
          <strong>Go live</strong> in its settings when you are ready — nothing else to fill in.
        </span>
        {state.error ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
