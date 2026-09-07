"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { detectListingUrl, SOURCE_LABELS } from "@/lib/listing/detect";
import type { ResolvedListing } from "@/app/estimate/_components/listing-client-types";

/**
 * "Check a listing" paste box under the goal bar. `initialUrl` (from a
 * `/markets?check=` deep link in the sourcing email) is checked as soon as
 * the box mounts, once.
 */
export function ListingCheck({ onResolved, initialUrl = null }: { onResolved: (r: ResolvedListing) => void; initialUrl?: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detected = detectListingUrl(url);
  const autoRan = useRef(false);

  async function run(target = url) {
    if (!detectListingUrl(target)) {
      setError("Paste a Rightmove, OnTheMarket or Airbnb listing link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/listing/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: target }) });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Could not read that listing.");
        return;
      }
      onResolved(data as ResolvedListing);
      setUrl("");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialUrl || autoRan.current) return;
    autoRan.current = true;
    const timer = setTimeout(() => void run(initialUrl), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the deep-linked URL
  }, [initialUrl]);

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
      <button type="button" className="mx-cta mx-cta--sm" onClick={() => void run()} disabled={busy || !url.trim()}>
        {busy ? <Loader2 size={14} className="mx-spin" aria-hidden /> : "Check listing"}
      </button>
      {detected && !error && !busy && <span className="mx-listing-check-hint">{SOURCE_LABELS[detected.source]} · free quick view, no report used</span>}
      {error && <span className="mx-listing-check-error" role="alert">{error}</span>}
    </div>
  );
}
