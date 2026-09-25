/**
 * How long an unused lead is kept.
 *
 * A lead nobody has used for six months is archived, kept for seven days so
 * it can be restored, then deleted. The customer is emailed two days before
 * it is archived and again when it is. The point is that a customer never
 * ends up holding strangers' names, emails and home addresses they are not
 * using — and never loses one they are without being told first.
 *
 * "Used" is `last_activity_at` (see activity.ts for what moves it).
 *
 * Six months is counted as 182 days rather than calendar months so that the
 * date shown to the customer ("Archives on 3 Mar") and the cutoff the cron
 * queries with are exact inverses of each other. Calendar months are not:
 * 31 Aug + 6 months clamps to 28 Feb, and subtracting back gives 28 Aug.
 *
 * Pure module (no I/O) so it runs under `node --test`. The cron in
 * src/app/api/internal/lead-retention turns these cutoffs into queries.
 */

const DAY_MS = 86_400_000;

/** About six months. */
export const INACTIVE_DAYS = 182;
/** The first email goes out this long before a lead is archived. */
export const WARN_DAYS_BEFORE = 2;
/** An archived lead can be restored for this long, then it is deleted. */
export const ARCHIVE_GRACE_DAYS = 7;
/** The list starts showing "Archives on …" this close to the date. */
export const SOON_DAYS = 30;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function plusDays(value: string | Date, days: number): Date {
  return new Date(toDate(value).getTime() + days * DAY_MS);
}

/** When a lead last used at `lastActivityAt` is archived, if nothing touches it. */
export function archiveDueAt(lastActivityAt: string | Date): Date {
  return plusDays(lastActivityAt, INACTIVE_DAYS);
}

/** When a lead archived (and announced) at `noticeAt` is deleted. */
export function purgeAfter(noticeAt: string | Date): Date {
  return plusDays(noticeAt, ARCHIVE_GRACE_DAYS);
}

/**
 * Leads last used at or before this are due their warning email.
 * Inverse of `archiveDueAt(last) - WARN_DAYS_BEFORE <= now`.
 */
export function warnCutoff(now: Date): Date {
  return plusDays(now, WARN_DAYS_BEFORE - INACTIVE_DAYS);
}

/** Leads last used at or before this are due to be archived. */
export function archiveCutoff(now: Date): Date {
  return plusDays(now, -INACTIVE_DAYS);
}

/**
 * A lead may only be archived once its warning went out at least this long
 * ago. This is what makes "you will be warned first" true even when the
 * warning email failed on the night it was due: no warning, no archive, and
 * the warning is retried the next night.
 *
 * An hour short of the full two days, because the nightly run does not start
 * at the same second each night: without the slack, a run a few seconds
 * earlier than the one that sent the warning would archive a day after the
 * date the email promised.
 */
export function warnedBefore(now: Date): Date {
  return new Date(plusDays(now, -WARN_DAYS_BEFORE).getTime() + 3_600_000);
}

/** True when the lead is close enough to its archive date to say so. */
export function archivingSoon(lastActivityAt: string | Date, now: Date = new Date()): boolean {
  const due = archiveDueAt(lastActivityAt).getTime();
  return due - now.getTime() <= SOON_DAYS * DAY_MS;
}

/** "3 Mar 2026" — every retention date a customer sees is in this one format. */
export function retentionDate(value: string | Date): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}
