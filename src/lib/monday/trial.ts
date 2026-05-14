// ─── Monday CRM integration (Stayful Intelligence enquiries) ─────────
// Writes signups, email-verification state, lifecycle status and analysis
// PDFs to the dedicated enquiries board
// (https://stayful.monday.com/boards/18413002067) so the team can manage
// trial users in one place. Defaults are hardcoded; production works as
// soon as MONDAY_API_KEY is set on Vercel.
//
// All helpers swallow errors and log to console — Monday outages must not
// break signup or analysis flows.

const MONDAY_ENDPOINT = "https://api.monday.com/v2";
const MONDAY_FILE_ENDPOINT = "https://api.monday.com/v2/file";
const MONDAY_API_VERSION = "2024-01";

const DEFAULTS = {
  boardId: "18413002067",
  cols: {
    name: "text_mm3ad9y7",            // Name (text)
    email: "text_mm3a8s7c",           // Email Address (text)
    mobile: "text_mm3ah0bk",          // Mobile Number (text)
    emailVerified: "boolean_mm3a1wy9",// Email Verified (checkbox)
    status: "color_mm3a4gp9",         // Status
    siteVisits: "text_mm3aapza",      // Site Visits (text — free-form notes)
    files: "file_mm3aevrs",           // Files (PDFs land here)
  },
  groups: {
    freeTrial: "topics",
    trialExpired: "group_mm3a1jys",
    customer: "group_mm3ak8fg",
    oldCustomer: "group_mm3app6t",
  },
} as const;

export const TRIAL_STATUS = {
  trial: "Free Trial",
  expired: "Free Trial Expired",
  customer: "Customer",
  churned: "Old Customer",
} as const;
export type TrialStatusLabel = (typeof TRIAL_STATUS)[keyof typeof TRIAL_STATUS];

type MondayConfig = {
  apiKey: string;
  boardId: typeof DEFAULTS.boardId;
  cols: typeof DEFAULTS.cols;
  groups: typeof DEFAULTS.groups;
};

function readConfig(): MondayConfig | null {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) return null;
  const boardId = process.env.MONDAY_TRIAL_BOARD_ID || DEFAULTS.boardId;
  return {
    apiKey,
    boardId: boardId as typeof DEFAULTS.boardId,
    cols: DEFAULTS.cols,
    groups: DEFAULTS.groups,
  };
}

async function mondayMutate(
  cfg: MondayConfig,
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
 * Create a row on the enquiries board when a verified user signs up.
 * Returns the new item's ID so the caller can persist it to profile.monday_item_id.
 * signupAt / trialEndsAt are accepted for backwards compatibility but the new
 * board doesn't have those columns yet, so they're ignored.
 */
export async function createTrialSignup(input: {
  email: string;
  fullName: string;
  mobile: string;
  signupAt: string;     // ignored — column not on board
  trialEndsAt: string;  // ignored — column not on board
}): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) return null;

  const columnValues: Record<string, unknown> = {
    [cfg.cols.name]: input.fullName,
    [cfg.cols.email]: input.email,
    [cfg.cols.mobile]: input.mobile,
    [cfg.cols.emailVerified]: { checked: "false" },
    [cfg.cols.status]: { label: TRIAL_STATUS.trial },
  };

  const query = `mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $cols: JSON!) {
    create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $cols) {
      id
    }
  }`;

  try {
    const data = (await mondayMutate(cfg, query, {
      boardId: cfg.boardId,
      groupId: cfg.groups.freeTrial,
      itemName: input.fullName || input.email,
      cols: JSON.stringify(columnValues),
    })) as { create_item?: { id?: string } } | undefined;
    return data?.create_item?.id ?? null;
  } catch (err) {
    console.error("[monday/trial] createTrialSignup failed:", err);
    return null;
  }
}

/** Flip the Email Verified checkbox to true after auth/callback succeeds. */
export async function markEmailVerified(itemId: string): Promise<void> {
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
      columnId: cfg.cols.emailVerified,
      value: JSON.stringify({ checked: "true" }),
    });
  } catch (err) {
    console.error("[monday/trial] markEmailVerified failed:", err);
  }
}

/** Move a row through the trial lifecycle. */
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

// Board 18413002067 doesn't yet have numeric reports-run or date last-seen
// columns. These no-ops keep the existing /api/analyse and /estimate/layout
// call sites compiling and running cleanly. If you add those columns later,
// wire them through here.
export async function updateReportsRun(_itemId: string, _total: number): Promise<void> {
  // intentionally empty
}
export async function pingLastSeen(_itemId: string, _isoTimestamp: string): Promise<void> {
  // intentionally empty
}

/**
 * Upload a PDF (or any binary) to the Files column on the user's enquiry row.
 * Uses Monday's multipart file-upload endpoint.
 */
export async function attachAnalysisPDF(
  itemId: string,
  pdfBuffer: Uint8Array | Buffer,
  filename: string,
): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;

  const formData = new FormData();
  formData.append(
    "query",
    `mutation ($file: File!, $itemId: ID!, $columnId: String!) {
      add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) {
        id
      }
    }`,
  );
  formData.append(
    "variables",
    JSON.stringify({ itemId, columnId: cfg.cols.files }),
  );
  formData.append("map", JSON.stringify({ "0": ["variables.file"] }));
  formData.append(
    "0",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    filename,
  );

  try {
    const res = await fetch(MONDAY_FILE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: cfg.apiKey },
      body: formData,
    });
    const json = await res.json();
    if (json?.errors) {
      throw new Error(
        `Monday file upload error: ${JSON.stringify(json.errors).slice(0, 300)}`,
      );
    }
  } catch (err) {
    console.error("[monday/trial] attachAnalysisPDF failed:", err);
  }
}
