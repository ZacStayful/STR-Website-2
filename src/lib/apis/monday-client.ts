/**
 * Low-level Monday transport, with the token passed in rather than read from
 * the environment.
 *
 * There are now two callers with different needs, which is why this exists
 * separately from `monday.ts`:
 *
 *   Our own enquiry board (`monday.ts`) is a fire-and-forget mirror. A CRM
 *   hiccup there must never break a signup, so it logs and swallows.
 *
 *   A customer's board (`lib/crm/providers/monday.ts`) is the product. When
 *   their token is wrong or their board id does not exist, they have to be
 *   TOLD, in their own words, on the settings page — swallowing it would
 *   leave them staring at an integration that silently does nothing.
 *
 * So this returns a discriminated result and never logs on the caller's
 * behalf. `monday.ts` adapts it back to its null-returning shape, which is
 * what keeps its nine internal call sites unchanged.
 */

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_FILE_URL = 'https://api.monday.com/v2/file';
export const MONDAY_API_VERSION = '2024-10';

/** Bound on every call: a customer's misconfiguration must not hang a cron. */
const TIMEOUT_MS = 15_000;

export type MondayResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; retryable: boolean };

/**
 * Whether another attempt could plausibly succeed. This is the field the
 * delivery queue acts on, so it is worth being exact: a 429 or a 5xx is
 * transient, a 401 or a board that does not exist will fail identically
 * for ever, and retrying it only burns attempts and hides the real error
 * from the customer.
 */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function mondayRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<MondayResult<T>> {
  if (!token) return { ok: false, error: 'No Monday API token.', retryable: false };
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        'API-Version': MONDAY_API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: describeHttp(res.status, body),
        retryable: retryableStatus(res.status),
      };
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (json.errors?.length) {
      // GraphQL errors arrive with HTTP 200. They are the customer's
      // configuration nearly every time — a column that no longer exists, a
      // board they lost access to — so they do not retry.
      const message = json.errors.map((e) => e?.message).filter(Boolean).join('; ');
      return { ok: false, error: message || 'Monday rejected the request.', retryable: false };
    }
    if (json.data === undefined || json.data === null) {
      return { ok: false, error: 'Monday returned no data.', retryable: true };
    }
    return { ok: true, data: json.data };
  } catch (err) {
    // A timeout or a dropped connection says nothing about the request, so
    // it is always worth another go.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach Monday: ${message}`, retryable: true };
  }
}

function describeHttp(status: number, body: string): string {
  if (status === 401 || status === 403) return 'Monday refused the API token. Check it has not been revoked.';
  if (status === 404) return 'Monday could not find that board.';
  if (status === 429) return 'Monday is rate limiting us. This will be retried.';
  if (status >= 500) return `Monday is having trouble (HTTP ${status}). This will be retried.`;
  const detail = body.slice(0, 200).trim();
  return detail ? `Monday returned HTTP ${status}: ${detail}` : `Monday returned HTTP ${status}.`;
}

/**
 * Uploads a file into an item's file column. Monday's file endpoint is a
 * multipart form with the query in a field rather than the JSON body, which
 * is why it cannot go through `mondayRequest`.
 *
 * The item id and column id are interpolated into the query string because
 * Monday's file endpoint does not accept variables for them. Both come from
 * our own database — an id we created and a column id read off the
 * customer's board — but they are still checked here rather than trusted,
 * since a value that reaches a query by string concatenation is exactly the
 * kind that stops being safe when a future caller passes something else.
 */
export async function mondayUploadFile(input: {
  token: string;
  itemId: string;
  columnId: string;
  file: Uint8Array;
  filename: string;
  contentType?: string;
}): Promise<MondayResult<{ id: string }>> {
  if (!input.token) return { ok: false, error: 'No Monday API token.', retryable: false };
  if (!/^\d+$/.test(input.itemId)) {
    return { ok: false, error: 'Monday item id is not a number.', retryable: false };
  }
  if (!/^[A-Za-z0-9_]+$/.test(input.columnId)) {
    return { ok: false, error: 'Monday column id has unexpected characters.', retryable: false };
  }
  try {
    const query = `mutation ($file: File!) { add_file_to_column(item_id: ${input.itemId}, column_id: "${input.columnId}", file: $file) { id } }`;
    const blob = new Blob([new Uint8Array(input.file)], { type: input.contentType ?? 'application/pdf' });
    const form = new FormData();
    form.append('query', query);
    form.append('variables[file]', blob, input.filename);
    const res = await fetch(MONDAY_FILE_URL, {
      method: 'POST',
      headers: { Authorization: input.token, 'API-Version': MONDAY_API_VERSION },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: describeHttp(res.status, body), retryable: retryableStatus(res.status) };
    }
    const json = (await res.json()) as {
      data?: { add_file_to_column?: { id: string } };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      const message = json.errors.map((e) => e?.message).filter(Boolean).join('; ');
      return { ok: false, error: message || 'Monday rejected the upload.', retryable: false };
    }
    const id = json.data?.add_file_to_column?.id;
    return id ? { ok: true, data: { id } } : { ok: false, error: 'Monday accepted the upload but returned no id.', retryable: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach Monday: ${message}`, retryable: true };
  }
}
