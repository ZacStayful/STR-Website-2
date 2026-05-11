// ─── Monday "Trial signups" CRM integration ───────────────────────
// Three events go to the dedicated Monday board so the team can see who
// signed up, which trial users are running reports, and who's still
// active in the trial window.
//
// Defaults wire straight to the production board
// (https://stayful.monday.com/boards/18412564741) so production works
// as soon as MONDAY_API_KEY is set. Env vars below override the
// defaults if you ever need to point at a different board or column.
//
//   MONDAY_API_KEY              — required; same key /api/track uses
//   MONDAY_TRIAL_BOARD_ID       — overrides board ID (default 18412564741)
//   MONDAY_TRIAL_COL_EMAIL      — overrides "Email" column ID
//   MONDAY_TRIAL_COL_MOBILE     — overrides "Mobile" column ID
//   MONDAY_TRIAL_COL_SIGNUP_AT  — overrides "Signup date" column ID
//   MONDAY_TRIAL_COL_TRIAL_ENDS_AT — overrides "Trial expiry date" column ID
//   MONDAY_TRIAL_COL_REPORTS_RUN   — overrides "Reports ran" column ID
//   MONDAY_TRIAL_COL_LAST_SEEN_AT  — overrides "Last seen at" column ID
//   MONDAY_TRIAL_COL_STATUS        — overrides "Status" column ID
//
// All helpers swallow errors and log to console — Monday outages
// must never break signup or analysis flows.

const MONDAY_ENDPOINT = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-01";

// Defaults for the stayful.monday.com board.
const DEFAULTS = {
  boardId: "18412564741",
  cols: {
    email: "text_mm388kk1",
    mobile: "text_mm386qhd",
    signupAt: "text_mm387dg4",      // Monday "text" type — written as YYYY-MM-DD string
    trialEndsAt: "text_mm38vn3y",   // Monday "text" type — written as YYYY-MM-DD string
    reportsRun: "numeric_mm38pc2",
    lastSeenAt: "date4",            // Monday "date" type — written as { date: 'YYYY-MM-DD' }
    status: "status",               // Monday "status" type — labels: "Free trial" / "Free trial ended" / "Customer" / "Customer left"
  },
} as const;

// Status labels as configured on the board.
export const TRIAL_STATUS = {
  trial: "Free trial",
  expired: "Free trial ended",
  customer: "Customer",
  churned: "Customer left",
} as const;
export type TrialStatusLabel = (typeof TRIAL_STATUS)[keyof typeof TRIAL_STATUS];

function envOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function readConfig() {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    boardId: envOrDefault("MONDAY_TRIAL_BOARD_ID", DEFAULTS.boardId),
    cols: {
      email: envOrDefault("MONDAY_TRIAL_COL_EMAIL", DEFAULTS.cols.email),
      mobile: envOrDefault("MONDAY_TRIAL_COL_MOBILE", DEFAULTS.cols.mobile),
      signupAt: envOrDefault("MONDAY_TRIAL_COL_SIGNUP_AT", DEFAULTS.cols.signupAt),
      trialEndsAt: envOrDefault(
        "MONDAY_TRIAL_COL_TRIAL_ENDS_AT",
        DEFAULTS.cols.trialEndsAt,
      ),
      reportsRun: envOrDefault(
        "MONDAY_TRIAL_COL_REPORTS_RUN",
        DEFAULTS.cols.reportsRun,
      ),
      lastSeenAt: envOrDefault(
        "MONDAY_TRIAL_COL_LAST_SEEN_AT",
        DEFAULTS.cols.lastSeenAt,
      ),
      status: envOrDefault("MONDAY_TRIAL_COL_STATUS", DEFAULTS.cols.status),
    },
  };
}

function toDateString(iso: string): string {
  // Monday wants YYYY-MM-DD for both Text and Date columns.
  return iso.slice(0, 10);
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
 * Create a row on the Trial signups board when a verified user signs
 * up. The user's full name becomes the item name; email / mobile /
 * dates / status fill out the rest. Returns the Monday item ID so the
 * caller can persist it to the profile row.
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

  const columnValues: Record<string, unknown> = {
    [cfg.cols.email]: input.email,
    [cfg.cols.mobile]: input.mobile,
    [cfg.cols.signupAt]: toDateString(input.signupAt),
    [cfg.cols.trialEndsAt]: toDateString(input.trialEndsAt),
    [cfg.cols.status]: { label: TRIAL_STATUS.trial },
  };

  const query = `mutation ($boardId: ID!, $itemName: String!, $cols: JSON!) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $cols) {
      id
    }
  }`;

  try {
    const data = (await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      itemName: input.fullName || input.email,
      cols: JSON.stringify(columnValues),
    })) as { create_item?: { id?: string } } | undefined;
    return data?.create_item?.id ?? null;
  } catch (err) {
    console.error("[monday/trial] createTrialSignup failed:", err);
    return null;
  }
}

/**
 * Mirror the latest reports_run count to Monday. We maintain the
 * authoritative count in profiles.reports_run; this just reflects it.
 */
export async function updateReportsRun(
  itemId: string,
  total: number,
): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;
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
      value: JSON.stringify(String(total)),
    });
  } catch (err) {
    console.error("[monday/trial] updateReportsRun failed:", err);
  }
}

/**
 * Update the row's last-seen-at date when the user lands on /estimate.
 */
export async function pingLastSeen(
  itemId: string,
  isoTimestamp: string,
): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;
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
      value: JSON.stringify({ date: toDateString(isoTimestamp) }),
    });
  } catch (err) {
    console.error("[monday/trial] pingLastSeen failed:", err);
  }
}

/**
 * Move a row through the trial lifecycle. Call when a user converts
 * (TRIAL_STATUS.customer), when a trial expires without converting
 * (TRIAL_STATUS.expired), or when a customer churns (TRIAL_STATUS.churned).
 */
export async function updateStatus(
  itemId: string,
  status: TrialStatusLabel,
): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;
  const query = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
      id
    }
  }`;
  try {
    await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      itemId,
      columnId: cfg.cols.status,
      value: JSON.stringify({ label: status }),
    });
  } catch (err) {
    console.error("[monday/trial] updateStatus failed:", err);
  }
}
