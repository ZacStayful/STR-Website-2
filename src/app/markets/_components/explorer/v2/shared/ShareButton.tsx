"use client";

import { useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";

/** Native share sheet where there is one, otherwise copy the link. */
export function ShareButton({ title, url, className = "mx2-btn mx2-btn--secondary" }: { title?: string; url?: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);

  async function share() {
    const href = url ?? window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: title ?? document.title, url: href });
        return;
      }
      await navigator.clipboard.writeText(href);
      setDone(true);
    } catch {
      // the member dismissed the sheet, or clipboard access was refused: nothing to report
    }
  }

  return (
    <button type="button" className={className} onClick={share} aria-live="polite">
      {done ? <><Check size={14} aria-hidden /> Link copied</> : <><Share2 size={14} aria-hidden /> Share</>}
    </button>
  );
}
