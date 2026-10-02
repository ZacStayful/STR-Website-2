"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveNotifyAction, type FunnelState } from "../../actions";
import { recordSetupStepAction } from "../actions";
import { ErrorLine, primaryBtn } from "../ui";

const INITIAL: FunnelState = {};

/** Batch 22f, step 3: "Email me each new lead" (on), the optional CRM panels, then the finish. */
export function DeliveryStep({ funnelId, notifyNewLead, email, children }: { funnelId: string; notifyNewLead: boolean; email: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [state, action, saving] = useActionState(saveNotifyAction, INITIAL);
  const [moving, startMove] = useTransition();
  useEffect(() => {
    if (state.saved) {
      startMove(async () => {
        await recordSetupStepAction(3);
        router.push("/leads/setup/live");
      });
    }
  }, [state.saved, router]);

  return (
    <div className="space-y-5">
      <form action={action} id="notify-form" className="space-y-3">
        <input type="hidden" name="id" value={funnelId} />
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
          <input type="checkbox" name="notifyNewLead" defaultChecked={notifyNewLead} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">Email me each new lead</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              The landlord&apos;s name and contact details, the property, the headline income and a link to their report{email ? `, to ${email}` : ""}. Free.
            </span>
          </span>
        </label>
        <ErrorLine state={state} />
      </form>
      {children}
      <button type="submit" form="notify-form" disabled={saving || moving} className={primaryBtn}>
        {saving || moving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
