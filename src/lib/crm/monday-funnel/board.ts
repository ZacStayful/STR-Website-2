import 'server-only';

import { mondayRequest, type MondayResult } from '../../apis/monday-client';
import { COLUMNS, FUNNEL_BOARD_ID, GROUPS, MIN_COMPLEXITY_LEFT, READ_PAGE, REQUEST_TIMEOUT_MS, WRITE_BATCH } from './config';
import type { BoardItem } from './match';
import type { RowCreate, RowUpdate } from './plan';
import { columnValuesJson } from './values';

/**
 * The Monday funnel's reads and writes (Batch 20, Part F), through the
 * shared transport (src/lib/apis/monday-client.ts) with an 8-second bound on
 * every call. Writes go as aliased mutations, 25 rows to a request, and every
 * request reads Monday's complexity budget: when it runs low the run stops
 * and the next one carries on. Nothing here throws; a failure comes back as
 * a result for the caller to report.
 */

export function mondayToken(): string | null {
  return process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN || null;
}

type ItemNode = {
  id: string;
  name: string;
  created_at: string | null;
  group: { id: string } | null;
  column_values: { id: string; text: string | null; value: string | null }[];
};

type Complexity = { after: number; reset_in_x_seconds: number } | null;

const COLUMN_IDS = Object.values(COLUMNS);
const ITEM_FIELDS = 'id name created_at group { id } column_values(ids: $cols) { id text value }';

function toItem(n: ItemNode): BoardItem {
  const text = (id: string) => n.column_values.find((c) => c.id === id)?.text?.trim() || null;
  return { id: String(n.id), name: n.name, groupId: n.group?.id ?? '', createdAt: n.created_at ?? null, email: text(COLUMNS.email), mobile: text(COLUMNS.mobile), columns: n.column_values };
}

export type Calls = { calls: number; complexityLeft: number | null };

/** Every row on the board (all groups), 500 to a request. */
export async function readBoard(token: string, deadline: number): Promise<({ ok: true; items: BoardItem[] } | { ok: false; error: string }) & Calls> {
  const items: BoardItem[] = [];
  let calls = 0;
  let complexityLeft: number | null = null;
  let cursor: string | null = null;
  for (let first = true; first || cursor; first = false) {
    if (Date.now() > deadline) return { ok: false, error: 'out of time reading the board', calls, complexityLeft };
    const query: string = first
      ? `query ($board: [ID!], $limit: Int!, $cols: [String!]) { complexity { after reset_in_x_seconds } boards(ids: $board) { items_page(limit: $limit) { cursor items { ${ITEM_FIELDS} } } } }`
      : `query ($cursor: String!, $limit: Int!, $cols: [String!]) { complexity { after reset_in_x_seconds } next_items_page(cursor: $cursor, limit: $limit) { cursor items { ${ITEM_FIELDS} } } }`;
    type Page = { cursor: string | null; items: ItemNode[] };
    const res: MondayResult<{ complexity: Complexity; boards?: { items_page: Page }[]; next_items_page?: Page }> = await mondayRequest<{ complexity: Complexity; boards?: { items_page: Page }[]; next_items_page?: Page }>(
      token,
      query,
      first ? { board: [FUNNEL_BOARD_ID], limit: READ_PAGE, cols: COLUMN_IDS } : { cursor, limit: READ_PAGE, cols: COLUMN_IDS },
      { timeoutMs: REQUEST_TIMEOUT_MS },
    );
    calls += 1;
    if (!res.ok) return { ok: false, error: res.error, calls, complexityLeft };
    complexityLeft = res.data.complexity?.after ?? complexityLeft;
    const page: Page | undefined = first ? res.data.boards?.[0]?.items_page : res.data.next_items_page;
    if (!page) return { ok: false, error: 'Monday returned no items page (board missing?)', calls, complexityLeft };
    items.push(...page.items.map(toItem));
    cursor = page.cursor;
  }
  return { ok: true, items, calls, complexityLeft };
}

/** Just these rows (the queue's members with a stored row). */
export async function readItems(token: string, ids: readonly string[]): Promise<({ ok: true; items: BoardItem[] } | { ok: false; error: string }) & Calls> {
  const valid = ids.filter((id) => /^\d+$/.test(id));
  if (valid.length === 0) return { ok: true, items: [], calls: 0, complexityLeft: null };
  const res = await mondayRequest<{ complexity: Complexity; items: ItemNode[] }>(token, `query ($ids: [ID!], $cols: [String!]) { complexity { after reset_in_x_seconds } items(ids: $ids, limit: 100) { ${ITEM_FIELDS} } }`, { ids: valid.slice(0, 100), cols: COLUMN_IDS }, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!res.ok) return { ok: false, error: res.error, calls: 1, complexityLeft: null };
  // A deleted or archived row is not the board's any more.
  return { ok: true, items: (res.data.items ?? []).filter((n) => n.group?.id).map(toItem), calls: 1, complexityLeft: res.data.complexity?.after ?? null };
}

/** Rows by their Email Address column, as typed and lower-cased (the queue's members with no stored row). */
export async function findItemsByEmail(token: string, emails: readonly string[]): Promise<({ ok: true; items: BoardItem[] } | { ok: false; error: string }) & Calls> {
  const list = [...new Set(emails.filter((e) => e && e.includes('@')))].slice(0, 25);
  if (list.length === 0) return { ok: true, items: [], calls: 0, complexityLeft: null };
  const vars: Record<string, unknown> = { board: FUNNEL_BOARD_ID, col: COLUMNS.email, cols: COLUMN_IDS };
  const fields = list.map((e, i) => {
    vars[`e${i}`] = [...new Set([e, e.toLowerCase()])];
    return `q${i}: items_page_by_column_values(board_id: $board, columns: [{ column_id: $col, column_values: $e${i} }], limit: 5) { items { ${ITEM_FIELDS} } }`;
  });
  const decl = list.map((_, i) => `$e${i}: [String]!`).join(', ');
  const res = await mondayRequest<Record<string, { items: ItemNode[] } | Complexity>>(token, `query ($board: ID!, $col: String!, $cols: [String!], ${decl}) { complexity { after reset_in_x_seconds } ${fields.join(' ')} }`, vars, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!res.ok) return { ok: false, error: res.error, calls: 1, complexityLeft: null };
  const items = new Map<string, BoardItem>();
  for (const [key, v] of Object.entries(res.data)) {
    if (key === 'complexity' || !v || !('items' in v)) continue;
    for (const n of v.items ?? []) items.set(String(n.id), toItem(n));
  }
  return { ok: true, items: [...items.values()], calls: 1, complexityLeft: (res.data.complexity as Complexity)?.after ?? null };
}

export interface WriteOutcome extends Calls {
  updated: number;
  moved: number;
  created: { userId: string; itemId: string }[];
  /** Members whose row was written. */
  succeeded: string[];
  failed: { userId: string; itemId: string | null; error: string }[];
  /** Why the run stopped before the end: out of time, Monday's budget, Monday unreachable. */
  stopped: string | null;
}

const safeId = (id: string) => /^\d+$/.test(id);
const safeGroup = (g: string) => /^[A-Za-z0-9_]+$/.test(g);

/**
 * The updates and creates, 25 rows to a request. A request Monday refuses as
 * a whole is retried row by row, so one bad row costs only itself.
 */
export async function writePlan(token: string, updates: readonly RowUpdate[], creates: readonly RowCreate[], deadline: number): Promise<WriteOutcome> {
  const out: WriteOutcome = { updated: 0, moved: 0, created: [], succeeded: [], failed: [], stopped: null, calls: 0, complexityLeft: null };
  type Op = { kind: 'update'; u: RowUpdate } | { kind: 'create'; c: RowCreate };
  const ops: Op[] = [...updates.map((u) => ({ kind: 'update' as const, u })), ...creates.map((c) => ({ kind: 'create' as const, c }))];

  const send = async (batch: Op[]): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; retryable: boolean }> => {
    const vars: Record<string, unknown> = { board: FUNNEL_BOARD_ID };
    const decl: string[] = ['$board: ID!'];
    const fields: string[] = [];
    batch.forEach((op, i) => {
      if (op.kind === 'update') {
        const { itemId, changes, to } = op.u;
        if (Object.keys(changes).length > 0) {
          decl.push(`$v${i}: JSON!`);
          vars[`v${i}`] = JSON.stringify(columnValuesJson(changes));
          fields.push(`c${i}: change_multiple_column_values(board_id: $board, item_id: ${itemId}, column_values: $v${i}) { id }`);
        }
        if (to) fields.push(`m${i}: move_item_to_group(item_id: ${itemId}, group_id: "${GROUPS[to]}") { id }`);
      } else {
        decl.push(`$n${i}: String!`, `$v${i}: JSON!`);
        vars[`n${i}`] = op.c.name.slice(0, 255);
        vars[`v${i}`] = JSON.stringify(columnValuesJson(op.c.changes));
        fields.push(`n${i}: create_item(board_id: $board, group_id: "${GROUPS[op.c.group]}", item_name: $n${i}, column_values: $v${i}) { id }`);
      }
    });
    if (fields.length === 0) return { ok: true, data: {} };
    const res = await mondayRequest<Record<string, unknown>>(token, `mutation (${decl.join(', ')}) { ${fields.join(' ')} complexity { after reset_in_x_seconds } }`, vars, { timeoutMs: REQUEST_TIMEOUT_MS });
    out.calls += 1;
    if (!res.ok) return res;
    out.complexityLeft = (res.data.complexity as Complexity)?.after ?? out.complexityLeft;
    return { ok: true, data: res.data };
  };

  const record = (batch: Op[], data: Record<string, unknown>) => {
    batch.forEach((op, i) => {
      if (op.kind === 'update') {
        if (data[`c${i}`]) out.updated += 1;
        if (data[`m${i}`]) out.moved += 1;
        out.succeeded.push(op.u.userId);
      } else {
        const id = (data[`n${i}`] as { id?: string } | null)?.id;
        if (id) {
          out.created.push({ userId: op.c.userId, itemId: String(id) });
          out.succeeded.push(op.c.userId);
        } else out.failed.push({ userId: op.c.userId, itemId: null, error: 'Monday created no row' });
      }
    });
  };

  const isValid = (op: Op) => (op.kind === 'update' ? safeId(op.u.itemId) && (!op.u.to || safeGroup(GROUPS[op.u.to])) : safeGroup(GROUPS[op.c.group]));
  const valid = ops.filter(isValid);
  for (const op of ops.filter((x) => !isValid(x))) out.failed.push({ userId: op.kind === 'update' ? op.u.userId : op.c.userId, itemId: op.kind === 'update' ? op.u.itemId : null, error: 'not a Monday id' });
  for (let i = 0; i < valid.length; i += WRITE_BATCH) {
    if (Date.now() > deadline) {
      out.stopped = 'out of time';
      break;
    }
    if (out.complexityLeft !== null && out.complexityLeft < MIN_COMPLEXITY_LEFT) {
      out.stopped = "Monday's complexity budget is low";
      break;
    }
    const batch = valid.slice(i, i + WRITE_BATCH);
    const res = await send(batch);
    if (res.ok) {
      record(batch, res.data);
      continue;
    }
    if (res.retryable) {
      // Monday down, slow or rate limiting: stop, and the next run carries on.
      out.stopped = res.error;
      for (const op of batch) out.failed.push({ userId: op.kind === 'update' ? op.u.userId : op.c.userId, itemId: op.kind === 'update' ? op.u.itemId : null, error: res.error });
      break;
    }
    // Refused as a whole (one row Monday will not take): row by row.
    for (const op of batch) {
      if (Date.now() > deadline) {
        out.stopped = 'out of time';
        break;
      }
      const one = await send([op]);
      if (one.ok) record([op], one.data);
      else out.failed.push({ userId: op.kind === 'update' ? op.u.userId : op.c.userId, itemId: op.kind === 'update' ? op.u.itemId : null, error: one.error });
    }
    if (out.stopped) break;
  }
  return out;
}
