/**
 * The demand-led searches' structural numbers, in one place. The business
 * numbers (threshold, monthly cap, paying weight, radius, active days, areas
 * per profile) are billing_settings rows, read and bounded in settings.ts.
 */

/** A pass stops starting new searches after this long; the route is capped at 60 s. */
export const PASS_BUDGET_MS = 44_000;
/** How long a pass waits for the area cards before giving up until the next one. */
export const SNAPSHOT_WAIT_MS = 20_000;
/** The most searches one pass starts (the job runs 12 passes a morning). */
export const MAX_SEARCHES_PER_PASS = 8;
/** Stop the pass after this many searches in a row get no answer: the portal may be refusing us. */
export const MAX_FAILURES_IN_A_ROW = 2;
/** An area × kind with no answer this many times today waits until tomorrow, so it cannot hold up every pass (the sweep's MAX_EMPTY_PER_DAY). */
export const MAX_NO_ANSWER_PER_DAY = 2;
/** A claim still open after this long belonged to a pass that died: closed at its reserve. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;
/** "New in the last 7 days" on the admin page. */
export const NEW_DEALS_WINDOW_DAYS = 7;
/** Searches listed on the admin page. */
export const LAST_SEARCHES_SHOWN = 50;
/** The log and ledger label for this job's provider calls. */
export const DEMAND_ACTION = 'cron:demand-sourcing';
