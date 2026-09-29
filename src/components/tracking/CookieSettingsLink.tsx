"use client";

import { openCookieSettings } from "@/lib/tracking/browser";
import { CONSENT_WORDING } from "@/lib/tracking/config";
import { metaPixelId } from "@/lib/meta/env";

// NEXT_PUBLIC_ values are fixed at build time, so the server and the browser
// agree. Without a dataset there is no banner to reopen, so no link either.
const ENABLED = metaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID }) !== null;

/**
 * "Cookie settings" (Batch 19): in the marketing footer, the members' footer
 * and under the sign-in forms. Reopens the cookie banner with the current
 * choice, so anyone can change their mind or withdraw at any time.
 * `separator` puts the footer's " · " in front (only when the link shows);
 * "quiet" is a small line of its own, under the sign-in forms.
 */
export function CookieSettingsLink({ variant, separator = false }: { variant: "marketing" | "members" | "quiet"; separator?: boolean }) {
  if (!ENABLED) return null;
  const dot = separator ? (
    <span className="mx-2" aria-hidden="true">
      ·
    </span>
  ) : null;
  if (variant === "marketing") {
    return (
      <button
        type="button"
        onClick={openCookieSettings}
        style={{ textDecoration: "none", color: "var(--ink-soft)", background: "none", border: 0, padding: 0, font: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        {CONSENT_WORDING.settingsLink}
      </button>
    );
  }
  if (variant === "quiet") {
    return (
      <p className="mt-6 text-center">
        <button type="button" onClick={openCookieSettings} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {CONSENT_WORDING.settingsLink}
        </button>
      </p>
    );
  }
  return (
    <>
      {dot}
      <button type="button" onClick={openCookieSettings} className="font-medium text-foreground underline underline-offset-2 hover:opacity-80">
        {CONSENT_WORDING.settingsLink}
      </button>
    </>
  );
}
