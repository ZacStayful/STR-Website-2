"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Share2 } from "lucide-react";
import { shareDealAction } from "../actions";

/**
 * Share one deal: mints (or reuses) the member's public link, then offers the
 * native share sheet, or copies the link where there is none. If the browser
 * refuses both (the tap went stale while the link was being made), the link
 * is shown to copy by hand. Free, and the page it links to shows only what
 * the card shows.
 */
export function ShareDealButton({ dealId, label = "Share", className }: { dealId: string; label?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  async function deliver(href: string) {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "A short-let deal on Stayful", url: href });
        return;
      }
      await navigator.clipboard.writeText(href);
      setNote("Link copied");
    } catch (err) {
      // The member closed the share sheet: nothing to do.
      if ((err as Error)?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(href);
        setNote("Link copied");
      } catch {
        setManual(true);
      }
    }
  }

  function share() {
    if (pending) return;
    if (url) {
      void deliver(url);
      return;
    }
    startTransition(async () => {
      const res = await shareDealAction(dealId);
      if (!res.ok) {
        setNote(res.error === "signed_out" ? "Sign in again to share" : res.error === "missing" ? "This deal can’t be shared" : "Couldn’t make a link");
        return;
      }
      setUrl(res.url);
      await deliver(res.url);
    });
  }

  return (
    <span className="relative inline-flex items-center">
      <button type="button" onClick={share} disabled={pending} aria-live="polite" className={className ?? "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"}>
        {note === "Link copied" ? <Check size={13} aria-hidden /> : <Share2 size={13} aria-hidden />}
        {note ?? label}
      </button>
      {manual && url && (
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          aria-label="Share link"
          className="absolute bottom-full right-0 z-10 mb-1 w-64 rounded-md border border-border bg-card px-2 py-1 text-xs shadow"
        />
      )}
    </span>
  );
}
