"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChatReply } from "@/lib/chat/reply";
import { DEEP_SEARCH_EVENT, type ChatButton } from "@/lib/chat/actions";
import type { ActionCardView } from "@/lib/si-actions/view";
import { ActionCard } from "./ActionCard";
import { DraftCard, FeatureRequest } from "./DraftCard";

/**
 * Batch 26: one answer as the member sees it: the text, the buttons (the
 * member taps them), what it cost, "Not helpful", and "Want me to remember
 * that?" when the answer offered to. Batch 27: what the eye is doing for the
 * member (ActionCard: spend line, Stop, confirm, progress, Undo), a drafted
 * message to copy, a feature request to send, and tap choices.
 */
export function ChatAnswer({
  reply,
  streaming = false,
  tone = "dark",
  onChoose,
}: {
  reply: Pick<ChatReply, "state" | "turnId" | "text" | "buttons" | "charged" | "factProposal" | "voiceCharged" | "actions" | "draft" | "report" | "featureRequest" | "choices">;
  streaming?: boolean;
  tone?: "dark" | "light";
  /** A tap choice is sent as the member's next question. */
  onChoose?: (text: string) => void;
}) {
  const muted = tone === "dark" ? "text-[#B9D5C6]" : "text-muted-foreground";
  return (
    <div className={`rounded-xl ${tone === "dark" ? "bg-white/10 text-white" : "bg-muted text-foreground"} p-4 text-sm leading-relaxed`} aria-live="polite" aria-busy={streaming}>
      <p className="whitespace-pre-line">{reply.text || (streaming ? "…" : "")}</p>
      {!streaming && reply.buttons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reply.buttons.map((b) => (
            <AnswerButton key={`${b.kind}:${b.href ?? b.whatIfKey}`} button={b} turnId={reply.turnId} />
          ))}
        </div>
      )}
      {!streaming && reply.choices && reply.choices.length > 0 && onChoose && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reply.choices.map((c) => (
            <button key={c} type="button" onClick={() => onChoose(c)} className="rounded-full border border-white/30 px-3 py-1.5 text-sm font-medium hover:bg-white/10">
              {c}
            </button>
          ))}
        </div>
      )}
      {!streaming && reply.actions && <ActionCard key={reply.actions.instructionId} initial={reply.actions} />}
      {!streaming && reply.draft && <DraftCard draft={reply.draft} turnId={reply.turnId} />}
      {!streaming && reply.featureRequest && <FeatureRequest text={reply.featureRequest} />}
      {!streaming && reply.report && !reply.actions && <p className={`mt-3 text-xs ${muted}`}>Reported to the Stayful team · #{reply.report.ref}</p>}
      {!streaming && reply.factProposal && reply.turnId && <RememberThat turnId={reply.turnId} fact={reply.factProposal} muted={muted} />}
      {!streaming && (reply.charged || reply.voiceCharged || (reply.state === "answer" && reply.turnId)) && (
        <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${muted}`}>
          {reply.charged && <span>Stayful Intelligence question · {reply.charged}</span>}
          {reply.voiceCharged && <span>AI voice · {reply.voiceCharged}</span>}
          {reply.state === "answer" && reply.turnId && <NotHelpful turnId={reply.turnId} />}
        </div>
      )}
    </div>
  );
}

function AnswerButton({ button, turnId }: { button: ChatButton; turnId: string | null }) {
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  const [card, setCard] = useState<ActionCardView | null>(null);
  const [busy, setBusy] = useState(false);
  const cls = "inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-60";
  if (button.href) {
    return (
      <Link
        href={button.href}
        className={cls}
        // R3-41: the deep-search offer sits inside today's picks, folded away while chatting: the full view opens them.
        onClick={() => {
          if (button.kind === "deep_search") window.dispatchEvent(new Event(DEEP_SEARCH_EVENT));
        }}
      >
        {button.label}
      </Link>
    );
  }
  if (button.whatIfKey && turnId) {
    // Batch 27: applied as one of the eye's steps (Batch 22's own save), with Undo for the window.
    if (card) return <div className="basis-full"><ActionCard initial={card} /></div>;
    if (done) return <span className="self-center text-xs">{done}</span>;
    return (
      <button
        type="button"
        className={cls}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch(`/api/si/actions/${turnId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "use_this", key: button.whatIfKey }) }).catch(() => null);
          const body = res ? ((await res.json().catch(() => ({}))) as { card?: ActionCardView; error?: string }) : {};
          setBusy(false);
          if (body.card) {
            setCard(body.card);
            router.refresh();
          } else setDone(body.error ?? "That didn’t save. Please try again.");
        }}
      >
        {button.label}
      </button>
    );
  }
  return null;
}

function NotHelpful({ turnId }: { turnId: string }) {
  const [sent, setSent] = useState(false);
  if (sent) return <span>Thanks — I’ve passed that on.</span>;
  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:opacity-80"
      onClick={() => {
        setSent(true);
        fetch(`/api/chat/turns/${turnId}/unhappy`, { method: "POST" }).catch(() => {});
      }}
    >
      Not helpful
    </button>
  );
}

function RememberThat({ turnId, fact, muted }: { turnId: string; fact: string; muted: string }) {
  /** The last word: the buttons go. */
  const [done, setDone] = useState<string | null>(null);
  /** Something to say with the buttons kept (R3-93: a Yes refused for want of room, or a send that failed, can be given again). */
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answer = async (yes: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/chat/facts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, yes }) });
      const body = (await res.json()) as { ok?: boolean; retry?: boolean; message?: string };
      const message = body.message ?? (yes ? "Done." : "OK.");
      if (body.ok === false && body.retry) {
        setNote(message);
        setBusy(false);
      } else setDone(message);
    } catch {
      setNote("That didn’t save. Please try again.");
      setBusy(false);
    }
  };
  if (done) return <p className={`mt-3 text-xs ${muted}`}>{done}</p>;
  return (
    <div className="mt-3 rounded-lg border border-white/20 p-3">
      <p>
        Want me to remember that? <span className="italic">“{fact}”</span>
      </p>
      {note && <p className={`mt-2 text-xs ${muted}`}>{note}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => answer(true)} className="rounded-md bg-[#B9D5C6] px-3 py-1 text-xs font-semibold text-[#1a2118] disabled:opacity-60">
          Yes
        </button>
        <button type="button" disabled={busy} onClick={() => answer(false)} className="rounded-md border border-white/30 px-3 py-1 text-xs font-semibold disabled:opacity-60">
          No
        </button>
      </div>
    </div>
  );
}
