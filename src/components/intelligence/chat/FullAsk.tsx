"use client";

import { useRef, useState } from "react";
import { useCreditOptional } from "@/components/credit/CreditProvider";
import { notifyCreditChanged } from "@/lib/credit/client";
import type { ChatReply, FullEvent } from "@/lib/chat/reply";
import { hintLabel } from "@/lib/chat/format";
import { FULL_SUGGESTIONS, MAX_QUESTION_CHARS } from "@/lib/chat/config";
import { publishThinking, readThinking } from "@/lib/intelligence/thinking-signal";
import { ChatAnswer } from "./ChatAnswer";
import { ChatHistory } from "./ChatHistory";
import { TopUpToAsk } from "./TopUpToAsk";
import { setChatThinking } from "./chat-state";
import { newTurnId, sendFull } from "./send";

interface Entry {
  key: string;
  clientTurnId: string;
  question: string;
  streaming: boolean;
  reply: ChatReply;
  dropped: boolean;
}

const EMPTY: ChatReply = { state: "answer", turnId: null, text: "", buttons: [], charged: null };

/**
 * Batch 26: the full view's text box, under Batch 22's tap-to-ask chips
 * (which stay free). "About 8p"; the answer streams in while the eye thinks;
 * the real charge shows under each answer. The conversation carries on until
 * the member leaves it idle; "Your chat history" shows the last 90 days and
 * deletes them.
 */
export function FullAsk({ hintPence, floorPence, initialQuestion = "" }: { hintPence: number; floorPence: number; initialQuestion?: string }) {
  const credit = useCreditOptional()?.credit ?? null;
  const [question, setQuestion] = useState(initialQuestion.slice(0, MAX_QUESTION_CHARS));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);

  const teamMember = Boolean(credit?.member);
  const outOfCredit = credit !== null && !credit.admin && credit.spendableBasePence < floorPence;

  const update = (key: string, f: (e: Entry) => Entry) => setEntries((list) => list.map((e) => (e.key === key ? f(e) : e)));

  async function ask(q: string, clientTurnId: string, key: string, retry = false): Promise<void> {
    setBusy(true);
    setChatThinking(true);
    update(key, (x) => ({ ...x, clientTurnId, streaming: true, dropped: false, reply: EMPTY }));
    try {
      const reply = await sendFull({ clientTurnId, question: q, conversationId: conversationId.current }, (e: FullEvent) => {
        if (e.type === "delta") update(key, (x) => ({ ...x, reply: { ...x.reply, text: x.reply.text + e.text } }));
        else if (e.type === "clear") update(key, (x) => ({ ...x, reply: { ...x.reply, text: "" } }));
        else if (e.type === "replace") update(key, (x) => ({ ...x, reply: { ...x.reply, text: e.text } }));
      });
      if (reply.conversationId) conversationId.current = reply.conversationId;
      if (reply.state === "did_not_finish" && retry) {
        // The first try never finished (and wasn't charged): ask it afresh, as a new question.
        return ask(q, newTurnId(), key);
      }
      update(key, (x) => ({ ...x, clientTurnId, streaming: false, dropped: false, reply }));
      if (reply.charged) notifyCreditChanged();
      // A small pulse in the background when an answer lands.
      publishThinking({ answerSeq: readThinking().answerSeq + 1 });
    } catch {
      update(key, (x) => ({ ...x, streaming: false, dropped: true, reply: { ...EMPTY, state: "did_not_finish", text: "That answer didn’t finish, so you weren’t charged." } }));
    } finally {
      setBusy(false);
      setChatThinking(false);
    }
  }

  function submit(q: string) {
    const text = q.trim().slice(0, MAX_QUESTION_CHARS);
    if (!text || busy) return;
    const key = newTurnId();
    const clientTurnId = newTurnId();
    setEntries((list) => [...list, { key, clientTurnId, question: text, streaming: true, reply: EMPTY, dropped: false }]);
    setQuestion("");
    void ask(text, clientTurnId, key);
  }

  return (
    <div className="space-y-4">
      {entries.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {FULL_SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={busy || outOfCredit} onClick={() => submit(s)} className="rounded-full border border-white/25 px-3 py-1.5 text-left text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      )}

      {entries.map((e) => (
        <div key={e.key} className="space-y-2">
          <p className="ml-auto w-fit max-w-[85%] rounded-xl bg-[#B9D5C6] px-3 py-2 text-sm text-[#1a2118]">{e.question}</p>
          <ChatAnswer reply={e.reply} streaming={e.streaming} />
          {e.dropped && (
            <button type="button" disabled={busy} className="text-xs text-[#B9D5C6] underline underline-offset-2" onClick={() => void ask(e.question, e.clientTurnId, e.key, true)}>
              Try again
            </button>
          )}
        </div>
      ))}

      {outOfCredit ? (
        <TopUpToAsk teamMember={teamMember} />
      ) : (
        <form
          className="space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit(question);
          }}
        >
          <label htmlFor="si-full-q" className="sr-only">
            Ask Stayful Intelligence
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="si-full-q"
              rows={2}
              maxLength={MAX_QUESTION_CHARS}
              value={question}
              onChange={(ev) => setQuestion(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) {
                  ev.preventDefault();
                  submit(question);
                }
              }}
              placeholder="Ask about your deals, your money or why nothing matched"
              className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-[#B9D5C6] focus:outline-none"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !question.trim()} className="h-11 shrink-0 rounded-lg bg-[#B9D5C6] px-4 text-sm font-semibold text-[#1a2118] disabled:opacity-50">
              {busy ? "…" : "Ask"}
            </button>
          </div>
          <p className="text-xs text-[#B9D5C6]">{hintLabel(hintPence)} a question; you only pay for an answer. The questions above are free.</p>
        </form>
      )}

      <ChatHistory />
    </div>
  );
}
