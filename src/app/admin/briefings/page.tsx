import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadBriefingsAdmin } from "@/lib/briefing/admin-server";
import { getBillingSettings } from "@/lib/credit/unit-costs";

export const metadata: Metadata = { title: "Briefings — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const pence = (p: number) => (p >= 100 ? `£${(p / 100).toFixed(2)}` : `${p.toFixed(1)}p`);

/** Batch 23b: the morning briefings, per UK day (src/lib/briefing). */
export default async function BriefingsAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/briefings");
  if (!isAdminEmail(user.email)) notFound();

  const [{ status, message, days, rejections }, settings] = await Promise.all([loadBriefingsAdmin(14), getBillingSettings()]);
  const cols: [string, (d: (typeof days)[number]) => string | number][] = [
    ["Generated", (d) => d.generated],
    ["Rejected", (d) => d.rejected],
    ["Template only", (d) => d.templateOnly],
    ["Skipped", (d) => d.skipped],
    ["Seen in app", (d) => d.seenInApp],
    ["Seen by email", (d) => d.seenByEmail],
    ["Played", (d) => d.played],
    ["Useful", (d) => d.useful],
    ["Not for me", (d) => d.notForMe],
    ["Charged", (d) => pence(d.chargedPence)],
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Morning briefings</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            One row per member per UK day. Generated: written by the AI and passed the validator (charged). Rejected: the AI&rsquo;s text failed the validator, so the template went (not charged). Template only: never sent to the AI (switched off, low credit). Skipped: nothing new to say. AI briefings are{" "}
            <strong>{settings.briefingsEnabled ? "on" : "off"}</strong> (<Link href="/admin/billing" className="text-primary hover:underline">billing settings</Link>).
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">
          ← Admin
        </Link>
      </div>
      {status !== "ok" && (
        <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          {status === "schema_missing" ? "The briefing tables are not there yet: run supabase/schema.sql." : status === "no_service_role" ? "No service role: nothing to show." : `Could not read the briefings: ${message}`}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">UK day</th>
              {cols.map(([h]) => (
                <th key={h} className="px-4 py-2 text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.length === 0 ? (
              <tr className="border-t border-border/60">
                <td className="px-4 py-2 text-muted-foreground" colSpan={cols.length + 1}>
                  No briefings yet.
                </td>
              </tr>
            ) : (
              days.map((d) => (
                <tr key={d.day} className="border-t border-border/60">
                  <td className="px-4 py-2 tabular-nums">{d.day}</td>
                  {cols.map(([h, f]) => (
                    <td key={h} className="px-4 py-2 text-right tabular-nums">
                      {f(d)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rejections.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-lg font-semibold text-foreground">Latest rejections</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {rejections.map((r, i) => (
              <li key={i}>
                <span className="tabular-nums">{r.day}</span> · {r.angle ?? "—"} · {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
