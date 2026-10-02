"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FunnelBrand } from "@/lib/funnels/brand";
import { saveBrandAction, type FunnelState } from "../../actions";
import { recordSetupStepAction } from "../actions";
import { BrandHidden, ErrorLine, field, labelCls, primaryBtn } from "../ui";

const INITIAL: FunnelState = {};

/** Batch 22f, step 2: reply-to (their login email by default) and the privacy policy. */
export function DetailsStep({ funnel, loginEmail }: { funnel: { id: string; name: string; brand: FunnelBrand }; loginEmail: string | null }) {
  const router = useRouter();
  const [state, action, saving] = useActionState(saveBrandAction, INITIAL);
  const [moving, startMove] = useTransition();
  useEffect(() => {
    if (state.saved) {
      startMove(async () => {
        await recordSetupStepAction(2);
        router.push("/leads/setup/delivery");
      });
    }
  }, [state.saved, router]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={funnel.id} />
      <input type="hidden" name="name" value={funnel.name} />
      <BrandHidden brand={funnel.brand} omit={["replyToEmail", "privacyUrl"]} />
      <div>
        <label className={labelCls} htmlFor="replyToEmail">Reply-to email</label>
        <input id="replyToEmail" name="replyToEmail" type="email" required defaultValue={funnel.brand.replyToEmail ?? loginEmail ?? ""} className={field} autoComplete="email" />
        <p className="mt-1 text-xs text-muted-foreground">When a landlord replies to their report email, it comes here.</p>
      </div>
      <div>
        <label className={labelCls} htmlFor="privacyUrl">Your privacy policy (link)</label>
        <input id="privacyUrl" name="privacyUrl" type="url" inputMode="url" placeholder="https://yourcompany.co.uk/privacy" defaultValue={funnel.brand.privacyUrl ?? ""} className={field} />
        <p className="mt-1 text-xs text-muted-foreground">
          Landlords are giving their details to you, so your form links to your privacy policy, and it can&apos;t go live without
          one. No link yet? Carry on: you can finish the setup now and your form stays paused until you add it.
        </p>
      </div>
      <ErrorLine state={state} />
      <button type="submit" disabled={saving || moving} className={primaryBtn}>
        {saving || moving ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
