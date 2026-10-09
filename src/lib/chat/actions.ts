/**
 * Batch 26: the buttons an answer can carry. Stayful Intelligence never
 * changes anything itself: it offers a button and the member taps it. Every
 * button is one of these kinds, built here from internal paths only
 * (src/lib/nav.ts NAV_DESTINATIONS, "for Batch 26's take me there"), so a
 * model can never put a link of its own in front of a member.
 *
 * Pure.
 */
import { NAV_DESTINATIONS, type MyDealsStage } from '../nav.ts';
import { isWhatIfKey } from '../intelligence/what-if.ts';
import type { ChatSurface } from './config.ts';

export const ACTION_KINDS = [
  'open_deal',
  'full_analysis',
  'deep_search',
  'show_me',
  'use_this',
  'auto_topup',
  'notifications',
  'top_up',
  'open_today',
  'my_deals',
  'open_full_view',
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/** What the quick box may offer: nothing about a deal (it doesn't see deals). */
export const QUICK_ACTIONS: readonly ActionKind[] = ['auto_topup', 'notifications', 'top_up', 'open_today', 'open_full_view'];

export const ACTION_LABELS: Record<ActionKind, string> = {
  open_deal: 'Open deal',
  full_analysis: 'Run full analysis',
  deep_search: 'Deep report',
  show_me: 'Show me',
  use_this: 'Use this',
  auto_topup: 'Turn on auto top-up',
  notifications: 'Notification settings',
  top_up: 'Top up',
  open_today: 'Open Today',
  my_deals: 'Open My deals',
  open_full_view: 'Open full view',
};

/** A button as the member sees it: a link, or (Use this) one of Batch 22's what-if keys the page applies on tap. */
export interface ChatButton {
  kind: ActionKind;
  label: string;
  href: string | null;
  whatIfKey: string | null;
}

export function isActionKind(v: unknown): v is ActionKind {
  return typeof v === 'string' && (ACTION_KINDS as readonly string[]).includes(v);
}

const STAGES: readonly MyDealsStage[] = ['watching', 'contacted', 'viewing', 'offer', 'secured'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActionContext {
  surface: ChatSurface;
  /** A team member: credit is the owner's, so no top-up buttons. */
  teamMember: boolean;
  /** Deal ids this member may be sent to (visible to them, seen in this answer's tools). */
  allowedDeals: ReadonlySet<string>;
  /** What-if keys this answer's suggestions offered "Use this" for. */
  allowedWhatIfs: ReadonlySet<string>;
  /** "Show me" targets this answer's suggestions offered (deal ids). */
  allowedShowMe: ReadonlySet<string>;
  /** The deep search is on offer to this member right now. */
  deepSearchOffered: boolean;
}

/**
 * The button for a kind and target, or null when it isn't allowed here:
 * an unknown kind, a deal the member can't be sent to, a what-if the answer
 * didn't offer, a top-up for a team member, or a deal button on the quick box.
 */
export function buildButton(kind: unknown, target: unknown, ctx: ActionContext): ChatButton | null {
  if (!isActionKind(kind)) return null;
  if (ctx.surface === 'quick' && !QUICK_ACTIONS.includes(kind)) return null;
  const t = typeof target === 'string' ? target.trim() : '';
  const link = (href: string): ChatButton => ({ kind, label: ACTION_LABELS[kind], href, whatIfKey: null });
  switch (kind) {
    case 'open_deal':
      return UUID.test(t) && ctx.allowedDeals.has(t) ? link(NAV_DESTINATIONS.deal(t)) : null;
    case 'full_analysis':
      return UUID.test(t) && ctx.allowedDeals.has(t) ? link(`${NAV_DESTINATIONS.deal(t)}?analysis=1`) : null;
    case 'show_me':
      return UUID.test(t) && ctx.allowedShowMe.has(t) ? link(NAV_DESTINATIONS.deal(t)) : null;
    case 'use_this':
      return isWhatIfKey(t) && ctx.allowedWhatIfs.has(t) ? { kind, label: ACTION_LABELS[kind], href: null, whatIfKey: t } : null;
    case 'deep_search':
      return ctx.deepSearchOffered ? link('/intelligence#si-deep-search') : null;
    case 'auto_topup':
      return ctx.teamMember ? null : link('/account/billing#auto-topup');
    case 'top_up':
      return ctx.teamMember ? null : link('/account/billing#topup');
    case 'notifications':
      return link('/account/notifications');
    case 'open_today':
      return link(NAV_DESTINATIONS.today());
    case 'my_deals':
      return (STAGES as readonly string[]).includes(t) ? link(NAV_DESTINATIONS.myDealsStage(t as MyDealsStage)) : link('/my-deals');
    case 'open_full_view':
      return link('/intelligence#si-ask');
  }
}

/** Buttons for one answer: valid ones only, no repeats, at most three. */
export function buildButtons(requests: readonly { kind: unknown; target?: unknown }[], ctx: ActionContext): ChatButton[] {
  const out: ChatButton[] = [];
  const seen = new Set<string>();
  for (const r of requests) {
    const b = buildButton(r.kind, r.target, ctx);
    if (!b) continue;
    const id = `${b.kind}:${b.href ?? b.whatIfKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(b);
    if (out.length >= 3) break;
  }
  return out;
}
