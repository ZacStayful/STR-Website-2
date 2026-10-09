"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCreditOptional } from "@/components/credit/CreditProvider";
import { notifyCreditChanged } from "@/lib/credit/client";
import type { ChatReply, FullEvent } from "@/lib/chat/reply";
import type { Answer } from "@/lib/intelligence/answers";
import type { EyeLevel } from "@/components/StayfulEye";
import { hintLabel } from "@/lib/chat/format";
import { FULL_SUGGESTIONS, MAX_QUESTION_CHARS } from "@/lib/chat/config";
import { publishThinking, readThinking } from "@/lib/intelligence/thinking-signal";
import { recordSiViewAction } from "../actions";
import { ChatAnswer } from "./ChatAnswer";
import { ChatComposer } from "./ChatComposer";
import { ChatEye } from "./ChatEye";
import { ChatHistory } from "./ChatHistory";
import { TopUpToAsk } from "./TopUpToAsk";
import { setChatEye } from "./chat-state";
import { newTurnId, sendFull } from "./send";
import { useVoice } from "./voice";

/** What the page tells the full view's chat (src/app/intelligence/page.tsx). */
export interface FullChatConfig {
  hintPence: number;
  floorPence: number;
  initialQuestion: string;
  voice: boolean;
}

type Entry =
  | { kind: "chip"; key: string; question: string; answer: Answer }
  | { kind: "ask"; key: string; clientTurnId: string; question: string; streaming: boolean; status: string | null; reply: ChatReply; dropped: boolean };

const EMPTY: ChatReply = { state: "answer", turnId: null, text: "", buttons: [], charged: null };

/**
 * Batch 26: the full Stayful Intelligence view as one screen. The eye and
 * today's picks at the top; once the member asks something, the eye shrinks
 * into a line that says what it is doing, the picks fold into one row (tap to
 * open), and the conversation takes the room. The box (type or talk) and the
 * free tap-to-ask chips stay pinned at the bottom, so nothing needs a scroll
 * to reach. Spoken questions get spoken answers.
 */
export function FullChat(p: {
  config: FullChatConfig;
  level: EyeLevel;
  levelName: string;
  headline: ReactNode;
  picks: ReactNode;
  picksSummary: string | null;
  answers: Answer[];
  surface: "header" | "reveal";
  footnote: ReactNode;
}) {
  const credit = useCreditOptional()?.credit ?? null;
  const [question, setQuestion] = useState(p.config.initialQuestion.slice(0, MAX_QUESTION_CHARS));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [picksOpen, setPicksOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const spokenNext = useRef(false);
  // Questions asked out loud: their answers are spoken back.
  const spokenKeys = useRef(new Set<string>());

  const teamMember = Boolean(credit?.member);
  const outOfCredit = credit !== null && !credit.admin && credit.spendableBasePence < p.config.floorPence;
  const chatting = entries.length > 0;
  const live = [...entries].reverse().find((e) => e.kind === "ask" && e.streaming);
  const status = live && live.kind === "ask" ? live.status ?? "Thinking…" : null;

  const voice = useVoice({
    enabled: p.config.voice,
    onHeard: (text) => {
      spokenNext.current = true;
      submit(text);
    },
    onMessage: setNotice,
  });

  // Leaving the page drops the answer in flight: the server stops and charges nothing.
  useEffect(
    () => () => {
      inFlight.current?.abort();
      setChatEye("idle");
    },
    [],
  );

  // Keep the newest words in view as they arrive.
  const lastText = entries.length ? (entries[entries.length - 1].kind === "ask" ? (entries[entries.length - 1] as Extract<Entry, { kind: "ask" }>).reply.text : "") : "";
  useEffect(() => {
    // Only once there's a conversation: on arrival the eye and the picks are what to see.
    if (entries.length > 0) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length, lastText]);

  const update = (key: string, f: (e: Extract<Entry, { kind: "ask" }>) => Entry) =>
    setEntries((list) => list.map((e) => (e.key === key && e.kind === "ask" ? f(e) : e)));

  async function ask(q: string, clientTurnId: string, key: string, retry = false): Promise<void> {
    setBusy(true);
    setNotice(null);
    setChatEye("thinking");
    update(key, (x) => ({ ...x, clientTurnId, streaming: true, status: null, dropped: false, reply: EMPTY }));
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    let spokenReply: string | null = null;
    try {
      const reply = await sendFull(
        { clientTurnId, question: q, conversationId: conversationId.current },
        (e: FullEvent) => {
          if (e.type === "delta") update(key, (x) => ({ ...x, status: null, reply: { ...x.reply, text: x.reply.text + e.text } }));
          else if (e.type === "clear") update(key, (x) => ({ ...x, reply: { ...x.reply, text: "" } }));
          else if (e.type === "replace") update(key, (x) => ({ ...x, reply: { ...x.reply, text: e.text } }));
          else if (e.type === "status") update(key, (x) => ({ ...x, status: e.text }));
        },
        ctrl.signal,
      );
      if (reply.conversationId) conversationId.current = reply.conversationId;
      if (reply.state === "did_not_finish" && retry) {
        // The first try never finished (and wasn't charged): ask it afresh, as a new question.
        // Awaited, so this try's finally doesn't clear "busy" while the fresh one streams.
        await ask(q, newTurnId(), key);
        return;
      }
      // Still being answered (another tab, or the first try before the server saw the drop): keep "Try again".
      const later = reply.state === "busy" || reply.state === "too_fast";
      update(key, (x) => ({ ...x, clientTurnId, streaming: false, status: null, dropped: later, reply }));
      if (reply.charged) notifyCreditChanged();
      if (!later) publishThinking({ answerSeq: readThinking().answerSeq + 1 });
      if (!later && spokenKeys.current.has(key)) spokenReply = reply.text;
    } catch {
      if (ctrl.signal.aborted) return;
      update(key, (x) => ({ ...x, streaming: false, status: null, dropped: true, reply: { ...EMPTY, state: "did_not_finish", text: "That answer didn’t finish, so you weren’t charged." } }));
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
      setBusy(false);
      setChatEye("idle");
    }
    // Asked out loud: answered out loud (after the eye stops thinking, so it can speak).
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
    const clientTurnId = newTurnId();
    setEntries((list) => [...list, { kind: "ask", key, clientTurnId, question: text, streaming: true, status: null, reply: EMPTY, dropped: false }]);
    setQuestion("");
    void ask(text, clientTurnId, key);
  }

  function tapChip(a: Answer) {
    setEntries((list) => [...list, { kind: "chip", key: newTurnId(), question: a.question, answer: a }]);
    recordSiViewAction({ surface: p.surface, step: "question", chip: a.key }).catch(() => {});
  }

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl space-y-4 px-4 pb-4 pt-3">
          {/* The eye: large and central before the first question, then a small line that says what it's doing. */}
          <header className={`flex gap-3 transition-all duration-500 ${chatting ? "flex-row items-center" : "flex-row items-center sm:flex-col sm:text-center"}`}>
            <div
              className={`shrink-0 transition-[width,height] duration-500 ease-out ${chatting ? "size-11 [--k:0.293]" : "size-[72px] [--k:0.48] sm:size-[128px] sm:[--k:0.853]"}`}
            >
              <div className="origin-top-left transition-transform duration-500 ease-out" style={{ transform: "scale(var(--k))" }}>
                <ChatEye size={150} level={p.level} label={`Stayful Intelligence, ${p.levelName}`} />
              </div>
            </div>
            {chatting ? (
              <p className="min-w-0 text-sm text-[#B9D5C6]" aria-live="polite">
                <span className="font-semibold text-white">Stayful Intelligence</span>
                <span className="block truncate">{voice.phase === "listening" ? "Listening…" : voice.phase === "hearing" ? "Hearing you…" : voice.phase === "speaking" ? "Speaking…" : status ?? "Ask me anything about your deals, money or picks."}</span>
              </p>
            ) : (
              <div className="min-w-0">{p.headline}</div>
            )}
          </header>

          {/* Today's picks: in full until the conversation starts, then one row that opens them. */}
          {p.picksSummary && chatting ? (
            <div className="rounded-2xl border border-white/10 bg-white/5">
              <button type="button" onClick={() => setPicksOpen((o) => !o)} aria-expanded={picksOpen} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">Today’s picks</span> <span className="text-[#B9D5C6]">· {p.picksSummary}</span>
                </span>
                {picksOpen ? <ChevronUp className="size-4 shrink-0" aria-hidden /> : <ChevronDown className="size-4 shrink-0" aria-hidden />}
              </button>
              {picksOpen && <div className="space-y-4 px-2 pb-3 sm:px-4">{p.picks}</div>}
            </div>
          ) : (
            p.picks
          )}

          {entries.map((e) =>
            e.kind === "chip" ? (
              <div key={e.key} className="space-y-2">
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[#B9D5C6] px-3 py-2 text-sm text-[#1a2118]">{e.question}</p>
                <div className="rounded-xl bg-white/10 p-4 text-sm leading-relaxed text-white">
                  <p>{e.answer.answer}</p>
                  {e.answer.action && (
                    <Link href={e.answer.action.href} className="mt-3 inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90">
                      {e.answer.action.label}
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div key={e.key} className="space-y-2">
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[#B9D5C6] px-3 py-2 text-sm text-[#1a2118]">{e.question}</p>
                {e.streaming && !e.reply.text ? (
                  <p className="flex items-center gap-2 rounded-xl bg-white/10 p-4 text-sm text-[#B9D5C6]" aria-live="polite">
                    <span className="inline-block size-2 animate-pulse rounded-full bg-[#B9D5C6]" aria-hidden />
                    {e.status ?? "Thinking…"}
                  </p>
                ) : (
                  <ChatAnswer reply={e.reply} streaming={e.streaming} />
                )}
                {e.dropped && (
                  <button type="button" disabled={busy} className="text-xs text-[#B9D5C6] underline underline-offset-2" onClick={() => void ask(e.question, e.clientTurnId, e.key, true)}>
                    Try again
                  </button>
                )}
              </div>
            ),
          )}

          <ChatHistory />
          <div className="text-center text-xs text-[#B9D5C6]/80">{p.footnote}</div>
          <div ref={end} />
        </div>
      </div>

      {/* Pinned: the free chips and the box. */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#2E3D2B]/95 backdrop-blur" id="si-ask">
        <div className="mx-auto max-w-3xl space-y-2 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5">
          {(p.answers.length > 0 || !chatting) && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {p.answers.map((a) => (
                <button key={a.key} type="button" onClick={() => tapChip(a)} className="shrink-0 rounded-full border border-white/25 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-white/10">
                  {a.question}
                </button>
              ))}
              {!chatting &&
                !outOfCredit &&
                FULL_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => submit(s)} className="shrink-0 rounded-full border border-dashed border-white/30 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-white/10 disabled:opacity-50">
                    {s}
                  </button>
                ))}
            </div>
          )}
          {notice && (
            <p className="text-xs text-[#f8c868]" role="status">
              {notice}
            </p>
          )}
          {outOfCredit ? (
            <TopUpToAsk teamMember={teamMember} />
          ) : (
            <>
              <ChatComposer id="si-full-q" value={question} onChange={setQuestion} onSubmit={() => submit(question)} busy={busy} placeholder={voice.supported ? "Ask, or tap the mic and talk" : "Ask about your deals, money or picks"} voice={voice} />
              <p className="text-[11px] text-[#B9D5C6]/90">
                {hintLabel(p.config.hintPence)} a question, only for an answer{voice.supported ? "; spoken answers are charged as AI voice" : ""}. The chips are free.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
