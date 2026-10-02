import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { oneOf } from "../picks/responses/windows";

export const metadata: Metadata = { title: "Conversations — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["call", "sms", "chat"] as const;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—");

interface Conv { id: string; channel: string; user_id: string | null; persona_version: string | null; started_at: string; transcript_purged_at: string | null }
interface Question { conversation_id: string; question: string; outcome: string; knowledge_ref: string | null }

/**
 * The shared conversation log (Batch 23), a plain list: every conversation
 * with Stayful Intelligence on any channel, its questions and how each went,
 * and the transcript while it is kept. Batch 24 builds its views on top.
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

  if (id && UUID.test(id)) {
    const [{ data: conv }, { data: turns }, { data: qs }] = await Promise.all([
      admin.from("si_conversations").select("id, channel, user_id, persona_version, started_at, transcript_purged_at").eq("id", id).maybeSingle(),
      admin.from("si_conversation_turns").select("seq, role, text, at, knowledge_ref").eq("conversation_id", id).order("seq", { ascending: true }),
      admin.from("si_conversation_questions").select("conversation_id, question, outcome, knowledge_ref").eq("conversation_id", id).order("at", { ascending: true }),
    ]);
    if (!conv) notFound();
    const c = conv as Conv;
    const { data: person } = c.user_id ? await admin.from("profiles").select("email").eq("id", c.user_id).maybeSingle() : { data: null };
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link href="/admin/conversations" className="text-sm font-medium text-primary hover:underline">← Conversations</Link>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">{c.channel === "call" ? "Call" : c.channel === "sms" ? "Text" : "Chat"} · {when(c.started_at)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{(person as { email: string | null } | null)?.email ?? "Unknown caller"} · persona {c.persona_version ?? "—"}</p>
        <h2 className="mt-6 text-sm font-semibold text-foreground">Questions</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {((qs ?? []) as Question[]).map((q, i) => (
            <li key={i}><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{q.outcome}</span> {q.question}{q.knowledge_ref ? <span className="text-xs text-muted-foreground"> [{q.knowledge_ref}]</span> : null}</li>
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

  let q = admin.from("si_conversations").select("id, channel, user_id, persona_version, started_at, transcript_purged_at").order("started_at", { ascending: false }).limit(200);
  if (channel && (CHANNELS as readonly string[]).includes(channel)) q = q.eq("channel", channel);
  const { data, error } = await q;
  const convs = (data ?? []) as Conv[];
  const ids = convs.map((c) => c.id);
  const { data: qs } = ids.length ? await admin.from("si_conversation_questions").select("conversation_id, question, outcome, knowledge_ref").in("conversation_id", ids) : { data: [] };
  const byConv = new Map<string, Question[]>();
  for (const x of (qs ?? []) as Question[]) byConv.set(x.conversation_id, [...(byConv.get(x.conversation_id) ?? []), x]);
  const userIds = [...new Set(convs.map((c) => c.user_id).filter((x): x is string => Boolean(x)))];
  const { data: people } = userIds.length ? await admin.from("profiles").select("id, email").in("id", userIds) : { data: [] };
  const emailOf = new Map(((people ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email ?? p.id]));

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Conversations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every conversation with Stayful Intelligence, newest first (the last 200), with each question and how it went.</p>
        </div>
        <span className="flex gap-4">
          <Link href="/admin/calls" className="text-sm font-medium text-primary hover:underline">Calls</Link>
          <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
        </span>
      </div>
      <div className="mb-4 flex gap-4 text-sm">
        {[null, ...CHANNELS].map((k) => (
          <Link key={k ?? "all"} href={k ? `/admin/conversations?channel=${k}` : "/admin/conversations"} className={k === channel ? "font-semibold text-foreground" : "text-primary hover:underline"}>{k ?? "All"}</Link>
        ))}
      </div>
      {error && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Could not read conversations (schema behind?): {error.message}</div>}
      <ul className="space-y-2">
        {convs.map((c) => (
          <li key={c.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <Link href={`/admin/conversations?id=${c.id}`} className="font-medium text-primary hover:underline">{c.channel} · {when(c.started_at)}</Link>
            <span className="text-muted-foreground"> · {c.user_id ? emailOf.get(c.user_id) ?? c.user_id : "Unknown"}</span>
            <ul className="mt-1 text-xs text-muted-foreground">
              {(byConv.get(c.id) ?? []).map((x, i) => (
                <li key={i}>{x.outcome}: {x.question}</li>
              ))}
            </ul>
          </li>
        ))}
        {convs.length === 0 && <li className="text-sm text-muted-foreground">No conversations yet.</li>}
      </ul>
    </div>
  );
}
