import { pct } from "@/lib/activity/metrics";
import { loadTakeUp } from "@/lib/analysis/take-up-server";

/**
 * Batch 10's three figures, in the slot Batch 9 left on this page: Full
 * analysis take-up, PMI add-on take-up, and reminders shown → acted on, over
 * the last 28 days (src/lib/analysis/take-up.ts). The accounts the page
 * leaves out are left out here too.
 */
export async function AnalysisTakeUp({ ready, excluded }: { ready: boolean; excluded: readonly string[] }) {
  const titles = ["Full analysis take-up", "PMI add-on take-up", "Reminder shown → acted on"];
  const load = ready ? await loadTakeUp({ excluded }) : null;
  if (!load || load.status !== "ok") {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {titles.map((title) => (
          <div key={title} className="rounded-xl border border-dashed border-border p-4">
            <div className="text-sm font-medium text-foreground">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{ready ? "Couldn’t read the activity log. Try again shortly." : "Shown once the figures above load."}</div>
          </div>
        ))}
      </div>
    );
  }
  const { analysis, pmi, reminders, days } = load.figures;
  const withPmi = pmi.atPurchase + pmi.later;
  const cards = [
    {
      title: titles[0],
      value: pct({ active: analysis.analysed, base: analysis.opened }),
      line: `${analysis.analysed} of ${analysis.opened} deals opened got a Full analysis`,
      detail: `${analysis.bought} bought: ${analysis.oneTap} in one go, ${analysis.afterLook} after a Quick look or pick; ${analysis.reused} from a saved analysis.`,
    },
    {
      title: titles[1],
      value: pct({ active: withPmi, base: pmi.analyses }),
      line: `${withPmi} of ${pmi.analyses} Full analyses have PMI’s second opinion`,
      detail: `${pmi.atPurchase} ticked at purchase, ${pmi.later} added later from the report.${pmi.noAnswer > 0 ? ` ${pmi.noAnswer} more were ticked but PMI had no answer (not charged).` : ""}`,
    },
    {
      title: titles[2],
      value: pct({ active: reminders.acted, base: reminders.shown }),
      line: `${reminders.acted} of ${reminders.shown} reminders acted on`,
      detail: `After a stage move: ${reminders.byWhere.stage.acted} of ${reminders.byWhere.stage.shown}. Kept next step: ${reminders.byWhere.kept_step.acted} of ${reminders.byWhere.kept_step.shown}. ${reminders.bought} went on to a finished Full analysis.`,
    },
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.title} className="rounded-xl border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">{c.title}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{c.value}</div>
            <div className="mt-1 text-xs text-foreground">{c.line}</div>
            <div className="mt-1 text-xs text-muted-foreground">{c.detail}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        The last {days} days, per member. A deal counts as opened after a Quick look or the open inside a one-tap Full analysis; a Full analysis of a daily pick counts as opened too. A reminder is acted on when the member starts a Full analysis from its button. Preview deployments are left out.
        {load.capped ? " More events than could be read: these figures cover the most recent part of the window." : ""}
      </p>
    </>
  );
}
