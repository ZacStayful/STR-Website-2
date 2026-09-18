import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { pickByToken, recordReaction } from "@/lib/listing/picks-server";
import { PICK_REASONS, isPickToken } from "@/lib/listing/picks";
import { describeDeal } from "@/lib/listing/sourcing";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { formatListingPrice } from "@/lib/listing/format";
import { submitPickFeedbackAction, unsubscribePicksAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your daily pick — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Where the email buttons land. Public (the token is the credential), shows
 * only the listing and the member's own answer, never who they are.
 *   ?a=yes | no    records the click straight away (after the page is sent)
 *                  and offers the reasons form, which is what actually
 *                  teaches the picks; a bare click can come from a mail
 *                  scanner, so it never changes what gets searched.
 *   ?a=unsubscribe asks for one confirming click (scanners GET every link).
 */
export default async function PickResponsePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ a?: string; thanks?: string; done?: string }> }) {
  const [{ token }, { a, thanks, done }] = await Promise.all([params, searchParams]);
  if (!isPickToken(token)) notFound();
  const pick = await pickByToken(token);
  if (!pick || pick.status !== "sent") notFound();

  const action = a === "yes" || a === "no" || a === "unsubscribe" ? a : null;
  if ((action === "yes" || action === "no") && !thanks) {
    // A link click only ever sets the reaction; reasons come from the form below.
    after(() => recordReaction({ token }, { reaction: action, source: "link" }).catch(() => {}));
  }
  const reaction = thanks ? (action === "yes" ? "yes" : "no") : action === "yes" || action === "no" ? action : pick.reaction;
  const l = pick.listing;
  const price = l.price ? formatListingPrice(l.price) : null;

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Stayful daily pick · {l.kind === "rent" ? "rent-to-rent" : "to buy"}</p>

        {action === "unsubscribe" ? (
          <section className="mt-3 rounded-2xl border border-[#e4e7dc] bg-white p-6">
            {done ? (
              <>
                <h1 className="text-2xl font-bold">Daily picks are off</h1>
                <p className="mt-2 text-sm text-[#5b6657]">You will not be emailed another pick. Changed your mind? Turn them back on from <Link href="/picks" className="underline">your picks</Link> any time.</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold">Stop daily picks?</h1>
                <p className="mt-2 text-sm text-[#5b6657]">One click below and no more picks are emailed to you. Everything already sent stays on <Link href="/picks" className="underline">your picks page</Link>.</p>
                <form action={unsubscribePicksAction} className="mt-4 flex flex-wrap gap-2">
                  <input type="hidden" name="token" value={token} />
                  <button type="submit" className="rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Yes, stop daily picks</button>
                  <Link href={`/p/${token}`} className="rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium">Keep them</Link>
                </form>
              </>
            )}
          </section>
        ) : (
          <>
            <h1 className="mt-1 text-2xl font-bold">{l.address ?? l.title}</h1>
            <p className="mt-1 text-sm text-[#7a8274]">
              {[l.bedrooms !== null ? `${l.bedrooms} bed` : null, l.rawType, price, pick.areaName].filter(Boolean).join(" · ")} ·{" "}
              <a href={l.canonicalUrl} target="_blank" rel="noopener noreferrer" className="underline">View on {SOURCE_LABELS[l.source]}</a>
            </p>
            {l.photo && <img src={l.photo} alt="" className="mt-4 w-full rounded-2xl border border-[#e4e7dc] object-cover" style={{ maxHeight: 320 }} />}
            {pick.deal && <p className="mt-4 text-sm font-medium text-[#5d8156]">{describeDeal(pick.deal)}</p>}
            {pick.fit !== null && <p className="mt-1 text-xs text-[#7a8274]">Fit {pick.fit}/100 · {pick.basis === "house" ? "Stayful house pick" : "picked for your filter"}</p>}

            <section className="mt-6 rounded-2xl border border-[#e4e7dc] bg-white p-5">
              {thanks ? (
                <>
                  <h2 className="text-lg font-bold">Thanks, noted.</h2>
                  <p className="mt-1 text-sm text-[#5b6657]">{reaction === "yes" ? "More like this coming up." : "Tomorrow’s pick will steer away from this."}</p>
                </>
              ) : reaction === "yes" ? (
                <>
                  <h2 className="text-lg font-bold">Great, more like this.</h2>
                  <p className="mt-1 text-sm text-[#5b6657]">Save it to your pipeline to track it, or run the full report.</p>
                  <form action={submitPickFeedbackAction} className="mt-3">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="reaction" value="no" />
                    <button type="submit" className="text-xs text-[#7a8274] underline">Actually, not for me</button>
                  </form>
                </>
              ) : (
                <form action={submitPickFeedbackAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="reaction" value="no" />
                  <h2 className="text-lg font-bold">{reaction === "no" ? "Not for you. What was wrong with it?" : "Is this the kind of property you are looking for?"}</h2>
                  {reaction !== "no" && (
                    <p className="mt-2">
                      <Link href={`/p/${token}?a=yes`} className="mr-2 inline-block rounded-md bg-[#5d8156] px-4 py-2 text-sm font-semibold text-white">Yes, more like this</Link>
                      <Link href={`/p/${token}?a=no`} className="inline-block rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium">Not for me</Link>
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PICK_REASONS.map((r) => (
                      <label key={r.key} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e4e7dc] bg-[#f7f8f4] px-3 py-1 text-xs">
                        <input type="checkbox" name="reasons" value={r.key} defaultChecked={pick.reasons.includes(r.key)} />
                        {r.label}
                      </label>
                    ))}
                  </div>
                  <textarea name="comment" defaultValue={pick.comment} placeholder="Anything else? (optional)" rows={2} className="mt-3 w-full rounded-md border border-[#e4e7dc] p-2 text-sm" maxLength={1000} />
                  <button type="submit" className="mt-3 rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Send feedback</button>
                </form>
              )}
            </section>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link href={`/picks?save=${encodeURIComponent(pick.id)}`} className="rounded-md bg-[#5d8156] px-4 py-2 text-sm font-semibold text-white">Save to my pipeline</Link>
              <Link href={`/estimate?listing=${encodeURIComponent(l.canonicalUrl)}`} className="rounded-md border border-[#e4e7dc] bg-white px-4 py-2 text-sm font-medium">Full report</Link>
              <Link href="/markets?goals=1" className="rounded-md border border-[#e4e7dc] bg-white px-4 py-2 text-sm font-medium">{pick.basis === "house" ? "Set my filter" : "Edit my filter"}</Link>
              <Link href="/picks" className="rounded-md border border-[#e4e7dc] bg-white px-4 py-2 text-sm font-medium">All my picks</Link>
            </div>
            {pick.basis === "house" && <p className="mt-4 text-xs text-[#7a8274]">This was a Stayful house pick from one of the best-scoring areas we track. Set a filter and tomorrow’s pick will be in your area, budget and size.</p>}
            <p className="mt-6 text-xs text-[#7a8274]">
              Figures are area averages for the size of property; run a full report before acting on one. Not financial advice. <Link href={`/p/${token}?a=unsubscribe`} className="underline">Stop daily picks</Link>.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
