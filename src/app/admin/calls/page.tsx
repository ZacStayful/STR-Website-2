import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { emailKey } from "@/lib/supabase/email-key";
import { getBillingSettings, getUnitCostTable } from "@/lib/credit/unit-costs";
import { priceFor } from "@/lib/credit/pricing";
import { BLOCKED_REASONS, CALL_MINUTE_UNIT, CALL_STATUSES, CALL_TYPES, CALL_TYPE_LABEL, callsDryRun, callsEnabled, voiceConfig, type BlockedReason, type CallType } from "@/lib/voice/config";
import { callTotals } from "@/lib/voice/admin";
import { oneOf, windowFor, WINDOWS } from "../picks/responses/windows";
import { CallSettingsForm, SyncAgentForm } from "./Forms";

export const metadata: Metadata = { title: "Calls — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const LIMIT = 2000;
const SHOWN = 300;

interface Row {
  id: string;
  user_id: string | null;
  direction: string;
  call_type: string;
  status: string;
  blocked_reason: string | null;
  queued_at: string;
  placed_at: string | null;
  seconds: number | null;
  charged_pence: number;
  texts_sent: number;
  handoff: boolean;
  conversation_id: string | null;
  error: string | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—");
const gbp = (p: number) => (p > 0 ? `£${(p / 100).toFixed(2)}` : "—");
const len = (s: number | null) => (s && s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");

/**
 * Every Stayful Intelligence call (Batch 23): placed, received and blocked,
 * with the reason a safety rule stopped one. Filters by type, status,
 * direction, window and member; totals for the filter. The calls settings,
 * and the agent sync to ElevenLabs. Admin only.
 */
export default async function CallsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/calls");
  if (!isAdminEmail(user.email)) notFound();

  const type = oneOf(params.type);
  const status = oneOf(params.status);
  const direction = oneOf(params.direction);
  const win = windowFor(oneOf(params.days) ?? "30");
  const memberEmail = oneOf(params.member)?.trim() ?? "";

  const admin = createAdminClient();
  const [settings, table] = await Promise.all([getBillingSettings(), getUnitCostTable()]);
  let memberId: string | null = null;
  let memberMissing = false;
  if (memberEmail) {
    const { data } = await admin.from("profiles").select("id").eq("email", emailKey(memberEmail)).limit(1);
    memberId = (data?.[0] as { id: string } | undefined)?.id ?? null;
    memberMissing = !memberId;
  }

  let q = admin.from("si_calls_log").select("id, user_id, direction, call_type, status, blocked_reason, queued_at, placed_at, seconds, charged_pence, texts_sent, handoff, conversation_id, error").order("queued_at", { ascending: false }).limit(LIMIT);
  if (type && (CALL_TYPES as readonly string[]).includes(type)) q = q.eq("call_type", type);
  if (status && (CALL_STATUSES as readonly string[]).includes(status)) q = q.eq("status", status);
  if (direction === "outbound" || direction === "inbound") q = q.eq("direction", direction);
  const now = new Date();
  if (win.days) q = q.gte("queued_at", new Date(now.getTime() - win.days * 86_400_000).toISOString());
  if (memberId) q = q.eq("user_id", memberId);
  const { data, error } = memberMissing ? { data: [], error: null } : await q;
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => Boolean(x)))].slice(0, 1000);
  const { data: people } = ids.length ? await admin.from("profiles").select("id, email").in("id", ids) : { data: [] };
  const emailOf = new Map(((people ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email ?? p.id]));

  const rawMin = priceFor(table, CALL_MINUTE_UNIT.provider, CALL_MINUTE_UNIT.unit, 1).rawPence;
  const rawText = priceFor(table, "twilio", "sms", 1).rawPence;
  const t = callTotals(rows, rawMin, rawText);
  const config = voiceConfig();

  const filterLink = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    const cur: Record<string, string | null> = { type, status, direction, days: win.key, member: memberEmail || null, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) sp.set(k, v);
    return `/admin/calls?${sp.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Calls</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Calls from and to Stayful Intelligence. Calls are {callsEnabled() ? "on" : "off (SI_CALLS_ENABLED)"}
            {callsDryRun() ? ", in dry run" : ""}; ElevenLabs is {config ? "configured" : "not configured"}. Handoffs and forwarded texts go to the address on{" "}
            <Link href="/admin/feedback" className="text-primary hover:underline">Feedback</Link>.{" "}
            <Link href="/admin/conversations" className="text-primary hover:underline">Conversations →</Link>
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {error && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Calls could not be read (has the Batch 23 section of schema.sql been run?): {error.message}</div>}
      {memberMissing && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No member with the email {memberEmail}.</div>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["Calls", String(t.calls)],
          ["Placed", String(t.placed)],
          ["Answer rate", t.answerRate === null ? "—" : `${Math.round(t.answerRate * 100)}%`],
          ["Minutes", t.minutes.toLocaleString("en-GB")],
          ["Revenue", gbp(t.revenuePence)],
          ["Raw cost (est.)", gbp(t.rawCostPence)],
          ["Blocked", String(t.blocked)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{v}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <span className="text-muted-foreground">Type:</span>
        {[null, ...CALL_TYPES].map((k) => (
          <Link key={k ?? "all"} href={filterLink({ type: k })} className={k === type ? "font-semibold text-foreground" : "text-primary hover:underline"}>{k ? CALL_TYPE_LABEL[k as CallType] : "All"}</Link>
        ))}
        <span className="text-muted-foreground">Status:</span>
        {[null, ...CALL_STATUSES].map((k) => (
          <Link key={k ?? "all"} href={filterLink({ status: k })} className={k === status ? "font-semibold text-foreground" : "text-primary hover:underline"}>{k ?? "All"}</Link>
        ))}
        <span className="text-muted-foreground">Direction:</span>
        {[null, "outbound", "inbound"].map((k) => (
          <Link key={k ?? "all"} href={filterLink({ direction: k })} className={k === direction ? "font-semibold text-foreground" : "text-primary hover:underline"}>{k ?? "Both"}</Link>
        ))}
        <span className="text-muted-foreground">Window:</span>
        {WINDOWS.map((w) => (
          <Link key={w.key} href={filterLink({ days: w.key })} className={w.key === win.key ? "font-semibold text-foreground" : "text-primary hover:underline"}>{w.label}</Link>
        ))}
      </div>
      <form action="/admin/calls" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {type && <input type="hidden" name="type" value={type} />}
        {status && <input type="hidden" name="status" value={status} />}
        {direction && <input type="hidden" name="direction" value={direction} />}
        <input type="hidden" name="days" value={win.key} />
        <input name="member" type="email" defaultValue={memberEmail} placeholder="Member email" className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <button type="submit" className="rounded-lg border border-border bg-card px-3 py-1.5">Filter</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="p-3 font-medium">When</th>
              <th className="p-3 font-medium">Member</th>
              <th className="p-3 font-medium">Call</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 text-right font-medium">Length</th>
              <th className="p-3 text-right font-medium">Charged</th>
              <th className="p-3 text-right font-medium">Texts</th>
              <th className="p-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN).map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="p-3 whitespace-nowrap">{when(r.placed_at ?? r.queued_at)}</td>
                <td className="p-3">{r.user_id ? emailOf.get(r.user_id) ?? r.user_id : "Unknown caller"}</td>
                <td className="p-3 whitespace-nowrap">{r.direction === "inbound" ? "In" : "Out"} · {CALL_TYPE_LABEL[r.call_type as CallType] ?? r.call_type}</td>
                <td className="p-3">{r.status}</td>
                <td className="p-3 text-right">{len(r.seconds)}</td>
                <td className="p-3 text-right">{gbp(r.charged_pence)}</td>
                <td className="p-3 text-right">{r.texts_sent || "—"}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {r.blocked_reason ? BLOCKED_REASONS[r.blocked_reason as BlockedReason] ?? r.blocked_reason : null}
                  {r.handoff ? "Handed to the team. " : null}
                  {r.error && !r.blocked_reason ? r.error : null}
                  {r.conversation_id ? (
                    <Link href={`/admin/conversations?id=${r.conversation_id}`} className="ml-1 text-primary hover:underline">Transcript</Link>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">No calls in this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && <p className="mt-2 text-xs text-muted-foreground">Showing the newest {SHOWN} of {rows.length}{rows.length >= LIMIT ? "+" : ""}; the totals count all of them{rows.length >= LIMIT ? " (up to the first 2,000)" : ""}.</p>}

      <section className="mt-10 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Settings</h2>
        <CallSettingsForm voice={settings.voice} textPence={settings.intelligence.siTextPence} emailPence={settings.intelligence.siEmailPence} />
      </section>
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold text-foreground">The agent</h2>
        <SyncAgentForm />
      </section>
    </div>
  );
}
