import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { recentWeeks } from "@/lib/activity/week";
import { CHANNEL_LABEL, COVERAGE_WEEKS } from "@/lib/knowledge/config";
import { knowledgeShare, percent, type Tally } from "@/lib/knowledge/coverage";
import { coverageFor, topGaps } from "@/lib/knowledge/coverage-server";
import { weekLabel } from "@/lib/knowledge/weekly";
import { CARD, SiAdminNav, when } from "../SiAdmin";

export const metadata: Metadata = { title: "Coverage — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The channels the log has: calls and texts now, the chat with Batch 26. Chips are fixed, approved questions and aren't logged. */
const CHANNELS = ["call", "sms", "chat"] as const;
const CHANNEL_NAME: Record<string, string> = { ...CHANNEL_LABEL, sms: "Texts" };

function Row({ label, t, strong }: { label: string; t: Tally; strong?: boolean }) {
  const share = knowledgeShare(t);
  return (
    <tr className={`border-t border-border ${strong ? "font-semibold" : "text-muted-foreground"}`}>
      <td className={`py-1.5 pr-3 ${strong ? "" : "pl-4"}`}>{label}</td>
      <td className="pr-3 text-right">{t.asked}</td>
      <td className="pr-3 text-right">{percent(share)}</td>
      <td className="pr-3 text-right">{t.fromKnowledge}</td>
      <td className="pr-3 text-right">{t.answeredOther}</td>
      <td className="pr-3 text-right">{t.lowConfidence}</td>
      <td className="pr-3 text-right">{t.couldNotAnswer}</td>
      <td className="pr-3 text-right">{t.handedOff}</td>
      <td className="text-right">{t.memberUnhappy}</td>
    </tr>
  );
}

/**
 * Batch 24: how much Stayful Intelligence answers from approved knowledge,
 * per UK week (the last 12, newest first) and per channel, with what it
 * couldn't answer, the handoffs and the unhappy members; and the most asked
 * gaps. Counts only: no member, no question text.
 */
export default async function CoverageAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence/coverage");
  if (!isAdminEmail(user.email)) notFound();

  const admin = hasServiceRole() ? createAdminClient() : null;
  const weeks = recentWeeks(new Date(), COVERAGE_WEEKS);
  const [coverage, gaps] = await Promise.all([admin ? coverageFor(admin, weeks) : null, admin ? topGaps(admin, { limit: 10 }) : null]);
  const newestFirst = [...(coverage ?? [])].reverse();

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <SiAdminNav current="coverage" />
      <h1 className="text-2xl font-semibold text-foreground">Coverage</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        The share of questions answered from an answer you approved, by UK week (Monday to Sunday) and channel. &quot;Answered otherwise&quot; is answered without an approved entry (small talk, the member&apos;s own figures, or a guess worth a look). &quot;Member unhappy&quot; is a reaction to an answer, not a question, so it isn&apos;t in &quot;Asked&quot;. Chips are fixed, approved questions and aren&apos;t counted.
      </p>

      {!coverage && <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The conversation log can&apos;t be read. Run the &quot;Batch 24&quot; section of supabase/schema.sql.</p>}

      <section className={`mt-6 overflow-x-auto ${CARD}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3">Week</th>
              <th className="pr-3 text-right">Asked</th>
              <th className="pr-3 text-right">From knowledge</th>
              <th className="pr-3 text-right">(count)</th>
              <th className="pr-3 text-right">Answered otherwise</th>
              <th className="pr-3 text-right">Unsure</th>
              <th className="pr-3 text-right">Couldn&apos;t answer</th>
              <th className="pr-3 text-right">Handed off</th>
              <th className="text-right">Member unhappy</th>
            </tr>
          </thead>
          {newestFirst.map((w) => (
            <tbody key={w.week}>
              <Row label={weekLabel(w.week)} t={w.total} strong />
              {CHANNELS.filter((c) => w.byChannel[c]).map((c) => (
                <Row key={c} label={CHANNEL_NAME[c] ?? c} t={w.byChannel[c]} />
              ))}
            </tbody>
          ))}
        </table>
        {coverage && coverage.every((w) => w.total.asked === 0 && w.total.memberUnhappy === 0) && <p className="mt-3 text-sm text-muted-foreground">No questions logged in the last {COVERAGE_WEEKS} weeks.</p>}
      </section>

      <section className={`mt-8 ${CARD}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Most asked gaps</h2>
          <Link href="/admin/intelligence/gaps" className="text-sm font-medium text-primary hover:underline">All gaps →</Link>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {(gaps ?? []).map((g) => (
            <li key={g.id}>
              {g.label} <span className="text-muted-foreground">· asked {g.asked} · {g.status} · last {when(g.last_asked_at)}</span>
            </li>
          ))}
          {gaps && gaps.length === 0 && <li className="list-none text-muted-foreground">No open gaps.</li>}
        </ol>
      </section>
    </div>
  );
}
