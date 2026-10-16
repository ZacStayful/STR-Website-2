import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadActionsAdmin, ACTION_ADMIN_DAYS } from "@/lib/si-actions/admin-server";
import { STEP_KINDS, type StepKind } from "@/lib/si-actions/config";
import { ACTION_SETTING_BOUNDS, ACTION_SETTING_LABELS, type ActionSettings } from "@/lib/si-actions/settings";
import { pct } from "@/lib/chat/metrics";
import { chargeLabel } from "@/lib/chat/format";
import { weekLabel } from "@/lib/activity/week";
import { saveActionSettingsAction } from "./actions";
import { readFlash } from "../flash";
import { BUTTON, CARD, FlashBox, SiAdminNav } from "../SiAdmin";

export const metadata: Metadata = { title: "Actions — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const money = (p: number) => (p >= 100 ? `£${(p / 100).toFixed(2)}` : chargeLabel(p));

const LABEL: Record<StepKind, string> = {
  keep: "Keep",
  pass: "Pass",
  stage_move: "Stage move",
  full_analysis: "Full analysis",
  deep_report: "Deep report",
  deep_search: "Deep search",
  check_link: "Listing check",
  change_criteria: "Criteria change",
  btl_report: "Buy-to-let report",
};

const FIELDS = Object.keys(ACTION_SETTING_BOUNDS) as Exclude<keyof ActionSettings, "enabled">[];

const TH = "pb-1 text-right font-medium";

/**
 * Batch 27: what Stayful Intelligence did for members, in its admin section
 * (Batch 24's, next to Batch 26's Chat): actions per day by type, what the
 * actions brought in and the question's AI cost and margin, Stops and the
 * confirms (shown and accepted), failures and the automatic reports, the Undo
 * rate by action, next-week weekly active, and the settings.
 */
export default async function ActionsAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence/actions");
  if (!isAdminEmail(user.email)) notFound();
  const [load, flash] = await Promise.all([loadActionsAdmin(), readFlash("/admin/intelligence/actions")]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <SiAdminNav current="actions" />
      <h1 className="text-2xl font-semibold text-foreground">Actions</h1>
      <p className="mt-1 text-sm text-muted-foreground">What Stayful Intelligence did when members told it to, in the full view. The last {ACTION_ADMIN_DAYS} days.</p>
      <FlashBox flash={flash} />
      {load.status === "no_service_role" && <p className="mt-6 text-sm text-muted-foreground">The service role isn’t configured, so there is nothing to read.</p>}
      {load.status === "failed" && <p className="mt-6 text-sm text-red-700">Couldn’t read the actions: {load.message}. Has the Batch 27 section of supabase/schema.sql been run?</p>}
      {load.status === "ok" && (
        <div className="mt-6 space-y-8">
          {!load.data.config.enabled && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Actions are switched off below: the eye answers, and members use the buttons.</p>}

          <section className={CARD}>
            <h2 className="text-base font-semibold">Actions per day</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left font-medium">Day</th>
                    <th className={TH}>Instructions</th>
                    {STEP_KINDS.map((k) => (
                      <th key={k} className={TH}>
                        {LABEL[k]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {load.data.days.map((d) => (
                    <tr key={d.day} className="border-t border-border">
                      <td className="py-1 pr-3 text-muted-foreground">{d.day}</td>
                      <td className="pr-3 text-right">{d.instructions || "·"}</td>
                      {STEP_KINDS.map((k) => (
                        <td key={k} className="pr-3 text-right">
                          {d.counts[k] || "·"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">An action counts when it happened (a charged one: started and charged by its own button’s code). Instructions whose answer never reached the member did nothing and aren’t counted.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Revenue, AI cost and margin</h2>
            <div className="mt-3 grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Actions (each at its button’s price)</h3>
                {load.data.revenue.rows.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {load.data.revenue.rows.map((r) => (
                        <tr key={r.action} className="border-t border-border">
                          <td className="py-1.5 pr-3">{LABEL[r.action]}</td>
                          <td className="pr-3 text-right">{r.count}</td>
                          <td className="text-right">
                            {money(r.revenuePence)}
                            {r.estimated > 0 ? "*" : ""}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-border font-semibold">
                        <td className="py-1.5 pr-3">All</td>
                        <td />
                        <td className="text-right">{money(load.data.revenue.totalPence)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {load.data.revenue.estimated > 0 && <p className="mt-1 text-xs text-muted-foreground">* Listing checks are metered per call, so they’re at their typical price here; the ledger has the exact pennies.</p>}
                <p className="mt-1 text-xs text-muted-foreground">An analysis that opened its deal: the open is its own ledger line and isn’t counted here.</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold">The questions that gave them (the AI line)</h3>
                <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Questions</dt>
                  <dd className="text-right">
                    {load.data.ai.turns} ({load.data.ai.charged} charged)
                  </dd>
                  <dt className="text-muted-foreground">Our cost</dt>
                  <dd className="text-right">{money(load.data.ai.rawPence)}</dd>
                  <dt className="text-muted-foreground">Charged</dt>
                  <dd className="text-right">{money(load.data.ai.revenuePence)}</dd>
                  <dt className="text-muted-foreground">Margin</dt>
                  <dd className="text-right">
                    {money(load.data.ai.marginPence)} ({pct(load.data.ai.marginRate)})
                  </dd>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">A question that ended in a bug report or a system error isn’t charged; its cost is still ours.</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Base pence, before a grant’s spend rate. Admin accounts are metered but never charged.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Stops and confirms</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-muted-foreground">Instructions</dt>
              <dd>{load.data.safety.instructions}</dd>
              <dt className="text-muted-foreground">With a charge</dt>
              <dd>{load.data.safety.withCharges}</dd>
              <dt className="text-muted-foreground">Stopped before any charge</dt>
              <dd>{load.data.safety.stopsBeforeCharge}</dd>
              <dt className="text-muted-foreground">“Stop the rest”</dt>
              <dd>{load.data.safety.stopsRest}</dd>
              <dt className="text-muted-foreground">Not enough credit</dt>
              <dd>{load.data.safety.blocked}</dd>
              <dt className="text-muted-foreground">Bugs filed for members</dt>
              <dd>{load.data.safety.memberBugs}</dd>
              <dt className="text-muted-foreground">Feature requests offered</dt>
              <dd>{load.data.safety.featureRequests}</dd>
            </dl>
            <table className="mt-4 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">Confirm</th>
                  <th className={TH}>Shown</th>
                  <th className={TH}>Yes</th>
                  <th className={TH}>No</th>
                  <th className={TH}>Accepted</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["low_balance", `Balance would end under ${money(load.data.config.lowCreditPence)}`],
                    ["over_cap", `Over ${money(load.data.config.instructionCapPence)} in one instruction`],
                  ] as const
                ).map(([k, label]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="py-1.5 pr-3">{label}</td>
                    <td className="pr-3 text-right">{load.data.safety.confirmsShown[k]}</td>
                    <td className="pr-3 text-right">{load.data.safety.confirmsYes[k]}</td>
                    <td className="pr-3 text-right">{load.data.safety.confirmsNo[k]}</td>
                    <td className="text-right">{pct(load.data.safety.confirmsShown[k] > 0 ? load.data.safety.confirmsYes[k] / load.data.safety.confirmsShown[k] : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">A confirm nobody answered expires (shown, neither yes nor no). Feature requests are offered filled in; the member sends them from the feedback form.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Failures</h2>
            {load.data.failures.rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left font-medium">Action</th>
                    <th className="pb-1 text-left font-medium">Code</th>
                    <th className={TH}>Failed</th>
                    <th className={TH}>Reported automatically</th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.failures.rows.map((f) => (
                    <tr key={`${f.action}:${f.code}`} className="border-t border-border">
                      <td className="py-1.5 pr-3">{LABEL[f.action]}</td>
                      <td className="pr-3 font-mono text-xs">{f.code}</td>
                      <td className="pr-3 text-right">{f.count}</td>
                      <td className="text-right">{f.autoReported}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-muted-foreground">A failed step is never charged. An unexpected one is filed to Feedback once per member, action and code a day ({load.data.failures.autoReported} in the window).</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Undo rate</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">Action</th>
                  <th className={TH}>Done</th>
                  <th className={TH}>Undone</th>
                  <th className={TH}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {load.data.undo.map((u) => (
                  <tr key={u.action} className="border-t border-border">
                    <td className="py-1.5 pr-3">{LABEL[u.action]}</td>
                    <td className="pr-3 text-right">{u.done}</td>
                    <td className="pr-3 text-right">{u.undone}</td>
                    <td className="text-right">{pct(u.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">A high rate means the eye is doing things members didn’t mean. Charges are never undone, so analyses, searches and listing checks aren’t here.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Weekly active the week after</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">Week from</th>
                  <th className={TH}>Members it acted for</th>
                  <th className={TH}>Active the next week</th>
                  <th className={TH}>Other full-view users</th>
                  <th className={TH}>Active the next week</th>
                </tr>
              </thead>
              <tbody>
                {load.data.nextWeek.map((w) => (
                  <tr key={w.week} className="border-t border-border">
                    <td className="py-1.5 pr-3">{weekLabel(w.week)}</td>
                    <td className="pr-3 text-right">{w.actors}</td>
                    <td className="pr-3 text-right">{w.actors ? `${w.activeNext} (${pct(w.activeNext / w.actors)})` : "—"}</td>
                    <td className="pr-3 text-right">{w.others}</td>
                    <td className="text-right">{w.others ? `${w.othersActiveNext} (${pct(w.othersActiveNext / w.others)})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">The newest row’s next week is the one in progress. Weekly active is the headline’s definition (admin, staff and excluded accounts left out).</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Settings</h2>
            <form action={saveActionSettingsAction} className="mt-3 space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={load.data.config.enabled} /> The eye acts for members (off: it answers, and members use the buttons)
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <label key={f} className="text-sm">
                    <span className="text-muted-foreground">{ACTION_SETTING_LABELS[f]}</span>
                    <input
                      name={f}
                      type="number"
                      step={1}
                      min={ACTION_SETTING_BOUNDS[f].min}
                      max={ACTION_SETTING_BOUNDS[f].max}
                      defaultValue={load.data.config[f]}
                      className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Pence are face pence (what comes off the balance). The low-credit line ({money(load.data.config.lowCreditPence)}) is Batch 20’s, shared with the low-credit email and call: change it on{" "}
                <Link href="/admin/lifecycle" className="underline">
                  Lifecycle
                </Link>
                . Each action keeps its button’s price; the question’s own price is on the Chat tab.
              </p>
              <button type="submit" className={BUTTON}>
                Save
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
