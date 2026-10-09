import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadChatAdmin, ADMIN_DAYS } from "@/lib/chat/admin-server";
import { pct, type Money, type Outcomes } from "@/lib/chat/metrics";
import { chargeLabel } from "@/lib/chat/format";
import { CHAT_SETTING_BOUNDS, CHAT_SETTING_LABELS, type ChatSettings } from "@/lib/chat/settings";
import { saveChatSettingsAction } from "./actions";
import { readFlash } from "../flash";
import { BUTTON, CARD, FlashBox, SiAdminNav } from "../SiAdmin";

export const metadata: Metadata = { title: "Chat — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const money = (p: number) => (p >= 100 ? `£${(p / 100).toFixed(2)}` : chargeLabel(p));

function OutcomeRow({ label, o }: { label: string; o: Outcomes }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3 font-medium">{label}</td>
      <td className="pr-3 text-right">{o.asked}</td>
      <td className="pr-3 text-right">{pct(o.answeredRate)}</td>
      <td className="pr-3 text-right">{pct(o.dontKnowRate)}</td>
      <td className="pr-3 text-right">{pct(o.unhappyRate)}</td>
      <td className="text-right text-muted-foreground">{o.failed}</td>
    </tr>
  );
}

function MoneyRow({ label, m }: { label: string; m: Money }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3 font-medium">{label}</td>
      <td className="pr-3 text-right">{money(m.rawPence)}</td>
      <td className="pr-3 text-right">{money(m.revenuePence)}</td>
      <td className="pr-3 text-right">{money(m.marginPence)}</td>
      <td className="pr-3 text-right">{pct(m.marginRate)}</td>
      <td className="pr-3 text-right">{m.medianChargePence === null ? "—" : chargeLabel(m.medianChargePence)}</td>
      <td className="pr-3 text-right">{pct(m.cacheHitRate)}</td>
      <td className="text-right">{pct(m.anyCacheShare)}</td>
    </tr>
  );
}

const FIELDS = Object.keys(CHAT_SETTING_BOUNDS) as Exclude<keyof ChatSettings, "enabled" | "voice">[];

/**
 * Batch 26: the typed chat in Stayful Intelligence's admin (Batch 24's
 * section, not a second one): questions per day by surface; answered,
 * "don't know" and unhappy rates; the most asked questions; our cost, what
 * members paid, the margin and the prompt cache's hit rate; real questions
 * either side of the confidence threshold; how many chat users were weekly
 * active; and the settings. Conversations (with the chat filter) and
 * Coverage (the chat row) are the other tabs.
 */
export default async function ChatAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence/chat");
  if (!isAdminEmail(user.email)) notFound();
  const [load, flash] = await Promise.all([loadChatAdmin(), readFlash()]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <SiAdminNav current="chat" />
      <h1 className="text-2xl font-semibold text-foreground">Chat</h1>
      <p className="mt-1 text-sm text-muted-foreground">Typed questions: quick answers under the header eye (Haiku 4.5) and the full view (Sonnet 5.5). The last {ADMIN_DAYS} days.</p>
      <FlashBox flash={flash} />
      {load.status === "no_service_role" && <p className="mt-6 text-sm text-muted-foreground">The service role isn’t configured, so there is nothing to read.</p>}
      {load.status === "failed" && <p className="mt-6 text-sm text-red-700">Couldn’t read the chat: {load.message}. Has the Batch 26 section of supabase/schema.sql been run?</p>}
      {load.status === "ok" && (
        <div className="mt-6 space-y-8">
          {!load.data.envOn && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The chat is off for members: SI_CHAT_ENABLED isn’t set to true in this deployment.</p>}
          {load.data.envOn && !load.data.settings.enabled && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The chat is switched off below.</p>}

          <section className={CARD}>
            <h2 className="text-base font-semibold">Answered, don’t know, unhappy</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium" />
                  <th className="pb-1 text-right font-medium">Asked</th>
                  <th className="pb-1 text-right font-medium">Answered</th>
                  <th className="pb-1 text-right font-medium">Don’t know</th>
                  <th className="pb-1 text-right font-medium">Unhappy (of answered)</th>
                  <th className="pb-1 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                <OutcomeRow label="Quick" o={load.data.outcomes.quick} />
                <OutcomeRow label="Full view" o={load.data.outcomes.full} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">Don’t know includes “Ask in the full view”. Failed is an error or a page that went away part-way: never charged.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Cost, revenue and margin</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium" />
                  <th className="pb-1 text-right font-medium">Our cost</th>
                  <th className="pb-1 text-right font-medium">Charged</th>
                  <th className="pb-1 text-right font-medium">Margin</th>
                  <th className="pb-1 text-right font-medium">Margin %</th>
                  <th className="pb-1 text-right font-medium">Median charge</th>
                  <th className="pb-1 text-right font-medium">Cache hit (tokens)</th>
                  <th className="pb-1 text-right font-medium">Questions with a hit</th>
                </tr>
              </thead>
              <tbody>
                <MoneyRow label="Quick" m={load.data.money.quick} />
                <MoneyRow label="Full view" m={load.data.money.full} />
                <MoneyRow label="All" m={load.data.money.all} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Our cost includes questions that weren’t charged (don’t know, failed). Charged is base pence, before a grant’s spend rate. Quick answers are too short for Haiku’s prompt cache (4,096 tokens); the full view’s cache lasts 5 minutes, so it only hits when questions are close together. The median charge is what to set the price hints to.
            </p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Questions per day</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {load.data.days.map((d) => (
                <div key={d.day} className="flex justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">{d.day}</span>
                  <span>
                    {d.quick} quick · {d.full} full
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Most asked</h2>
            {load.data.topQuestions.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No questions yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left font-medium">Question</th>
                    <th className="pb-1 text-right font-medium">Asked</th>
                    <th className="pb-1 text-right font-medium">Answered</th>
                    <th className="pb-1 text-right font-medium">Not answered</th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.topQuestions.map((q) => (
                    <tr key={q.question} className="border-t border-border">
                      <td className="py-1.5 pr-3">{q.question}</td>
                      <td className="pr-3 text-right">{q.asked}</td>
                      <td className="pr-3 text-right">{q.answered}</td>
                      <td className="text-right">{q.notAnswered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-muted-foreground">The ones it couldn’t answer reach Gaps after the nightly job.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Either side of the confidence threshold ({load.data.answerMin})</h2>
            <p className="mt-1 text-xs text-muted-foreground">Real questions the matcher scored just above (answered from knowledge) and just below (not). The threshold is on the Knowledge tab.</p>
            <div className="mt-3 grid gap-6 sm:grid-cols-2">
              {(
                [
                  ["Just above", load.data.above],
                  ["Just below", load.data.below],
                ] as const
              ).map(([title, list]) => (
                <div key={title}>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  {list.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">None yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {list.map((q, i) => (
                        <li key={i}>
                          <span className="font-mono text-xs text-muted-foreground">{q.confidence.toFixed(3)}</span> {q.question} <span className="text-xs text-muted-foreground">({q.surface}, {q.outcome ?? "—"})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Chat users who were weekly active</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">Week from</th>
                  <th className="pb-1 text-right font-medium">Chat users</th>
                  <th className="pb-1 text-right font-medium">Weekly active</th>
                  <th className="pb-1 text-right font-medium">Active beyond the chat</th>
                </tr>
              </thead>
              <tbody>
                {load.data.active.map((w) => (
                  <tr key={w.week} className="border-t border-border">
                    <td className="py-1.5 pr-3">{w.week}</td>
                    <td className="pr-3 text-right">{w.chatUsers}</td>
                    <td className="pr-3 text-right">{w.chatUsers ? `${w.active} (${pct(w.active / w.chatUsers)})` : "—"}</td>
                    <td className="text-right">{w.chatUsers ? `${w.activeBeyondChat} (${pct(w.activeBeyondChat / w.chatUsers)})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">A full-view question counts towards weekly active by itself; a quick answer doesn’t. “Beyond the chat” leaves the chat out.</p>
          </section>

          <section className={CARD}>
            <h2 className="text-base font-semibold">Settings</h2>
            <form action={saveChatSettingsAction} className="mt-3 space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={load.data.settings.enabled} /> The chat is on (SI_CHAT_ENABLED must also be true)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="voice" defaultChecked={load.data.settings.voice} /> Voice is on (the microphone, and answers spoken back; each is charged as AI voice)
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <label key={f} className="text-sm">
                    <span className="text-muted-foreground">{CHAT_SETTING_LABELS[f]}</span>
                    <input
                      name={f}
                      type="number"
                      step={CHAT_SETTING_BOUNDS[f].whole ? 1 : "any"}
                      min={CHAT_SETTING_BOUNDS[f].min}
                      max={CHAT_SETTING_BOUNDS[f].max}
                      defaultValue={load.data.settings[f]}
                      className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Prices are base pence. A question costs its actual tokens × the markup, never more than its ceiling, and only when it’s answered. The thresholds that decide “answered from knowledge” are on the Knowledge tab; the 90 days are the calls’ transcript setting.</p>
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
