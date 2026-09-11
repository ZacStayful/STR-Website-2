"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { detectListingUrl, SOURCE_LABELS } from "@/lib/listing/detect";
import { readResolvedListing, RESOLVE_NETWORK_ERROR, type ResolvedListing } from "@/app/estimate/_components/listing-client-types";

/**
 * "Check a listing" paste box under the goal bar. `initialUrl` (from a
 * `/markets?check=` deep link in the sourcing email) only prefills the box:
 * the member still clicks Check, so a plain link can never add listings to
 * their pipeline or spend their daily checks on their behalf.
 */
export function ListingCheck({ onResolved, initialUrl = null }: { onResolved: (r: ResolvedListing) => void; initialUrl?: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detected = detectListingUrl(url);

  async function run() {
    if (!detected) {
      setError("Paste a Rightmove, OnTheMarket or Airbnb listing link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/listing/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const result = await readResolvedListing(res);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(result.listing);
      setUrl("");
    } catch {
      setError(RESOLVE_NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-listing-check">
      <label className="mx-search mx-search--bar mx-listing-check-input">
        <Link2 size={15} aria-hidden />
        <input
          type="url"
          className="mx-search-input"
          placeholder="Check a listing: paste a Rightmove, OnTheMarket or Airbnb link"
          value={url}
          autoFocus={Boolean(initialUrl)}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          disabled={busy}
          aria-label="Listing link"
        />
      </label>
      <button type="button" className="mx-cta mx-cta--sm" onClick={run} disabled={busy || !url.trim()}>
        {busy ? <Loader2 size={14} className="mx-spin" aria-hidden /> : "Check listing"}
      </button>
      {detected && !error && !busy && <span className="mx-listing-check-hint">{SOURCE_LABELS[detected.source]} · {initialUrl && url === initialUrl ? "press Check listing to add it to your pipeline" : "free quick view, no report used"}</span>}
      {error && <span className="mx-listing-check-error" role="alert">{error}</span>}
    </div>
  );
}
