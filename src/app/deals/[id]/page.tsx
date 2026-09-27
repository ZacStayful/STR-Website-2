import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payerFor, personName, profileNames } from "@/lib/team";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { getCreditSummary } from "@/lib/credit/summary";
import { quoterFor } from "@/lib/credit/quote-server";
import { addOnLabel, formatPence, openCreditBase, priceText } from "@/lib/credit/deal-pricing";
import { getAreaCards } from "@/lib/market/cached";
import { areaMetaForCode } from "@/lib/market/areas";
import { parseMarketGoals } from "@/lib/market/goals";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { BAND_LABELS, parseScreening } from "@/lib/listing/screen";
import { purchaseDeal, rentToRentDeal, DEFAULT_FINANCE, type Deal } from "@/lib/listing/deal";
import { areaRevenueFor } from "@/lib/listing/sourcing";
import { parseHistory, describeChange } from "@/lib/listing/recheck";
import { motivationLabel, parseMotivation } from "@/lib/listing/motivation";
import { dealListingFor, dealSheet } from "@/lib/marketplace/open";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { openPricePence } from "@/lib/marketplace/ladder";
import { badgesFor, describeType, type DealCard as Card } from "@/lib/marketplace/grid";
import { photoUrlFor } from "@/lib/marketplace/queries";
import { moneyRange, profitRange, spread, upliftTag } from "@/lib/marketplace/profit-range";
import { priceLine } from "../_components/DealCard";
import { openDealAction } from "../actions";
import { dealTrackingFor } from "@/lib/listing/tracked-server";
import { myDealsFocusPath } from "@/lib/listing/return-path";
import { KEPT_STATUS } from "@/lib/listing/pipeline";
import { readableReportFor } from "@/lib/analysis/deal-analysis";
import { analysisQuote } from "@/lib/analysis/deal-analysis-rules";
import { dealAnalysisInput, dealListingPrice } from "@/lib/analysis/deal-input";
import { enhancedEnabled } from "@/lib/analysis/run";
import { reminderWhere } from "@/lib/analysis/take-up";
import { StageSelect } from "@/app/my-deals/_components/StageSelect";
import { NextStepSlot } from "@/app/my-deals/_components/NextStepSlot";
import { factsFromCard } from "@/lib/pipeline/slot-facts";
import { StageReminder } from "@/components/pipeline/StageReminder";
import { ShareDealButton } from "../_components/ShareDealButton";
import { AnalysisPanel } from "../_components/AnalysisPanel";
import { AnalysisPreview } from "../_components/AnalysisPreview";
import { BasicVsDetailed } from "../_components/BasicVsDetailed";

export const metadata: Metadata = { title: "Deal — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// An open may read the listing page live before charging.
export const maxDuration = 60;

/** The sample report behind "See a sample report" (decided 27 Sep 2026). */
const SAMPLE_REPORT = "/demo-report?demo=manchester";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

const MESSAGES: Record<string, { text: string; tone: "ok" | "warn" }> = {
  opened: { text: "Unlocked. This deal is yours to come back to whenever you like.", tone: "ok" },
  just_gone: { text: "This one has just gone off the market. Nothing was charged.", tone: "warn" },
  gone: { text: "This deal is no longer on the market.", tone: "warn" },
  checking: { text: "We’re checking it is still on the market and will have an answer within the hour. Nothing was charged; try again shortly.", tone: "warn" },
  rate_limited: { text: "You’ve opened a lot of deals in the last hour. Give it a few minutes and try again.", tone: "warn" },
  failed: { text: "Something went wrong opening that deal. Nothing was charged. Please try again.", tone: "warn" },
  not_open: { text: "Open the deal first to save it to your pipeline.", tone: "warn" },
  save_failed: { text: "We could not save that deal to your pipeline just now.", tone: "warn" },
  stage_failed: { text: "Unlocked, but we couldn’t move it to that stage just now. Choose it again below.", tone: "warn" },
};

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; need?: string; have?: string; analysis?: string; from?: string }> }) {
  const { id } = await params;
  const { msg, analysis, from } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const adminUser = isAdminEmail(user.email);
  // Deals opened by anyone on the team are open for everyone on it, and the
  // balance shown is the team's (the owner's), which is what pays.
  const { payerId } = await payerFor(user.id);
  // Inside its early-access window a deal is a 404 for an account that has never paid.
  const visibility = await dealVisibilityFor(user.id, adminUser);
  const sheet = await dealSheet(id, payerId, adminUser, visibility);
  if (!sheet) notFound();
  const { deal, priv } = sheet;
  const [settings, credit, cards, profileRes, quoter] = await Promise.all([getBillingSettings(), getCreditSummary(payerId).catch(() => null), getAreaCards().catch(() => []), supabase.from("profiles").select("market_goals").eq("id", user.id).single(), quoterFor(payerId, adminUser)]);
  const goals = parseMarketGoals(profileRes.data?.market_goals);
  const pricing = quoter.pricing;
  const now = new Date();
  const card: Card = { ...deal, has_photo: Boolean(deal.photo) } as unknown as Card;
  const badges = badgesFor(card, now);
  const price = priceLine(card);
  const area = deal.postcode_area ? areaMetaForCode(deal.postcode_area) : null;
  const areaCard = deal.postcode_area ? cards.find((c) => c.code === deal.postcode_area) ?? null : null;
  const profit = deal.annual_profit === null ? null : Number(deal.annual_profit);
  const ladderPence = openPricePence(profit, settings.dealOpenLadder);
  const screening = parseScreening(deal.screening);
  const motivation = parseMotivation(deal.motivation);
  const history = parseHistory(deal.price_history);
  const message = msg ? MESSAGES[msg] ?? null : null;
  const insufficient = msg === "insufficient_credit";
  const where = [deal.town, area?.name && area.name !== deal.town ? area.name : null, deal.outcode].filter(Boolean).join(" · ");

  // The profit as an area-estimate range at the member's finance (Batch 10):
  // the exact figure for the property is what a Full analysis is for.
  const gross = screening?.grossRevenue?.value ?? null;
  const range = profitRange({ kind: deal.kind, priceAmount: deal.price_amount, pricePeriod: deal.price_period, bedrooms: deal.bedrooms, grossRevenue: gross, confidence: screening?.confidence ?? null, finance: goals?.finance ?? null, widths: pricing.profitRangePct });
  const pct = range?.pct ?? 25;
  const uplift = deal.kind === "sale" ? upliftTag(deal.uplift_pct) : null;

  // Batch 5 (My deals): this member's stage for the deal. The analysis to
  // open instead of buying (or running) another: theirs first, then the
  // team's, only if it still exists and they may read it.
  const tracking = await dealTrackingFor({ userId: user.id, deal });
  const report = priv ? await readableReportFor(supabase, user.id, deal.id, tracking.reportCandidates) : null;
  const reportBy = report && report.userId !== user.id ? personName((await profileNames([report.userId])).get(report.userId)) : null;
  const dealPath = `/deals/${deal.id}`;
  const opened = Boolean(priv);
  const openPaid = priv && priv.open.id !== "admin" ? openCreditBase(priv.open) : 0;

  // Can a Full analysis run on this listing (a full postcode; a rental's
  // rent)? Worked out exactly as the purchase does, before anything is shown
  // as buyable. The private listing is read here only to decide; nothing of
  // it reaches an unopened page.
  let blocked: string | null = null;
  if (!report) {
    let snapshot = priv ? { ...priv.snapshot, postcode: priv.postcode ?? priv.snapshot.postcode, displayAddress: priv.address ?? priv.snapshot.displayAddress } : null;
    if (!snapshot) {
      const found = await dealListingFor(createAdminClient(), deal).catch(() => null);
      if (found?.snapshot) snapshot = { ...found.snapshot, postcode: found.listing?.postcode ?? found.snapshot.postcode, displayAddress: found.listing?.address ?? found.snapshot.displayAddress };
    }
    const check = snapshot ? dealAnalysisInput(snapshot, { canonicalUrl: deal.canonical_url, kind: deal.kind, price: dealListingPrice(deal.price_amount, deal.price_period), withPmi: false, checkedListingId: null }) : null;
    blocked = !check ? "We couldn’t read this listing well enough to analyse it. You can still take a Quick look." : check.ok ? null : check.message;
  }
  const quoteFor = (withPmi: boolean) => analysisQuote({ admin: adminUser, pricing, opened, openPaidBasePence: openPaid, openPricePence: ladderPence, withPmi }).due.purchaseBasePence;
  const analysisPrice = { without: quoter.label(quoteFor(false)), withPmi: quoter.label(quoteFor(true)) };
  const pmiLabel = enhancedEnabled(true) ? quoter.label(adminUser ? 0 : pricing.pmiAddonPence) : null;
  const quickLook = quoter.label(adminUser ? 0 : ladderPence);
  const canBuy = !report && (opened || deal.status === "live");
  const stagePastKept = tracking.tracked && tracking.stage !== KEPT_STATUS && tracking.stage !== "passed";

  // The purchase / rent-to-rent model at the member's own finance settings
  // when they have set them, on the screening's revenue for the area and
  // size (the same figure as the range above). Anything that rests on that
  // income is shown as a range; the price, the cash needed, the mortgage and
  // the stamp duty are the listing's and the member's own, so stay exact.
  let model: Deal | null = null;
  if (deal.price_amount !== null) {
    const rev = gross !== null ? { grossRevenue: gross, adr: 0 } : areaCard ? areaRevenueFor({ byBedrooms: areaCard.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: areaCard.headline.grossRevenue, adr: areaCard.headline.adr } }, deal.bedrooms) : null;
    if (rev) {
      const base = { grossRevenue: rev.grossRevenue, adr: rev.adr, bedrooms: deal.bedrooms ?? 2, finance: { ...DEFAULT_FINANCE, ...(goals?.finance ?? {}) } };
      model = deal.kind === "rent" ? rentToRentDeal(Number(deal.price_amount), base) : purchaseDeal(Number(deal.price_amount), base);
    }
  }
  const pctRange = (v: number) => {
    const [lo, hi] = spread(v, pct, 0.1);
    return `${lo.toFixed(1)}–${hi.toFixed(1)}%`;
  };
  const gbpRange = (v: number, step = 10) => moneyRange(spread(v, pct, step));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs">
          <Link href="/deals" className="text-muted-foreground hover:underline">← All deals</Link>
          {/* Batch 3: a public link showing only what the card shows (never the address), on the member's referral code. */}
          <ShareDealButton dealId={deal.id} />
        </div>

        {message && <p className={"mb-4 rounded-md border p-3 text-sm " + (message.tone === "ok" ? "border-primary/40 bg-primary/10 text-foreground" : "border-destructive/40 bg-destructive/10 text-destructive")}>{message.text}</p>}
        {insufficient && (
          <section className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">Not enough credit for a Quick look.</p>
            <p className="mt-1 text-muted-foreground">
              A Quick look at this deal is {formatPence(ladderPence)} on a plan{credit ? `; your balance is ${formatPence(Math.max(0, credit.totalPence))}` : ""}. Top up or upgrade and you’ll come straight back here.
            </p>
            <p className="mt-3 flex flex-wrap gap-2">
              <Link href={`/account/billing?redirect=${encodeURIComponent(`/deals/${id}`)}#topup`} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">Top up</Link>
              <Link href={`/upgrade?redirect=${encodeURIComponent(`/deals/${id}`)}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">See plans</Link>
            </p>
          </section>
        )}

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
          <section>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative aspect-[16/10] w-full bg-muted">
                {priv && priv.photos.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={priv.photos[0]} alt="" className="h-full w-full object-cover" />
                ) : photoUrlFor(card, now) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrlFor(card, now)!} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{deal.source === "zoopla" ? "Photos on the listing" : "Photo coming"}</div>
                )}
                <div className="absolute left-3 top-3 flex flex-wrap gap-1">
                  <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{deal.kind === "rent" ? "Rent-to-rent" : "To buy"}</span>
                  {badges.tags.map((t) => (
                    <span key={t} className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t}</span>
                  ))}
                  {deal.status === "retired" && <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white">Off the market</span>}
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {range?.label ?? "—"} <span className="text-sm font-normal text-muted-foreground">area estimate{range ? ` · ${range.basis}` : ""}</span>
                  </p>
                  {price && <p className="text-lg font-semibold text-foreground">{price}</p>}
                </div>
                {uplift && <p className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{uplift}</p>}
                <p className="mt-2 text-sm font-medium text-foreground">{priv ? (priv.address ?? where) : where}</p>
                <p className="text-xs text-muted-foreground">{describeType(card)}{priv?.postcode ? ` · ${priv.postcode}` : ""}</p>
                <p className={"mt-1 text-[11px] " + (badges.freshnessKind === "live" ? "text-primary" : "text-muted-foreground")}>{badges.freshness}{deal.listed_date ? ` · listed ${new Date(deal.listed_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p>
                {(opened || report) && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {opened && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Opened</span>}
                    {report && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Analysed</span>}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <StageSelect key={tracking.stage} itemKey={`d-${deal.id}`} stage={tracking.stage} opened={Boolean(priv)} dealId={deal.id} dealLive={deal.status === "live"} openPence={adminUser ? 0 : ladderPence} openLabel={priceText(quickLook)} back={dealPath} untracked={!tracking.tracked} />
                  </div>
                  {tracking.onMyDeals && (
                    <Link href={myDealsFocusPath(`d-${deal.id}`)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">See in My deals</Link>
                  )}
                </div>
                {/* Batch 10: past Kept without a Full analysis, an advisory line (never a block). */}
                {stagePastKept && canBuy && !blocked && <StageReminder itemKey={`d-${deal.id}`} dealId={deal.id} stage={tracking.stage} href={`${dealPath}?analysis=1&from=stage`} price={priceText(analysisPrice.without)} recommendPmi={tracking.stage === "offer" && Boolean(pmiLabel)} />}
                {/* Batch 7: the next step, for the member's own opened deal only. At Kept it leads with the Full analysis. */}
                <NextStepSlot stage={tracking.stage} dealId={deal.id} checkedListingId={tracking.checkedListingId} opened={Boolean(priv)} itemKey={`d-${deal.id}`} mine={tracking.tracked} facts={factsFromCard(deal, Boolean(priv), priv?.address ?? null)} variant="full" lead={tracking.stage === KEPT_STATUS && canBuy && !blocked ? { text: `Run the full analysis${priceText(analysisPrice.without) ? ` · ${priceText(analysisPrice.without)}` : ""}`, href: `${dealPath}?analysis=1&from=kept_step`, note: "The exact figures for this property before you contact the agent.", seen: { dealId: deal.id, stage: tracking.stage } } : null} />

                {priv ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <a href={priv.listingUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">View on {SOURCE_LABELS[deal.source]}</a>
                    {report ? (
                      <Link href={`/reports/${report.id}?back=${encodeURIComponent(dealPath)}`} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">Open full analysis{reportBy ? ` · ${reportBy}’s` : ""}</Link>
                    ) : null}
                    <Link href={`/deals?kind=${deal.kind}${deal.postcode_area ? `&areas=${deal.postcode_area}` : ""}${deal.bedrooms ? `&beds=${Math.min(deal.bedrooms, 4)}${deal.bedrooms >= 4 ? "%2B" : ""}` : ""}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">More like this</Link>
                    {priv.open.id !== "admin" && <span className="text-[11px] text-muted-foreground">Opened {new Date(priv.open.opened_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                  </div>
                ) : deal.status === "live" ? (
                  <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-sm font-semibold text-foreground">Take a Quick look, or get the Full analysis</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      A Quick look opens the address, postcode, photos and the {SOURCE_LABELS[deal.source]} link. We check it is still on the market before charging, and once opened it’s yours for good. A Full analysis includes the Quick look.
                    </p>
                    <form action={openDealAction} className="mt-2">
                      <input type="hidden" name="id" value={deal.id} />
                      <button type="submit" className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">Quick look{priceText(quickLook) ? ` · ${priceText(quickLook)}` : ""}</button>
                    </form>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">{deal.status === "pending_verify" ? "We’re checking this listing’s page before it goes live. Come back in an hour." : "This deal is off the market and cannot be opened."}</p>
                )}
                {canBuy && (
                  <div className="mt-3">
                    <AnalysisPanel dealId={deal.id} initialOpen={analysis === "1"} blocked={blocked} price={analysisPrice} pmi={pmiLabel ? addOnLabel(analysisPrice.withPmi, analysisPrice.without, adminUser ? 0 : pricing.pmiAddonPence) : null} opensDeal={!opened} recommendPmi={tracking.stage === "offer"} sampleHref={SAMPLE_REPORT} from={reminderWhere(from)} />
                  </div>
                )}
                {report && pmiLabel && <p className="mt-2 text-[11px] text-muted-foreground">No second opinion on it yet? Add one from PMI on the report · {priceText(pmiLabel) || "free"}.</p>}
              </div>
            </div>

            {screening && screening.band !== "insufficient-data" && (
              <section className="mt-4 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">{BAND_LABELS[screening.band]}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Our screening of the area and size, as ranges. A Full analysis works the figures out for this property.</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  {gross !== null && <Fig label="Short-let revenue, area" value={`${moneyRange(spread(gross, pct, 100))}/yr`} />}
                  {range && <Fig label={range.kind === "purchase" ? "Cash flow / mo" : "Profit / mo"} value={range.label.replace(/\/mo$/, "")} />}
                  {screening.kind === "purchase" && screening.upliftPct !== null && <Fig label="Against a long let" value={`${screening.upliftPct >= 0 ? "+" : "−"}${Math.abs(Math.round(screening.upliftPct))}%`} />}
                  {screening.kind === "rent-to-rent" && screening.revenueMultiple !== null && <Fig label="Revenue multiple" value={`about ${screening.revenueMultiple.toFixed(1)}× the rent`} />}
                </dl>
              </section>
            )}

            {model && (
              <section className="mt-4 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">{model.kind === "purchase" ? "If you bought it" : "If you rented it (rent-to-rent)"}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{model.kind === "purchase" ? `At ${gbp(model.askingPrice)} with a ${goals?.finance.depositPct ?? DEFAULT_FINANCE.depositPct}% deposit at ${goals?.finance.mortgageRatePct ?? DEFAULT_FINANCE.mortgageRatePct}%. Change these in your Market Explorer goals. Figures that rest on the area’s short-let income are ranges.` : `At ${gbp(model.advertisedRentPcm)} pcm rent. Figures that rest on the area’s short-let income are ranges.`}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  {model.kind === "purchase" ? (
                    <>
                      <Fig label="Gross yield" value={pctRange(model.grossYieldPct)} />
                      <Fig label="Cash flow / mo" value={range?.kind === "purchase" ? range.label.replace(/\/mo$/, "") : gbpRange(model.cashflowMonthly)} />
                      <Fig label="Cash on cash" value={pctRange(model.cashOnCashPct)} />
                      <Fig label="Cash needed" value={gbp(model.cashRequired)} sub={`incl. ${gbp(model.stampDuty)} stamp duty`} />
                      <Fig label="Mortgage / mo" value={gbp(model.mortgageMonthly)} />
                      <Fig label="Net operating / yr" value={gbpRange(model.netOperating, 100)} />
                      <Fig label="Max price at target yield" value={gbpRange(model.maxPriceForTargetYield, 1000)} sub={`${model.targetYieldPct}% target`} />
                    </>
                  ) : (
                    <>
                      <Fig label="Margin / mo" value={range?.kind === "rent-to-rent" ? range.label.replace(/\/mo$/, "") : gbpRange(model.monthlyMargin)} />
                      <Fig label="Margin / yr" value={gbpRange(model.annualMargin, 100)} />
                      <Fig label="Setup cost" value={gbp(model.setupCost)} />
                      <Fig label="Max rent at target margin" value={`${gbpRange(model.maxRentForTargetMargin)} pcm`} sub={`${gbp(model.targetMarginPcm)} target`} />
                    </>
                  )}
                </dl>
              </section>
            )}

            {canBuy && <AnalysisPreview />}

            {history.length > 0 && (
              <section className="mt-4 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">Price history</h2>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {history.slice().reverse().map((e) => (
                    <li key={e.at}>{new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: {describeChange(e)}</li>
                  ))}
                </ul>
              </section>
            )}

            {priv && priv.photos.length > 1 && (
              <section className="mt-4 grid grid-cols-3 gap-2">
                {priv.photos.slice(1, 10).map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={p} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                ))}
              </section>
            )}
          </section>

          <aside className="space-y-4">
            {areaCard && area && (
              <section className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Area</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{area.name}</p>
                <dl className="mt-2 space-y-1 text-xs">
                  <Row k="Stayful score" v={areaCard.score ? `${areaCard.score.score}/100` : "—"} />
                  <Row k="Occupancy" v={areaCard.headline.occupancy === null ? "—" : `${Math.round(areaCard.headline.occupancy)}%`} />
                  <Row k="Nightly rate" v={areaCard.headline.adr === null ? "—" : gbp(areaCard.headline.adr)} />
                  <Row k="Revenue, this size" v={(() => { const b = deal.bedrooms ? areaCard.byBedrooms.find((x) => x.bedrooms === deal.bedrooms) : null; const g = b?.grossRevenue ?? areaCard.headline.grossRevenue; return g === null || g === undefined ? "—" : `${gbp(g)}/yr`; })()} />
                </dl>
                <Link href={`/markets/${area.slug}`} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">Explore {area.name} →</Link>
              </section>
            )}
            {motivation && motivation.fired.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why this one</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {motivation.fired.map((k) => (
                    <li key={k} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{motivationLabel(k)}</li>
                  ))}
                </ul>
              </section>
            )}
            <BasicVsDetailed />
          </aside>
        </div>
      </div>
    </main>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}{sub ? <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span> : null}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  );
}
