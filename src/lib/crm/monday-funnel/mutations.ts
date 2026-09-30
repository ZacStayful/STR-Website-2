/**
 * The funnel's update mutations (Batch 20, Part F), built as one aliased
 * request per batch: each row's column values (c<i>) and its move (m<i>).
 * Pure. Item and group ids are checked by the caller before they are put in.
 */
import { FUNNEL_BOARD_ID, GROUPS } from './config.ts';
import type { RowUpdate } from './plan.ts';
import { columnValuesJson } from './values.ts';

/** One request for these updates: each row's column values (c<i>) and its move (m<i>), aliased. */
export function updateRequest(batch: readonly RowUpdate[]): { fields: string[]; decl: string[]; vars: Record<string, unknown>; aliases: string[][] } {
  const vars: Record<string, unknown> = {};
  const decl: string[] = [];
  const fields: string[] = [];
  const aliases: string[][] = [];
  batch.forEach((u, i) => {
    const mine: string[] = [];
    if (Object.keys(u.changes).length > 0) {
      decl.push(`$v${i}: JSON!`);
      vars[`v${i}`] = JSON.stringify(columnValuesJson(u.changes));
      fields.push(`c${i}: change_multiple_column_values(board_id: $board, item_id: ${u.itemId}, column_values: $v${i}) { id }`);
      mine.push(`c${i}`);
    }
    if (u.to) {
      fields.push(`m${i}: move_item_to_group(item_id: ${u.itemId}, group_id: "${GROUPS[u.to]}") { id }`);
      mine.push(`m${i}`);
    }
    aliases.push(mine);
  });
  // $board only when something uses it: a request of moves alone must not declare it (GraphQL refuses an unused variable).
  if (fields.some((f) => f.includes('$board'))) {
    decl.unshift('$board: ID!');
    vars.board = FUNNEL_BOARD_ID;
  }
  return { fields, decl, vars, aliases };
}
