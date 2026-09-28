import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { payerFor } from "@/lib/team";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { parseMarketGoals } from "@/lib/market/goals";
import { countDeals, dealCardsByIds, earlyAccessCount, openedDealIds, photoUrlFor, recordShown } from "@/lib/marketplace/queries";
import { earlyAccessBanner, earlyAccessFor } from "@/lib/marketplace/early-access";
import { reactionsFor } from "@/lib/marketplace/reactions-server";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { filtersForGoals } from "@/lib/today/candidates";
import { displayOrder, greeting, matchLine, todayKey, todayStart } from "@/lib/today/day";
import { todaySelection, todaysPick, type TodaysPick } from "@/lib/today/selection";
import { syncChecklist } from "@/lib/today/checklist-server";
import { GOALS_EDITOR_HREF, TODAY_LIST_ID } from "@/lib/nav";
import { DealCard } from "@/app/deals/_components/DealCard";
import { cardViewsFor } from "@/lib/marketplace/card-state";
import { cashBuyerOf } from "@/lib/marketplace/most-you-can-pay";
import { EarlyAccessBanner } from "@/app/deals/_components/EarlyAccessBanner";
import { ShareDealButton } from "@/app/deals/_components/ShareDealButton";
import { Checklist, ChecklistProvider } from "./_components/Checklist";
import { PasteLinkBox } from "./_components/PasteLinkBox";
import { TodayCards } from "./_components/TodayCards";
import { ProfileProgressCard } from "./_components/ProfileProgressCard";
import { profilePriceLineFor, profilesFor } from "@/lib/profiles/server";
import { isRunning, labelsShown } from "@/lib/profiles/rules";
import { pauseProfileAction } from "@/app/profiles/actions";
import { markPromptShown, promptStatesFor, tailoringForMember } from "@/lib/tailoring/server";
import { sharesWithInvestors, usesTailoring, wantsLandlordLeads } from "@/lib/tailoring/profile";
import { promptToShow } from "@/lib/tailoring/behaviour";
import { ownsAnyFunnel } from "@/lib/funnels/ownership";
import { logActivity } from "@/lib/activity/log";
import { BehaviourPrompt } from "./_components/BehaviourPrompt";
import { LeadsUpsell } from "./_components/LeadsUpsell";

export const metadata: Metadata = {
  title: "Today — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * The first screen a member sees each day: up to five deals picked for them,
 * this morning's pick first, triaged with Keep and Pass until they are done
 * for the day. The list is chosen once a day and stored, so it does not move
 * under them between visits or devices.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ check?: string | string[] }> }) {
  const params = await searchParams;
  const searchParam = Array.isArray(params.check) ? params.check[0] : params.check;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const now = new Date();
  const adminUser = isAdminEmail(user.email);
  const [payer, visibility, profileRes, savedRes, settings, saved] = await Promise.all([
    payerFor(user.id),
    // An account that has never paid sees a deal only once its early-access window has passed.
    dealVisibilityFor(user.id, adminUser),
    supabase.from("profiles").select("full_name, market_goals").eq("id", user.id).maybeSingle(),
    supabase.from("saved_areas").select("postcode_area").eq("user_id", user.id),
    getBillingSettings(),
    // Saved profiles (Batch 13): Today is the active profile's own list and pick.
    profilesFor(user.id),
  ]);
  const active = saved.readable ? saved.active : null;
  const profileId = active?.id ?? null;
  const paused = active !== null && !isRunning(active);
  const profileName = active && labelsShown(saved.all) ? active.name : null;
  const profile = profileRes.data as { full_name: string | null; market_goals: unknown } | null;
  const goals = parseMarketGoals(profile?.market_goals ?? null);
  const savedAreas = ((savedRes.data ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area);
  // The search the member's goals point at: the same one /deals counts, so "N match" and the cards agree.
  const filters = filtersForGoals(goals, savedAreas);

  // Batch 14: the profile's tailoring, read by the same loader as the daily runs.
  const tailoringReady = paused ? Promise.resolve(null) : tailoringForMember(user.id, active, goals, savedAreas, now);

  const [selection, pick, count, waiting, checklist, priceLine, tailoring, promptStates, ownsLeads] = await Promise.all([
    // A paused profile has no daily deals: no list, no pick, until it is resumed.
    paused ? Promise.resolve(null) : tailoringReady.then((tailoring) => todaySelection({ userId: user.id, payerId: payer.payerId, goals, savedAreas, visibility, profileId, profileActive: true, tailoring }, now)),
    paused ? Promise.resolve(null) : todaysPick(user.id, now, profileId),
    countDeals(filters, visibility, { userId: user.id }),
    visibility.tier === "free" ? earlyAccessCount(filters, visibility) : Promise.resolve(null),
    // The first-week checklist, brought up to date now: any "+£1" it shows is marked seen.
    syncChecklist(user.id, { markSeen: true, now }),
    paused ? profilePriceLineFor(user.id, adminUser) : Promise.resolve(null),
    tailoringReady,
    tailoringReady.then((t) => (usesTailoring(t) ? promptStatesFor(user.id, profileId) : null)),
    tailoringReady.then((t) => (wantsLandlordLeads(t) ? ownsAnyFunnel(payer.payerId) : true)),
  ]);

  // Batch 14: one profile check a visit ("You've kept 4 houses but said flats only"), when the Keeps call for one.
  const prompt = promptStates ? promptToShow(tailoring, promptStates, now, todayStart(now)) : null;
  if (prompt) {
    const state = promptStates?.find((x) => x.question === prompt.question);
    const shownToday = Boolean(state?.lastShownAt && Date.parse(state.lastShownAt) >= todayStart(now).getTime());
    after(() => markPromptShown(user.id, profileId, prompt.question, now, shownToday));
    if (!shownToday) logActivity(user.id, "tailoring_prompt_shown", { profileId, extras: { question: prompt.question, step: "shown" }, dedupeKey: `tailoring_prompt_shown:${profileId ?? "member"}:${prompt.question}:${todayKey(now)}` });
  }
  const leadsCard = !ownsLeads;
  const investorShare = sharesWithInvestors(tailoring);

  const stored = selection?.dealIds ?? [];
  const pickDealId = pick?.dealId ?? null;
  const answered = await reactionsFor(user.id, pickDealId ? [pickDealId, ...stored] : stored);
  const order = displayOrder(stored, pickDealId, new Set(answered.keys()));
  const cards = await dealCardsByIds(order, visibility);
  const [opened, views] = await Promise.all([openedDealIds(payer.payerId, cards.map((c) => c.id)), cardViewsFor({ supabase, userId: user.id, adminUser, cards, finance: goals?.finance ?? null, cashBuyer: cashBuyerOf(goals) })]);
  const pickCard = pickDealId ? cards.find((c) => c.id === pickDealId) ?? null : null;
  const dayCards = cards.filter((c) => c.id !== pickDealId);
  const ids = cards.map((c) => c.id);
  const initial = Object.fromEntries(ids.filter((id) => answered.has(id)).map((id) => [id, answered.get(id)!]));

  // What this member was shown goes to the front of the recheck queue.
  if (ids.length > 0) after(() => recordShown(ids));

  const banner = earlyAccessBanner(waiting, false);
  // Batch 14: a tailored list counts the deals meeting every must-have, as chosen.
  const line = selection?.mustMatches != null ? matchLine(selection.mustMatches, true, true) : matchLine(count, goals !== null);
  const card = (c: (typeof cards)[number]) => (
    <DealCard
      key={c.id}
      card={c}
      photoUrl={photoUrlFor(c, now)}
      ladder={settings.dealOpenLadder}
      now={now}
      opened={opened.has(c.id)}
      reaction={answered.get(c.id) ?? null}
      earlyAccess={visibility.tier === "paid" ? earlyAccessFor(c.live_since, settings.freeDealDelayHours, now) : null}
      share={investorShare ? <ShareDealButton dealId={c.id} label="Share with an investor" className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50" /> : <ShareDealButton dealId={c.id} />}
      view={views.get(c.id)}
    />
  );

  return (
    <main className="min-h-screen bg-background">
      <ChecklistProvider initial={checklist}>
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <Checklist />
        {/* Batch 12: the profile reminder, until the profile is complete. */}
        <ProfileProgressCard userId={user.id} now={now} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">{greeting(now, profile?.full_name ?? null)}</h1>
          {profileName && (
            <p className="mt-1 text-sm font-medium text-foreground">
              Today’s 5 for {profileName} ·{" "}
              <Link href="/profiles" className="font-normal text-muted-foreground underline-offset-4 hover:underline">
                switch profile
              </Link>
            </p>
          )}
          {line && <p className="mt-1 text-sm text-muted-foreground">{line}</p>}
          {!goals && (
            <p className="mt-2 text-sm text-foreground">
              <Link href={GOALS_EDITOR_HREF} className="font-semibold underline-offset-4 hover:underline">
                Tell us what you’re looking for
              </Link>{" "}
              and today’s deals will be picked for you.
            </p>
          )}
        </header>

        {searchParam === "1" && (
          <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
            Updated. Today’s deals now follow it.
          </p>
        )}
        {searchParam === "0" && (
          <p role="status" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Could not update your profile. Please try again shortly.
          </p>
        )}
        {prompt && <BehaviourPrompt prompt={prompt} />}
        {leadsCard && <LeadsUpsell />}

        <PasteLinkBox />

        {/* The first-week checklist's steps scroll here (Batch 11): the cards, or the empty day in their place. */}
        <div id={TODAY_LIST_ID} className="scroll-mt-4 space-y-5">
        {paused && active ? (
          <section className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground">Daily deals for {active.name} are paused.</p>
            <p className="mt-1 text-sm text-muted-foreground">Nothing is charged for this profile while it’s paused. {priceLine ? `${priceLine}.` : ""}</p>
            <form action={pauseProfileAction} className="mt-3">
              <input type="hidden" name="id" value={active.id} />
              <input type="hidden" name="paused" value="0" />
              <input type="hidden" name="next" value="/today" />
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Resume daily deals</button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">They start again with the next morning’s email. You can still browse every deal meanwhile.</p>
          </section>
        ) : ids.length > 0 ? (
          <TodayCards ids={ids} initial={initial}>
            <div className="space-y-5">
              {pickCard && (
                <section aria-labelledby="todays-pick">
                  <h2 id="todays-pick" className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Today’s pick · from this morning’s email</h2>
                  <ul className="grid gap-4">{card(pickCard)}</ul>
                </section>
              )}
              {!pickCard && pick && <OutsidePick pick={pick} />}
              {dayCards.length > 0 && (
                <section aria-labelledby="todays-deals">
                  <h2 id="todays-deals" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {selection?.nearMiss ? "The closest we found" : pickCard ? "More picked for you today" : "Picked for you today"}
                  </h2>
                  {selection?.nearMiss && (
                    <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                      <p className="font-semibold text-foreground">Not an exact match</p>
                      {selection.advice && <p className="mt-0.5 text-foreground">{selection.advice}</p>}
                      <Link href={GOALS_EDITOR_HREF} className="mt-1 inline-block font-medium text-foreground underline-offset-4 hover:underline">
                        Edit what you’re looking for
                      </Link>
                    </div>
                  )}
                  <ul className="grid gap-4 sm:grid-cols-2">{dayCards.map(card)}</ul>
                </section>
              )}
            </div>
          </TodayCards>
        ) : (
          <>
            {pick && <OutsidePick pick={pick} />}
            <EmptyDay hasGoals={goals !== null} ready={selection !== null} />
          </>
        )}
        </div>

        <EarlyAccessBanner text={banner} returnTo="/today" />

        <p className="border-t border-border pt-4 text-sm">
          <Link href="/deals" className="font-medium text-foreground underline-offset-4 hover:underline">Browse all deals</Link>
        </p>
      </div>
      </ChecklistProvider>
    </main>
  );
}

/** A daily pick found outside the marketplace pool: no deal sheet to draw, so a line and a way to it. */
function OutsidePick({ pick }: { pick: TodaysPick }) {
  const what = [pick.bedrooms ? `${pick.bedrooms}-bed` : null, pick.kind === "rent" ? "to rent" : "to buy", pick.areaName ? `in ${pick.areaName}` : null].filter(Boolean).join(" ");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Today’s pick · from this morning’s email</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{what}</p>
      {pick.price && <p className="text-sm text-muted-foreground">{pick.price}</p>}
      <Link href="/picks" className="mt-2 inline-block text-sm font-medium text-foreground underline-offset-4 hover:underline">
        See it in your picks
      </Link>
    </section>
  );
}

function EmptyDay({ hasGoals, ready }: { hasGoals: boolean; ready: boolean }) {
  return (
    <section className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium text-foreground">{ready ? "Nothing new for you today." : "Today’s deals aren’t ready yet."}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {hasGoals ? (
          <>
            New deals arrive every morning.{" "}
            <Link href={GOALS_EDITOR_HREF} className="font-medium text-foreground underline-offset-4 hover:underline">
              Widen what you’re looking for
            </Link>{" "}
            or browse every deal.
          </>
        ) : (
          "New deals arrive every morning. Browse every deal in the meantime."
        )}
      </p>
    </section>
  );
}
