"use client";

import { useState } from "react";

interface Conversation {
  id: string;
  startedAt: string;
  turns: { role: "member" | "agent"; text: string; at: string }[];
}

/**
 * Batch 26: the member's own chat for the last 90 days, newest first, and
 * one "Delete my chat history" button. Read only when asked for.
 */
export function ChatHistory() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Conversation[] | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/chat/history");
      const body = (await res.json()) as { conversations?: Conversation[]; days?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? "failed");
      setList(body.conversations ?? []);
      setDays(body.days ?? null);
    } catch {
      setMessage("Your history couldn’t be read just now.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete your chat history with Stayful Intelligence? This can't be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/history", { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setList([]);
      setMessage("Deleted.");
    } catch {
      setMessage("That didn’t delete. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-white/10 pt-4 text-sm">
      <button
        type="button"
        className="text-xs font-semibold text-[#B9D5C6] underline underline-offset-4"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && list === null) void load();
        }}
      >
        {open ? "Hide your chat history" : "Your chat history"}
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {busy && list === null && <p className="text-xs text-[#B9D5C6]">Loading…</p>}
          {message && <p className="text-xs text-[#B9D5C6]" role="status">{message}</p>}
          {list && list.length === 0 && !message && <p className="text-xs text-[#B9D5C6]">Nothing here{days ? ` from the last ${days} days` : ""}.</p>}
          {list?.map((c) => (
            <div key={c.id} className="space-y-1 rounded-xl bg-white/5 p-3">
              <p className="text-xs text-[#B9D5C6]">{new Date(c.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              {c.turns.map((t, i) => (
                <p key={i} className={t.role === "member" ? "font-semibold text-white" : "text-white/85"}>
                  {t.text}
                </p>
              ))}
            </div>
          ))}
          {list && list.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-md border border-white/30 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Delete my chat history
            </button>
          )}
          {days && <p className="text-xs text-[#B9D5C6]/80">I keep your chat for {days} days. After that your name comes off it; the questions stay, unnamed, so I can learn.</p>}
        </div>
      )}
    </div>
  );
}
