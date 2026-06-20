/**
 * Monday.com CRM integration — Management Leads board.
 *
 * Finds a lead in Monday.com by email (case-insensitive) and writes the
 * computed long-term let net annual and short-term let net annual figures
 * to the board columns.
 *
 * Required env vars (all must be set for sync to run):
 *   MONDAY_API_TOKEN              — personal API token (keep secret)
 *   MONDAY_BOARD_ID               — "Management Leads" board id
 *   MONDAY_EMAIL_COLUMN_ID        — column id holding lead emails
 *   MONDAY_LONG_TERM_LET_COLUMN_ID
 *   MONDAY_DEAL_ANALYSER_COLUMN_ID
 *
 * Behaviour: silent — all errors log server-side and are swallowed so the
 * caller (the analyse endpoint) never leaks CRM failures to the user.
 */

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

// Management Leads board + its column IDs, hardcoded as defaults so the
// integration works with only MONDAY_API_TOKEN set. Env vars still override
// each value if you ever need to point at a different board or columns.
const DEFAULTS = {
  boardId: "5891626711",
  emailColumnId: "text_mkygb5xx",
  longTermColumnId: "text_mm2dsnw7",
  dealAnalyserColumnId: "text_mm2dkavd",
  fileColumnId: "files__1",
  timeOnSiteColumnId: "text_mm1ysvmg",
};

function envConfig() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return null;
  return {
    token,
    boardId: process.env.MONDAY_BOARD_ID || DEFAULTS.boardId,
    emailColumnId: process.env.MONDAY_EMAIL_COLUMN_ID || DEFAULTS.emailColumnId,
    longTermColumnId: process.env.MONDAY_LONG_TERM_LET_COLUMN_ID || DEFAULTS.longTermColumnId,
    dealAnalyserColumnId: process.env.MONDAY_DEAL_ANALYSER_COLUMN_ID || DEFAULTS.dealAnalyserColumnId,
  };
}

async function mondayQuery<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      console.error(`[Monday] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      console.error("[Monday] GraphQL errors:", JSON.stringify(json.errors));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[Monday] Network/parse error:", err);
    return null;
  }
}

/**
 * Finds the first item in the Management Leads board with a matching email.
 * Returns the item id or null.
 */
async function findItemIdByEmail(
  token: string,
  boardId: string,
  emailColumnId: string,
  email: string,
): Promise<string | null> {
  const query = `
    query ($boardId: ID!, $columnId: String!, $email: String!) {
      items_page_by_column_values(
        board_id: $boardId,
        columns: [{ column_id: $columnId, column_values: [$email] }],
        limit: 1
      ) {
        items { id }
      }
    }
  `;
  const data = await mondayQuery<{
    items_page_by_column_values: { items: Array<{ id: string }> };
  }>(token, query, {
    boardId,
    columnId: emailColumnId,
    email,
  });
  const item = data?.items_page_by_column_values?.items?.[0];
  if (item?.id) return item.id;

  // Fallback: try lowercase if original didn't match (handles case mismatches)
  const lower = email.toLowerCase();
  if (lower !== email) {
    const fallback = await mondayQuery<{
      items_page_by_column_values: { items: Array<{ id: string }> };
    }>(token, query, {
      boardId,
      columnId: emailColumnId,
      email: lower,
    });
    return fallback?.items_page_by_column_values?.items?.[0]?.id ?? null;
  }

  return null;
}

/**
 * Updates the two money-tracking columns on a given item.
 */
async function updateItemColumns(
  token: string,
  boardId: string,
  itemId: string,
  columnValues: Record<string, string | number>,
): Promise<boolean> {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $values
      ) {
        id
      }
    }
  `;
  const valuesJson = JSON.stringify(columnValues);
  const data = await mondayQuery<{ change_multiple_column_values: { id: string } }>(
    token,
    mutation,
    { boardId, itemId, values: valuesJson },
  );
  return Boolean(data?.change_multiple_column_values?.id);
}

/**
 * Fire-and-forget sync: find Monday item by email, then write the two figures.
 * Fails silently (logs only). Safe to call from within an SSE stream handler
 * without awaiting — though awaiting is fine too since errors are swallowed.
 */
export async function syncAnalysisToMonday(
  email: string,
  longTermLetNetAnnual: number,
  stayfulNetRevenue: number,
): Promise<void> {
  const cfg = envConfig();
  if (!cfg) {
    console.log("[Monday] Sync skipped — env vars not configured");
    return;
  }
  if (!email || !email.includes("@")) {
    console.log("[Monday] Sync skipped — invalid email");
    return;
  }

  const itemId = await findItemIdByEmail(cfg.token, cfg.boardId, cfg.emailColumnId, email);
  if (!itemId) {
    console.log(`[Monday] No lead found for email (sync skipped): ${email}`);
    return;
  }

  // Text columns require string values in Monday's API
  const columnValues: Record<string, string> = {
    [cfg.longTermColumnId]: String(Math.round(longTermLetNetAnnual)),
    [cfg.dealAnalyserColumnId]: String(Math.round(stayfulNetRevenue)),
  };

  const ok = await updateItemColumns(cfg.token, cfg.boardId, itemId, columnValues);
  if (ok) {
    console.log(`[Monday] Synced analysis for ${email} → item ${itemId}`);
  } else {
    console.error(`[Monday] Column update failed for ${email} (item ${itemId})`);
  }
}

/**
 * Uploads a PDF buffer to a Monday file column on the matched item.
 * Uses Monday's multipart file upload endpoint.
 */
export async function uploadPdfToMonday(
  email: string,
  pdfBuffer: Buffer | Uint8Array,
  filename: string,
): Promise<void> {
  const cfg = envConfig();
  if (!cfg) return;
  if (!email || !email.includes("@")) return;

  const itemId = await findItemIdByEmail(cfg.token, cfg.boardId, cfg.emailColumnId, email);
  if (!itemId) {
    console.log(`[Monday] PDF upload skipped — no lead for: ${email}`);
    return;
  }

  const fileColumnId = process.env.MONDAY_FILE_COLUMN_ID || DEFAULTS.fileColumnId;

  try {
    const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${fileColumnId}", file: $file) { id } }`;

    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
    const form = new FormData();
    form.append("query", query);
    form.append("variables[file]", blob, filename);

    const res = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: {
        Authorization: cfg.token,
        "API-Version": MONDAY_API_VERSION,
      },
      body: form,
    });

    if (!res.ok) {
      console.error(`[Monday] PDF upload HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`[Monday] PDF uploaded for ${email} → item ${itemId}`);
  } catch (err) {
    console.error("[Monday] PDF upload error:", err);
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Pushes session duration to a text column in Monday.
 */
export async function syncTimeOnSiteToMonday(
  email: string,
  seconds: number,
): Promise<void> {
  const cfg = envConfig();
  if (!cfg) return;
  if (!email || !email.includes("@") || seconds <= 0) return;

  const itemId = await findItemIdByEmail(cfg.token, cfg.boardId, cfg.emailColumnId, email);
  if (!itemId) {
    console.log(`[Monday] Time sync skipped — no lead for: ${email}`);
    return;
  }

  const timeColumnId = process.env.MONDAY_TIME_ON_SITE_COLUMN_ID || DEFAULTS.timeOnSiteColumnId;
  const formatted = formatDuration(Math.round(seconds));

  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
    }
  `;
  const valuesJson = JSON.stringify({ [timeColumnId]: formatted });
  const data = await mondayQuery<{ change_multiple_column_values: { id: string } }>(
    cfg.token,
    mutation,
    { boardId: cfg.boardId, itemId, values: valuesJson },
  );
  if (data?.change_multiple_column_values?.id) {
    console.log(`[Monday] Time synced for ${email}: ${formatted}`);
  } else {
    console.error(`[Monday] Time update failed for ${email}`);
  }
}
