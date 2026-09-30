/**
 * Monday.com CRM — "Stayful Intelligence enquiries" board (18413002067).
 *
 * One enquiry per trial signup, created in "1. Free sign-up" when a user
 * confirms their email, found again by email address:
 *   - trial created     → name / email / mobile + "Signed up" (date_mm3cny59)
 *   - analysis run      → PDF into "Reports" (file_mm3aevrs)
 *
 * Everything else on the row (plan, credit, payments, activity, the funnel
 * group) is the sales-funnel sync's (Batch 20, src/lib/crm/monday-funnel),
 * which replaced the billing mirror that lived here. Every board, group and
 * column id comes from its config module.
 *
 * Uses MONDAY_API_KEY (falls back to MONDAY_API_TOKEN). All failures are
 * logged and swallowed so CRM hiccups never break the user flow.
 */

import { mondayRequest, mondayUploadFile } from "./monday-client";
import { COLUMNS, FUNNEL_BOARD_ID, GROUPS, REPORTS_COLUMN } from "../crm/monday-funnel/config";

const BOARD_ID = FUNNEL_BOARD_ID;
const GROUP_ID = GROUPS.free;

const COL = {
  name: COLUMNS.name,
  email: COLUMNS.email,
  mobile: COLUMNS.mobile,
  trialStarted: COLUMNS.signedUp,
  file: REPORTS_COLUMN,
} as const;

function token(): string | null {
  return process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN || null;
}

export async function mondayQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  const tok = token();
  if (!tok) {
    console.log("[Monday] skipped — MONDAY_API_KEY not set");
    return null;
  }
  const res = await mondayRequest<T>(tok, query, variables);
  if (!res.ok) {
    console.error(`[Monday] ${res.error}`);
    return null;
  }
  return res.data;
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

  const upload = await mondayUploadFile({
    token: tok,
    itemId,
    columnId: COL.file,
    file: pdfBuffer,
    filename,
  });
  if (!upload.ok) {
    console.error(`[Monday] PDF upload failed for ${email}: ${upload.error}`);
    return;
  }
  console.log(`[Monday] PDF uploaded for ${email} → item ${itemId}`);
}

/**
 * Kept for the marketing /api/track caller. The enquiries board has no
 * time-on-site column, so this is intentionally a no-op now.
 */
export async function syncTimeOnSiteToMonday(_email: string, _seconds: number): Promise<void> {
  return;
}
