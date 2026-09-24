import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { pickByToken, recordReaction } from "@/lib/listing/picks-server";
import { isPickToken, reasonLabel, reasonEffect, feedbackRules, ruleApplied, type PickFeedback } from "@/lib/listing/picks";
import { ReasonChips } from "@/components/PickReasonChips";
import { describeDeal } from "@/lib/listing/sourcing";
import { BAND_LABELS, screeningWorking } from "@/lib/listing/screen";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { formatListingPrice } from "@/lib/listing/format";
import { applyRelaxationAction, submitPickFeedbackAction, unsubscribePicksAction } from "./actions";

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

  const action = a === "yes" || a === "no" || a === "unsubscribe" || a === "relaxed" ? a : null;
  if ((action === "yes" || action === "no") && !thanks) {
    // A link click only ever sets the reaction; reasons come from the form below.
    after(() => recordReaction({ token }, { reaction: action, source: "link" }).catch(() => {}));
  }
  const reaction = thanks ? (action === "yes" ? "yes" : "no") : action === "yes" || action === "no" ? action : pick.reaction;
  const l = pick.listing;
  // Only shown when this pick actually carried an offer: a near miss.
  const offer = pick.relaxation;
  // Only promise what the rules actually do with this answer: a contradictory
  // pair cancels, and a rule with nothing to key on (no outcode on the stored
  // listing, a 1-bed rejected as too big) never arms.
  const answer: PickFeedback = {
    reaction: "no",
    reactionSource: "form",
    reasons: pick.reasons,
    kind: pick.kind,
    postcodeArea: pick.postcodeArea,
    bedrooms: l.bedrooms,
    amount: l.price ? (pick.kind === "rent" ? (l.price.period === "pw" ? Math.round((l.price.amount * 52) / 12) : l.price.amount) : l.price.period === "total" ? l.price.amount : null) : null,
    rawType: l.rawType,
    outcode: l.outcode,
    dealScore: pick.deal ? (pick.deal.kind === "purchase" ? pick.deal.grossYieldPct : pick.deal.monthlyMargin) : null,
  };
  const rules = feedbackRules([answer]);
  const changed = pick.reasons.filter((r) => ruleApplied(rules, r) && reasonEffect(r));
  const cancelled = pick.reasons.filter((r) => rules.cancelled.includes(r));
  const noted = pick.reasons.filter((r) => !changed.includes(r) && !cancelled.includes(r));
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
            {offer && (
              <section className="mt-4 rounded-2xl border border-[#e4e7dc] bg-[#f7f5ee] p-4">
                {action === "relaxed" ? (
                  <p className="text-sm text-[#2e3d2b]">
                    {done === "1"
                      ? `Done — ${offer.label.toLowerCase()} is now ${offer.suggested}. Tomorrow's pick uses the new setting.`
                      : "That offer is no longer available. You can change it yourself from your filter."}{" "}
                    <Link href="/markets?goals=1" className="underline">Open my filter</Link>
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[#2e3d2b]">Nothing matched your filter exactly</p>
                    <p className="mt-1 text-sm text-[#5b6657]">
                      Your tightest setting is {offer.label.toLowerCase()} — currently {offer.current}.
                      {offer.wouldAdd > 0 && ` Changing it to ${offer.suggested} would have brought in ${offer.wouldAdd} more.`}
                    </p>
                    {offer.applyField ? (
                      <form action={applyRelaxationAction} className="mt-3 flex flex-wrap gap-2">
                        <input type="hidden" name="token" value={token} />
                        <button type="submit" className="rounded-md bg-[#2e3d2b] px-4 py-2 text-sm font-semibold text-white">Change it to {offer.suggested}</button>
                        <Link href="/markets?goals=1" className="rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium">Edit the whole filter</Link>
                      </form>
                    ) : (
                      <p className="mt-3">
                        <Link href="/markets?goals=1" className="rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium inline-block">Edit my filter</Link>
                      </p>
                    )}
                  </>
                )}
              </section>
            )}
            {l.photo && <img src={l.photo} alt="" className="mt-4 w-full rounded-2xl border border-[#e4e7dc] object-cover" style={{ maxHeight: 320 }} />}
            {pick.deal && <p className="mt-4 text-sm font-medium text-[#5d8156]">{describeDeal(pick.deal)}</p>}
            {pick.screening && pick.screening.band !== "insufficient-data" && (
              <div className="mt-3 rounded-lg bg-[#f5f2e8] p-3">
                <p className="text-sm font-semibold text-[#2e3d2b]">{BAND_LABELS[pick.screening.band]}</p>
                <p className="mt-0.5 text-xs text-[#5b6657]">{pick.screening.reason}</p>
                <dl className="mt-2 space-y-0.5">
                  {screeningWorking(pick.screening).map((w) => (
                    <div key={w.label} className="flex justify-between gap-4 text-xs">
                      <dt className="text-[#5b6657]">{w.label}</dt>
                      <dd className="font-semibold text-[#2e3d2b]">{w.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {pick.fit !== null && <p className="mt-1 text-xs text-[#7a8274]">Fit {pick.fit}/100 · {pick.basis === "house" ? "Stayful house pick" : "picked for your filter"}</p>}

            <section className="mt-6 rounded-2xl border border-[#e4e7dc] bg-white p-5">
              {thanks ? (
                <>
                  <h2 className="text-lg font-bold">Thanks, noted.</h2>
                  {reaction === "yes" ? (
                    <p className="mt-1 text-sm text-[#5b6657]">More like this coming up.</p>
                  ) : pick.reasons.length > 0 ? (
                    <>
                      {changed.length > 0 ? (
                        <>
                          <p className="mt-1 text-sm text-[#5b6657]">Here is what changes from tomorrow:</p>
                          <ul className="mt-2 space-y-1 text-sm text-[#5b6657]">
                            {changed.map((r) => (
                              <li key={r}>· {reasonEffect(r)}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-[#5b6657]">Noted. Tomorrow’s pick will steer away from this one.</p>
                      )}
                      {cancelled.length > 0 && (
                        <p className="mt-3 text-sm text-[#5b6657]">
                          {cancelled.map(reasonLabel).map((l) => `“${l}”`).join(" and ")} cancel each other out, so nothing changed there. Tell us which one you meant and we will act on it.
                        </p>
                      )}
                      {noted.length > 0 && (
                        <p className="mt-2 text-xs text-[#7a8274]">
                          Also noted, though it does not change a search on its own: {noted.map(reasonLabel).join(", ").toLowerCase()}.
                        </p>
                      )}
                      <p className="mt-3 text-xs text-[#7a8274]">
                        Want to change more than this? <Link href="/markets?goals=1" className="underline">Edit your filter</Link> and set your area, budget and size directly.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-[#5b6657]">Tomorrow’s pick will steer away from this one.</p>
                      <p className="mt-3 text-sm text-[#5b6657]">
                        It helps much more if we know <strong>why</strong>.{" "}
                        <Link href={`/p/${token}?a=no`} className="underline">Tell us in two clicks</Link>.
                      </p>
                    </>
                  )}
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
                  <h2 className="text-lg font-bold">{reaction === "no" ? "Noted. What was wrong with it?" : "Is this the kind of property you are looking for?"}</h2>
                  {reaction === "no" ? (
                    <p className="mt-1 text-sm text-[#5b6657]">Tick whatever fits. Each one changes what we send you tomorrow, so this is the fastest way to get better picks.</p>
                  ) : (
                    <>
                      <p className="mt-2">
                        <Link href={`/p/${token}?a=yes`} className="mr-2 inline-block rounded-md bg-[#5d8156] px-4 py-2 text-sm font-semibold text-white">Yes, more like this</Link>
                        <Link href={`/p/${token}?a=no`} className="inline-block rounded-md border border-[#e4e7dc] px-4 py-2 text-sm font-medium">Not for me</Link>
                      </p>
                      <p className="mt-2 text-sm text-[#5b6657]">Not for you? Say why below and tomorrow’s pick changes.</p>
                    </>
                  )}
                  <ReasonChips selected={pick.reasons} tone="public" />
                  <label className="mt-3 block text-sm font-medium">
                    What would you rather have seen?
                    <textarea name="comment" defaultValue={pick.comment} placeholder="e.g. a 3-bed house in Leicester under £250k, or anything with a garden" rows={2} className="mt-1 w-full rounded-md border border-[#e4e7dc] p-2 text-sm font-normal" maxLength={1000} />
                  </label>
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
