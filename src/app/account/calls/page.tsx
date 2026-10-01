import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamOf } from "@/lib/team";
import { CALL_TYPE_LABEL, type CallType } from "@/lib/voice/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your calls — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = { answered: "Answered", missed: "Missed", voicemail: "Missed (voicemail)", failed: "Didn't connect", ringing: "In progress", queued: "Coming up" };

function date(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
}
const length = (s: number | null) => (s && s > 0 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : "—");
const charge = (p: number) => (p > 0 ? `£${(p / 100).toFixed(2)}` : "Free");

/**
 * "Your calls" (Batch 23; Account → More): every call from and to Stayful
 * Intelligence — date, type, length and what it cost (minutes, plus any
 * texts and the missed-call email). Blocked calls never happened, so they
 * aren't shown. Owners only: calls go to the account owner.
 */
export default async function YourCallsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/calls");
  if ((await teamOf(user.id)).role === "member") redirect("/account");
  const { data, error } = await createAdminClient()
    .from("si_calls_log")
    .select("id, direction, call_type, status, placed_at, queued_at, seconds, charged_pence")
    .eq("user_id", user.id)
    .neq("status", "blocked")
    .order("queued_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as { id: string; direction: string; call_type: string; status: string; placed_at: string | null; queued_at: string; seconds: number | null; charged_pence: number }[];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm text-[#6b7280]">
        <Link href="/account" className="hover:underline">Your account</Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[#1f2a1d]">Your calls</h1>
      <p className="mt-2 text-sm text-[#6b7280]">
        Calls from Stayful Intelligence, and calls you made to it. Switch calls off any time in{" "}
        <Link href="/account/notifications" className="underline">Notifications</Link>.
      </p>
      {error ? (
        <p className="mt-6 text-sm text-[#6b7280]">Your calls can&rsquo;t be shown right now.</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[#6b7280]">No calls yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[#e4e7dc] bg-white p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-[#1f2a1d]">{CALL_TYPE_LABEL[r.call_type as CallType] ?? r.call_type}</span>
                <span className="text-[#6b7280]">{date(r.placed_at ?? r.queued_at)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-[#4b5a45]">
                <span>{STATUS[r.status] ?? r.status}</span>
                <span>Length {length(r.seconds)}</span>
                <span>{charge(r.charged_pence)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
