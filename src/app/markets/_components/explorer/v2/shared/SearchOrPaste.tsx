"use client";

import { Link2, Loader2, Search } from "lucide-react";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import type { ListingSearch } from "./useListingSearch";

export const SEARCH_PLACEHOLDER = "Search an area or postcode, or paste a Rightmove, OnTheMarket or Airbnb link";

/** The input itself; state comes from useListingSearch so the hint can sit elsewhere in the layout. */
export function SearchOrPaste({ search, className = "", placeholder = SEARCH_PLACEHOLDER, autoFocus = false }: { search: ListingSearch; className?: string; placeholder?: string; autoFocus?: boolean }) {
  const { text, onText, busy, detected, check } = search;
  return (
    <label className={`mx-search mx-search--bar ${className}${detected ? " is-link" : ""}`}>
      {detected ? <Link2 size={16} aria-hidden /> : <Search size={16} aria-hidden />}
      <input
        type="search"
        className="mx-search-input"
        placeholder={placeholder}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && detected) {
            e.preventDefault();
            void check();
          }
        }}
        disabled={busy}
        aria-label="Search an area or paste a listing link"
        autoFocus={autoFocus}
      />
      {detected && (
        <button type="button" className="mx-cta mx-cta--sm" onClick={check} disabled={busy}>
          {busy ? <Loader2 size={14} className="mx-spin" aria-hidden /> : "Check listing"}
        </button>
      )}
    </label>
  );
}

/** The line under the box: a resolve error, a "not a listing" note, or which source was detected. Null when there is nothing to say. */
export function SearchHint({ search }: { search: ListingSearch }) {
  const { detected, error, badLink, prefilled } = search;
  if (error) return <span className="mx-listing-check-error" role="alert">{error}</span>;
  if (badLink) return <span className="mx-listing-check-error" role="alert">That link is not a listing page we can read. Paste a Rightmove, OnTheMarket or Airbnb listing link.</span>;
  if (detected) return <span className="mx-listing-check-hint">{SOURCE_LABELS[detected.source]} listing · {prefilled ? "press Check listing to add it to your deals" : "free quick view, no report used"}</span>;
  return null;
}
