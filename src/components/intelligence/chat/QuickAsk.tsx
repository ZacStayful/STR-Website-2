"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useCreditOptional } from "@/components/credit/CreditProvider";
import { notifyCreditChanged } from "@/lib/credit/client";
import type { ChatReply } from "@/lib/chat/reply";
import { hintLabel } from "@/lib/chat/format";
import { MAX_QUESTION_CHARS } from "@/lib/chat/config";
import { ChatAnswer } from "./ChatAnswer";
import { TopUpToAsk } from "./TopUpToAsk";
import { newTurnId, sendQuick } from "./send";

/**
 * Batch 26: quick answers. A single line, "about 1p", the answer under it
 * with any button. When the question needs the member's own deals it offers
 * "Ask in the full view (about 8p)", carrying the question over but never
 * sending it: the member decides. Under the floor: "Top up to ask me more".
 */
export function QuickAsk({ hintPence, fullHintPence, floorPence, autoFocus = false }: { hintPence: number; fullHintPence: number; floorPence: number; autoFocus?: boolean }) {
  const credit = useCreditOptional()?.credit ?? null;
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept across a retry of the same send: the server never asks or charges twice for one id.
  const pending = useRef<{ id: string; question: string } | null>(null);

  const teamMember = Boolean(credit?.member);
  const outOfCredit = credit !== null && !credit.admin && credit.spendableBasePence < floorPence;

  async function send(q: string, id: string) {
    setBusy(true);
    setError(null);
    pending.current = { id, question: q };
    try {
      const r = await sendQuick(id, q);
      pending.current = null;
      setReply(r);
      setAsked(q);
      if (r.charged) notifyCreditChanged();
    } catch (err) {
      setError((err as Error)?.message === "signed_out" ? "Please sign in again." : "That didn’t get through.");
    } finally {
      setBusy(false);
    }
  }

  if (outOfCredit) return <TopUpToAsk teamMember={teamMember} />;

  return (
    <div className="space-y-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = question.trim();
          if (!q || busy) return;
          void send(q, newTurnId());
          setQuestion("");
        }}
      >
        <label htmlFor="si-quick-q" className="sr-only">
          Ask Stayful Intelligence a quick question
        </label>
        <input
          id="si-quick-q"
          type="text"
          autoFocus={autoFocus}
          maxLength={MAX_QUESTION_CHARS}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask me something quick"
          className="h-10 min-w-0 flex-1 rounded-lg border border-white/25 bg-white/10 px-3 text-sm text-white placeholder:text-white/50 focus:border-[#B9D5C6] focus:outline-none"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !question.trim()} className="h-10 shrink-0 rounded-lg bg-[#B9D5C6] px-4 text-sm font-semibold text-[#1a2118] disabled:opacity-50">
          {busy ? "…" : "Ask"}
        </button>
      </form>
      <p className="text-xs text-[#B9D5C6]">Quick answers, {hintLabel(hintPence)} each. You only pay for an answer.</p>
      {error && (
        <p className="text-sm text-white" role="alert">
          {error}{" "}
          {pending.current && (
            <button type="button" className="underline underline-offset-2" onClick={() => pending.current && void send(pending.current.question, pending.current.id)}>
              Try again
            </button>
          )}
        </p>
      )}
      {reply && reply.state === "full_view" && (
        <div className="rounded-xl bg-white/10 p-4 text-sm text-white">
          <p>{reply.text}</p>
          <Link href={`/intelligence?ask=${encodeURIComponent(asked)}#si-ask`} className="mt-3 inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90">
            Ask in the full view ({hintLabel(fullHintPence)})
          </Link>
        </div>
      )}
      {reply && reply.state === "top_up" && <TopUpToAsk teamMember={teamMember} />}
      {reply && reply.state !== "full_view" && reply.state !== "top_up" && <ChatAnswer reply={reply} />}
    </div>
  );
}
