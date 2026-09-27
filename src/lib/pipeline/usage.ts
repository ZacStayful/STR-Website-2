/**
 * Which next-step tools members use (pipeline_step_events), summed for the
 * admin page: each tool at each stage, how often and by how many members.
 *
 * Pure: no network, no database, no `server-only`.
 */
import { PIPELINE_STATUSES, isPipelineStatus } from '../listing/pipeline.ts';
import { NEXT_STEPS } from './next-steps.ts';
import type { NextStepsContent } from './types.ts';

export interface StepEventRow {
  user_id: string;
  stage: string;
  deal_kind: string;
  action: string;
  item_id: string | null;
}

export interface UsageRow {
  stage: string;
  stageLabel: string;
  kind: string;
  action: string;
  itemId: string | null;
  /** What was used, in words. */
  label: string;
  uses: number;
  members: number;
}

const ACTION_WORDS: Record<string, string> = {
  copy: 'Copied',
  email: 'Opened in email',
  tick: 'Ticked',
  untick: 'Unticked',
  advance: 'Moved on',
  enquiry: 'Sent a management enquiry',
};

function itemLabels(c: NextStepsContent): Map<string, string> {
  const out = new Map<string, string>();
  for (const kinds of Object.values(c.stages)) {
    for (const block of [kinds.purchase, kinds.rentToRent]) {
      if (block.message) out.set(block.message.id, `${block.heading}: message`);
      for (const i of block.checklist ?? []) out.set(i.id, i.text.split(':')[0].slice(0, 60));
    }
  }
  return out;
}

const stageLabel = (s: string) => (isPipelineStatus(s) ? PIPELINE_STATUSES.find((x) => x.key === s)?.label ?? s : s);
const stageOrder = (s: string) => {
  const i = PIPELINE_STATUSES.findIndex((x) => x.key === s);
  return i === -1 ? 99 : i;
};

export function summariseUsage(rows: StepEventRow[], content: NextStepsContent = NEXT_STEPS): UsageRow[] {
  const labels = itemLabels(content);
  const groups = new Map<string, { row: Omit<UsageRow, 'uses' | 'members'>; uses: number; members: Set<string> }>();
  for (const r of rows) {
    const key = [r.stage, r.deal_kind, r.action, r.item_id ?? ''].join('|');
    let g = groups.get(key);
    if (!g) {
      const what = r.action === 'advance' ? `to ${stageLabel(r.item_id ?? '')}` : r.item_id ? labels.get(r.item_id) ?? r.item_id : '';
      g = {
        row: { stage: r.stage, stageLabel: stageLabel(r.stage), kind: r.deal_kind, action: r.action, itemId: r.item_id, label: [ACTION_WORDS[r.action] ?? r.action, what].filter(Boolean).join(' ') },
        uses: 0,
        members: new Set(),
      };
      groups.set(key, g);
    }
    g.uses += 1;
    g.members.add(r.user_id);
  }
  return [...groups.values()]
    .map((g) => ({ ...g.row, uses: g.uses, members: g.members.size }))
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || b.uses - a.uses || a.label.localeCompare(b.label));
}

/** Members who used any tool, and the total per action. */
export function usageTotals(rows: StepEventRow[]): { members: number; byAction: Record<string, number> } {
  const byAction: Record<string, number> = {};
  for (const r of rows) byAction[r.action] = (byAction[r.action] ?? 0) + 1;
  return { members: new Set(rows.map((r) => r.user_id)).size, byAction };
}
