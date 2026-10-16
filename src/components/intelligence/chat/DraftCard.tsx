"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftView } from "@/lib/si-actions/view";
import { openFeedback } from "@/lib/feedback/client";

/**
 * Batch 27: a message the eye drafted for the member from the next-step
 * slot's own template. Copy, then they send it themselves (the eye never
 * sends anything); then the slot's own move ("Move to Contacted"), only on
 * their tap, with Undo on the answer's card.
 */
export function DraftCard({ draft, turnId }: { draft: DraftView; turnId: string | null }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = `${draft.subject}\n\n${draft.body}`;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/20 p-3 text-sm">
      <p className="text-xs text-[#B9D5C6]">For the {draft.dealLabel} · you send it</p>
      <p className="font-semibold">{draft.subject}</p>
      <p className="whitespace-pre-line">{draft.body}</p>
      {draft.offerRange && (
        <p className="text-xs text-[#B9D5C6]">
          Offer range: {draft.offerRange}
          {draft.offerNote ? ` — ${draft.offerNote}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {draft.move && turnId && !moved && (
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-white/30 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
            onClick={async () => {
              setBusy(true);
              const res = await fetch(`/api/si/actions/${turnId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "move", dealId: draft.dealId, stage: draft.move!.to }) }).catch(() => null);
              const body = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; note?: string }) : {};
              // Moved: the button goes. Not moved: it stays, to try again.
              if (body.ok) setMoved(body.note ?? "Moved.");
              else setMoveNote(body.note ?? "That didn’t move. Please try again.");
              setBusy(false);
              if (body.ok) router.refresh();
            }}
          >
            {draft.move.label}
          </button>
        )}
      </div>
      {(moved ?? moveNote) && <p className="text-xs text-[#B9D5C6]">{moved ?? moveNote}</p>}
    </div>
  );
}

/** Batch 27: a feature request the eye filled in; the member checks it and sends it from Batch 18's own form. */
export function FeatureRequest({ text }: { text: string }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/20 p-3 text-sm">
      <p className="text-xs text-[#B9D5C6]">A request for the Stayful team, ready for you to check and send</p>
      <p className="whitespace-pre-line">{text}</p>
      <button type="button" className="rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90" onClick={() => openFeedback({ kind: "feature", text })}>
        Check and send
      </button>
    </div>
  );
}
