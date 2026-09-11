"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { detectListingUrl, SOURCE_LABELS } from "@/lib/listing/detect";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";

/** "Check a listing" paste box under the goal bar. */
export function ListingCheck({ onResolved }: { onResolved: (r: ResolvedListing) => void }) {
  const [url, setUrl] = useState("");
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
      // The route always answers JSON; anything else is the platform (a gateway timeout, a proxy error page).
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!data || typeof data !== "object") {
        setError(res.status === 504 || res.status === 502 ? "Stayful took too long reading that listing. Please try again in a moment." : `Something went wrong on our side (HTTP ${res.status}). Please try again.`);
        return;
      }
      if (!res.ok || data.error) {
        setError(typeof data.error === "string" ? data.error : "Could not read that listing.");
        return;
      }
      onResolved(data as unknown as ResolvedListing);
      setUrl("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
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
      {detected && !error && !busy && <span className="mx-listing-check-hint">{SOURCE_LABELS[detected.source]} · free quick view, no report used</span>}
      {error && <span className="mx-listing-check-error" role="alert">{error}</span>}
    </div>
  );
}
