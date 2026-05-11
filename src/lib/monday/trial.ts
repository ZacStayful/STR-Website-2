// ─── Monday "Trial signups" CRM integration ───────────────────────
// Three events go to a dedicated Monday board so the team can see who
// signed up, which trial users are running reports, and who's still
// active in the trial window.
//
// Required env vars (all must be set; otherwise these helpers no-op):
//   MONDAY_API_KEY              — same key the existing /api/track uses
//   MONDAY_TRIAL_BOARD_ID       — numeric ID of the new "Trial signups"
//                                 board (e.g. "1234567890")
//   MONDAY_TRIAL_COL_EMAIL      — text column ID for email
//   MONDAY_TRIAL_COL_NAME       — text column ID for full name
//   MONDAY_TRIAL_COL_MOBILE     — text column ID for mobile
//   MONDAY_TRIAL_COL_SIGNUP_AT  — date column ID for signup timestamp
//   MONDAY_TRIAL_COL_TRIAL_ENDS_AT  — date column ID for trial end
//   MONDAY_TRIAL_COL_REPORTS_RUN    — numbers column ID
//   MONDAY_TRIAL_COL_LAST_SEEN_AT   — date column ID
//   MONDAY_TRIAL_COL_PLAN       — status column ID
//
// The helpers swallow errors and log to console — Monday outages must
// not break signup or analysis flows.

const MONDAY_ENDPOINT = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-01";

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

function readConfig() {
  const apiKey = env("MONDAY_API_KEY");
  const boardId = env("MONDAY_TRIAL_BOARD_ID");
  if (!apiKey || !boardId) return null;
  return {
    apiKey,
    boardId,
    cols: {
      email: env("MONDAY_TRIAL_COL_EMAIL"),
      name: env("MONDAY_TRIAL_COL_NAME"),
      mobile: env("MONDAY_TRIAL_COL_MOBILE"),
      signupAt: env("MONDAY_TRIAL_COL_SIGNUP_AT"),
      trialEndsAt: env("MONDAY_TRIAL_COL_TRIAL_ENDS_AT"),
      reportsRun: env("MONDAY_TRIAL_COL_REPORTS_RUN"),
      lastSeenAt: env("MONDAY_TRIAL_COL_LAST_SEEN_AT"),
      plan: env("MONDAY_TRIAL_COL_PLAN"),
    },
  };
}

function dateColumn(iso: string) {
  // Monday's date column wants { date: 'YYYY-MM-DD' }
  return { date: iso.slice(0, 10) };
}

async function mondayMutate(
  cfg: NonNullable<ReturnType<typeof readConfig>>,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(MONDAY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: cfg.apiKey,
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json?.errors) {
    throw new Error(
      `Monday API error: ${JSON.stringify(json.errors).slice(0, 300)}`,
    );
  }
  return json?.data;
}

/**
 * Create a row on the Trial signups board when a new user signs up.
 * Returns the Monday item ID so the caller can persist it to the
 * profile row — that lets future events update the right row.
 */
export async function createTrialSignup(input: {
  email: string;
  fullName: string;
  mobile: string;
  signupAt: string; // ISO timestamp
  trialEndsAt: string; // ISO timestamp
}): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) return null;

  const columnValues: Record<string, unknown> = {};
  if (cfg.cols.email) columnValues[cfg.cols.email] = input.email;
  if (cfg.cols.name) columnValues[cfg.cols.name] = input.fullName;
  if (cfg.cols.mobile) columnValues[cfg.cols.mobile] = input.mobile;
  if (cfg.cols.signupAt)
    columnValues[cfg.cols.signupAt] = dateColumn(input.signupAt);
  if (cfg.cols.trialEndsAt)
    columnValues[cfg.cols.trialEndsAt] = dateColumn(input.trialEndsAt);
  if (cfg.cols.plan) columnValues[cfg.cols.plan] = { label: "Free" };

  const query = `mutation ($boardId: ID!, $itemName: String!, $cols: JSON!) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $cols) {
      id
    }
  }`;

  try {
    const data = (await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      itemName: input.email,
      cols: JSON.stringify(columnValues),
    })) as { create_item?: { id?: string } } | undefined;
    return data?.create_item?.id ?? null;
  } catch (err) {
    console.error("[monday/trial] createTrialSignup failed:", err);
    return null;
  }
}

/**
 * Update an existing trial-signup row with the latest reports_run
 * count (we maintain the authoritative count in profiles.reports_run
 * and mirror it here). No-op if itemId or the env var is missing.
 */
export async function updateReportsRun(itemId: string, total: number): Promise<void> {
  const cfg = readConfig();
  if (!cfg || !cfg.cols.reportsRun) return;
  const query = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
      id
    }
  }`;
  try {
    await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      itemId,
      columnId: cfg.cols.reportsRun,
      value: JSON.stringify(total),
    });
  } catch (err) {
    console.error("[monday/trial] updateReportsRun failed:", err);
  }
}

/**
 * Update the row's last-seen-at date when the user lands on /estimate.
 * No-op if itemId or the env var is missing.
 */
export async function pingLastSeen(itemId: string, isoTimestamp: string): Promise<void> {
  const cfg = readConfig();
  if (!cfg || !cfg.cols.lastSeenAt) return;
  const query = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
      id
    }
  }`;
  try {
    await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      itemId,
      columnId: cfg.cols.lastSeenAt,
      value: JSON.stringify(dateColumn(isoTimestamp)),
    });
  } catch (err) {
    console.error("[monday/trial] pingLastSeen failed:", err);
  }
}

/**
 * Update the plan column when a user converts from Free → Pro (will
 * be called from the Stripe webhook once that's wired). No-op until
 * Monday config is in place.
 */
export async function updatePlan(itemId: string, plan: "Free" | "Pro"): Promise<void> {
  const cfg = readConfig();
  if (!cfg || !cfg.cols.plan) return;
  const query = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
      id
    }
  }`;
  try {
    await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      itemId,
      columnId: cfg.cols.plan,
      value: JSON.stringify({ label: plan }),
    });
  } catch (err) {
    console.error("[monday/trial] updatePlan failed:", err);
  }
}
