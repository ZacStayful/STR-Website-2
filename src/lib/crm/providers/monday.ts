/**
 * Monday, as a customer's own CRM.
 *
 * Nothing here touches Stayful's enquiry board. This runs against the
 * customer's account with the customer's token, on a board they chose, into
 * columns they mapped — see `../monday-map.ts` for why the mapping cannot be
 * skipped.
 *
 * The push is deliberately two steps. `create_item` makes the row with every
 * mapped column filled in; the PDF follows through the file endpoint because
 * Monday has no way to attach a file while creating an item. If the item
 * lands and the upload fails we report SUCCESS with the item id, because the
 * lead is in their CRM — which is what they care about — and a retry would
 * create a second row for the same person. The missing PDF is logged as a
 * warning on the delivery instead.
 */

import { mondayRequest, mondayUploadFile } from '../../apis/monday-client.ts';
import { parseMondayConfig, mondayColumnValues, mondayConfigBlockers } from '../monday-map.ts';
import { leadItemName } from '../payload.ts';
import type { CrmField, CrmProvider, CrmResult, LeadPayload, ResolvedConnection } from '../types.ts';

/** Only these can hold a lead field; the rest of a board is noise in a picker. */
const PICKABLE_TYPES = new Set([
  'text', 'long_text', 'email', 'phone', 'date', 'numbers', 'status', 'dropdown', 'link', 'checkbox', 'file',
]);

interface BoardQuery {
  boards: Array<{
    id: string;
    name: string;
    columns: Array<{ id: string; title: string; type: string }>;
    groups: Array<{ id: string; title: string }>;
  }> | null;
}

export const mondayProvider: CrmProvider = {
  id: 'monday',
  label: 'Monday.com',

  async testConnection(conn: ResolvedConnection): Promise<CrmResult> {
    const token = conn.credential;
    if (!token) return { ok: false, error: 'Add your Monday API token first.', retryable: false };

    const config = parseMondayConfig(conn.config);
    if (config.boardId === null) {
      // The token alone is still worth checking: it is the half a customer
      // is most likely to have pasted wrong, and saying so before they pick
      // a board saves a confusing second failure.
      const me = await mondayRequest<{ me: { name: string } | null }>(token, 'query { me { name } }');
      if (!me.ok) return { ok: false, error: me.error, retryable: me.retryable };
      return { ok: false, error: 'Token works. Now choose which board your leads should land on.', retryable: false };
    }

    const board = await fetchBoard(token, config.boardId);
    if (!board.ok) return { ok: false, error: board.error, retryable: board.retryable };
    return { ok: true, externalId: board.data.id };
  },

  async discoverFields(conn: ResolvedConnection) {
    const token = conn.credential;
    if (!token) return { fields: [], error: 'Add your Monday API token first.' };
    const config = parseMondayConfig(conn.config);
    if (config.boardId === null) return { fields: [], error: 'Choose a board first.' };

    const board = await fetchBoard(token, config.boardId);
    if (!board.ok) return { fields: [], error: board.error };

    const fields: CrmField[] = board.data.columns
      .filter((c) => PICKABLE_TYPES.has(c.type.toLowerCase()))
      .map((c) => ({ id: c.id, title: c.title, type: c.type.toLowerCase() }));
    return { fields };
  },

  async pushLead(conn: ResolvedConnection, payload: LeadPayload, pdf: Uint8Array | null): Promise<CrmResult> {
    const token = conn.credential;
    if (!token) return { ok: false, error: 'No Monday API token on this connection.', retryable: false };

    const config = parseMondayConfig(conn.config);
    const blockers = mondayConfigBlockers(config);
    // A misconfiguration fails the same way every time, so it never retries:
    // the customer has to fix it, and the error has to survive to tell them.
    if (blockers.length > 0) return { ok: false, error: blockers.join(' '), retryable: false };

    const columnValues = mondayColumnValues(config, payload);
    const created = await mondayRequest<{ create_item: { id: string } | null }>(
      token,
      `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $cols: JSON!) {
        create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $cols, create_labels_if_missing: true) { id }
      }`,
      {
        boardId: config.boardId,
        // Null lands it in the board's first group, which is Monday's own
        // default and better than guessing a group id that may not exist.
        groupId: config.groupId,
        itemName: leadItemName(payload),
        cols: JSON.stringify(columnValues),
      },
    );
    if (!created.ok) return { ok: false, error: created.error, retryable: created.retryable };

    const itemId = created.data.create_item?.id;
    if (!itemId) return { ok: false, error: 'Monday created no item.', retryable: true };

    const fileColumn = config.columns.file;
    if (pdf && fileColumn) {
      const upload = await mondayUploadFile({
        token,
        itemId,
        columnId: fileColumn.id,
        file: pdf,
        filename: pdfFilename(payload),
      });
      if (!upload.ok) {
        // The lead is in their CRM; retrying would duplicate the row. Report
        // the win and carry the warning.
        return { ok: true, externalId: itemId, error: `Lead created, but the PDF did not attach: ${upload.error}` };
      }
    }

    return { ok: true, externalId: itemId };
  },
};

async function fetchBoard(token: string, boardId: string) {
  const res = await mondayRequest<BoardQuery>(
    token,
    `query ($ids: [ID!]) { boards(ids: $ids) { id name columns { id title type } groups { id title } } }`,
    { ids: [boardId] },
  );
  if (!res.ok) return res;
  const board = res.data.boards?.[0];
  if (!board) {
    // Monday answers 200 with an empty list for a board you cannot see, so
    // this is the same message for "wrong id" and "no access" — both are the
    // customer's to fix and neither is worth retrying.
    return { ok: false as const, error: `No board ${boardId} on this account, or the token cannot see it.`, retryable: false };
  }
  return { ok: true as const, data: board };
}

/** Their board, their prospect — so the file is named after the property. */
function pdfFilename(payload: LeadPayload): string {
  const stem = (payload.property.address ?? payload.contact.name ?? 'property')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${stem || 'property'}_analysis.pdf`;
}

/** Board list for the picker, so a customer chooses rather than pastes an id. */
export async function listMondayBoards(token: string): Promise<{ boards: Array<{ id: string; name: string }>; error?: string }> {
  const res = await mondayRequest<{ boards: Array<{ id: string; name: string; state?: string }> | null }>(
    token,
    `query { boards(limit: 100, state: active, order_by: used_at) { id name state } }`,
  );
  if (!res.ok) return { boards: [], error: res.error };
  return { boards: (res.data.boards ?? []).map((b) => ({ id: b.id, name: b.name })) };
}

/** Groups on a board, so leads can land somewhere other than the top. */
export async function listMondayGroups(token: string, boardId: string): Promise<{ groups: Array<{ id: string; title: string }>; error?: string }> {
  const board = await fetchBoard(token, boardId);
  if (!board.ok) return { groups: [], error: board.error };
  return { groups: board.data.groups.map((g) => ({ id: g.id, title: g.title })) };
}
