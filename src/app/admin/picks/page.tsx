import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { areaMetaForCode } from "@/lib/market/areas";
import { cookies } from "next/headers";
import { summarisePicks, cleanReasons, PICK_REASONS, type PickRow } from "@/lib/listing/picks";
import { sendingEnabled } from "@/lib/listing/picks-run";
import { sendTestPickAction, dryRunPicksAction } from "./actions";

const RUN_COOKIE = "sf_picks_run";

export const metadata: Metadata = { title: "Daily picks admin — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// The test-pick and dry-run actions run the same search as the cron.
export const maxDuration = 60;

interface LastRun {
  kind: "test" | "dry";
  at: string;
  body: Record<string, unknown>;
}

async function readLastRun(): Promise<LastRun | null> {
  try {
    const raw = (await cookies()).get(RUN_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as LastRun;
    return parsed && (parsed.kind === "test" || parsed.kind === "dry") ? parsed : null;
  } catch {
    return null;
  }
}

const DAYS = 30;

interface RecentRow {
  id: string;
  sent_at: string;
  status: string;
  kind: string | null;
  basis: string | null;
  postcode_area: string | null;
  reaction: string | null;
  reaction_source: string | null;
  reasons: unknown;
  comment: string | null;
  responded_at: string | null;
  saved_at: string | null;
  canonical_url: string;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * The feedback report for daily picks: what went out, who answered, why they
 * said no, and where the yeses are. The reasons histogram is the signal to
 * tune the house areas, the price and size rules, and the copy.
 */
export default async function PicksAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/picks");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();
  const since = sinceIso(DAYS);
  const lastRun = await readLastRun();
  const [{ data, error }, { count: enrolled }, { count: optedOut }] = await Promise.all([
    admin
      .from("sourcing_sent")
      .select("id, sent_at, status, kind, basis, postcode_area, reaction, reaction_source, reasons, comment, responded_at, saved_at, canonical_url")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(5000),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("sourcing_alerts", true),
    admin.from("profiles").select("id", { count: "exact", head: true }).not("sourcing_opted_out_at", "is", null),
  ]);
  if (error) console.error("[admin/picks] select failed:", error.message);
  const raw = (data ?? []) as RecentRow[];
  const rows: PickRow[] = raw.map((r) => ({
    status: r.status === "pending" || r.status === "failed" ? r.status : "sent",
    kind: r.kind === "rent" ? "rent" : r.kind === "sale" ? "sale" : null,
    basis: r.basis === "house" ? "house" : r.basis === "goals" ? "goals" : null,
    postcodeArea: r.postcode_area,
    reaction: r.reaction === "yes" || r.reaction === "no" ? r.reaction : null,
    reactionSource: r.reaction_source === "form" || r.reaction_source === "link" ? r.reaction_source : null,
    reasons: cleanReasons(r.reasons),
    savedAt: r.saved_at,
    sentAt: r.sent_at,
  }));
  const s = summarisePicks(rows);
  const recent = raw.filter((r) => r.reaction).slice(0, 40);
  const label = (k: string) => PICK_REASONS.find((r) => r.key === k)?.label ?? k;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Daily picks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last {DAYS} days. {enrolled ?? "—"} members enrolled, {optedOut ?? "—"} opted out. Sending is {sendingEnabled() ? "ON" : "OFF (SOURCING_ENABLED=false)"}.</p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {error && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Could not read sourcing_sent (schema behind?): {error.message}</div>}

      <section className="mb-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Test and dry run</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <strong>Send me a test pick</strong> runs the real search for your account only and emails you the result (admins are never charged; it ignores the one-a-day guard so you can press it again, but never repeats a listing).{" "}
          <strong>Dry run</strong> reports who would get what across every enrolled member and writes nothing. Either takes up to a minute.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={sendTestPickAction}>
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Send me a test pick</button>
          </form>
          <form action={dryRunPicksAction}>
            <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry run (everyone)</button>
          </form>
        </div>
        {lastRun && <RunResult run={lastRun} />}
      </section>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Picks sent" value={s.sent} sub={`${s.failed} failed sends`} />
        <Stat label="Responded" value={pct(s.responded, s.sent)} sub={`${s.responded} of ${s.sent}`} />
        <Stat label="Said yes" value={pct(s.yes, s.responded)} sub={`${s.yes} yes · ${s.no} no`} />
        <Stat label="Saved to pipeline" value={pct(s.saved, s.sent)} sub={`${s.saved} saved`} />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">By kind and basis</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Segment</th><th>Sent</th><th>Yes</th><th>No</th><th>Saved</th></tr></thead>
            <tbody>
              {([["To buy", s.byKind.sale], ["Rent-to-rent", s.byKind.rent], ["From a filter", s.byBasis.goals], ["House picks", s.byBasis.house]] as const).map(([name, b]) => (
                <tr key={name} className="border-t border-border"><td className="py-1.5">{name}</td><td>{b.sent}</td><td>{b.yes}</td><td>{b.no}</td><td>{b.saved}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Why members said no</h2>
          {s.reasons.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No reasons given yet.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {s.reasons.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="w-40 flex-none">{label(r.key)}</span>
                  <span className="h-2 flex-1 rounded bg-muted"><span className="block h-2 rounded bg-primary" style={{ width: `${Math.round((r.count / s.reasons[0].count) * 100)}%` }} /></span>
                  <span className="w-8 text-right text-xs text-muted-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Areas by yes</h2>
        {s.areas.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Area</th><th>Sent</th><th>Yes</th><th>No</th><th>Yes rate</th></tr></thead>
            <tbody>
              {s.areas.map((a) => (
                <tr key={a.area} className="border-t border-border"><td className="py-1.5">{areaMetaForCode(a.area).name} ({a.area})</td><td>{a.sent}</td><td>{a.yes}</td><td>{a.no}</td><td>{pct(a.yes, a.yes + a.no)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Recent responses</h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No responses yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {recent.map((r) => (
              <li key={r.id} className="py-2">
                <span className={"mr-2 rounded-full px-2 py-0.5 text-xs font-semibold " + (r.reaction === "yes" ? "bg-primary/10 text-primary" : "bg-muted")}>{r.reaction}{r.reaction_source === "link" ? " (link)" : ""}</span>
                <span className="text-muted-foreground">{new Date(r.responded_at ?? r.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {r.kind === "rent" ? "R2R" : "buy"} · {r.basis} · {r.postcode_area ?? "—"}</span>
                {cleanReasons(r.reasons).length > 0 && <span className="ml-2">{cleanReasons(r.reasons).map(label).join(", ")}</span>}
                {r.comment && <p className="mt-0.5 text-xs italic text-muted-foreground">“{r.comment}”</p>}
                <a href={r.canonical_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-primary underline">listing</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}


function RunResult({ run }: { run: LastRun }) {
  const b = run.body;
  const members = Array.isArray(b.members) ? (b.members as { user: string; basis: string; candidates: number; sent: boolean; reason?: string }[]) : [];
  const skipped = Array.isArray(b.skipped) ? (b.skipped as { user: string; reason: string }[]) : [];
  const wouldEmail = Array.isArray(b.wouldEmail) ? (b.wouldEmail as { email?: string; basis: string; firstEver: boolean; queries: string[] }[]) : [];
  const n = (k: string) => (typeof b[k] === "number" ? (b[k] as number) : 0);
  const headline =
    typeof b.error === "string"
      ? `Failed: ${b.error}`
      : run.kind === "test"
        ? members.some((m) => m.sent)
          ? "Sent. Check your inbox."
          : `Nothing sent${members[0]?.reason ? ` (${members[0].reason})` : skipped[0]?.reason ? ` (${skipped[0].reason})` : ""}.`
        : `${n("members")} of ${n("enrolled")} enrolled would get a pick from ${n("queries")} shared searches.`;
  return (
    <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs">
      <p className="text-sm font-medium text-foreground">{run.kind === "test" ? "Test pick" : "Dry run"} · {new Date(run.at).toLocaleTimeString("en-GB")} · {headline}</p>
      {run.kind === "test" && (
        <p className="mt-1 text-muted-foreground">
          searches answered {n("answered")} · unavailable {n("unavailable")} · listings {n("listings")} · candidates {members[0]?.candidates ?? 0} · emails {n("emails")} · failures {n("emailFailures")} · {n("ms")} ms
        </p>
      )}
      {run.kind === "dry" && wouldEmail.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-auto">
          {wouldEmail.slice(0, 60).map((w, i) => (
            <li key={i} className="text-muted-foreground">{w.email ?? "member"} · {w.basis} · {w.firstEver ? "first pick" : "repeat"} · {w.queries.length} searches</li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && <p className="mt-2 text-muted-foreground">Skipped: {skipped.map((s) => s.reason).join(", ")}</p>}
      {typeof b.ranOutOfTime === "boolean" && b.ranOutOfTime && <p className="mt-1 text-muted-foreground">Ran out of time; the 07:20 pass finishes what this one did not.</p>}
    </div>
  );
}
