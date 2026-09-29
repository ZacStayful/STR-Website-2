"use client";

import Link from "next/link";
import { COOKIE_POLICY_HREF, CONSENT_WORDING } from "@/lib/tracking/config";
import type { Choice } from "@/lib/tracking/consent";

// Accept and Reject look exactly the same: equal size and weight, no nudging.
const CHOICE = "h-10 flex-1 rounded-lg border border-primary bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none sm:min-w-28";

/**
 * The cookie banner (Batch 19). Fixed to the bottom, one short line and two
 * equal buttons; one tap either way dismisses it. The × closes it without a
 * choice, which counts as no consent (it comes back on the next page load).
 * Sits below the credit toast and the feedback sheet.
 */
export function CookieBanner({ current, onChoose, onClose }: { current: Choice | null; onChoose: (choice: Choice) => void; onClose: () => void }) {
  return (
    <div role="region" aria-label="Cookie choice" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="pointer-events-auto relative mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <p className="flex-1 pr-6 text-sm leading-snug sm:pr-0">
          {CONSENT_WORDING.banner}{" "}
          <Link href={COOKIE_POLICY_HREF} className="whitespace-nowrap underline underline-offset-2">
            {CONSENT_WORDING.policyLink}
          </Link>
          {current ? <span className="mt-1 block text-xs text-muted-foreground">Your choice now: {current === "accept" ? "Accept" : "Reject"}.</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className={CHOICE} onClick={() => onChoose("accept")}>
            {CONSENT_WORDING.accept}
          </button>
          <button type="button" className={CHOICE} onClick={() => onChoose("reject")}>
            {CONSENT_WORDING.reject}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close without choosing"
          className="absolute right-5 top-2 h-8 w-8 rounded-full text-lg leading-none text-muted-foreground hover:text-foreground sm:static sm:h-8 sm:w-8"
        >
          ×
        </button>
      </div>
    </div>
  );
}
