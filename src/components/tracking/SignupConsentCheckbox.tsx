"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { chooseConsent, newVisitorId, readConsentRaw, subscribeConsent } from "@/lib/tracking/browser";
import { COOKIE_POLICY_HREF, CONSENT_WORDING } from "@/lib/tracking/config";
import { parseConsent, secondChanceShown, type Choice } from "@/lib/tracking/consent";
import { consentSaved, noteChoice } from "@/lib/tracking/runtime";

const serverRaw = (): string | null => null;

/**
 * The second chance to say yes to Meta's pixel (Batch 19): one unticked
 * checkbox, never required.
 *
 *   On the sign-up form: a field of the form (meta_consent), saved as Accept
 *   ("signup") with the new account. Shown while this device has not
 *   accepted; the page leaves it out for team invites.
 *
 *   `instant`, on the quiz's start screen (new Google sign-ups, who never
 *   saw the form): ticking it is Accept at once, unticking it Reject. The
 *   page decides whether it shows.
 */
export function SignupConsentCheckbox({ initialChoice = null, instant = false }: { initialChoice?: Choice | null; instant?: boolean }) {
  const raw = useSyncExternalStore<string | null>(subscribeConsent, readConsentRaw, serverRaw);
  const [checked, setChecked] = useState(false);
  const choice = raw === null ? initialChoice : parseConsent(raw)?.choice ?? null;
  if (!instant && !secondChanceShown(choice)) return null;

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const on = e.target.checked;
    setChecked(on);
    if (!instant) return;
    const next: Choice = on ? "accept" : "reject";
    noteChoice(next);
    void chooseConsent(next, "signup", parseConsent(readConsentRaw())?.visitorId ?? newVisitorId()).then(() => consentSaved(next));
  };

  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={instant ? undefined : "meta_consent"} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 shrink-0 rounded border-border" />
      <span>
        {CONSENT_WORDING.checkbox}{" "}
        <Link href={COOKIE_POLICY_HREF} target="_blank" className="underline underline-offset-2">
          {CONSENT_WORDING.policyLink}
        </Link>
      </span>
    </label>
  );
}
