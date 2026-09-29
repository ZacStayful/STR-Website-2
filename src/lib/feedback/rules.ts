/**
 * The rules behind Batch 18's feedback (src/lib/feedback):
 *   - what a report, a status message or an announcement may say;
 *   - which paths may become links;
 *   - what the form may tell us about where it was sent from;
 *   - which images are accepted and how the browser shrinks them;
 *   - the settings' bounds;
 *   - who a status email goes to;
 *   - the sums on /admin/feedback.
 * The routes, the pages and the emails call these; they decide nothing on
 * their own.
 *
 * Pure: no network, no database, no server-only.
 */
import { DEFAULT_SETTINGS, IMAGE, LIMITS, SETTING_BOUNDS, SETTING_KEYS, isReportKind, isReportStatus, type FeedbackSettings, type ReportKind, type ReportStatus } from './config.ts';
import { sniffImage } from '../funnels/image.ts';
import { recentWeeks, ukDay, ukWeekRange, ukWeekStart, weekLabel } from '../activity/week.ts';
import { londonDayStart } from '../leads/search.ts';

// ── Text ──

/** Characters as the database counts them (code points), not UTF-16 units. */
export function charLength(s: string): number {
  return [...s].length;
}

// C0 and C1 controls (tab and newline are handled first), and the bidi
// embeddings, overrides and isolates that can make text read differently in
// admin than it was written.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export type TextResult = { ok: true; text: string } | { ok: false; reason: 'empty' | 'too_long' };

/**
 * A report's text, or an announcement's: line breaks kept (CRLF and CR become
 * LF, three or more blank lines become one), tabs become spaces, controls and
 * direction overrides go, the ends are trimmed. Plain text only: it is never
 * rendered as markup anywhere.
 */
export function cleanText(raw: unknown, max: number = LIMITS.textMax): TextResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (charLength(text) > max) return { ok: false, reason: 'too_long' };
  return { ok: true, text };
}

/** One line: a status message, an announcement's title. Newlines become spaces. */
export function cleanLine(raw: unknown, max: number): TextResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const text = raw.replace(/[\r\n\t]+/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (charLength(text) > max) return { ok: false, reason: 'too_long' };
  return { ok: true, text };
}

/** The start of a text for a quote or a list, on one line, cut at a word where it can be. */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

// ── Paths ──

/**
 * A path on this site that may become a link: the page a report was sent
 * from (it comes from the member's browser, so it is untrusted) and an
 * announcement's "Take a look". Stricter than safeInternalPath, and the same
 * rule as the check on announcements.link_path in supabase/schema.sql:
 * printable ASCII with no spaces or backslash anywhere, a single leading
 * slash, no "." or ".." segment, nothing under /api, at most LIMITS.pathMax.
 * The query and anchor are kept (a filter is often what reproduces a bug).
 * Null when it is not one.
 */
export function memberPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > LIMITS.pathMax) return null;
  if (!/^\/[!-~]*$/.test(v) || v.startsWith('//') || v.includes('\\')) return null;
  const path = v.split(/[?#]/, 1)[0];
  if (/(^|\/)\.{1,2}(\/|$)/.test(path)) return null;
  if (/^\/api(\/|$)/i.test(path)) return null;
  return v;
}

/** The path alone, for showing: no query or anchor. */
export function pathOnly(path: string): string {
  return path.split(/[?#]/, 1)[0] || '/';
}

// ── What the form captured ──

export interface ClientContext {
  /** The page the form was opened on, when it is a valid path. */
  page: string | null;
  screen: { w: number; h: number } | null;
  viewport: { w: number; h: number } | null;
  dpr: number | null;
  /** Could be an iPad reporting a Mac user agent. */
  touch: boolean;
  timeZone: string | null;
  language: string | null;
  /** The browser's build: a tab left open across a deploy runs the old one. */
  clientBuild: string | null;
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

function size(v: unknown): { w: number; h: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const w = intIn(o.w, 1, 20000);
  const h = intIn(o.h, 1, 20000);
  return w !== null && h !== null ? { w, h } : null;
}

function token(v: unknown, re: RegExp, max: number): string | null {
  return typeof v === 'string' && v.length <= max && re.test(v) ? v : null;
}

/** What the browser sent about itself, checked field by field; anything else is dropped. */
export function cleanClientContext(raw: unknown): ClientContext {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const dpr = Number(o.dpr);
  const build = token(o.clientBuild, /^[0-9a-f]{7,40}$/i, 40);
  return {
    page: memberPath(o.page),
    screen: size(o.screen),
    viewport: size(o.viewport),
    dpr: Number.isFinite(dpr) && dpr > 0 && dpr <= 10 ? Math.round(dpr * 100) / 100 : null,
    touch: o.touch === true,
    timeZone: token(o.timeZone, /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/, 64),
    language: token(o.language, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/, 35),
    clientBuild: build ? build.slice(0, 7).toLowerCase() : null,
  };
}

/** A header value fit to store: no controls, at most `max` characters. */
export function cleanHeader(v: string | null | undefined, max = 400): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s.length > 0 ? s.slice(0, max) : null;
}

/** A commit SHA, shortened; null when it is not one. */
export function shortBuild(v: string | null | undefined): string | null {
  return typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v) ? v.slice(0, 7).toLowerCase() : null;
}

/**
 * "Safari 17 on iPhone (iOS 17.5)", "Facebook in-app browser on Android 14":
 * enough to know where a bug happened, from the user agent alone. Ads send
 * members through Facebook's and Instagram's own browsers, so those are named.
 * `touch`: an iPad asks for desktop sites and says it is a Mac.
 */
export function deviceSummary(ua: string | null | undefined, touch = false): string {
  if (!ua) return 'Unknown device';
  let os = '';
  let form = '';
  const ios = /\b(iPhone|iPad|iPod)\b[^)]*?OS (\d+)[_.](\d+)/.exec(ua);
  const android = /\bAndroid (\d+(?:\.\d+)?)/.exec(ua);
  if (ios) {
    os = `iOS ${ios[2]}.${ios[3]}`;
    form = ios[1] === 'iPad' ? 'iPad' : 'iPhone';
  } else if (android) {
    os = `Android ${android[1]}`;
    form = /\bMobile\b/.test(ua) ? 'phone' : 'tablet';
  } else if (/\bCrOS\b/.test(ua)) os = 'ChromeOS';
  else if (/\bWindows\b/.test(ua)) os = 'Windows';
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) {
    if (touch) {
      os = 'iPadOS';
      form = 'iPad';
    } else os = 'macOS';
  } else if (/\bLinux\b/.test(ua)) os = 'Linux';

  const v = (re: RegExp) => re.exec(ua)?.[1] ?? '';
  let browser: string;
  if (/\bFBAN\/|\bFBAV\/|\bFB_IAB\//.test(ua)) browser = 'Facebook in-app browser';
  else if (/\bInstagram\b/.test(ua)) browser = 'Instagram in-app browser';
  else if (/\bEdg(?:e|A|iOS)?\/(\d+)/.test(ua)) browser = `Edge ${v(/\bEdg(?:e|A|iOS)?\/(\d+)/)}`;
  else if (/\bSamsungBrowser\/(\d+)/.test(ua)) browser = `Samsung Internet ${v(/\bSamsungBrowser\/(\d+)/)}`;
  else if (/\bOPR\/(\d+)/.test(ua)) browser = `Opera ${v(/\bOPR\/(\d+)/)}`;
  else if (/\b(?:Firefox|FxiOS)\/(\d+)/.test(ua)) browser = `Firefox ${v(/\b(?:Firefox|FxiOS)\/(\d+)/)}`;
  else if (/\b(?:Chrome|CriOS)\/(\d+)/.test(ua)) browser = `Chrome ${v(/\b(?:Chrome|CriOS)\/(\d+)/)}`;
  else if (/\bVersion\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//.test(ua)) browser = `Safari ${v(/\bVersion\/(\d+)/)}`;
  else browser = 'Unknown browser';

  if (form === 'iPhone' || form === 'iPad') return `${browser} on ${form}${os && os !== 'iPadOS' ? ` (${os})` : ''}`;
  if (os.startsWith('Android')) return `${browser} on ${os} (${form})`;
  return os ? `${browser} on ${os}` : browser;
}

// ── Screenshots ──

export type ScreenshotType = 'image/png' | 'image/jpeg' | 'image/webp';

/** The format from the first bytes, never the file's name: PNG, JPEG or WebP (RIFF…WEBP). */
export function sniffScreenshot(bytes: Uint8Array): ScreenshotType | null {
  const logo = sniffImage(bytes);
  if (logo) return logo;
  const riff = bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = riff && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return webp ? 'image/webp' : null;
}

export function screenshotExtension(type: ScreenshotType): 'png' | 'jpg' | 'webp' {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}

export function maxScreenshotBytes(s: Pick<FeedbackSettings, 'screenshotMaxMb'>): number {
  return s.screenshotMaxMb * 1024 * 1024;
}

/** Why one received image is refused, or null when it is fine. */
export function screenshotProblem(bytes: Uint8Array, s: Pick<FeedbackSettings, 'screenshotMaxMb'>): 'empty' | 'too_big' | 'not_an_image' | null {
  if (bytes.byteLength === 0) return 'empty';
  if (bytes.byteLength > maxScreenshotBytes(s)) return 'too_big';
  return sniffScreenshot(bytes) ? null : 'not_an_image';
}

/** One pass of the browser's shrinking: the long side and the JPEG quality. */
export interface ShrinkPass {
  longEdge: number;
  quality: number;
}

/** The passes, gentlest first: the first for every image, the others only while the report is over budget. */
export const SHRINK_PASSES: readonly ShrinkPass[] = [
  { longEdge: IMAGE.longEdgePx, quality: IMAGE.quality },
  { longEdge: IMAGE.longEdgePx, quality: IMAGE.fallbackQuality },
  { longEdge: IMAGE.fallbackLongEdgePx, quality: IMAGE.fallbackQuality },
];

/**
 * Whether an image is re-drawn on the first pass. JPEG and WebP always are,
 * which also leaves a photo's location data behind; a PNG only when it is big
 * (a phone screenshot stays sharp as it is).
 */
export function needsReencode(type: string, bytes: number, width: number, height: number): boolean {
  if (type !== 'image/png') return true;
  return bytes > IMAGE.keepPngUnderBytes || Math.max(width, height) > IMAGE.longEdgePx;
}

/** The size to draw at: the same, or scaled down so the long side is `longEdge`. */
export function scaledSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= longEdge || long <= 0) return { width, height };
  const k = longEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * What the browser does next to keep a report under IMAGE.requestBudgetBytes:
 * nothing ('ok'); shrink the biggest image that has a harder pass left
 * ('shrink', which image and which pass); or ask the member to take one away
 * ('too_big'). `images`: each prepared image's size and the pass it is at.
 */
export function nextShrink(images: { bytes: number; pass: number }[], textBytes = 0): { action: 'ok' } | { action: 'shrink'; index: number; pass: number } | { action: 'too_big' } {
  const total = images.reduce((n, i) => n + i.bytes, textBytes);
  if (total <= IMAGE.requestBudgetBytes) return { action: 'ok' };
  let pick = -1;
  for (let i = 0; i < images.length; i += 1) {
    if (images[i].pass >= SHRINK_PASSES.length - 1) continue;
    if (pick === -1 || images[i].bytes > images[pick].bytes) pick = i;
  }
  return pick === -1 ? { action: 'too_big' } : { action: 'shrink', index: pick, pass: images[pick].pass + 1 };
}

// ── Settings ──

function clampInt(v: unknown, bounds: { min: number; max: number }, fallback: number): number {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

/** A single plausible address: no spaces, commas or header tricks. Lower-cased. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t.length === 0 || t.length > 254 || /[\s<>,;"\\]/.test(t)) return null;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(t) ? t : null;
}

/**
 * Batch 18's settings from billing_settings rows, each clamped to its bounds;
 * a missing or unreadable row takes its default. An admin address that is not
 * a single valid address falls back to `adminFallback` (the first of
 * ADMIN_EMAILS), so a typo can never send reports nowhere.
 */
export function parseSettings(rows: ReadonlyMap<string, unknown>, adminFallback: string | null = null): FeedbackSettings {
  const d = DEFAULT_SETTINGS;
  const b = SETTING_BOUNDS;
  return {
    dailyLimit: clampInt(rows.get(SETTING_KEYS.dailyLimit), b.dailyLimit, d.dailyLimit),
    maxScreenshots: clampInt(rows.get(SETTING_KEYS.maxScreenshots), b.maxScreenshots, d.maxScreenshots),
    screenshotMaxMb: clampInt(rows.get(SETTING_KEYS.screenshotMaxMb), b.screenshotMaxMb, d.screenshotMaxMb),
    retentionDays: clampInt(rows.get(SETTING_KEYS.retentionDays), b.retentionDays, d.retentionDays),
    adminEmail: cleanEmail(rows.get(SETTING_KEYS.adminEmail)) ?? cleanEmail(adminFallback) ?? d.adminEmail,
    announcementMaxAgeDays: clampInt(rows.get(SETTING_KEYS.announcementMaxAgeDays), b.announcementMaxAgeDays, d.announcementMaxAgeDays),
  };
}

// ── Days ──

/** When today (UK) began: the daily limit counts from here, as feedback_submit does. */
export function ukDayStart(now: Date): Date {
  return londonDayStart(ukDay(now)) ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

// ── Labels ──

export function kindLabel(kind: ReportKind, form: 'short' | 'long' = 'short'): string {
  if (form === 'long') return kind === 'bug' ? 'Bug report' : 'Feature request';
  return kind === 'bug' ? 'Bug' : 'Idea';
}

/** New, Planned, Fixed or Built, Not doing. A member sees "Received" for new. */
export function statusLabel(kind: ReportKind, status: ReportStatus, audience: 'admin' | 'member' = 'admin'): string {
  switch (status) {
    case 'new':
      return audience === 'member' ? 'Received' : 'New';
    case 'planned':
      return 'Planned';
    case 'done':
      return kind === 'bug' ? 'Fixed' : 'Built';
    case 'not_doing':
      return 'Not doing';
  }
}

/**
 * The columns "Your feedback" may read: never the admin's note, the captured
 * page or anything else in context.
 */
export const MEMBER_REPORT_COLUMNS = 'id, ref, kind, body, status, status_message, status_changed_at, screenshot_count, created_at';

// ── Duplicates ──

/**
 * Where marking `reportId` a duplicate of `targetId` points it: the target's
 * own original, so duplicates never chain. Refused when it is the report
 * itself, when the target leads back to the report (a loop) or is missing.
 * `parentOf(id)`: that report's duplicate_of (null for an original), or
 * undefined when there is no such report.
 */
export function duplicateRoot(reportId: string, targetId: string, parentOf: (id: string) => string | null | undefined): { ok: true; rootId: string } | { ok: false; reason: 'self' | 'loop' | 'missing' } {
  if (reportId === targetId) return { ok: false, reason: 'self' };
  let id = targetId;
  for (let hops = 0; hops < 20; hops += 1) {
    const parent = parentOf(id);
    if (parent === undefined) return { ok: false, reason: 'missing' };
    if (id === reportId) return { ok: false, reason: 'loop' };
    if (parent === null) return { ok: true, rootId: id };
    id = parent;
  }
  return { ok: false, reason: 'loop' };
}

// ── Who a status email goes to ──

export interface RecipientReport {
  id: string;
  ref: number;
  userId: string;
  email: string | null;
  firstName: string | null;
  kind: ReportKind;
  body: string;
  createdAt: string;
}

export interface Recipient {
  report: RecipientReport;
  /** No address to send to: recorded as skipped, never sent. */
  skip: boolean;
}

/**
 * One email per member for a status change on `root`: its reporter, and the
 * reporters of its duplicates, each quoting their own report (the root's
 * reporter their original; anyone else their earliest duplicate). A member
 * with no usable address is kept, to be recorded as skipped.
 */
export function statusRecipients(root: RecipientReport, duplicates: RecipientReport[]): Recipient[] {
  const byUser = new Map<string, RecipientReport>([[root.userId, root]]);
  for (const r of [...duplicates].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, r);
  }
  return [...byUser.values()].map((report) => ({ report, skip: cleanEmail(report.email) === null }));
}

// ── Admin sums ──

export interface ReportFacts {
  kind: ReportKind;
  status: ReportStatus;
  duplicateOf: string | null;
  createdAt: string;
}

export type StatusCounts = Record<ReportStatus, number>;

export interface KindTotals {
  byStatus: StatusCounts;
  total: number;
  thisWeek: number;
  lastWeek: number;
}

export type Totals = Record<ReportKind, KindTotals>;

const emptyCounts = (): StatusCounts => ({ new: 0, planned: 0, done: 0, not_doing: 0 });

/**
 * The totals at the top of /admin/feedback: bugs and ideas by status, and
 * how many arrived this week and last (UK weeks, Monday to Sunday). A
 * duplicate is counted once, as its original.
 */
export function reportTotals(rows: readonly ReportFacts[], now: Date): Totals {
  const thisStart = ukWeekStart(now);
  const { start: thisFrom } = ukWeekRange(thisStart);
  const lastFrom = new Date(ukWeekRange(recentWeeks(now, 2)[0]).start);
  const totals: Totals = {
    bug: { byStatus: emptyCounts(), total: 0, thisWeek: 0, lastWeek: 0 },
    feature: { byStatus: emptyCounts(), total: 0, thisWeek: 0, lastWeek: 0 },
  };
  for (const r of rows) {
    if (r.duplicateOf || !isReportKind(r.kind) || !isReportStatus(r.status)) continue;
    const t = totals[r.kind];
    t.byStatus[r.status] += 1;
    t.total += 1;
    const at = new Date(r.createdAt).getTime();
    if (at >= thisFrom.getTime()) t.thisWeek += 1;
    else if (at >= lastFrom.getTime()) t.lastWeek += 1;
  }
  return totals;
}

export interface WeekRow {
  week: string;
  label: string;
  bugs: number;
  ideas: number;
  total: number;
}

/** Every report sent, week by week (duplicates too: each one is a member's action), oldest first. */
export function weeklySubmissions(rows: readonly Pick<ReportFacts, 'kind' | 'createdAt'>[], now: Date, weeks: number): WeekRow[] {
  const list = recentWeeks(now, weeks);
  const index = new Map(list.map((w, i) => [w, i]));
  const out: WeekRow[] = list.map((week) => ({ week, label: weekLabel(week), bugs: 0, ideas: 0, total: 0 }));
  for (const r of rows) {
    const at = new Date(r.createdAt);
    if (!Number.isFinite(at.getTime())) continue;
    const i = index.get(ukWeekStart(at));
    if (i === undefined) continue;
    if (r.kind === 'bug') out[i].bugs += 1;
    else out[i].ideas += 1;
    out[i].total += 1;
  }
  return out;
}

// ── Activity ──

/** Dedupe keys for the activity log: tokens event.ts accepts, never text. */
export const activityKey = {
  sent: (reportId: string) => `feedback_sent:${reportId}`,
  shown: (announcementId: string) => `announcement_shown:${announcementId}`,
  clicked: (announcementId: string) => `announcement_clicked:${announcementId}`,
  emailClick: (reportId: string, status: string) => `feedback_email_click:${reportId}:${status}`,
};

// ── Before the schema is run ──

/**
 * The Batch 18 tables or functions are not there yet (schema not run, or
 * PostgREST not reloaded): every reader then says so instead of failing.
 * PGRST205 is PostgREST's "table not in the schema cache", PGRST202 the same
 * for a function; 42P01 and 42883 are Postgres's own.
 */
export function isSchemaMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? '')) return true;
  return /could not find the (function|table)|does not exist/i.test(error.message ?? '');
}

// ── A report's context, as stored and as shown to admin ──

/** What is stored in feedback_reports.context: admin only, never shown to the member. */
export interface ReportContext extends ClientContext {
  device: string;
  userAgent: string | null;
  serverBuild: string | null;
  env: string | null;
  /** The member's email when they sent it. */
  email: string | null;
  /** The plan of whoever pays: a team member's owner. */
  plan: { code: string | null; name: string; status: string };
  team: { member: boolean; ownerId: string | null; ownerEmail: string | null };
  activeProfileId: string | null;
}

const STATUS_WORDS: Record<string, string> = { paid: 'paid', subscription_trial: 'trial', free: 'free', lapsed: 'lapsed', paused: 'paused' };

/** "Pro (paid)", or "Team member of owner@x.com — Starter (paused)". */
export function planLine(ctx: Pick<ReportContext, 'plan' | 'team'> | null | undefined): string {
  if (!ctx?.plan) return 'Unknown';
  const plan = `${ctx.plan.name} (${STATUS_WORDS[ctx.plan.status] ?? ctx.plan.status})`;
  return ctx.team?.member ? `Team member of ${ctx.team.ownerEmail ?? 'a team'} — ${plan}` : plan;
}

/** The plan in a word or two, for a subject line: "Pro", "Pay as you go", "Pro · team". */
export function planShort(ctx: Pick<ReportContext, 'plan' | 'team'> | null | undefined): string {
  if (!ctx?.plan) return 'unknown plan';
  return ctx.team?.member ? `${ctx.plan.name} · team` : ctx.plan.name;
}

/** "390×844 @3x, window 390×664", from what the browser sent; null when it sent nothing. */
export function screenLine(ctx: Pick<ClientContext, 'screen' | 'viewport' | 'dpr'> | null | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.screen) parts.push(`${ctx.screen.w}×${ctx.screen.h}${ctx.dpr ? ` @${ctx.dpr}x` : ''}`);
  if (ctx.viewport) parts.push(`window ${ctx.viewport.w}×${ctx.viewport.h}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** "abc1234", or "abc1234 (browser on def5678)" when a tab left open across a deploy sent it. */
export function versionLine(ctx: Pick<ReportContext, 'serverBuild' | 'clientBuild'> | null | undefined): string | null {
  const server = ctx?.serverBuild ?? null;
  const client = ctx?.clientBuild ?? null;
  if (server && client && server !== client) return `${server} (browser on ${client})`;
  return server ?? client;
}
