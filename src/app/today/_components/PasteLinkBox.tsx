"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { detectListingUrl, SERVER_FETCHABLE } from "@/lib/listing/detect";

/**
 * "Got your own property?" — takes a listing link to the analyser, which
 * reads and checks it on arrival (/estimate?listing=…, the same door every
 * "Full report" link uses). Only the links the analyser can read by itself
 * are sent on; anything else gets a line saying which ones work.
 */
export function PasteLinkBox() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const detected = detectListingUrl(url.trim());
    if (!detected || !SERVER_FETCHABLE.has(detected.source)) {
      setError("Paste a link to a Rightmove, OnTheMarket or Airbnb listing.");
      return;
    }
    setError(null);
    router.push(`/estimate?listing=${encodeURIComponent(detected.canonicalUrl)}`);
  }

  return (
    <form onSubmit={go} className="rounded-xl border border-border bg-card p-3">
      <label htmlFor="today-paste" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Link2 size={15} aria-hidden />
        Got your own property?
      </label>
      <p className="mt-0.5 text-xs text-muted-foreground">Paste a Rightmove, OnTheMarket or Airbnb link and we’ll run the numbers.</p>
      <div className="mt-2 flex gap-2">
        <input
          id="today-paste"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.rightmove.co.uk/properties/…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button type="submit" disabled={!url.trim()} className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          Analyse
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </form>
  );
}
