"use client";

import { useState } from "react";
import { creditFetch, notifyCreditChanged } from "@/lib/credit/client";
import { detectListingUrl } from "@/lib/listing/detect";
import { readResolvedListing, RESOLVE_NETWORK_ERROR, type ResolvedListing } from "@/app/estimate/_components/listing-client-types";

/**
 * One text box that is either an area search or a listing check: plain text
 * filters the areas, a Rightmove / OnTheMarket / Airbnb link becomes a
 * "Check listing" action charged to the member's credit. Shared by the
 * classic top bar and the v2 filter bar so the two never drift.
 */
export function useListingSearch({
  q,
  onQuery,
  onResolved,
  initialCheckUrl = null,
}: {
  q: string;
  onQuery: (q: string) => void;
  onResolved: (r: ResolvedListing) => void;
  /** A listing URL prefilled from a deep link; the member still clicks Check. */
  initialCheckUrl?: string | null;
}) {
  const [text, setText] = useState(initialCheckUrl ?? q);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detected = detectListingUrl(text);
  // A link we cannot read is told apart from an area search, so the member
  // hears "not a listing page" rather than "no data for https://…".
  const badLink = !detected && /^https?:\/\//i.test(text.trim());

  const onText = (v: string) => {
    setText(v);
    setError(null);
    // A pasted link is a listing check, not an area search.
    const next = detectListingUrl(v) || /^https?:\/\//i.test(v.trim()) ? "" : v;
    if (next !== q) onQuery(next);
  };

  async function check() {
    if (!detected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await creditFetch("/api/listing/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: text.trim() }) });
      if (res.ok) notifyCreditChanged();
      const result = await readResolvedListing(res);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(result.listing);
      setText("");
    } catch {
      setError(RESOLVE_NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return { text, onText, busy, error, detected, badLink, check, prefilled: Boolean(initialCheckUrl) && text === initialCheckUrl };
}

export type ListingSearch = ReturnType<typeof useListingSearch>;
