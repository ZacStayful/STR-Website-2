"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCreditOptional } from "@/components/credit/CreditProvider";
import { notifyCreditChanged } from "@/lib/credit/client";
import type { ChatReply } from "@/lib/chat/reply";
import { hintLabel } from "@/lib/chat/format";
import { MAX_QUESTION_CHARS, QUICK_SUGGESTIONS } from "@/lib/chat/config";
import { ChatAnswer } from "./ChatAnswer";
import { ChatComposer } from "./ChatComposer";
import { TopUpToAsk } from "./TopUpToAsk";
import { setChatEye } from "./chat-state";
import { newTurnId, sendQuick } from "./send";
import { useVoice } from "./voice";

interface Entry {
  key: string;
  clientTurnId: string;
  question: string;
  waiting: boolean;
  reply: ChatReply | null;
  /** Didn't get through (or is still being answered): shown with "Try again", the same id. */
  error: string | null;
}

/**
 * Batch 26: quick answers, as a small conversation: the answers scroll, the
 * box (type or talk) stays at the bottom. "About 1p". When a question needs
 * the member's own deals it offers "Ask in the full view (about 8p)",
 * carrying the question over but never sending it. Under the floor: "Top up
 * to ask me more". Used by the panel under the header eye (desktop) and the
 * full-screen page (/intelligence/ask, phones).
 */
export function QuickChat(p: { hintPence: number; fullHintPence: number; floorPence: number; voice: boolean; autoFocus?: boolean; inputId: string }) {
  const credit = useCreditOptional()?.credit ?? null;
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const spokenNext = useRef(false);
  const spokenKeys = useRef(new Set<string>());

  const teamMember = Boolean(credit?.member);
  const outOfCredit = credit !== null && !credit.admin && credit.spendableBasePence < p.floorPence;

  const voice = useVoice({
    enabled: p.voice,
    onHeard: (text) => {
      spokenNext.current = true;
      submit(text);
    },
    onMessage: setNotice,
  });

  // The send in flight is dropped if the box goes away (a finished answer is still in "Your chat history").
  useEffect(
    () => () => {
      inFlight.current?.abort();
      setChatEye("idle");
    },
    [],
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries]);

  const update = (key: string, f: (e: Entry) => Entry) => setEntries((list) => list.map((e) => (e.key === key ? f(e) : e)));

  async function send(key: string, q: string, id: string, retry = false): Promise<void> {
    setBusy(true);
    setNotice(null);
    setChatEye("thinking");
    update(key, (e) => ({ ...e, clientTurnId: id, waiting: true, error: null }));
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    let spokenReply: string | null = null;
    try {
      const r = await sendQuick(id, q, ctrl.signal);
      if (r.state === "busy" || r.state === "too_fast") {
        // Still being answered (another tab, or this one before a drop): keep the retry for later.
        update(key, (e) => ({ ...e, waiting: false, error: r.text }));
        return;
      }
      if (r.state === "did_not_finish" && retry) {
        // The first try never finished (and wasn't charged): ask it afresh, as a new question.
        await send(key, q, newTurnId());
        return;
      }
      update(key, (e) => ({ ...e, waiting: false, reply: r, error: null }));
      if (r.charged) notifyCreditChanged();
      if (spokenKeys.current.has(key) && r.text) spokenReply = r.text;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      update(key, (e) => ({ ...e, waiting: false, error: (err as Error)?.message === "signed_out" ? "Please sign in again." : "That didn’t get through." }));
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
      setBusy(false);
      setChatEye("idle");
    }
    // Asked out loud: answered out loud.
    if (spokenReply) void voice.speak(spokenReply);
  }

  function submit(q: string) {
    const text = q.trim().slice(0, MAX_QUESTION_CHARS);
    if (!text || busy) return;
    const key = newTurnId();
    if (spokenNext.current) spokenKeys.current.add(key);
    // Typed (or tapped): no more listening by itself after the answer.
    else voice.endConversation();
    spokenNext.current = false;
    const id = newTurnId();
    setEntries((list) => [...list.slice(-9), { key, clientTurnId: id, question: text, waiting: true, reply: null, error: null }]);
    setQuestion("");
    void send(key, text, id);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-2">
        {entries.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-[#B9D5C6]">
              Ask me something quick: a price, your credit, how something works.{voice.supported ? " Tap the mic to talk." : ""}
            </p>
            {!outOfCredit && (
              <div className="flex flex-wrap gap-2">
                {QUICK_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => submit(s)} className="rounded-full border border-white/25 px-3 py-1.5 text-left text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {entries.map((e) => (
          <div key={e.key} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[#B9D5C6] px-3 py-2 text-sm text-[#1a2118]">{e.question}</p>
            {e.waiting && (
              <p className="flex items-center gap-2 rounded-xl bg-white/10 p-3 text-sm text-[#B9D5C6]" aria-live="polite">
                <span className="inline-block size-2 animate-pulse rounded-full bg-[#B9D5C6]" aria-hidden />
                Thinking…
              </p>
            )}
            {e.error && (
              <p className="text-sm text-white" role="alert">
                {e.error}{" "}
                <button type="button" disabled={busy} className="underline underline-offset-2 disabled:opacity-50" onClick={() => void send(e.key, e.question, e.clientTurnId, true)}>
                  Try again
                </button>
              </p>
            )}
            {e.reply?.state === "full_view" && (
              <div className="rounded-xl bg-white/10 p-3 text-sm text-white">
                <p>{e.reply.text}</p>
                <Link href={`/intelligence?ask=${encodeURIComponent(e.question)}#si-ask`} className="mt-2 inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90">
                  Ask in the full view ({hintLabel(p.fullHintPence)})
                </Link>
              </div>
            )}
            {e.reply?.state === "top_up" && <TopUpToAsk teamMember={teamMember} />}
            {e.reply && e.reply.state !== "full_view" && e.reply.state !== "top_up" && <ChatAnswer reply={e.reply} />}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-white/10 pt-2.5">
        {notice && (
          <p className="text-xs text-[#f8c868]" role="status">
            {notice}
          </p>
        )}
        {outOfCredit ? (
          <TopUpToAsk teamMember={teamMember} />
        ) : (
          <>
            <ChatComposer id={p.inputId} value={question} onChange={setQuestion} onSubmit={() => submit(question)} busy={busy} placeholder={voice.supported ? "Ask, or tap the mic" : "Ask me something quick"} voice={voice} autoFocus={p.autoFocus} />
            <p className="text-[11px] text-[#B9D5C6]/90">
              Quick answers, {hintLabel(p.hintPence)} each, only for an answer{voice.supported ? "; spoken answers are charged as AI voice" : ""}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
