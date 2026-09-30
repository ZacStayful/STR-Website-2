import 'server-only';

import { mondayRequest, mondayRequestRaw, type MondayResult } from '../../apis/monday-client';
import { COLUMNS, FUNNEL_BOARD_ID, GROUPS, MIN_COMPLEXITY_LEFT, READ_PAGE, REQUEST_TIMEOUT_MS, WRITE_BATCH } from './config';
import type { BoardItem } from './match';
import type { RowCreate, RowUpdate } from './plan';
import { updateRequest } from './mutations';
import { readReply, type Reply } from './responses';
import { columnValuesJson } from './values';

/**
 * The Monday funnel's reads and writes (Batch 20, Part F), through the
 * shared transport (src/lib/apis/monday-client.ts) with an 8-second bound on
 * every call. Updates go as aliased mutations, 25 rows to a request; creates
 * one to a request, and never twice in a run (./responses.ts reads what
 * Monday did, partial results included). Every request reads Monday's
 * complexity budget: when it runs low, or Monday is limiting us or down, the
 * run stops and the next one carries on. Nothing here throws; a failure
 * comes back as a result for the caller to report.
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

/** Just these rows (the queue's members with a stored row): only live rows on this board. */
export async function readItems(token: string, ids: readonly string[]): Promise<({ ok: true; items: BoardItem[] } | { ok: false; error: string }) & Calls> {
  const valid = ids.filter((id) => /^\d+$/.test(id));
  if (valid.length === 0) return { ok: true, items: [], calls: 0, complexityLeft: null };
  type Stored = ItemNode & { state?: string | null; board?: { id: string } | null };
  const res = await mondayRequest<{ complexity: Complexity; items: Stored[] }>(token, `query ($ids: [ID!], $cols: [String!]) { complexity { after reset_in_x_seconds } items(ids: $ids, limit: 100) { state board { id } ${ITEM_FIELDS} } }`, { ids: valid.slice(0, 100), cols: COLUMN_IDS }, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!res.ok) return { ok: false, error: res.error, calls: 1, complexityLeft: null };
  // A deleted or archived row, or one on another board, is not the member's row here: they are looked up by email instead.
  const live = (res.data.items ?? []).filter((n) => n.group?.id && String(n.board?.id ?? '') === FUNNEL_BOARD_ID && (n.state ?? 'active') === 'active');
  return { ok: true, items: live.map(toItem), calls: 1, complexityLeft: res.data.complexity?.after ?? null };
}

/** How many emails one lookup request asks about. */
const EMAILS_PER_REQUEST = 25;

/**
 * Rows by their Email Address column (the queue's members with no stored
 * row). Monday's match on it ignores case (checked on this board), so the
 * address as typed finds a row typed in capitals; lower-cased as well, all
 * the same. 25 addresses to a request, as many requests as it takes.
 */
export async function findItemsByEmail(token: string, emails: readonly string[]): Promise<({ ok: true; items: BoardItem[] } | { ok: false; error: string }) & Calls> {
  const list = [...new Set(emails.filter((e) => e && e.includes('@')))];
  const items = new Map<string, BoardItem>();
  let calls = 0;
  let complexityLeft: number | null = null;
  for (let at = 0; at < list.length; at += EMAILS_PER_REQUEST) {
    const some = list.slice(at, at + EMAILS_PER_REQUEST);
    const vars: Record<string, unknown> = { board: FUNNEL_BOARD_ID, col: COLUMNS.email, cols: COLUMN_IDS };
    const fields = some.map((e, i) => {
      vars[`e${i}`] = [...new Set([e, e.toLowerCase()])];
      return `q${i}: items_page_by_column_values(board_id: $board, columns: [{ column_id: $col, column_values: $e${i} }], limit: 5) { items { ${ITEM_FIELDS} } }`;
    });
    const decl = some.map((_, i) => `$e${i}: [String]!`).join(', ');
    const res = await mondayRequest<Record<string, { items: ItemNode[] } | Complexity>>(token, `query ($board: ID!, $col: String!, $cols: [String!], ${decl}) { complexity { after reset_in_x_seconds } ${fields.join(' ')} }`, vars, { timeoutMs: REQUEST_TIMEOUT_MS });
    calls += 1;
    if (!res.ok) return { ok: false, error: res.error, calls, complexityLeft };
    for (const [key, v] of Object.entries(res.data)) {
      if (key === 'complexity' || !v || !('items' in v)) continue;
      for (const n of v.items ?? []) items.set(String(n.id), toItem(n));
    }
    complexityLeft = (res.data.complexity as Complexity)?.after ?? complexityLeft;
  }
  return { ok: true, items: [...items.values()], calls, complexityLeft };
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

async function send(token: string, fields: string[], decl: string[], vars: Record<string, unknown>): Promise<Reply> {
  const head = decl.length > 0 ? `mutation (${decl.join(', ')})` : 'mutation';
  return readReply(await mondayRequestRaw(token, `${head} { ${fields.join(' ')} complexity { after reset_in_x_seconds } }`, vars, { timeoutMs: REQUEST_TIMEOUT_MS }));
}

/**
 * The updates, 25 rows to a request (they are idempotent: a request refused
 * as a whole is tried row by row, so one bad row costs only itself), then
 * the creates, one to a request and never repeated in the run: when Monday's
 * answer is unclear (no reply, a limit hit), the next run reads the board
 * first and finds the row if it was made.
 */
export async function writePlan(token: string, updates: readonly RowUpdate[], creates: readonly RowCreate[], deadline: number): Promise<WriteOutcome> {
  const out: WriteOutcome = { updated: 0, moved: 0, created: [], succeeded: [], failed: [], stopped: null, calls: 0, complexityLeft: null };
  const complexity = (r: Reply) => {
    const after = (r.data.complexity as Complexity)?.after;
    if (typeof after === 'number') out.complexityLeft = after;
  };
  const halt = (): boolean => {
    if (out.stopped) return true;
    if (Date.now() > deadline) out.stopped = 'out of time';
    else if (out.complexityLeft !== null && out.complexityLeft < MIN_COMPLEXITY_LEFT) out.stopped = "Monday's complexity budget is low";
    return out.stopped !== null;
  };

  const okUpdates: RowUpdate[] = [];
  for (const u of updates) {
    if (safeId(u.itemId) && (!u.to || safeGroup(GROUPS[u.to]))) okUpdates.push(u);
    else out.failed.push({ userId: u.userId, itemId: u.itemId, error: 'not a Monday id' });
  }
  const okCreates: RowCreate[] = [];
  for (const c of creates) {
    if (safeGroup(GROUPS[c.group])) okCreates.push(c);
    else out.failed.push({ userId: c.userId, itemId: null, error: 'not a Monday group' });
  }

  /** Settles each row of a sent batch from the reply; returns the rows it could not tell about. */
  const settle = (batch: readonly RowUpdate[], aliases: string[][], r: Reply): RowUpdate[] => {
    const unknown: RowUpdate[] = [];
    batch.forEach((u, i) => {
      const mine = aliases[i];
      const error = mine.map((a) => r.aliasErrors.get(a)).find(Boolean);
      if (error) {
        out.failed.push({ userId: u.userId, itemId: u.itemId, error });
        return;
      }
      if (mine.every((a) => r.data[a])) {
        if (mine.some((a) => a.startsWith('c'))) out.updated += 1;
        if (mine.some((a) => a.startsWith('m'))) out.moved += 1;
        out.succeeded.push(u.userId);
        return;
      }
      unknown.push(u);
    });
    return unknown;
  };

  for (let i = 0; i < okUpdates.length && !halt(); i += WRITE_BATCH) {
    const batch = okUpdates.slice(i, i + WRITE_BATCH);
    const req = updateRequest(batch);
    if (req.fields.length === 0) {
      for (const u of batch) out.succeeded.push(u.userId);
      continue;
    }
    const r = await send(token, req.fields, req.decl, req.vars);
    out.calls += 1;
    complexity(r);
    const unknown = settle(batch, req.aliases, r);
    if (r.stop) {
      // Limited or unreachable: what got through is counted; the rest waits for the next run.
      out.stopped = r.stop;
      break;
    }
    // Refused as a whole, or rows it said nothing about: row by row.
    for (const u of unknown) {
      if (halt()) break;
      const one = updateRequest([u]);
      const r1 = await send(token, one.fields, one.decl, one.vars);
      out.calls += 1;
      complexity(r1);
      const still = settle([u], one.aliases, r1);
      if (r1.stop) {
        out.stopped = r1.stop;
        break;
      }
      for (const x of still) out.failed.push({ userId: x.userId, itemId: x.itemId, error: r1.refused ?? 'Monday did not say it was written' });
    }
  }

  for (const c of okCreates) {
    if (halt()) break;
    const r = await send(
      token,
      [`n0: create_item(board_id: $board, group_id: "${GROUPS[c.group]}", item_name: $name, column_values: $v) { id }`],
      ['$board: ID!', '$name: String!', '$v: JSON!'],
      { board: FUNNEL_BOARD_ID, name: c.name.slice(0, 255), v: JSON.stringify(columnValuesJson(c.changes)) },
    );
    out.calls += 1;
    complexity(r);
    const id = (r.data.n0 as { id?: string | number } | null | undefined)?.id;
    if (id !== undefined && id !== null) {
      out.created.push({ userId: c.userId, itemId: String(id) });
      out.succeeded.push(c.userId);
      continue;
    }
    if (r.stop) {
      // No clear answer: it may have been made, so it is not sent again now.
      out.failed.push({ userId: c.userId, itemId: null, error: r.stop });
      out.stopped = r.stop;
      break;
    }
    out.failed.push({ userId: c.userId, itemId: null, error: r.aliasErrors.get('n0') ?? r.refused ?? 'Monday created no row' });
  }
  return out;
}
