"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";

// ─── Postcode split ──────────────────────────────────────────────
// Google returns addresses like "17 Park Crescent, York YO31 7NU, UK".
// Split into a clean address (no postcode, no trailing UK) and the postcode.
const UK_POSTCODE_RE = /([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})/i;

export function splitAddressAndPostcode(description: string): { address: string; postcode: string } {
  const cleaned = description.replace(/,\s*UK\s*$/i, "").trim();
  const m = cleaned.match(UK_POSTCODE_RE);
  if (!m) return { address: cleaned, postcode: "" };
  const postcode = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  const address = cleaned
    .replace(UK_POSTCODE_RE, "")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/, "")
    .trim();
  return { address, postcode };
}

// ─── Debounce hook (no new dependency) ───────────────────────────
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ─── Suggestion shape (mirrors /api/address-autocomplete response) ─
interface Suggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface AddressAutocompleteProps {
  onSelect: (result: { address: string; postcode: string }) => void;
  onUseManual: (typedQuery: string) => void;
  disabled?: boolean;
}

export function AddressAutocomplete({ onSelect, onUseManual, disabled }: AddressAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // One session token per mount. Google bills an entire autocomplete session
  // (typing → selection) as a single unit when a token is passed.
  const sessionToken = useMemo(
    () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    [],
  );

  const debouncedQuery = useDebouncedValue(query, 300);

  // Fetch suggestions when the debounced query changes.
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/address-autocomplete?q=${encodeURIComponent(q)}&session=${encodeURIComponent(sessionToken)}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { suggestions?: Suggestion[]; error?: string }) => {
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        if (data.error) setError(data.error);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setSuggestions([]);
        setError("Address search is temporarily unavailable");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [debouncedQuery, sessionToken]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const choose = (s: Suggestion) => {
    const parts = splitAddressAndPostcode(s.description);
    onSelect(parts);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        setOpen(true);
        setHighlightIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setHighlightIndex((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        choose(suggestions[highlightIndex]);
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && (loading || suggestions.length > 0 || (debouncedQuery.trim().length >= 3 && !loading));

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlightIndex(-1);
          }}
          onFocus={() => {
            if (suggestions.length > 0 || query.trim().length >= 3) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Start typing your address, e.g. 17 Park Crescent York"
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="address-autocomplete-listbox"
          className="pr-9"
        />
        {loading && (
          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!loading && query.trim().length >= 3 && (
          <MapPin className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {showDropdown && (
        <ul
          id="address-autocomplete-listbox"
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-auto rounded-md border border-border bg-card shadow-lg"
        >
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">Searching…</li>
          )}
          {!loading && suggestions.length === 0 && debouncedQuery.trim().length >= 3 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              No matches. Try a different search or enter manually.
            </li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === highlightIndex}
              onMouseEnter={() => setHighlightIndex(i)}
              onMouseDown={(e) => {
                // mousedown so we select before onBlur closes the dropdown.
                e.preventDefault();
                choose(s);
              }}
              className={`cursor-pointer px-3 py-2.5 text-sm ${
                i === highlightIndex ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted"
              }`}
            >
              <p className="font-medium truncate">{s.mainText || s.description}</p>
              {s.secondaryText && (
                <p className="text-xs text-muted-foreground truncate">{s.secondaryText}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1.5 flex items-center justify-between text-xs">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <span className="text-muted-foreground">
            We&apos;ll auto-fill the postcode. UK addresses only.
          </span>
        )}
        <button
          type="button"
          onClick={() => onUseManual(query)}
          className="font-medium text-primary hover:underline"
        >
          Can&apos;t find it? Enter manually
        </button>
      </div>
    </div>
  );
}
