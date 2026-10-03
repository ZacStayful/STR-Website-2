import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { refToSlug } from "@/lib/knowledge/seed";
import { oneOf } from "../picks/responses/windows";
import { SiAdminNav } from "../intelligence/SiAdmin";

export const metadata: Metadata = { title: "Conversations — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["call", "sms", "chat"] as const;
const OUTCOMES = ["answered", "low_confidence", "could_not_answer", "member_unhappy", "handed_off"] as const;
const OUTCOME_TEXT: Record<string, string> = { answered: "answered", low_confidence: "unsure", could_not_answer: "couldn't answer", member_unhappy: "member unhappy", handed_off: "handed off" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—");

interface Conv { id: string; channel: string; user_id: string | null; persona_version: string | null; started_at: string; transcript_purged_at: string | null }
interface Question { conversation_id: string; question: string; outcome: string; knowledge_ref: string | null }
interface CallRow { conversation_id: string | null; direction: string; status: string; seconds: number | null; charged_pence: number; handoff: boolean }

type Admin = ReturnType<typeof createAdminClient>;

/** Knowledge entries by slug (Batch 24), so each question links to the answer used. */
async function entryIds(admin: Admin): Promise<Map<string, string>> {
  const { data } = await admin.from("si_knowledge").select("id, slug").limit(5000);
  return new Map(((data ?? []) as { id: string; slug: string }[]).map((r) => [r.slug, r.id]));
}

function Ref({ refText, entries }: { refText: string | null; entries: Map<string, string> }) {
  if (!refText) return null;
  const slug = refToSlug(refText);
  const id = slug ? entries.get(slug) : undefined;
  return id ? (
    <Link href={`/admin/intelligence/knowledge/${id}`} className="text-xs text-primary hover:underline"> [{slug}]</Link>
  ) : (
    <span className="text-xs text-muted-foreground"> [{refText}]</span>
  );
}

const length = (s: number | null) => (s === null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
const charge = (p: number) => (p > 0 ? `£${(p / 100).toFixed(2)}` : "free");
function callLine(calls: CallRow[]): string | null {
  if (!calls.length) return null;
  return calls.map((c) => `${c.direction} ${c.status}, ${length(c.seconds)}, ${charge(c.charged_pence)}${c.handoff ? ", handed off" : ""}`).join("; ");
}

/**
 * The shared conversation log (Batch 23): every conversation with Stayful
 * Intelligence on any channel, its questions and how each went, and the
 * transcript while it is kept. Batch 24 adds the section's nav, filters by
 * outcome and member email, the knowledge entry each answer used (linked),
 * and each call's length and charge from si_calls_log.
 */
export default async function ConversationsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/conversations");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();
  const id = oneOf(params.id);
  const channel = oneOf(params.channel);
  const outcomeParam = oneOf(params.outcome);
  const outcome = outcomeParam && (OUTCOMES as readonly string[]).includes(outcomeParam) ? outcomeParam : null;
  const email = (oneOf(params.email) ?? "").trim().toLowerCase().slice(0, 200);

  if (id && UUID.test(id)) {
    const [{ data: conv }, { data: turns }, { data: qs }, { data: calls }, entries] = await Promise.all([
      admin.from("si_conversations").select("id, channel, user_id, persona_version, started_at, transcript_purged_at").eq("id", id).maybeSingle(),
      admin.from("si_conversation_turns").select("seq, role, text, at, knowledge_ref").eq("conversation_id", id).order("seq", { ascending: true }),
      admin.from("si_conversation_questions").select("conversation_id, question, outcome, knowledge_ref").eq("conversation_id", id).order("at", { ascending: true }),
      admin.from("si_calls_log").select("conversation_id, direction, status, seconds, charged_pence, handoff").eq("conversation_id", id),
      entryIds(admin),
    ]);
    if (!conv) notFound();
    const c = conv as Conv;
    const { data: person } = c.user_id ? await admin.from("profiles").select("email").eq("id", c.user_id).maybeSingle() : { data: null };
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <SiAdminNav current="conversations" />
        <Link href="/admin/conversations" className="text-sm font-medium text-primary hover:underline">← Conversations</Link>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">{c.channel === "call" ? "Call" : c.channel === "sms" ? "Text" : "Chat"} · {when(c.started_at)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{(person as { email: string | null } | null)?.email ?? "Unknown caller"} · persona {c.persona_version ?? "—"}</p>
        {callLine((calls ?? []) as CallRow[]) && <p className="mt-1 text-sm text-muted-foreground">Call: {callLine((calls ?? []) as CallRow[])}</p>}
        <h2 className="mt-6 text-sm font-semibold text-foreground">Questions</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {((qs ?? []) as Question[]).map((q, i) => (
            <li key={i}><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{OUTCOME_TEXT[q.outcome] ?? q.outcome}</span> {q.question}<Ref refText={q.knowledge_ref} entries={entries} /></li>
          ))}
          {(qs ?? []).length === 0 && <li className="text-muted-foreground">None recorded.</li>}
        </ul>
        <h2 className="mt-6 text-sm font-semibold text-foreground">Transcript</h2>
        {c.transcript_purged_at ? (
          <p className="mt-2 text-sm text-muted-foreground">Deleted on {when(c.transcript_purged_at)} (kept for the retention period only; questions and outcomes are kept).</p>
        ) : (
          <div className="mt-2 space-y-2">
            {((turns ?? []) as { seq: number; role: string; text: string }[]).map((t) => (
              <p key={t.seq} className={`rounded-lg p-3 text-sm ${t.role === "agent" ? "bg-card" : "bg-muted"}`}>
                <span className="text-xs font-semibold text-muted-foreground">{t.role === "agent" ? "Stayful Intelligence" : "Member"}</span>
                <br />
                {t.text}
              </p>
            ))}
            {(turns ?? []).length === 0 && <p className="text-sm text-muted-foreground">No turns recorded yet.</p>}
          </div>
        )}
      </div>
    );
  }

  // Filters narrow to conversation ids or members first; null means "no narrowing".
  let onlyConvs: string[] | null = null;
  let onlyUsers: string[] | null = null;
  if (outcome) {
    const { data: hits } = await admin.from("si_conversation_questions").select("conversation_id").eq("outcome", outcome).order("at", { ascending: false }).limit(1000);
    onlyConvs = [...new Set(((hits ?? []) as { conversation_id: string }[]).map((h) => h.conversation_id))].slice(0, 200);
  }
  if (email) {
    const { data: people } = await admin.from("profiles").select("id").ilike("email", `%${email.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`).limit(50);
    onlyUsers = ((people ?? []) as { id: string }[]).map((p) => p.id);
  }
  let q = admin.from("si_conversations").select("id, channel, user_id, persona_version, started_at, transcript_purged_at").order("started_at", { ascending: false }).limit(200);
  if (channel && (CHANNELS as readonly string[]).includes(channel)) q = q.eq("channel", channel);
  if (onlyConvs) q = q.in("id", onlyConvs.length ? onlyConvs : ["00000000-0000-0000-0000-000000000000"]);
  if (onlyUsers) q = q.in("user_id", onlyUsers.length ? onlyUsers : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  const convs = (data ?? []) as Conv[];
  const ids = convs.map((c) => c.id);
  const [{ data: qs }, { data: calls }, entries] = await Promise.all([
    ids.length ? admin.from("si_conversation_questions").select("conversation_id, question, outcome, knowledge_ref").in("conversation_id", ids).order("at", { ascending: true }) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("si_calls_log").select("conversation_id, direction, status, seconds, charged_pence, handoff").in("conversation_id", ids) : Promise.resolve({ data: [] }),
    entryIds(admin),
  ]);
  const byConv = new Map<string, Question[]>();
  for (const x of (qs ?? []) as Question[]) byConv.set(x.conversation_id, [...(byConv.get(x.conversation_id) ?? []), x]);
  const callsByConv = new Map<string, CallRow[]>();
  for (const c of (calls ?? []) as CallRow[]) if (c.conversation_id) callsByConv.set(c.conversation_id, [...(callsByConv.get(c.conversation_id) ?? []), c]);
  const filterHref = (o: { channel?: string | null; outcome?: string | null; email?: string | null }) => {
    const sp = new URLSearchParams();
    const ch = o.channel === undefined ? channel : o.channel;
    const oc = o.outcome === undefined ? outcome : o.outcome;
    const em = o.email === undefined ? email : o.email;
    if (ch) sp.set("channel", ch);
    if (oc) sp.set("outcome", oc);
    if (em) sp.set("email", em);
    const qs = sp.toString();
    return qs ? `/admin/conversations?${qs}` : "/admin/conversations";
  };
  const userIds = [...new Set(convs.map((c) => c.user_id).filter((x): x is string => Boolean(x)))];
  const { data: people } = userIds.length ? await admin.from("profiles").select("id, email").in("id", userIds) : { data: [] };
  const emailOf = new Map(((people ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email ?? p.id]));

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <SiAdminNav current="conversations" />
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Conversations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every conversation with Stayful Intelligence, newest first (the last 200 that match), with each question, how it went and the answer it used.</p>
        </div>
        <Link href="/admin/calls" className="text-sm font-medium text-primary hover:underline">Calls</Link>
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">Channel:</span>
        {[null, ...CHANNELS].map((k) => (
          <Link key={k ?? "all"} href={filterHref({ channel: k })} className={k === channel ? "font-semibold text-foreground" : "text-primary hover:underline"}>{k ?? "All"}</Link>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">Outcome:</span>
        {[null, ...OUTCOMES].map((k) => (
          <Link key={k ?? "all"} href={filterHref({ outcome: k })} className={k === outcome ? "font-semibold text-foreground" : "text-primary hover:underline"}>{k ? OUTCOME_TEXT[k] : "Any"}</Link>
        ))}
      </div>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {channel && <input type="hidden" name="channel" value={channel} />}
        {outcome && <input type="hidden" name="outcome" value={outcome} />}
        <label>Member email <input name="email" defaultValue={email} className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-sm" /></label>
        <button type="submit" className="rounded-md border border-border px-3 py-1 hover:bg-muted">Filter</button>
        {email && <Link href={filterHref({ email: null })} className="text-primary hover:underline">Clear</Link>}
      </form>
      {error && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Could not read conversations (schema behind?): {error.message}</div>}
      <ul className="space-y-2">
        {convs.map((c) => (
          <li key={c.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <Link href={`/admin/conversations?id=${c.id}`} className="font-medium text-primary hover:underline">{c.channel} · {when(c.started_at)}</Link>
            <span className="text-muted-foreground"> · {c.user_id ? emailOf.get(c.user_id) ?? c.user_id : "Unknown"}</span>
            {callLine(callsByConv.get(c.id) ?? []) && <span className="text-muted-foreground"> · {callLine(callsByConv.get(c.id) ?? [])}</span>}
            <ul className="mt-1 text-xs text-muted-foreground">
              {(byConv.get(c.id) ?? []).map((x, i) => (
                <li key={i}>{OUTCOME_TEXT[x.outcome] ?? x.outcome}: {x.question}<Ref refText={x.knowledge_ref} entries={entries} /></li>
              ))}
            </ul>
          </li>
        ))}
        {convs.length === 0 && <li className="text-sm text-muted-foreground">{outcome || email ? "Nothing matches." : "No conversations yet."}</li>}
      </ul>
    </div>
  );
}
