"use client";

import { useEffect, useState } from "react";
import { mailtoHref } from "@/lib/pipeline/render";

/**
 * A message ready to send: the subject, the text in a box the member can
 * also select by hand, Copy, and Open in email (subject and body filled in,
 * no recipient: we never hold the agent's address).
 */
export function MessageBox({
  subject,
  body,
  labels,
  onCopy,
  onEmail,
}: {
  subject: string;
  body: string;
  labels: { copy: string; copied: string; email: string; copyFallback: string };
  onCopy: () => void;
  onEmail: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setFailed(false);
      onCopy();
    } catch {
      // Clipboard blocked (an insecure page, an old browser): the text box is there to select by hand.
      setFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Subject: <span className="font-medium text-foreground">{subject}</span>
      </p>
      <textarea readOnly value={body} rows={Math.min(14, body.split("\n").length + 1)} className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed text-foreground" onFocus={(e) => e.currentTarget.select()} aria-label="Message" />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" aria-live="polite">
          {copied ? labels.copied : labels.copy}
        </button>
        <a href={mailtoHref(subject, body)} onClick={onEmail} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          {labels.email}
        </a>
      </div>
      {failed && <p className="text-xs text-muted-foreground">{labels.copyFallback}</p>}
    </div>
  );
}
