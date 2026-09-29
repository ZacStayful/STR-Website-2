/**
 * Batch 18's numbers, in one place: the settings admin can change (seeded in
 * billing_settings, edited on /admin/feedback and /admin/announcements), the
 * bounds every setting is clamped to, and the technical limits that change
 * only with a deploy. The feedback form, the routes, the admin pages, the
 * emails and the retention run all read from here, and
 * src/lib/feedback/schema.test.ts checks supabase/schema.sql agrees.
 *
 * Pure: no network, no database, no server-only.
 */

export const REPORT_KINDS = ['bug', 'feature'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** `done` reads "Fixed" on a bug and "Built" on an idea. */
export const REPORT_STATUSES = ['new', 'planned', 'done', 'not_doing'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The statuses that email the reporter (and the reporters of its duplicates), each once. */
export const EMAILED_STATUSES = ['planned', 'done', 'not_doing'] as const;
export type EmailedStatus = (typeof EMAILED_STATUSES)[number];

export const ANNOUNCEMENT_KINDS = ['feature', 'fix'] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

// ── Settings (billing_settings) ──

export const SETTING_KEYS = {
  dailyLimit: 'feedback_daily_limit',
  maxScreenshots: 'feedback_max_screenshots',
  screenshotMaxMb: 'feedback_screenshot_max_mb',
  retentionDays: 'feedback_screenshot_retention_days',
  adminEmail: 'feedback_admin_email',
  announcementMaxAgeDays: 'announcement_max_age_days',
} as const;

export interface FeedbackSettings {
  /** Reports one member may send in a UK day. */
  dailyLimit: number;
  /** Screenshots on one report; 0 turns them off. */
  maxScreenshots: number;
  /** The biggest image a member may pick, in MB, before the browser shrinks it. */
  screenshotMaxMb: number;
  /** Days a screenshot is kept; the report's text stays. */
  retentionDays: number;
  /** Where every new report is emailed. */
  adminEmail: string;
  /** Announcements older than this are no longer shown. */
  announcementMaxAgeDays: number;
}

export const DEFAULT_SETTINGS: FeedbackSettings = {
  dailyLimit: 10,
  maxScreenshots: 3,
  screenshotMaxMb: 5,
  retentionDays: 90,
  adminEmail: 'zac@stayful.co.uk',
  announcementMaxAgeDays: 30,
};

/**
 * What each number setting is clamped to, whatever is saved. Retention never
 * goes below a week, so a typo cannot wipe every screenshot overnight.
 */
export const SETTING_BOUNDS = {
  dailyLimit: { min: 1, max: 100 },
  maxScreenshots: { min: 0, max: 5 },
  screenshotMaxMb: { min: 1, max: 20 },
  retentionDays: { min: 7, max: 3650 },
  announcementMaxAgeDays: { min: 1, max: 365 },
} as const;

// ── Technical limits ──

export const LIMITS = {
  /** A report's text, in characters. */
  textMax: 2000,
  announcementTitleMax: 80,
  /** An announcement's text: two or three lines. */
  announcementBodyMax: 300,
  /** The one line sent with a status email. */
  statusMessageMax: 200,
  adminNoteMax: 5000,
  /** A captured page, or an announcement's link. */
  pathMax: 300,
  /** The quote of a report in its status email. */
  quoteMax: 300,
} as const;

export const IMAGE = {
  /** What the form accepts and the bucket allows. HEIC is converted in the browser when it can be read. */
  types: ['image/jpeg', 'image/png', 'image/webp'],
  /** The long side a photo is shrunk to. */
  longEdgePx: 2560,
  /** …and to this if the report is still over its budget. */
  fallbackLongEdgePx: 1920,
  quality: 0.85,
  fallbackQuality: 0.7,
  /** A PNG this small, within longEdgePx, is sent as it is (a screenshot stays sharp). */
  keepPngUnderBytes: 1024 * 1024,
  /** What the browser keeps a whole report under. Vercel refuses a request over 4.5 MB. */
  requestBudgetBytes: 4_000_000,
  /** What the route refuses outright. */
  requestHardCapBytes: 4_400_000,
} as const;

export const BUCKET = 'feedback-screenshots';

/** The bucket's own ceiling: the most feedback_screenshot_max_mb can be set to. */
export const BUCKET_CEILING_BYTES = SETTING_BOUNDS.screenshotMaxMb.max * 1024 * 1024;

/** How long an admin's link to a screenshot works. */
export const SIGNED_URL_SECONDS = 300;

/** An admin email not sent this long after the report is retried by the daily run, for this many days. */
export const ADMIN_EMAIL_RETRY_AFTER_MINUTES = 10;
export const ADMIN_EMAIL_RETRY_WITHIN_DAYS = 3;

/** A status email left 'claimed' this long (the send died) may be claimed again. */
export const STATUS_CLAIM_STALE_SECONDS = 600;

/** A batch of status emails stops after this and asks to be pressed again. */
export const SEND_TIME_BUDGET_MS = 45_000;

/** Screenshots removed per storage call in the retention run. */
export const RETENTION_BATCH = 100;

/** Announcements after the third fold under "N more". */
export const BANNER_FOLD_AFTER = 3;

/** Reports per page on /admin/feedback, and weeks in its table. */
export const ADMIN_PAGE_SIZE = 50;
export const ADMIN_WEEKS = 12;

/** Reports shown on "Your feedback". */
export const MEMBER_LIST_MAX = 50;

/** How long a server keeps the list of live announcements and the settings. */
export const CACHE_MS = 60_000;

export function isReportKind(v: unknown): v is ReportKind {
  return typeof v === 'string' && (REPORT_KINDS as readonly string[]).includes(v);
}

export function isReportStatus(v: unknown): v is ReportStatus {
  return typeof v === 'string' && (REPORT_STATUSES as readonly string[]).includes(v);
}

export function isEmailedStatus(v: unknown): v is EmailedStatus {
  return typeof v === 'string' && (EMAILED_STATUSES as readonly string[]).includes(v);
}

export function isAnnouncementKind(v: unknown): v is AnnouncementKind {
  return typeof v === 'string' && (ANNOUNCEMENT_KINDS as readonly string[]).includes(v);
}
