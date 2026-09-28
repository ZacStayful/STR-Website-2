import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { teamCreditSnapshot } from "@/lib/team/credit";
import { payerFor } from "@/lib/team";
import { quoterFor } from "@/lib/credit/quote-server";
import { formatPence } from "@/lib/credit/deal-pricing";
import { usageBreakdown, type UsageCategory } from "@/lib/credit/usage-breakdown";
import { usageLinesSince, usagePeriodFor } from "@/lib/credit/usage-server";
import { dailyDealsLineFor } from "@/lib/listing/daily-deals";
import { TopupButtons } from "@/components/credit/TopupButtons";
import { profilesFor } from "@/lib/profiles/server";
import { labelsShown } from "@/lib/profiles/rules";
import { usageByProfile } from "@/lib/profiles/usage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Usage — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const COLOURS: Record<UsageCategory, string> = {
  daily: "#5d8156",
  full: "#2e3d2b",
  quick: "#b9d5c6",
  pmi: "#c8a45a",
  other: "#a3aa9c",
};

const WHAT: Record<UsageCategory, string> = {
  daily: "Today’s 5 each morning (and daily picks before the daily price)",
  full: "Full analyses of deals, and full reports on addresses you entered",
  quick: "Deals you opened for the address, photos and listing",
  pmi: "Second opinions from Property Market Intel",
  other: "Everything else: listing checks, narration, team seats, funnel leads",
};

/**
 * Where the credit went (Batch 10): this plan period, or this month on pay
 * as you go, split so it always adds up to 100%, in what left the balance.
 * A team member sees the team's, which is what they spend; the owner tops up.
 */
export default async function UsagePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/usage");
  const admin = isAdminEmail(user.email);
  const { payerId } = await payerFor(user.id);
  const [credit, quoter] = await Promise.all([teamCreditSnapshot({ id: user.id, admin }), quoterFor(payerId, admin)]);
  const onPlan = Boolean(credit.cycle?.planCode);
  const period = await usagePeriodFor(payerId, onPlan);
  const { lines, truncated, failed } = await usageLinesSince(payerId, period.start);
  const breakdown = usageBreakdown(lines);
  // Batch 13: the split by saved profile, for someone with two or more of their own.
  const saved = credit.member ? null : await profilesFor(user.id);
  const byProfile = saved?.readable && labelsShown(saved.all) && !failed ? usageByProfile(lines, saved.all) : [];
  const daily = dailyDealsLineFor(quoter.label(admin ? 0 : quoter.pricing.todays5DailyPence), quoter.pricing.todays5DailyPence);
  const member = credit.member;
  const allowance = credit.cycle?.allowancePence ?? 0;
  const usedPct = onPlan && allowance > 0 ? Math.min(100, Math.round(((credit.cycle?.usedPence ?? 0) / allowance) * 100)) : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          <Link href="/account" className="hover:underline">Your account</Link>
        </p>
        <header>
          <h1 className="text-2xl font-bold text-foreground">{member ? `${member.teamName}’s usage` : "Usage"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {period.kind === "plan" ? `This plan period, ${period.label}.` : `${period.label}.`} What left the balance{member ? " the team shares" : ""}, by what it was spent on.
          </p>
        </header>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-2xl font-bold text-foreground">{failed ? "—" : formatPence(breakdown.totalFacePence)} <span className="text-sm font-normal text-muted-foreground">used</span></p>
            <p className="text-sm text-muted-foreground">
              Balance {formatPence(Math.max(0, credit.totalPence))}
              {usedPct !== null ? ` · ${usedPct}% of ${formatPence(allowance)} plan credit used` : ""}
            </p>
          </div>
          {admin ? (
            <p className="mt-3 text-sm text-muted-foreground">Admin account: usage is logged, never charged.</p>
          ) : failed ? (
            <p className="mt-3 text-sm text-muted-foreground">We couldn’t load your usage just now. Try again in a minute, or see every charge in <Link href="/account/billing#usage-history" className="underline">Billing</Link>.</p>
          ) : breakdown.totalFacePence <= 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing spent {period.kind === "plan" ? "this period" : "this month"} yet.</p>
          ) : (
            <>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={breakdown.rows.filter((r) => r.pct > 0).map((r) => `${r.label} ${r.pct}%`).join(", ")}>
                {breakdown.rows.filter((r) => r.pct > 0).map((r) => (
                  <div key={r.category} style={{ width: `${r.pct}%`, background: COLOURS[r.category] }} />
                ))}
              </div>
              <ul className="mt-4 divide-y divide-border">
                {breakdown.rows.map((r) => (
                  <li key={r.category} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOURS[r.category] }} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{WHAT[r.category]}</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="font-semibold text-foreground">{r.pct}%</span>
                      <span className="block text-xs text-muted-foreground">{formatPence(r.facePence)}</span>
                    </p>
                  </li>
                ))}
              </ul>
              {truncated && <p className="mt-2 text-xs text-muted-foreground">Showing the first 20,000 charges of the period.</p>}
            </>
          )}
          {daily && <p className="mt-4 rounded-md bg-muted/60 px-3 py-2 text-xs text-foreground">{daily}. Switch them off any time in <Link href="/account/notifications" className="underline">Notifications</Link>.</p>}
        </section>

        {byProfile.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="usage-by-profile">
            <h2 id="usage-by-profile" className="text-base font-semibold text-foreground">By profile</h2>
            <p className="mt-1 text-xs text-muted-foreground">Each profile’s daily deals, and what you opened or analysed while you were on it.</p>
            <ul className="mt-3 divide-y divide-border">
              {byProfile.map((r) => (
                <li key={r.key} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate font-medium text-foreground">{r.label}</span>
                  <span className="shrink-0 text-right">
                    <span className="font-semibold text-foreground">{r.pct}%</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatPence(r.facePence)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs"><Link href="/profiles" className="underline-offset-4 hover:underline">Manage profiles</Link></p>
          </section>
        )}

        {!admin && (
          <section className="rounded-xl border border-border bg-card p-5">
            {member ? (
              <p className="text-sm text-muted-foreground">The team’s owner tops up and chooses the plan. {member.paused ? "Your seat is paused, so you can’t spend the team’s credit just now." : ""}</p>
            ) : (
              <>
                <h2 className="text-base font-semibold text-foreground">Top up or upgrade</h2>
                <p className="mt-1 text-xs text-muted-foreground">Top-up credit is spent at {credit.rates.topup}× the plan rate, so a plan is the cheaper way to buy the same things.</p>
                <div className="mt-3">
                  <TopupButtons presets={credit.topupPresetsPence} hasSavedCard={credit.hasSavedCard} />
                </div>
                <p className="mt-3">
                  <Link href="/upgrade" className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                    {onPlan ? "Change plan" : "See plans"}
                  </Link>
                </p>
              </>
            )}
          </section>
        )}

        <p className="text-sm">
          <Link href="/account/billing#usage-history" className="font-medium text-foreground underline-offset-4 hover:underline">See every charge</Link>
        </p>
      </div>
    </main>
  );
}
