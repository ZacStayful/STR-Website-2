import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseMarketGoals, describeGoals } from "@/lib/market/goals";
import { loadPicks, picksEnabled, type PickView } from "@/lib/listing/picks-server";
import { reasonLabel } from "@/lib/listing/picks";
import { ReasonChips } from "@/components/PickReasonChips";
import { describeDeal } from "@/lib/listing/sourcing";
import { BAND_LABELS, screeningWorking } from "@/lib/listing/screen";
import { formatListingPrice } from "@/lib/listing/format";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { motivationLabel } from "@/lib/listing/motivation";
import { savePickAction, reactToPickAction, togglePicksAction } from "./actions";

export const metadata: Metadata = {
  title: "Daily picks — Stayful Intelligence",
  robots: { index: false, follow: false },
};

type Tab = "all" | "liked" | "saved" | "passed";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "liked", label: "Liked" },
  { key: "saved", label: "Saved" },
  { key: "passed", label: "Passed" },
];

const MESSAGES: Record<string, string> = {
  missing: "We could not find that pick.",
  failed: "We could not save that pick just now. Please try again.",
  cap: "You have reached today's listing-check limit. Try again tomorrow.",
  insufficient_credit: "You're out of credit. Top up or upgrade to save picks to your pipeline.",
  not_found: "That listing seems to have been removed.",
  blocked: "The listing site did not let us read that page. Try again later, or check it from the explorer.",
  paused: "That listing site is temporarily unavailable to us. Try again later.",
  disabled: "Fetching listing pages is switched off right now.",
  unreadable: "We could not read that listing page.",
  needs_extension: "That site blocks automated access. Open the listing with the Stayful browser extension installed.",
  unsupported_url: "That link is not a listing we can read.",
};

function inTab(p: PickView, tab: Tab): boolean {
  if (tab === "liked") return p.reaction === "yes";
  if (tab === "saved") return p.savedAt !== null;
  if (tab === "passed") return p.reaction === "no";
  return true;
}

export default async function PicksPage({ searchParams }: { searchParams: Promise<{ tab?: string; save?: string; msg?: string; pick?: string }> }) {
  const { tab: tabRaw, save, msg, pick: pickParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [picks, enabled, profileRes] = await Promise.all([loadPicks(user.id), picksEnabled(user.id), supabase.from("profiles").select("market_goals").eq("id", user.id).single()]);
  const goals = parseMarketGoals(profileRes.data?.market_goals);
  const chips = goals ? describeGoals(goals) : [];
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? (tabRaw as Tab) : "all";
  const rows = picks.filter((p) => inTab(p, tab));
  const highlight = typeof save === "string" ? picks.find((p) => p.id === save) ?? null : null;
  const message = msg ? MESSAGES[msg] ?? null : null;
  const failedPick = typeof pickParam === "string" ? pickParam : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Daily picks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One property a day that Stayful Intelligence thinks fits you. Tell it yes or no and tomorrow’s pick gets closer.
            </p>
          </div>
          <form action={togglePicksAction}>
            <input type="hidden" name="on" value={enabled === false ? "1" : "0"} />
            <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
              {enabled === false ? "Turn daily picks on" : "Turn daily picks off"}
            </button>
          </form>
        </div>

        <section className="mb-6 rounded-xl border border-border bg-card p-4">
          {goals ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your filter</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">{c}</span>
                ))}
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">{goals.sourcingKind === "both" ? "Buy or rent-to-rent" : goals.sourcingKind === "rent" ? "Rent-to-rent" : "To buy"}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">No filter set: you are getting Stayful house picks.</p>
              <p className="mt-1 text-xs text-muted-foreground">Set your area, budget, size and whether you want to buy or rent-to-rent, and every pick will match it.</p>
            </>
          )}
          <p className="mt-3 flex flex-wrap gap-2 text-sm">
            <Link href="/markets?goals=1" className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">{goals ? "Edit filter" : "Set my filter"}</Link>
            <Link href="/markets?pane=listings" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Open my pipeline</Link>
          </p>
          {enabled === false && <p className="mt-3 text-xs text-muted-foreground">Daily picks are off. Turn them on above to get one a day again.</p>}
        </section>

        {message && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{message}</p>}

        {highlight && !highlight.savedAt && (
          <section className="mb-6 rounded-xl border-2 border-primary bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Save this pick?</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{highlight.listing.address ?? highlight.listing.title}</p>
            <p className="text-xs text-muted-foreground">Saving runs the quick listing check (a few pence of credit) and adds it to your deal pipeline, where price drops are tracked automatically.</p>
            <form action={savePickAction} className="mt-3">
              <input type="hidden" name="id" value={highlight.id} />
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Save to my pipeline</button>
            </form>
          </section>
        )}

        <nav className="mb-4 flex gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Filter picks">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key === "all" ? "/picks" : `/picks?tab=${t.key}`} className={"flex-1 rounded-md px-3 py-1.5 text-center font-medium " + (tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")} aria-current={tab === t.key ? "page" : undefined}>
              {t.label} <span className="text-xs opacity-70">{picks.filter((p) => inTab(p, t.key)).length}</span>
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">{picks.length === 0 ? "No picks yet." : "Nothing in this tab yet."}</p>
            <p className="mt-1 text-xs text-muted-foreground">{picks.length === 0 ? "Your first pick arrives by email at about 7am UK time, once there is a listing worth sending." : "Picks you like, save or pass on show up here."}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((p) => (
              <PickCard key={p.id} pick={p} tab={tab} showReasons={failedPick === p.id ? false : p.reaction === "no" && p.reactionSource !== "form"} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function PickCard({ pick: p, tab, showReasons }: { pick: PickView; tab: Tab; showReasons: boolean }) {
  const l = p.listing;
  const price = l.price ? formatListingPrice(l.price) : null;
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap gap-4">
        {l.photo ? <img src={l.photo} alt="" className="h-24 w-32 flex-none rounded-lg object-cover" /> : <div className="h-24 w-32 flex-none rounded-lg bg-muted" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{l.address ?? l.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[new Date(p.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), p.kind === "rent" ? "Rent-to-rent" : "To buy", l.bedrooms !== null ? `${l.bedrooms} bed` : null, l.rawType, price, p.areaName].filter(Boolean).join(" · ")}
          </p>
          {p.deal && <p className="mt-1 text-xs font-medium text-primary">{describeDeal(p.deal)}</p>}
          {p.screening && p.screening.band !== "insufficient-data" && (
            <div className="mt-1.5">
              <p className="text-xs font-semibold text-foreground">{BAND_LABELS[p.screening.band]}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {screeningWorking(p.screening).map((w) => `${w.label} ${w.value}`).join(" · ")}
              </p>
            </div>
          )}
          {p.motivation && p.motivation.fired.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Why this one">
              {p.motivation.fired.slice(0, 4).map((k) => (
                <li key={k} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{motivationLabel(k)}</li>
              ))}
            </ul>
          )}
          {p.relaxation && (
            <p className="mt-2 text-xs text-muted-foreground">
              Not an exact match — your {p.relaxation.label.toLowerCase()} is {p.relaxation.current}.{" "}
              <Link href="/markets?goals=1" className="underline">Change it</Link>
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {p.fit !== null ? `Fit ${p.fit}/100 · ` : ""}{p.basis === "house" ? "Stayful house pick" : "Picked for your filter"}
            {p.reaction === "yes" && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Liked</span>}
            {p.reaction === "no" && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Passed{p.reasons.length ? `: ${p.reasons.map(reasonLabel).join(", ")}` : ""}</span>}
            {p.savedAt && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">In pipeline</span>}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.checkedListingId ? (
          <Link href={`/markets?pane=listings&listing=${encodeURIComponent(p.checkedListingId)}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Open in pipeline</Link>
        ) : (
          <form action={savePickAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">Save to pipeline</button>
          </form>
        )}
        <Link href={`/estimate?listing=${encodeURIComponent(l.canonicalUrl)}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Full report</Link>
        <a href={l.canonicalUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">View on {SOURCE_LABELS[l.source]}</a>
        {p.reaction !== "yes" && (
          <form action={reactToPickAction}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="reaction" value="yes" />
            <input type="hidden" name="tab" value={tab} />
            <button type="submit" className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">More like this</button>
          </form>
        )}
        {p.reaction !== "no" && (
          <details className="text-xs">
            <summary className="cursor-pointer rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground">Not for me</summary>
            <ReasonsForm pick={p} tab={tab} />
          </details>
        )}
      </div>
      {showReasons && (
        <div className="mt-3 rounded-lg bg-muted/60 p-3 text-xs">
          <p className="font-medium text-foreground">What was wrong with it? Each answer changes what we send you tomorrow.</p>
          <ReasonsForm pick={p} tab={tab} />
        </div>
      )}
    </li>
  );
}

function ReasonsForm({ pick: p, tab }: { pick: PickView; tab: Tab }) {
  return (
    <form action={reactToPickAction} className="mt-2">
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="reaction" value="no" />
      <input type="hidden" name="tab" value={tab} />
      <ReasonChips selected={p.reasons} tone="app" />
      <label className="mt-2 block font-medium text-foreground">
        What would you rather have seen?
        <textarea name="comment" defaultValue={p.comment} placeholder="e.g. a 3-bed house in Leicester under £250k, or anything with a garden" rows={2} maxLength={1000} className="mt-1 w-full rounded-md border border-border bg-card p-2 font-normal" />
      </label>
      <button type="submit" className="mt-2 rounded-md bg-foreground px-3 py-1.5 font-semibold text-background">Send feedback</button>
    </form>
  );
}
