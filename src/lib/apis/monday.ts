/**
 * Monday.com CRM — "Stayful Intelligence enquiries" board (18413002067).
 *
 * One enquiry per trial signup, created in the "topics" (Free Trial) group
 * when a user confirms their email. Later events update that same item,
 * matched by email address:
 *   - trial created     → name / email / mobile + "Trial started" (date_mm3cny59)
 *   - analysis run      → PDF into "Reports" (file_mm3aevrs)
 *   - subscription paid → "Sign up started" (date_mm3cp4k3)
 *   - cancellation      → "Cancel date" (date_mm3ctqag)
 *
 * Uses MONDAY_API_KEY (falls back to MONDAY_API_TOKEN). All failures are
 * logged and swallowed so CRM hiccups never break the user flow.
 */

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

const BOARD_ID = process.env.MONDAY_ENQUIRY_BOARD_ID || "18413002067";
const GROUP_ID = process.env.MONDAY_ENQUIRY_GROUP_ID || "topics";

const COL = {
  name: "text_mm3ad9y7",
  email: "text_mm3a8s7c",
  mobile: "text_mm3ah0bk",
  trialStarted: "date_mm3cny59",
  subscribed: "date_mm3cp4k3",
  cancelled: "date_mm3ctqag",
  file: "file_mm3aevrs",
} as const;

function token(): string | null {
  return process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN || null;
}

async function mondayQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  const tok = token();
  if (!tok) {
    console.log("[Monday] skipped — MONDAY_API_KEY not set");
    return null;
  }
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: tok,
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

// Monday "date" column value: { date: "YYYY-MM-DD", time: "HH:MM:SS" } in UTC.
function dateValue(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
}

/** Find an enquiry item id by its email column. Tries exact then lowercase. */
export async function findEnquiryByEmail(email: string): Promise<string | null> {
  if (!email || !email.includes("@")) return null;
  const query = `query ($boardId: ID!, $columnId: String!, $email: String!) {
    items_page_by_column_values(board_id: $boardId, columns: [{ column_id: $columnId, column_values: [$email] }], limit: 1) {
      items { id }
    }
  }`;
  const candidates = email === email.toLowerCase() ? [email] : [email, email.toLowerCase()];
  for (const e of candidates) {
    const data = await mondayQuery<{
      items_page_by_column_values: { items: Array<{ id: string }> };
    }>(query, { boardId: BOARD_ID, columnId: COL.email, email: e });
    const id = data?.items_page_by_column_values?.items?.[0]?.id;
    if (id) return id;
  }
  return null;
}

/**
 * Create a new enquiry row when a trial is created (email confirmed).
 * Lands in the "topics" (Free Trial) group with name/email/mobile + the
 * trial-start timestamp. Returns the new item id (stored on the profile).
 */
export async function createEnquiry(input: {
  name: string;
  email: string;
  mobile: string;
  trialStartedAt?: string;
}): Promise<string | null> {
  const cols: Record<string, unknown> = {
    [COL.name]: input.name || "",
    [COL.email]: input.email,
    [COL.mobile]: input.mobile || "",
  };
  // Only stamp the trial-start date when this is an actual trial signup
  // (not when we're back-filling a row to attach a report).
  if (input.trialStartedAt !== undefined) {
    cols[COL.trialStarted] = dateValue(input.trialStartedAt);
  }
  const query = `mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $cols: JSON!) {
    create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $cols) { id }
  }`;
  const data = await mondayQuery<{ create_item: { id: string } }>(query, {
    boardId: BOARD_ID,
    groupId: GROUP_ID,
    itemName: input.name?.trim() || input.email,
    cols: JSON.stringify(cols),
  });
  return data?.create_item?.id ?? null;
}

/**
 * Link a trial user to a Monday enquiry, creating the row only if one doesn't
 * already exist for that email. Dedupes so we never create a second row for the
 * same person (and so a manually-created row gets adopted). Returns the item id
 * to store on the profile, or null if Monday is unconfigured/unreachable.
 *
 * Safe to call repeatedly — this is what lets the /estimate backfill retry a
 * sync that failed during the one-shot /auth/callback hook.
 */
export async function ensureEnquiry(input: {
  name: string;
  email: string;
  mobile: string;
  trialStartedAt?: string;
}): Promise<string | null> {
  if (!input.email || !input.email.includes("@")) return null;
  const existing = await findEnquiryByEmail(input.email);
  if (existing) return existing;
  return createEnquiry(input);
}

async function setEnquiryDate(email: string, columnId: string, when?: string): Promise<void> {
  const itemId = await findEnquiryByEmail(email);
  if (!itemId) {
    console.log(`[Monday] no enquiry for ${email} — date update skipped`);
    return;
  }
  const mutation = `mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
  }`;
  await mondayQuery(mutation, {
    boardId: BOARD_ID,
    itemId,
    values: JSON.stringify({ [columnId]: dateValue(when) }),
  });
}

/** Log the date/time a user started paying ("Sign up started"). */
export const setSubscriptionStarted = (email: string, when?: string) =>
  setEnquiryDate(email, COL.subscribed, when);

/** Log the date/time a user cancelled their subscription ("Cancel date"). */
export const setSubscriptionCancelled = (email: string, when?: string) =>
  setEnquiryDate(email, COL.cancelled, when);

/**
 * Upload a PDF report to the enquiry's "Reports" file column (file_mm3aevrs),
 * matched on the email column (text_mm3a8s7c). If no enquiry exists for that
 * email yet (e.g. an account created before CRM wiring), one is created first
 * so the report always lands somewhere.
 */
export async function uploadPdfToMonday(
  input:
    | string
    | { email: string; name?: string; mobile?: string },
  pdfBuffer: Buffer | Uint8Array,
  filename: string,
): Promise<void> {
  const tok = token();
  if (!tok) return;

  const email = typeof input === "string" ? input : input.email;
  if (!email || !email.includes("@")) return;

  let itemId = await findEnquiryByEmail(email);
  if (!itemId) {
    const name = typeof input === "string" ? "" : input.name ?? "";
    const mobile = typeof input === "string" ? "" : input.mobile ?? "";
    itemId = await createEnquiry({ name, email, mobile });
    console.log(`[Monday] no enquiry for ${email} — created ${itemId ?? "FAILED"}`);
  }
  if (!itemId) {
    console.error(`[Monday] PDF skipped — could not find/create enquiry for ${email}`);
    return;
  }

  try {
    const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${COL.file}", file: $file) { id } }`;
    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
    const form = new FormData();
    form.append("query", query);
    form.append("variables[file]", blob, filename);
    const res = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: { Authorization: tok, "API-Version": MONDAY_API_VERSION },
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

/**
 * Kept for the marketing /api/track caller. The enquiries board has no
 * time-on-site column, so this is intentionally a no-op now.
 */
export async function syncTimeOnSiteToMonday(_email: string, _seconds: number): Promise<void> {
  return;
}

// ─── Management Leads board — qualification decision write-back ────────
// Separate board from the trial enquiries board above. Leads are matched on
// the plain-text "Email" column (text_mkygb5xx), and the qualification
// decision is written to three pre-existing columns.
const MGMT_BOARD_ID = process.env.MONDAY_MGMT_BOARD_ID || "5891626711";

const MGMT_COL = {
  email: "text_mkygb5xx",        // "Email" (plain text)
  longTermLet: "text_mm2dsnw7",  // "Long term let" — annual long-let rent
  strProfit: "text_mm2eawgk",    // "STR Profit" — true uplift (trueSTRNet − trueLLNet)
  recommendation: "color_mm4tkwqv", // "Recommendation" status (1=Short-Let, 2=Long-Let)
} as const;

/** Find a Management Leads item id by its email column. Tries exact then lowercase. */
async function findManagementLeadByEmail(email: string): Promise<string | null> {
  if (!email || !email.includes("@")) return null;
  const query = `query ($boardId: ID!, $columnId: String!, $email: String!) {
    items_page_by_column_values(board_id: $boardId, columns: [{ column_id: $columnId, column_values: [$email] }], limit: 1) {
      items { id }
    }
  }`;
  const candidates = email === email.toLowerCase() ? [email] : [email, email.toLowerCase()];
  for (const e of candidates) {
    const data = await mondayQuery<{
      items_page_by_column_values: { items: Array<{ id: string }> };
    }>(query, { boardId: MGMT_BOARD_ID, columnId: MGMT_COL.email, email: e });
    const id = data?.items_page_by_column_values?.items?.[0]?.id;
    if (id) return id;
  }
  return null;
}

/**
 * Write the short-let vs long-let qualification decision onto the matching
 * Management Leads row. Matched by email. No-op (logged) if no lead matches or
 * Monday is unconfigured — CRM hiccups never break the user flow.
 */
export async function syncQualificationToMonday(
  email: string,
  input: {
    longLetAnnual: number;   // longLetMonthly × 12
    strProfit: number;       // true uplift: trueSTRNet − trueLLNet
    recommendation: "SHORT_LET" | "LONG_LET";
  },
): Promise<void> {
  if (!token()) return;
  if (!email || !email.includes("@")) return;

  const itemId = await findManagementLeadByEmail(email);
  if (!itemId) {
    console.log(`[Monday] no management lead for ${email} — qualification write skipped`);
    return;
  }

  const label = input.recommendation === "SHORT_LET" ? "Short-Let" : "Long-Let";
  const values = {
    [MGMT_COL.recommendation]: { label },
    [MGMT_COL.longTermLet]: String(Math.round(input.longLetAnnual)),
    [MGMT_COL.strProfit]: String(Math.round(input.strProfit)),
  };

  const mutation = `mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) {
    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
  }`;
  await mondayQuery(mutation, {
    boardId: MGMT_BOARD_ID,
    itemId,
    values: JSON.stringify(values),
  });
  console.log(`[Monday] qualification (${label}) written for ${email} → item ${itemId}`);
}
