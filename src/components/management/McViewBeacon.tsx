"use client";

import { useEffect } from "react";

/**
 * Batch 22f: counts this view of the management page (anonymously; see
 * /api/mc/view). Whether it came from an ad is read off the address the page
 * was first loaded at, before the tracking tags are tidied away.
 */
export function McViewBeacon() {
  useEffect(() => {
    let tagged = false;
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const first = new URL(nav?.name || window.location.href);
      tagged = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"].some((k) => first.searchParams.has(k));
    } catch {
      /* counted as untagged */
    }
    fetch("/api/mc/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tagged }), keepalive: true }).catch(() => {});
  }, []);
  return null;
}
