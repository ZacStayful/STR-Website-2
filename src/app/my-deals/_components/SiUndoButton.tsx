"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Batch 27: Undo for what Stayful Intelligence changed (the same Undo as the chat's). */
export function SiUndoButton({ instructionId }: { instructionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (note) return <span className="text-xs text-muted-foreground">{note}</span>;
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-md border border-border px-3 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`/api/si/actions/${instructionId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "undo" }) }).catch(() => null);
        const body = res ? ((await res.json().catch(() => ({}))) as { card?: { undone?: string | null }; error?: string }) : {};
        setNote(body.card?.undone ?? body.error ?? "That didn’t go through. Please try again.");
        setBusy(false);
        router.refresh();
      }}
    >
      Undo
    </button>
  );
}
