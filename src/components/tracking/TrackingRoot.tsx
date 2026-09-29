"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { surfaceFor } from "@/lib/tracking/surfaces";
import { bannerShown, parseConsent, type Choice } from "@/lib/tracking/consent";
import { chooseConsent, isFramed, newVisitorId, OPEN_COOKIE_SETTINGS_EVENT, readConsentRaw, subscribeConsent } from "@/lib/tracking/browser";
import { CookieBanner } from "./CookieBanner";

// Server render and hydration: the cookie is not known yet, so nothing shows.
const SERVER_SNAPSHOT = "\u0000";
const serverSnapshot = () => SERVER_SNAPSHOT;
const subscribeNothing = () => () => {};
const serverFramed = () => true;

/**
 * Cookie consent for every page (Batch 19), rendered once by the root layout
 * after the page itself. It decides from the address (src/lib/tracking/
 * surfaces.ts) whether this page may ask at all: white-label funnel pages,
 * admin, token pages and anything unknown get nothing, and so does any page
 * shown inside a frame.
 *
 * The choice lives in the essential consent cookie; the banner shows until
 * there is one. "Cookie settings" (in the footers) reopens it.
 */
export function TrackingRoot({ bannerOn }: { bannerOn: boolean }) {
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribeConsent, readConsentRaw, serverSnapshot);
  const framed = useSyncExternalStore(subscribeNothing, isFramed, serverFramed);
  // Closed without a choice: gone until the next full page load (the root
  // layout keeps this component, and its state, across client navigation).
  const [dismissed, setDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
  }, []);

  const hydrated = raw !== SERVER_SNAPSHOT;
  const device = hydrated ? parseConsent(raw) : null;
  const surface = !hydrated || framed ? "none" : surfaceFor(pathname);
  const visitorId = device?.visitorId ?? null;

  const choose = (choice: Choice) => {
    const source = settingsOpen ? "settings" : "banner";
    setSettingsOpen(false);
    void chooseConsent(choice, source, visitorId ?? newVisitorId());
  };

  const close = () => {
    if (settingsOpen) setSettingsOpen(false);
    else setDismissed(true);
  };

  const shown = bannerShown({ enabled: bannerOn, surface, choice: device?.choice ?? null, dismissed, settingsOpen, lookingUp: false });
  if (!shown) return null;
  return <CookieBanner current={settingsOpen ? device?.choice ?? null : null} onChoose={choose} onClose={close} />;
}
