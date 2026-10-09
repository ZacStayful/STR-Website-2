"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChatReply } from "@/lib/chat/reply";
import type { ChatButton } from "@/lib/chat/actions";
import { applyWhatIfAction } from "../what-if-actions";

/**
 * Batch 26: one answer as the member sees it: the text, the buttons (the
 * member taps; Stayful Intelligence never does the thing itself), what it
 * cost, "Not helpful", and "Want me to remember that?" when the answer
 * offered to.
 */
export function ChatAnswer({ reply, streaming = false, tone = "dark" }: { reply: Pick<ChatReply, "state" | "turnId" | "text" | "buttons" | "charged" | "factProposal">; streaming?: boolean; tone?: "dark" | "light" }) {
  const muted = tone === "dark" ? "text-[#B9D5C6]" : "text-muted-foreground";
  return (
    <div className={`rounded-xl ${tone === "dark" ? "bg-white/10 text-white" : "bg-muted text-foreground"} p-4 text-sm leading-relaxed`} aria-live="polite" aria-busy={streaming}>
      <p className="whitespace-pre-line">{reply.text || (streaming ? "…" : "")}</p>
      {!streaming && reply.buttons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reply.buttons.map((b) => (
            <AnswerButton key={`${b.kind}:${b.href ?? b.whatIfKey}`} button={b} />
          ))}
        </div>
      )}
      {!streaming && reply.factProposal && reply.turnId && <RememberThat turnId={reply.turnId} fact={reply.factProposal} muted={muted} />}
      {!streaming && (reply.charged || (reply.state === "answer" && reply.turnId)) && (
        <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${muted}`}>
          {reply.charged && <span>Stayful Intelligence question · {reply.charged}</span>}
          {reply.state === "answer" && reply.turnId && <NotHelpful turnId={reply.turnId} />}
        </div>
      )}
    </div>
  );
}

function AnswerButton({ button }: { button: ChatButton }) {
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cls = "inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-60";
  if (button.href) {
    return (
      <Link href={button.href} className={cls}>
        {button.label}
      </Link>
    );
  }
  if (button.whatIfKey) {
    if (done) return <span className="self-center text-xs">{done}</span>;
    return (
      <button
        type="button"
        className={cls}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await applyWhatIfAction(button.whatIfKey).catch(() => ({ ok: false as const, error: "That didn’t save. Please try again." }));
          setBusy(false);
          if (r.ok) {
            setDone("Done — I’ve changed that in your profile.");
            router.refresh();
          } else setDone(r.error);
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
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answer = async (yes: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/chat/facts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, yes }) });
      const body = (await res.json()) as { message?: string };
      setMessage(body.message ?? (yes ? "Done." : "OK."));
    } catch {
      setMessage("That didn’t save. Please try again.");
      setBusy(false);
    }
  };
  if (message) return <p className={`mt-3 text-xs ${muted}`}>{message}</p>;
  return (
    <div className="mt-3 rounded-lg border border-white/20 p-3">
      <p>
        Want me to remember that? <span className="italic">“{fact}”</span>
      </p>
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
