import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { teaserAnswerContext } from "@/lib/tailoring/email-answers-server";
import { EMAIL_ANSWER_LABELS } from "@/lib/tailoring/email-answers";
import { teaserItem } from "@/lib/notify/message";
import { rangeLineFor } from "@/lib/project/display";
import { memberFinance } from "@/lib/marketplace/most-you-can-pay";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { ReasonChips } from "@/components/PickReasonChips";
import { NAV_TARGETS } from "@/lib/nav";
import { answerTeaserAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your answer — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  gone: "This deal has just left the market, so there is nothing to answer.",
  failed: "We could not save that just now. Please try again.",
  invalid: "This link has expired.",
};

/**
 * Where a teaser's "Yes, more like this" / "Not for me" lands (Batch 14,
 * Part F). Public: the send's token is the credential, and only for the
 * deals that email carried. A GET writes nothing, because mail scanners
 * open every link; the one button below records the answer. It shows only
 * what the teaser showed: no photo, no address, no listing or report link.
 */
export default async function TeaserAnswerPage({ params, searchParams }: { params: Promise<{ token: string; deal: string }>; searchParams: Promise<{ a?: string; done?: string; error?: string }> }) {
  const [{ token, deal }, { a, done, error }] = await Promise.all([params, searchParams]);
  const ctx = await teaserAnswerContext(token, deal);
  if (!ctx) notFound();
  const now = new Date();
  const widths = (await getBillingSettings()).dealPricing.profitRangePct;
  const item = ctx.card ? teaserItem(ctx.card, "/today", now, (c) => rangeLineFor(c, memberFinance(ctx.goals), widths)) : null;
  const answer = done === "yes" || done === "no" ? null : a === "no" ? "no" : "yes";
  const problem = error ? ERRORS[error] ?? ERRORS.failed : null;

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Stayful · Today’s 5</p>
        {item ? (
          <section className="mt-3 rounded-2xl border border-[#e4e7dc] bg-white p-5">
            <p className="text-lg font-bold">{item.title}</p>
            {item.lines.map((l) => (
              <p key={l} className="text-sm text-[#5b6657]">{l}</p>
            ))}
          </section>
        ) : (
          <p className="mt-3 text-sm text-[#5b6657]">This deal has left the market since the email.</p>
        )}

        {problem && <p className="mt-4 rounded-lg border border-[#e8c9c4] bg-[#fbeeec] p-3 text-sm text-[#8a2f22]">{problem}</p>}

        {done === "yes" && (
          <section className="mt-4 rounded-2xl border border-[#e4e7dc] bg-white p-5">
            <h1 className="text-xl font-bold">Kept</h1>
            <p className="mt-1 text-sm text-[#5b6657]">It’s on your kept deals, and the deals picked for you will lean towards ones like it.</p>
            <Link href={NAV_TARGETS.myDeals.href} className="mt-3 inline-block rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Your kept deals</Link>
          </section>
        )}
        {done === "no" && (
          <section className="mt-4 rounded-2xl border border-[#e4e7dc] bg-white p-5">
            <h1 className="text-xl font-bold">Passed</h1>
            <p className="mt-1 text-sm text-[#5b6657]">It won’t be shown to you again, and what you told us shapes the deals picked for you.</p>
            <Link href="/today" className="mt-3 inline-block rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Open Today</Link>
          </section>
        )}

        {answer && item && (
          <form action={answerTeaserAction} className="mt-4 rounded-2xl border border-[#e4e7dc] bg-white p-5">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="deal" value={deal} />
            <input type="hidden" name="answer" value={answer} />
            {answer === "yes" ? (
              <>
                <h1 className="text-xl font-bold">{EMAIL_ANSWER_LABELS.yes}?</h1>
                <p className="mt-1 text-sm text-[#5b6657]">This keeps the deal, and the deals picked for you lean towards ones like it.{ctx.reaction === "keep" ? " You’ve already kept it." : ""}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="submit" className="rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Yes, keep it</button>
                  <Link href={`/p/d/${encodeURIComponent(token)}/${deal}?a=no`} className="rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium">{EMAIL_ANSWER_LABELS.no}</Link>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold">{EMAIL_ANSWER_LABELS.no}</h1>
                <p className="mt-1 text-sm text-[#5b6657]">Why not? Optional, and it’s what makes the next deals better.{ctx.reaction === "pass" ? " You’ve already passed on it." : ""}</p>
                <ReasonChips selected={[]} tone="public" />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="submit" className="rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Pass on it</button>
                  <Link href={`/p/d/${encodeURIComponent(token)}/${deal}?a=yes`} className="rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium">{EMAIL_ANSWER_LABELS.yes}</Link>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
