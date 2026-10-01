"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CREDIT_CHANGED_EVENT, creditFetch, notifyCreditChanged } from "@/lib/credit/client";
import { resumeAction, saveResumeIntentAction } from "./resume-actions";
import { formatPence, type PriceLabel } from "@/lib/credit/deal-pricing";
import { useCreditOptional } from "@/components/credit/CreditProvider";
import { ANALYSES_AT_ONCE } from "@/lib/intelligence/config";

export interface RevealAnalysisItem {
  dealId: string;
  title: string;
  full: PriceLabel | null;
  deep: PriceLabel | null;
  fullNote: string | null;
  deepNote: string | null;
  fullList: number | null;
  deepList: number | null;
}

type Run = { state: "idle" } | { state: "running"; progress: number; message: string } | { state: "done"; reportId: string } | { state: "error"; message: string };

/**
 * Batch 22, Part H: analyses from the reveal. Each card: "Run full analysis"
 * and "Deep report" at the member's own price (the welcome price on their
 * revealed deals); "Analyse all 3" (or tick 1–2) with one confirm and the
 * total, ANALYSES_AT_ONCE at a time, through the same start and run routes
 * as the deal page. Short of credit, the out-of-credit window opens (the
 * pack offer or a top-up); nothing starts.
 */
export function RevealAnalyses({ items, resumeId = null, returnPath }: { items: RevealAnalysisItem[]; /** Back from paying (?resume=). */ resumeId?: string | null; returnPath: string }) {
  const credit = useCreditOptional();
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [ticked, setTicked] = useState<Record<string, "full" | "deep" | null>>({});
  const [confirming, setConfirming] = useState(false);
  const set = (id: string, r: Run) => setRuns((prev) => ({ ...prev, [id]: r }));

  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const pending = useRef<string | null>(resumeId);

  /** Short of credit: save what they want, then the top-up (one click, or Checkout and back here). */
  const topUpFor = async (picks: { item: RevealAnalysisItem; withPmi: boolean }[]) => {
    const requiredPence = picks.reduce((sum, p) => sum + ((p.withPmi ? p.item.deep : p.item.full)?.basePence ?? 0), 0);
    const id = await saveResumeIntentAction(
      picks.map((p) => {
        const l = (p.withPmi ? p.item.deep : p.item.full)!;
        return { dealId: p.item.dealId, withPmi: p.withPmi, quotedBasePence: l.basePence, quotedFacePence: l.facePence };
      }),
      returnPath,
    ).catch(() => null);
    pending.current = id;
    credit?.openOutOfCredit({ action: "full_analysis", requiredPence, mode: "topup", ...(id ? { resumeId: id } : {}) });
  };

  const runOne = async (item: RevealAnalysisItem, withPmi: boolean, label0?: PriceLabel): Promise<void> => {
    const label = label0 ?? (withPmi ? item.deep : item.full);
    if (!label) return;
    if (label.state === "short") {
      await topUpFor([{ item, withPmi }]);
      return;
    }
    set(item.dealId, { state: "running", progress: 5, message: "Starting…" });
    try {
      const start = await creditFetch(`/api/deals/${encodeURIComponent(item.dealId)}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withPmi, ...(label.state === "admin" ? { quotedBasePence: 0 } : { quotedBasePence: label.basePence, quotedFacePence: label.facePence }) }),
      });
      const answer = (await start.json().catch(() => ({}))) as { purchaseId?: string; error?: string; reportId?: string };
      if (answer.reportId) return set(item.dealId, { state: "done", reportId: answer.reportId });
      if (!start.ok || !answer.purchaseId) return set(item.dealId, { state: "error", message: answer.error ?? "That didn’t start. Nothing was charged." });
      notifyCreditChanged();
      const run = await fetch(`/api/deals/${encodeURIComponent(item.dealId)}/analysis/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId: answer.purchaseId }) });
      if (!run.ok || !run.body) {
        const data = (await run.json().catch(() => ({}))) as { error?: string; reportId?: string };
        return set(item.dealId, data.reportId ? { state: "done", reportId: data.reportId } : { state: "error", message: data.error ?? "The analysis couldn’t run. You haven’t been charged for it." });
      }
      const reader = run.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let ev: { stage?: string; progress?: number; message?: string; reportId?: string };
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.stage === "error") {
            notifyCreditChanged();
            return set(item.dealId, { state: "error", message: ev.message ?? "The analysis couldn’t be completed. You haven’t been charged for it." });
          }
          if (ev.stage === "complete" && ev.reportId) {
            notifyCreditChanged();
            return set(item.dealId, { state: "done", reportId: ev.reportId });
          }
          set(item.dealId, { state: "running", progress: Math.max(5, Math.min(99, Number(ev.progress) || 5)), message: ev.message ?? "Working…" });
        }
      }
      set(item.dealId, { state: "error", message: "We lost the connection, but your report carries on. It will be in My deals." });
    } catch {
      set(item.dealId, { state: "error", message: "We lost the connection. Your report will be in My deals if it ran." });
    }
  };

  const chosen = items.filter((i) => ticked[i.dealId]);
  const total = chosen.reduce((sum, i) => sum + ((ticked[i.dealId] === "deep" ? i.deep : i.full)?.facePence ?? 0), 0);
  const runChosen = async () => {
    setConfirming(false);
    const short = chosen.filter((i) => (ticked[i.dealId] === "deep" ? i.deep : i.full)?.state === "short");
    if (short.length > 0) {
      await topUpFor(chosen.map((i) => ({ item: i, withPmi: ticked[i.dealId] === "deep" })));
      return;
    }
    const queue = [...chosen];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await runOne(next, ticked[next.dealId] === "deep");
    };
    await Promise.all(Array.from({ length: Math.min(ANALYSES_AT_ONCE, queue.length) }, worker));
  };

  // Back from paying: quoted again on the server; start only if every price still matches.
  const resume = useCallback(
    async (attempt = 0) => {
      const id = pending.current;
      if (!id) return;
      const d = await resumeAction(id).catch(() => ({ kind: "expired" as const }));
      if (d.kind === "short") {
        if (attempt < 5) {
          setResumeNote("Your top-up is on its way…");
          setTimeout(() => void resume(attempt + 1), 4000);
        } else setResumeNote("Your top-up hasn’t arrived yet. Try again in a minute.");
        return;
      }
      pending.current = null;
      if (d.kind === "expired" || d.kind === "nothing") {
        setResumeNote(null);
        return;
      }
      const byId = new Map(items.map((i) => [i.dealId, i]));
      const go = async () => {
        setResumeNote(null);
        const queue = d.items.map((r) => ({ r, item: byId.get(r.dealId) })).filter((x): x is { r: (typeof d.items)[number]; item: RevealAnalysisItem } => Boolean(x.item));
        const worker = async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const base = (next.r.withPmi ? next.item.deep : next.item.full)!;
            await runOne(next.item, next.r.withPmi, { ...base, basePence: next.r.basePence, facePence: next.r.facePence, state: "ok" });
          }
        };
        await Promise.all(Array.from({ length: Math.min(ANALYSES_AT_ONCE, queue.length) }, worker));
      };
      if (d.kind === "start") return void go();
      setConfirm({ total: d.totalFacePence, go });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );
  const [confirm, setConfirm] = useState<{ total: number; go: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (resumeId) void resume();
    // A one-click top-up on a saved card: the balance changes in place, and the reports resume.
    const onChange = () => {
      if (pending.current) void resume();
    };
    window.addEventListener(CREDIT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CREDIT_CHANGED_EVENT, onChange);
  }, [resumeId, resume]);

  const price = (label: PriceLabel | null, note: string | null, list: number | null) =>
    label ? (
      <>
        {label.main || "Free"}
        {note && list !== null && (
          <>
            {" "}
            <s className="opacity-60">{formatPence(list)}</s> {note}
          </>
        )}
      </>
    ) : null;

  if (items.length === 0) return null;
  return (
    <section aria-labelledby="si-analyses" className="space-y-3 rounded-xl bg-white/5 p-4 text-sm text-white">
      <h2 id="si-analyses" className="font-semibold">
        Analyse your matches
      </h2>
      {resumeNote && <p role="status" className="text-[#B9D5C6]">{resumeNote}</p>}
      {confirm && (
        <p role="status" className="flex flex-wrap items-center gap-2">
          Your top-up credit makes these {formatPence(confirm.total)} in total now. Start them?
          <button type="button" className="rounded-full bg-[#B9D5C6] px-3 py-1 text-xs font-semibold text-[#1a2118]" onClick={() => { const g = confirm.go; setConfirm(null); void g(); }}>
            Start
          </button>
          <button type="button" className="text-xs underline underline-offset-4" onClick={() => setConfirm(null)}>
            Not now
          </button>
        </p>
      )}
      <ul className="space-y-3">
        {items.map((i) => {
          const r = runs[i.dealId] ?? { state: "idle" };
          return (
            <li key={i.dealId} className="space-y-1.5">
              <p className="font-medium">{i.title}</p>
              {r.state === "done" ? (
                <Link href={`/reports/${encodeURIComponent(r.reportId)}`} className="inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-xs font-semibold text-[#1a2118]">
                  Open report
                </Link>
              ) : r.state === "running" ? (
                <p role="status" className="text-[#B9D5C6]">
                  {r.message} ({r.progress}%)
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {i.full && (
                    <button type="button" onClick={() => runOne(i, false)} className="rounded-md bg-[#B9D5C6] px-3 py-1.5 text-xs font-semibold text-[#1a2118] hover:opacity-90">
                      Run full analysis · {price(i.full, i.fullNote, i.fullList)}
                    </button>
                  )}
                  {i.deep && (
                    <button type="button" onClick={() => runOne(i, true)} className="rounded-md border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
                      Deep report · {price(i.deep, i.deepNote, i.deepList)}
                    </button>
                  )}
                  <select
                    aria-label={`Add ${i.title} to "Analyse all"`}
                    value={ticked[i.dealId] ?? ""}
                    onChange={(e) => setTicked((t) => ({ ...t, [i.dealId]: (e.target.value || null) as "full" | "deep" | null }))}
                    className="rounded-md border border-white/30 bg-transparent px-2 py-1 text-xs text-white"
                  >
                    <option value="">Not in “Analyse all”</option>
                    {i.full && <option value="full">Full analysis</option>}
                    {i.deep && <option value="deep">Deep report</option>}
                  </select>
                </div>
              )}
              {r.state === "error" && (
                <p role="alert" className="text-xs text-[#f3c1bd]">
                  {r.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        {!confirming ? (
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => setConfirming(true)}
            className="rounded-full bg-[#B9D5C6] px-4 py-1.5 text-xs font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-40"
          >
            Analyse {chosen.length === items.length ? `all ${items.length}` : chosen.length || ""} {chosen.length > 0 ? `· ${formatPence(total)}` : ""}
          </button>
        ) : (
          <>
            <span>
              Run {chosen.length} report{chosen.length === 1 ? "" : "s"} for {formatPence(total)} in all?
            </span>
            <button type="button" onClick={runChosen} className="rounded-full bg-[#B9D5C6] px-4 py-1.5 text-xs font-semibold text-[#1a2118]">
              Start
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="text-xs underline underline-offset-4">
              Cancel
            </button>
          </>
        )}
        <span className="text-xs text-[#B9D5C6]">Your reports will be in My deals.</span>
      </div>
    </section>
  );
}
