import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { payerFor, personName, profileNames } from "@/lib/team";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { getCreditSummary } from "@/lib/credit/summary";
import { getAreaCards } from "@/lib/market/cached";
import { areaMetaForCode } from "@/lib/market/areas";
import { parseMarketGoals } from "@/lib/market/goals";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { BAND_LABELS, parseScreening, screeningWorking } from "@/lib/listing/screen";
import { purchaseDeal, rentToRentDeal, DEFAULT_FINANCE, type Deal } from "@/lib/listing/deal";
import { areaRevenueFor } from "@/lib/listing/sourcing";
import { parseHistory, describeChange } from "@/lib/listing/recheck";
import { motivationLabel, parseMotivation } from "@/lib/listing/motivation";
import { dealSheet } from "@/lib/marketplace/open";
import { dealVisibilityFor } from "@/lib/marketplace/tier";
import { formatOpenPrice, openPricePence } from "@/lib/marketplace/ladder";
import { badgesFor, describeType, type DealCard as Card } from "@/lib/marketplace/grid";
import { photoUrlFor } from "@/lib/marketplace/queries";
import { headlineFigure, priceLine } from "../_components/DealCard";
import { openDealAction } from "../actions";
import { dealTrackingFor } from "@/lib/listing/tracked-server";
import { myDealsFocusPath } from "@/lib/listing/return-path";
import { formatQuote, reportQuotePence } from "@/lib/credit/report-quote";
import { StageSelect } from "@/app/my-deals/_components/StageSelect";
import { NextStepSlot } from "@/app/my-deals/_components/NextStepSlot";
import { factsFromCard } from "@/lib/pipeline/slot-facts";
import { ShareDealButton } from "../_components/ShareDealButton";

export const metadata: Metadata = { title: "Deal — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// An open may read the listing page live before charging.
export const maxDuration = 60;

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

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; need?: string; have?: string }> }) {
  const { id } = await params;
  const { msg, need, have } = await searchParams;
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
  const [settings, credit, cards, profileRes] = await Promise.all([getBillingSettings(), getCreditSummary(payerId).catch(() => null), getAreaCards().catch(() => []), supabase.from("profiles").select("market_goals").eq("id", user.id).single()]);
  const goals = parseMarketGoals(profileRes.data?.market_goals);
  const now = new Date();
  const card: Card = { ...deal, has_photo: Boolean(deal.photo) } as unknown as Card;
  const badges = badgesFor(card, now);
  const figure = headlineFigure(card);
  const price = priceLine(card);
  const area = deal.postcode_area ? areaMetaForCode(deal.postcode_area) : null;
  const areaCard = deal.postcode_area ? cards.find((c) => c.code === deal.postcode_area) ?? null : null;
  const profit = deal.annual_profit === null ? null : Number(deal.annual_profit);
  const pence = adminUser ? 0 : openPricePence(profit, settings.dealOpenLadder);
  const screening = parseScreening(deal.screening);
  const motivation = parseMotivation(deal.motivation);
  const history = parseHistory(deal.price_history);
  const message = msg ? MESSAGES[msg] ?? null : null;
  const insufficient = msg === "insufficient_credit";
  const where = [deal.town, area?.name && area.name !== deal.town ? area.name : null, deal.outcode].filter(Boolean).join(" · ");

  // Batch 5 (My deals): this member's stage for the deal, and the full report
  // to open instead of running (and paying for) another one. A report counts
  // only if it still exists and this member may read it (Team reports' rule).
  const tracking = await dealTrackingFor({ userId: user.id, deal });
  let report: { id: string; userId: string } | null = null;
  if (priv && tracking.reportCandidates.length > 0) {
    // Ids come from pipeline rows in scope: a handful for one listing.
    const { data: readable } = await supabase.from("saved_searches").select("id").in("id", tracking.reportCandidates.map((c) => c.id));
    const ok = new Set(((readable ?? []) as { id: string }[]).map((r) => r.id));
    report = tracking.reportCandidates.find((c) => ok.has(c.id)) ?? null;
  }
  const reportBy = report && report.userId !== user.id ? personName((await profileNames([report.userId])).get(report.userId)) : null;
  const quote = priv && !report ? await reportQuotePence(payerId, adminUser) : null;
  const dealPath = `/deals/${deal.id}`;

  // The purchase / rent-to-rent model at the member's own finance settings when they have set them.
  let model: Deal | null = null;
  if (deal.price_amount !== null && areaCard) {
    const rev = areaRevenueFor({ byBedrooms: areaCard.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: areaCard.headline.grossRevenue, adr: areaCard.headline.adr } }, deal.bedrooms);
    if (rev) {
      const base = { grossRevenue: rev.grossRevenue, adr: rev.adr, bedrooms: deal.bedrooms ?? 2, finance: { ...DEFAULT_FINANCE, ...(goals?.finance ?? {}) } };
      model = deal.kind === "rent" ? rentToRentDeal(Number(deal.price_amount), base) : purchaseDeal(Number(deal.price_amount), base);
    }
  }

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
            <p className="font-semibold text-destructive">Not enough credit to open this deal.</p>
            <p className="mt-1 text-muted-foreground">Opening costs {formatOpenPrice(Number(need ?? pence))}; you have {formatOpenPrice(Number(have ?? 0))} of credit. Top up or upgrade and you’ll come straight back here.</p>
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
                  <p className="text-2xl font-bold text-foreground">{figure.big} <span className="text-sm font-normal text-muted-foreground">{figure.small}</span></p>
                  {price && <p className="text-lg font-semibold text-foreground">{price}</p>}
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{priv ? (priv.address ?? where) : where}</p>
                <p className="text-xs text-muted-foreground">{describeType(card)}{priv?.postcode ? ` · ${priv.postcode}` : ""}</p>
                <p className={"mt-1 text-[11px] " + (badges.freshnessKind === "live" ? "text-primary" : "text-muted-foreground")}>{badges.freshness}{deal.listed_date ? ` · listed ${new Date(deal.listed_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p>

                <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <StageSelect key={tracking.stage} itemKey={`d-${deal.id}`} stage={tracking.stage} opened={Boolean(priv)} dealId={deal.id} dealLive={deal.status === "live"} openPence={pence} back={dealPath} untracked={!tracking.tracked} />
                  </div>
                  {tracking.onMyDeals && (
                    <Link href={myDealsFocusPath(`d-${deal.id}`)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">See in My deals</Link>
                  )}
                </div>
                {/* Batch 7: the next step, for the member's own opened deal only. */}
                <NextStepSlot stage={tracking.stage} dealId={deal.id} checkedListingId={tracking.checkedListingId} opened={Boolean(priv)} itemKey={`d-${deal.id}`} mine={tracking.tracked} facts={factsFromCard(deal, Boolean(priv), priv?.address ?? null)} variant="full" />

                {priv ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <a href={priv.listingUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">View on {SOURCE_LABELS[deal.source]}</a>
                    {report ? (
                      <Link href={`/reports/${report.id}?back=${encodeURIComponent(dealPath)}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Open full report{reportBy ? ` · ${reportBy}’s` : ""}</Link>
                    ) : (
                      // The deal's own URL, so the report links back to this deal; `back` brings the member here after.
                      <Link href={`/estimate?listing=${encodeURIComponent(deal.canonical_url)}&back=${encodeURIComponent(dealPath)}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Full report{quote !== null ? ` · about ${formatQuote(quote)}` : ""}</Link>
                    )}
                    <Link href={`/deals?kind=${deal.kind}${deal.postcode_area ? `&areas=${deal.postcode_area}` : ""}${deal.bedrooms ? `&beds=${Math.min(deal.bedrooms, 4)}${deal.bedrooms >= 4 ? "%2B" : ""}` : ""}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">More like this</Link>
                    {priv.open.id !== "admin" && <span className="text-[11px] text-muted-foreground">Opened {new Date(priv.open.opened_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{Number(priv.open.charged_base_pence) > 0 ? ` for ${formatOpenPrice(Number(priv.open.charged_base_pence))}` : ""}</span>}
                  </div>
                ) : deal.status === "live" ? (
                  <form action={openDealAction} className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                    <input type="hidden" name="id" value={deal.id} />
                    <p className="text-sm font-semibold text-foreground">Open the deal sheet · {formatOpenPrice(pence)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Address, postcode, photos and the {SOURCE_LABELS[deal.source]} link. We check the listing is still on the market before charging, and once opened it’s yours for good.{credit ? ` You have ${formatOpenPrice(Math.max(0, Math.round(credit.spendableBasePence)))} of credit.` : ""}</p>
                    <button type="submit" className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Open for {formatOpenPrice(pence)}</button>
                  </form>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">{deal.status === "pending_verify" ? "We’re checking this listing’s page before it goes live. Come back in an hour." : "This deal is off the market and cannot be opened."}</p>
                )}
              </div>
            </div>

            {screening && screening.band !== "insufficient-data" && (
              <section className="mt-4 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">{BAND_LABELS[screening.band]}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{screening.reason}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  {screeningWorking(screening).map((w) => (
                    <div key={w.label}>
                      <dt className="text-muted-foreground">{w.label}</dt>
                      <dd className="font-medium text-foreground">{w.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {model && (
              <section className="mt-4 rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">{model.kind === "purchase" ? "If you bought it" : "If you rented it (rent-to-rent)"}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{model.kind === "purchase" ? `At ${gbp(model.askingPrice)} with a ${goals?.finance.depositPct ?? DEFAULT_FINANCE.depositPct}% deposit at ${goals?.finance.mortgageRatePct ?? DEFAULT_FINANCE.mortgageRatePct}%. Change these in your Market Explorer goals.` : `At ${gbp(model.advertisedRentPcm)} pcm rent and ${gbp(model.grossRevenue)} estimated gross revenue.`}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  {model.kind === "purchase" ? (
                    <>
                      <Fig label="Gross yield" value={`${model.grossYieldPct.toFixed(1)}%`} />
                      <Fig label="Cash flow / mo" value={gbp(model.cashflowMonthly)} />
                      <Fig label="Cash on cash" value={`${model.cashOnCashPct.toFixed(1)}%`} />
                      <Fig label="Cash needed" value={gbp(model.cashRequired)} sub={`incl. ${gbp(model.stampDuty)} stamp duty`} />
                      <Fig label="Mortgage / mo" value={gbp(model.mortgageMonthly)} />
                      <Fig label="Net operating / yr" value={gbp(model.netOperating)} />
                      <Fig label="Max price at target yield" value={gbp(model.maxPriceForTargetYield)} sub={`${model.targetYieldPct}% target`} />
                    </>
                  ) : (
                    <>
                      <Fig label="Margin / mo" value={gbp(model.monthlyMargin)} />
                      <Fig label="Margin / yr" value={gbp(model.annualMargin)} />
                      <Fig label="Breakeven occupancy" value={model.breakevenOccupancyPct === null ? "—" : `${Math.round(model.breakevenOccupancyPct)}%`} />
                      <Fig label="Setup cost" value={gbp(model.setupCost)} sub={model.paybackMonths === null ? undefined : `paid back in ${Math.round(model.paybackMonths)} months`} />
                      <Fig label="Max rent at target margin" value={`${gbp(model.maxRentForTargetMargin)} pcm`} sub={`${gbp(model.targetMarginPcm)} target`} />
                    </>
                  )}
                </dl>
              </section>
            )}

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
            <p className="text-[11px] text-muted-foreground">Short-let income is Stayful’s estimate for the area and size, not this property’s history. Long-let rent is the listing’s own for a rental, or our stored figure for the area where marked as an estimate.</p>
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
