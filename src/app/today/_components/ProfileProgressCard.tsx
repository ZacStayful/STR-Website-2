import { getBillingSettings } from "@/lib/credit/unit-costs";
import { profileSummaryFor, reminderDue } from "@/lib/profile/server";
import { minutesLeftLabel } from "@/lib/profile/state";
import { logActivity } from "@/lib/activity/log";
import { todayKey } from "@/lib/today/day";
import { collapseProfileReminderAction, tapProfileReminderAction } from "../profile-actions";

/**
 * The profile reminder on Today (Batch 12): the bar, "£5 when you finish"
 * and the way back into the quiz. It never stops until the profile is
 * complete; "Hide for today" folds it away for this Today-day only. Not
 * shown to team members, who are never asked. The read is AppShell's own
 * (cached per request), so the card costs nothing extra.
 */
export async function ProfileProgressCard({ userId, now }: { userId: string; now: Date }) {
  const summary = await profileSummaryFor(userId);
  if (!reminderDue(summary, now) || !summary) return null;
  const settings = await getBillingSettings();
  const pence = summary.quiz.creditGrantId || summary.quiz.creditSkippedReason ? 0 : settings.profileCompletePence;
  logActivity(userId, "profile_reminder_shown", { dedupeKey: `profile_reminder_shown:${todayKey(now)}` });
  const { percent, minutesLeft } = summary.progress;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby="profile-reminder">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="profile-reminder" className="text-sm font-semibold text-foreground">
            Your profile is {percent}% done
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {minutesLeftLabel(minutesLeft)} · better deals{pence > 0 ? ` and £${(pence / 100).toFixed(0)} of credit when you finish` : ""}.
          </p>
        </div>
        <form action={collapseProfileReminderAction}>
          <button type="submit" className="text-xs text-muted-foreground underline-offset-4 hover:underline" title="Hide until tomorrow">
            Hide for today
          </button>
        </form>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile progress">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <form action={tapProfileReminderAction} className="mt-3">
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Continue your profile
        </button>
      </form>
    </section>
  );
}
