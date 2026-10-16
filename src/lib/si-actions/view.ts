/**
 * Batch 27: what the member sees of an instruction, built from its rows. The
 * chat's card (src/components/intelligence/chat/ActionCard.tsx), the status
 * route and My deals' Undo banner all draw from this one view.
 *
 * Pure: no network, no database, no server-only.
 */
import { formatPence } from '../credit/deal-pricing.ts';
import { DROP_REASONS, type InstructionStatus, type StepKind, type StepStatus, type DropReason } from './config.ts';
import { undoOpen, undoUntil } from './undo.ts';

/** The fields of an instruction row the view reads. */
export interface InstructionLike {
  id: string;
  status: InstructionStatus;
  confirm_kind: 'low_balance' | 'over_cap' | null;
  confirm_answer: 'yes' | 'no' | null;
  quoted_face_pence: number;
  later_face_pence: number;
  balance_before_pence: number | null;
  spend_line: string | null;
  starts_after: string | null;
  charged_started_at: string | null;
  stopped_at: string | null;
  report_ref: number | null;
  report_kind: 'bug' | 'feature' | null;
  updated_at: string;
}

/** The fields of a step row the view reads. */
export interface StepLike {
  id: string;
  seq: number;
  action: StepKind;
  deal_id: string | null;
  target_label: string | null;
  params: Record<string, unknown>;
  part: 'now' | 'later';
  quote_face_pence: number;
  after: Record<string, unknown> | null;
  /** What it changed from (read for Undo: a profile change with nothing before can't be put back). */
  before?: Record<string, unknown> | null;
  ledger_ref: string | null;
  status: StepStatus;
  drop_reason: string | null;
  error_code: string | null;
  report_ref: number | null;
  finished_at: string | null;
  undone_at: string | null;
  undo_note: string | null;
}

export type ProgressState = 'waiting' | 'running' | 'done' | 'failed' | 'stopped' | 'skipped' | 'declined' | 'later';

export interface ProgressRow {
  stepId: string;
  kind: StepKind;
  label: string;
  state: ProgressState;
  price: string | null;
  /** Where the result is: the report, the deal, Today. */
  href: string | null;
  note: string | null;
}

export interface ConfirmView {
  reason: 'low_balance' | 'over_cap';
  text: string;
  /** What it would spend ("£12"). */
  total: string;
  /** The balance after ("£3"); null when not known. */
  balanceAfter: string | null;
  topUp: boolean;
}

export interface LinkView {
  stepId: string;
  title: string;
  lines: string[];
  canKeep: boolean;
  kept: boolean;
}

/** A drafted agent message (src/lib/si-actions/draft-server.ts): shown with Copy, sent by the member. */
export interface DraftView {
  dealId: string;
  dealLabel: string;
  subject: string;
  body: string;
  /** "£171,000 to £182,000", at the Offer stage. */
  offerRange: string | null;
  /** How the range was worked out, in one line. */
  offerNote: string | null;
  /** The slot's own move after sending ("Move to Contacted"), when the deal isn't there yet. */
  move: { to: 'watching' | 'contacted' | 'viewing' | 'offer' | 'secured' | 'passed'; label: string } | null;
}

export interface ActionCardView {
  instructionId: string;
  status: InstructionStatus;
  spendLine: string | null;
  /** The free steps' results, one line each (grouped). */
  done: string[];
  /** What wasn't done, and why. */
  notDone: string[];
  /** One row per charged step. */
  progress: ProgressRow[];
  /** While counting down: when the first charged step starts. */
  startsAfter: string | null;
  stop: 'stop' | 'stop_rest' | null;
  confirm: ConfirmView | null;
  /** Not enough credit: nothing charged ran. */
  blocked: { requiredPence: number; availablePence: number; text: string } | null;
  /** Undo is open until then. */
  undo: { until: string } | null;
  undone: string | null;
  link: LinkView | null;
  report: { kind: 'bug' | 'feature'; ref: number } | null;
  /** Something is still going: the page polls the status. */
  live: boolean;
}

const STAGE_WORDS: Record<string, string> = { watching: 'Kept', contacted: 'Contacted', viewing: 'Viewing', offer: 'Offer', secured: 'Secured', passed: 'Passed' };

/** The free steps that ran, as lines: "Passed 4 deals", "Moved the 2 bed flat in LS6 to Viewing", "Bedrooms: 2 — 212 → 64 matches". */
export function doneLines(steps: readonly StepLike[]): string[] {
  const done = steps.filter((s) => s.status === 'done' && !s.undone_at);
  const out: string[] = [];
  const keeps = done.filter((s) => s.action === 'keep');
  const passes = done.filter((s) => s.action === 'pass');
  if (keeps.length > 0) out.push(keeps.length === 1 ? `Kept the ${keeps[0].target_label ?? 'deal'}` : `Kept ${keeps.length} deals`);
  if (passes.length > 0) out.push(passes.length === 1 ? `Passed the ${passes[0].target_label ?? 'deal'}` : `Passed ${passes.length} deals`);
  for (const s of done.filter((x) => x.action === 'stage_move')) {
    const to = STAGE_WORDS[String(s.params.stage ?? '')] ?? String(s.params.stage ?? '');
    out.push(`Moved the ${s.target_label ?? 'deal'} to ${to}`);
  }
  for (const s of done.filter((x) => x.action === 'change_criteria')) {
    const label = typeof s.after?.label === 'string' ? s.after.label : 'Your profile';
    const before = typeof s.after?.countBefore === 'number' ? s.after.countBefore : null;
    const after = typeof s.after?.countAfter === 'number' ? s.after.countAfter : null;
    out.push(before !== null && after !== null ? `${label} — matches ${before} → ${after}` : label);
  }
  return out;
}

function dropText(reason: string | null): string {
  return reason && reason in DROP_REASONS ? DROP_REASONS[reason as DropReason] : 'I couldn’t do that one.';
}

const FAIL_WORDS: Record<string, string> = {
  insufficient_credit: 'not enough credit when its turn came',
  price_changed: 'the price changed, so it wasn’t run — ask again for the new price',
  gone: 'it’s no longer live',
  missing: 'I couldn’t find it',
  held: 'it’s still being checked',
  checking: 'it’s still being checked',
  running: 'one is already running',
  already_done: 'it already has one',
  cap: 'that’s today’s limit of listing checks',
  seat_paused: 'your seat is paused',
  unavailable: 'it isn’t available just now',
  changed: 'it had changed since',
  expired: 'it wasn’t started in time',
  switched_off: 'actions are switched off just now',
  abandoned: 'it didn’t finish starting',
};

/** What wasn't done: dropped steps (with the reason), failed free steps. */
export function notDoneLines(steps: readonly StepLike[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (s.status === 'dropped') out.push(s.target_label ? `${s.target_label}: ${dropText(s.drop_reason)}` : dropText(s.drop_reason));
    else if (s.status === 'failed' && (s.action === 'keep' || s.action === 'pass' || s.action === 'stage_move' || s.action === 'change_criteria')) {
      const why = s.error_code ? (FAIL_WORDS[s.error_code] ?? 'it didn’t save') : 'it didn’t save';
      out.push(`${s.target_label ?? 'That change'}: not done (${why}).`);
    }
  }
  return out;
}

const CHARGED: ReadonlySet<StepKind> = new Set<StepKind>(['full_analysis', 'deep_report', 'deep_search', 'check_link', 'btl_report']);

function progressState(s: StepLike): ProgressState {
  switch (s.status) {
    case 'queued':
      return 'waiting';
    case 'deferred':
      return 'later';
    case 'running':
    case 'handed_out':
      return 'running';
    case 'done':
      return 'done';
    case 'stopped':
      return 'stopped';
    case 'declined':
      return 'declined';
    case 'skipped':
      return 'skipped';
    default:
      return 'failed';
  }
}

const KIND_LABEL: Record<string, string> = { full_analysis: 'Full analysis', deep_report: 'Deep report', deep_search: 'Deep search', check_link: 'Listing check', btl_report: 'Buy-to-let report' };

function hrefFor(s: StepLike): string | null {
  if (s.status !== 'done') return null;
  const report = typeof s.after?.reportId === 'string' ? s.after.reportId : null;
  if (report) return `/reports/${report}`;
  // Batch 28: a buy-to-let report has its own page.
  if (typeof s.after?.btlReportId === 'string') return `/btl-report/${s.after.btlReportId}`;
  if (s.action === 'deep_search') return '/today';
  if ((s.action === 'full_analysis' || s.action === 'deep_report') && s.deal_id) return `/deals/${s.deal_id}`;
  return null;
}

export function progressRows(steps: readonly StepLike[]): ProgressRow[] {
  return steps
    .filter((s) => CHARGED.has(s.action) && s.status !== 'dropped')
    .map((s) => {
      const state = progressState(s);
      const what = KIND_LABEL[s.action] ?? s.action;
      const label = s.action === 'deep_search' || s.action === 'check_link' ? (s.target_label ? `${what} · ${s.target_label}` : what) : `${what} · ${s.target_label ?? 'deal'}`;
      const note = state === 'failed' || state === 'skipped' ? (s.error_code ? (FAIL_WORDS[s.error_code] ?? 'didn’t finish, so it wasn’t charged') : 'didn’t finish, so it wasn’t charged') : s.report_ref ? `reported to the team (#${s.report_ref})` : null;
      return { stepId: s.id, kind: s.action, label, state, price: s.quote_face_pence > 0 ? formatPence(s.quote_face_pence) : null, href: hrefFor(s), note };
    });
}

function linkView(steps: readonly StepLike[]): LinkView | null {
  const s = steps.find((x) => x.action === 'check_link' && x.status === 'done' && x.after);
  if (!s || !s.after) return null;
  const lines = Array.isArray(s.after.lines) ? (s.after.lines as unknown[]).filter((l): l is string => typeof l === 'string') : [];
  const kept = typeof s.after.checkedListingId === 'string' && !s.undone_at;
  return { stepId: s.id, title: typeof s.after.title === 'string' ? s.after.title : 'The listing', lines, canKeep: !kept && s.after.keepable === true, kept };
}

const LIVE: ReadonlySet<InstructionStatus> = new Set<InstructionStatus>(['proposed', 'ready', 'running']);

export function cardView(i: InstructionLike, steps: readonly StepLike[], o: { now: Date; undoHours: number; spendableBasePence?: number | null; autoTopupOn?: boolean }): ActionCardView {
  const undoable = steps.filter((s) => undoOpen({ kind: s.action, status: s.status, finishedAt: s.finished_at, undoneAt: s.undone_at, before: s.before }, o.now, o.undoHours));
  const linkKeep = steps.find((s) => s.action === 'check_link' && s.status === 'done' && typeof s.after?.checkedListingId === 'string' && !s.undone_at);
  const until = undoUntil([...undoable.map((s) => s.finished_at), ...(linkKeep ? [String(linkKeep.after?.keptAt ?? linkKeep.finished_at)] : [])], o.undoHours);
  const undoneNotes = steps.map((s) => s.undo_note).filter((n): n is string => Boolean(n));
  const laterLeft = steps.some((s) => s.status === 'deferred');

  let confirm: ConfirmView | null = null;
  // The cap's question is only about steps still waiting for a yes: once a yes has queued them, it is answered, even
  // if this view was read in the moment before the instruction itself moved on (preview test, 16 Oct: a refresh landing
  // then showed the low-credit question instead).
  if (i.status === 'awaiting_confirm' && (i.confirm_kind === 'low_balance' || (i.confirm_kind === 'over_cap' && laterLeft))) {
    const rest = i.confirm_kind === 'over_cap';
    const totalPence = rest ? i.later_face_pence : i.quoted_face_pence;
    const after = i.balance_before_pence === null ? null : i.balance_before_pence - totalPence;
    confirm = {
      reason: i.confirm_kind,
      text: rest ? (steps.some((s) => s.status === 'done' || s.status === 'handed_out') ? `Run the other ${steps.filter((s) => s.status === 'deferred').length} for ${formatPence(totalPence)}?` : `That would spend ${formatPence(totalPence)} in one go. Go ahead?`) : `That would leave ${after === null ? 'your balance low' : formatPence(Math.max(0, after))} in credit. Go ahead?`,
      total: formatPence(totalPence),
      balanceAfter: after === null ? null : formatPence(Math.max(0, after)),
      topUp: !o.autoTopupOn,
    };
  }

  const stop: ActionCardView['stop'] = i.status === 'ready' ? 'stop' : i.status === 'running' && !i.stopped_at && steps.some((s) => s.status === 'queued' || s.status === 'deferred') ? 'stop_rest' : null;

  return {
    instructionId: i.id,
    status: i.status,
    spendLine: i.spend_line,
    done: doneLines(steps),
    notDone: notDoneLines(steps),
    progress: progressRows(steps),
    startsAfter: i.status === 'ready' ? i.starts_after : null,
    stop,
    confirm,
    blocked: i.status === 'blocked' ? { requiredPence: i.quoted_face_pence, availablePence: Math.max(0, Math.round(o.spendableBasePence ?? 0)), text: `That needs ${formatPence(i.quoted_face_pence)} and there isn’t enough credit, so nothing that costs anything ran.` } : null,
    undo: until && (undoable.length > 0 || Boolean(linkKeep)) ? { until } : null,
    undone: undoneNotes.length > 0 ? undoneNotes[undoneNotes.length - 1] : null,
    link: linkView(steps),
    report: i.report_ref && i.report_kind ? { kind: i.report_kind, ref: i.report_ref } : null,
    live: LIVE.has(i.status) || steps.some((s) => s.status === 'running' || s.status === 'handed_out'),
  };
}

/** For My deals' banner: what the eye changed that Undo could put back ("Passed 4 deals", "Kept a listing you checked"). */
export function summaryLine(steps: readonly StepLike[]): string {
  const lines = doneLines(steps);
  const kept = steps.filter((s) => s.action === 'check_link' && typeof s.after?.checkedListingId === 'string' && !s.undone_at).length;
  if (kept > 0) lines.push(kept === 1 ? 'Kept a listing you checked' : `Kept ${kept} listings you checked`);
  return lines.join('. ');
}
