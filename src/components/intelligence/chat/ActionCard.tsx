"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { notifyCreditChanged, openOutOfCredit } from "@/lib/credit/client";
import type { ActionCardView } from "@/lib/si-actions/view";
import { ANALYSES_AT_ONCE } from "@/lib/si-actions/config";

/**
 * Batch 27: what Stayful Intelligence is doing for the member, under its
 * answer: what it changed (with Undo), the spend line with a Stop countdown,
 * the confirm card when it asks first, the progress of each charged step,
 * and a checked listing with Keep.
 *
 * The countdown is the Stop window: nothing charged starts before it ends
 * (the server refuses to start a step any earlier). After it, the page asks
 * the server for one charged step at a time; a full analysis's run and a PMI
 * opinion then go through their buttons' own routes, two analyses at a time,
 * exactly as Part H's "Analyse all" runs them.
 */

type HandOut = { kind: "analysis"; stepId: string; dealId: string; purchaseId: string } | { kind: "pmi"; stepId: string; reportId: string; quotedBasePence: number };

interface Resp {
  card?: ActionCardView;
  handOut?: HandOut | null;
  waitMs?: number;
  code?: string;
  requiredPence?: number;
  availablePence?: number;
  error?: string;
  note?: string;
  ok?: boolean;
}

const btn = "rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-60";
const ghost = "rounded-md border border-white/30 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60";

const DIDNT_GO = "That didn’t go through. Please try again.";

/** One request to the instruction's route. Never throws: a dropped connection or a server error comes back as { error }. */
async function post(id: string, body: Record<string, unknown>): Promise<Resp> {
  let res: Response;
  try {
    res = await fetch(`/api/si/actions/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { error: DIDNT_GO };
  }
  try {
    const r = (await res.json()) as Resp;
    return !res.ok && !r.error ? { ...r, error: DIDNT_GO } : r;
  } catch {
    return { error: DIDNT_GO };
  }
}

/** Tries of the next step after a failed request (2s, 4s, 8s) before the card waits for the member. */
const NEXT_RETRIES = 3;

/** A full analysis's run through its button's own route (server-sent events), to its end. */
async function runAnalysis(h: Extract<HandOut, { kind: "analysis" }>, onProgress: (pct: number, message: string) => void): Promise<void> {
  const res = await fetch(`/api/deals/${h.dealId}/analysis/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purchaseId: h.purchaseId }) });
  if (!res.ok || !res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const d = JSON.parse(line.slice(6)) as { stage?: string; progress?: number; message?: string };
        if (typeof d.progress === "number") onProgress(d.progress, d.message ?? "");
        if (d.stage === "complete" || d.stage === "error") return;
      } catch {
        /* a partial line: the next read completes it */
      }
    }
  }
}

function outOfCredit(r: Resp) {
  if (r.code === "insufficient_credit") openOutOfCredit({ action: "this", requiredPence: r.requiredPence, availablePence: r.availablePence, mode: "topup" });
}

/** `update`: a newer view of the same instruction from elsewhere in the answer ("Use this"), taken in without a second card. */
export function ActionCard({ initial, update = null }: { initial: ActionCardView; update?: ActionCardView | null }) {
  const router = useRouter();
  const [card, setCard] = useState<ActionCardView>(initial);
  const [lastUpdate, setLastUpdate] = useState<ActionCardView | null>(update);
  if (update !== lastUpdate) {
    setLastUpdate(update);
    if (update) setCard(update);
  }
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { pct: number; message: string }>>({});
  const inFlight = useRef(0);
  const pumping = useRef(false);
  const started = useRef(false);
  const failures = useRef(0);
  // Gone from the page: nothing more is asked for (what already started finishes through its own route).
  const alive = useRef(true);
  const id = card.instructionId;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback(
    (r: Resp) => {
      if (r.card) setCard(r.card);
      if (r.error) setNote(r.error);
      outOfCredit(r);
      return r;
    },
    [],
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/si/actions/${id}`).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json().catch(() => ({}))) as Resp;
    if (body.card) setCard(body.card);
  }, [id]);

  // One charged step at a time from the server; the long ones run through their own routes, two at once.
  // A PMI opinion through its button's own route; a refusal (price changed, no credit) closes its step at once.
  const runPmi = useCallback(
    async (h: Extract<HandOut, { kind: "pmi" }>): Promise<void> => {
      const res = await fetch(`/api/reports/${h.reportId}/pmi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotedBasePence: h.quotedBasePence }) }).catch(() => null);
      if (!res || res.ok) return; // a dropped connection: its purchase row settles it
      const b = (await res.json().catch(() => ({}))) as { code?: string; requiredPence?: number; availablePence?: number };
      const code = res.status === 402 ? "insufficient_credit" : b.code;
      if (code === "insufficient_credit") openOutOfCredit({ action: "this", requiredPence: b.requiredPence, availablePence: b.availablePence, mode: "topup" });
      if (alive.current) apply(await post(id, { op: "refused", stepId: h.stepId, code }));
    },
    [apply, id],
  );

  const pump = useCallback(async (): Promise<void> => {
    if (pumping.current || !alive.current) return;
    pumping.current = true;
    try {
      while (alive.current && inFlight.current < ANALYSES_AT_ONCE) {
        const r = apply(await post(id, { op: "next" }));
        if (typeof r.waitMs === "number") {
          window.setTimeout(() => void pump(), Math.max(200, r.waitMs));
          return;
        }
        if (r.error && !r.card) {
          // A failed request isn't the end: ask again a little later, a few times (a paused seat won't change).
          if (r.code !== "seat_paused" && failures.current < NEXT_RETRIES) {
            const wait = 2000 * 2 ** failures.current;
            failures.current += 1;
            window.setTimeout(() => void pump(), wait);
          }
          return;
        }
        failures.current = 0;
        if (!("handOut" in r)) break;
        notifyCreditChanged();
        const h = r.handOut;
        if (!h) continue;
        inFlight.current += 1;
        const run = h.kind === "analysis" ? runAnalysis(h, (pct, message) => setProgress((p) => ({ ...p, [h.stepId]: { pct, message } }))) : runPmi(h);
        void run
          .catch(() => undefined)
          .finally(() => {
            inFlight.current -= 1;
            notifyCreditChanged();
            if (!alive.current) return;
            void refresh().then(() => pump());
            router.refresh();
          });
      }
    } finally {
      pumping.current = false;
    }
  }, [apply, id, refresh, router, runPmi]);

  // The countdown: ticks until it ends, then the charged steps start (once).
  useEffect(() => {
    if (card.status !== "ready" || !card.startsAfter) return;
    const end = Date.parse(card.startsAfter);
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= end && !started.current) {
        started.current = true;
        window.clearInterval(t);
        void pump();
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [card.status, card.startsAfter, pump]);

  // A yes to a confirm (or a page that came back to a running instruction): carry on.
  useEffect(() => {
    if (card.status === "running" && !started.current && card.stop !== null) {
      started.current = true;
      void pump();
    }
  }, [card.status, card.stop, pump]);

  // While something runs on the server (a deep search, a run started elsewhere), look again now and then.
  useEffect(() => {
    if (!card.live) return;
    const t = window.setInterval(() => {
      if (inFlight.current === 0) void refresh();
    }, 4000);
    return () => window.clearInterval(t);
  }, [card.live, refresh]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const r = apply(await post(id, body));
      if (body.op === "undo" || body.op === "keep") router.refresh();
      if (body.op === "confirm" && body.yes === true && (r.card?.status === "ready" || r.card?.status === "running")) {
        started.current = true;
        failures.current = 0;
        void pump();
      }
    } finally {
      setBusy(false);
    }
  };

  const secondsLeft = card.status === "ready" && card.startsAfter ? Math.max(0, Math.ceil((Date.parse(card.startsAfter) - now) / 1000)) : null;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/20 p-3 text-sm" aria-live="polite">
      {card.done.length > 0 && (
        <ul className="space-y-1">
          {card.done.map((line, i) => (
            <li key={`${i}:${line}`}>✓ {line}</li>
          ))}
        </ul>
      )}
      {card.notDone.length > 0 && (
        <ul className="space-y-1 text-[#B9D5C6]">
          {card.notDone.map((line, i) => (
            <li key={`${i}:${line}`}>{line}</li>
          ))}
        </ul>
      )}

      {card.spendLine && card.status !== "blocked" && <p className="font-semibold">{card.spendLine}</p>}

      {card.status === "ready" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[#B9D5C6]">{secondsLeft ? `Starting in ${secondsLeft}…` : "Starting…"}</span>
          <button type="button" className={ghost} disabled={busy} onClick={() => void act({ op: "stop" })}>
            Stop
          </button>
        </div>
      )}

      {card.confirm && (
        <div className="space-y-2 rounded-md bg-white/5 p-3">
          <p>{card.confirm.text}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void act({ op: "confirm", yes: true })}>
              Yes, {card.confirm.total}
            </button>
            <button type="button" className={ghost} disabled={busy} onClick={() => void act({ op: "confirm", yes: false })}>
              No
            </button>
            {card.confirm.topUp && (
              <button type="button" className={ghost} onClick={() => openOutOfCredit({ mode: "topup" })}>
                Top up
              </button>
            )}
          </div>
        </div>
      )}

      {card.blocked && (
        <div className="space-y-2 rounded-md bg-white/5 p-3">
          <p>{card.blocked.text}</p>
          <button type="button" className={btn} onClick={() => openOutOfCredit({ action: "this", requiredPence: card.blocked!.requiredPence, availablePence: card.blocked!.availablePence, mode: "topup" })}>
            Top up
          </button>
        </div>
      )}

      {card.progress.length > 0 && (
        <ul className="space-y-1.5">
          {card.progress.map((row) => {
            const p = progress[row.stepId];
            const state = row.state === "running" && p ? `${Math.round(p.pct)}%` : row.state === "running" ? "running…" : row.state === "waiting" ? "waiting" : row.state === "later" ? "waiting for your yes" : row.state;
            return (
              <li key={row.stepId} className="flex flex-wrap items-center justify-between gap-x-3">
                <span className="min-w-0">
                  {row.label}
                  {row.price ? <span className="text-[#B9D5C6]"> · {row.price}</span> : null}
                </span>
                <span className="text-xs text-[#B9D5C6]">
                  {row.href ? (
                    <Link href={row.href} className="font-semibold text-white underline underline-offset-2">
                      Open
                    </Link>
                  ) : (
                    state
                  )}
                  {row.note ? ` · ${row.note}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {card.stop === "stop_rest" && (
        <button type="button" className={ghost} disabled={busy} onClick={() => void act({ op: "stop" })}>
          Stop the rest
        </button>
      )}

      {card.link && (
        <div className="space-y-2 rounded-md bg-white/5 p-3">
          <p className="font-semibold">{card.link.title}</p>
          {card.link.lines.map((l, i) => (
            <p key={`${i}:${l}`} className="text-[#B9D5C6]">
              {l}
            </p>
          ))}
          {card.link.canKeep && (
            <button type="button" className={btn} disabled={busy} onClick={() => void act({ op: "keep", stepId: card.link!.stepId })}>
              Keep
            </button>
          )}
          {card.link.kept && <p className="text-xs">Kept — it’s in My deals.</p>}
        </div>
      )}

      {card.report && <p className="text-xs text-[#B9D5C6]">Reported to the Stayful team · #{card.report.ref}</p>}

      {(card.undo || card.undone) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#B9D5C6]">
          {card.undo && (
            <button type="button" className="font-semibold text-white underline underline-offset-2 disabled:opacity-60" disabled={busy} onClick={() => void act({ op: "undo" })}>
              Undo
            </button>
          )}
          {card.undone && <span>{card.undone}</span>}
        </div>
      )}
      {note && <p className="text-xs text-[#B9D5C6]">{note}</p>}
    </div>
  );
}
