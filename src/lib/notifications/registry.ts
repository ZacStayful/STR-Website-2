/**
 * Every email and text a member can switch off, in one list.
 *
 * The Notifications panel (/account/notifications) renders this list, the
 * server writer (./server.ts) only writes columns named here, and every
 * sender reads its column before sending. Adding a notification type later
 * — missed deals, watchlist alerts, SMS — is one entry here plus one column
 * in supabase/schema.sql.
 *
 * Pure: no server-only, no Supabase. Tested.
 */

export type NotificationKey = 'daily_picks' | 'deal_changes' | 'weekly_missed' | 'weekly_alerts' | 'credit_alerts' | SmsNotificationKey;

/** Batch 8: one text switch per kind of change on a tracked deal. */
export type SmsNotificationKey = 'sms_price_drop' | 'sms_back_on_market' | 'sms_nearly_gone' | 'sms_gone';

export type NotificationColumn = 'sourcing_alerts' | 'alert_tracked' | 'alert_missed' | 'alert_weekly' | 'alert_credit' | SmsNotificationKey;

/** How it reaches the member. The panel lists each channel separately. */
export type NotificationChannel = 'email' | 'sms';

export interface NotificationType {
  key: NotificationKey;
  /** Email unless set. */
  channel?: NotificationChannel;
  /** The profiles column that holds the switch. */
  column: NotificationColumn;
  label: string;
  /** One line under the label. */
  description: string;
  /** What a missing or null column means. */
  defaultOn: boolean;
  /**
   * A column stamped when the switch goes off and cleared when it goes back
   * on, so a schema backfill that defaults the switch on can never re-enrol
   * someone who chose to leave.
   */
  optOutStampColumn?: 'sourcing_opted_out_at';
}

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  {
    key: 'daily_picks',
    column: 'sourcing_alerts',
    label: 'Daily picks',
    description: 'Today’s 5 each morning: one pick that fits your filter (it uses a little of your credit) and the rest of your Today.',
    defaultOn: true,
    optOutStampColumn: 'sourcing_opted_out_at',
  },
  {
    key: 'deal_changes',
    column: 'alert_tracked',
    label: 'Changes on deals I’m tracking',
    description: 'A price drop, a deal back on the market, going fast or gone: in your morning email, or on its own when there is none.',
    defaultOn: true,
  },
  {
    key: 'weekly_missed',
    column: 'alert_missed',
    label: 'Weekly: deals I missed',
    description: 'On Mondays, the deals that matched you and went under offer or let agreed that week.',
    defaultOn: true,
  },
  {
    key: 'weekly_alerts',
    column: 'alert_weekly',
    label: 'Weekly area alerts',
    description: 'On Mondays, when a saved area’s enquiry trend flips or its data becomes Confirmed.',
    defaultOn: true,
  },
  {
    key: 'credit_alerts',
    column: 'alert_credit',
    label: 'Picks paused / out of credit',
    description: 'A note when your daily picks pause because your credit ran out, and when your balance is running low.',
    defaultOn: true,
  },
  // ── Texts (Batch 8, src/lib/sms). Off until the member verifies a number,
  // which turns all four on; each can then be turned off here. At most one
  // text a day, however many of these have news. ──
  {
    key: 'sms_price_drop',
    channel: 'sms',
    column: 'sms_price_drop',
    label: 'Price drops',
    description: 'A deal you track drops its price.',
    defaultOn: false,
  },
  {
    key: 'sms_back_on_market',
    channel: 'sms',
    column: 'sms_back_on_market',
    label: 'Back on the market',
    description: 'A deal you track that had gone is available again.',
    defaultOn: false,
  },
  {
    key: 'sms_nearly_gone',
    channel: 'sms',
    column: 'sms_nearly_gone',
    label: 'Getting attention',
    description: 'Three or more other members opened or kept a deal you track this week.',
    defaultOn: false,
  },
  {
    key: 'sms_gone',
    channel: 'sms',
    column: 'sms_gone',
    label: 'Gone',
    description: 'A deal you track goes under offer, sells or is let.',
    defaultOn: false,
  },
];

export function channelOf(t: Pick<NotificationType, 'channel'>): NotificationChannel {
  return t.channel ?? 'email';
}

export const EMAIL_NOTIFICATION_TYPES: readonly NotificationType[] = NOTIFICATION_TYPES.filter((t) => channelOf(t) === 'email');
export const SMS_NOTIFICATION_TYPES: readonly NotificationType[] = NOTIFICATION_TYPES.filter((t) => channelOf(t) === 'sms');
export const SMS_NOTIFICATION_KEYS: readonly SmsNotificationKey[] = SMS_NOTIFICATION_TYPES.map((t) => t.key as SmsNotificationKey);

/** Every column the registry reads: select these together. */
export const NOTIFICATION_COLUMNS = 'sourcing_alerts, sourcing_opted_out_at, alert_tracked, alert_missed, alert_weekly, alert_credit, sms_price_drop, sms_back_on_market, sms_nearly_gone, sms_gone';

/**
 * The same, as it was before the Batch 8 text switches: what a database that
 * has not had them added yet can still answer (readNotifications falls back;
 * a missing text switch reads as off).
 */
export const NOTIFICATION_COLUMNS_BEFORE_BATCH_8 = 'sourcing_alerts, sourcing_opted_out_at, alert_tracked, alert_missed, alert_weekly, alert_credit';

/**
 * The same, as it was before the Batch 6 columns: what a database that has
 * not had them added yet can still answer (readNotifications falls back).
 */
export const NOTIFICATION_COLUMNS_BEFORE_BATCH_6 = 'sourcing_alerts, sourcing_opted_out_at, alert_weekly, alert_credit';

/** The one line the panel says about what it does not control. */
export const ALWAYS_SENT_NOTE = 'Billing and receipt emails are always sent.';

export const MANAGE_NOTIFICATIONS_PATH = '/account/notifications';

export function isNotificationKey(key: unknown): key is NotificationKey {
  return typeof key === 'string' && NOTIFICATION_TYPES.some((t) => t.key === key);
}

export function notificationType(key: NotificationKey): NotificationType {
  const t = NOTIFICATION_TYPES.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown notification type: ${key}`);
  return t;
}

export type NotificationRow = Partial<Record<NotificationColumn, boolean | null>> & { sourcing_opted_out_at?: string | null };

export type NotificationState = Record<NotificationKey, boolean>;

/** Each switch's position from a profile row; a missing column reads as its default. */
export function notificationState(row: NotificationRow | null | undefined): NotificationState {
  const out = {} as NotificationState;
  for (const t of NOTIFICATION_TYPES) {
    const v = row?.[t.column];
    out[t.key] = typeof v === 'boolean' ? v : t.defaultOn;
  }
  return out;
}

/** The profile update that moves several switches at once (a member's text switches, on verifying). */
export function notificationsPatch(keys: readonly NotificationKey[], on: boolean, now: Date = new Date()): Record<string, boolean | string | null> {
  return Object.assign({}, ...keys.map((k) => notificationPatch(k, on, now)));
}

/** The profile update that moves one switch, including its opt-out stamp. */
export function notificationPatch(key: NotificationKey, on: boolean, now: Date = new Date()): Record<string, boolean | string | null> {
  const t = notificationType(key);
  const patch: Record<string, boolean | string | null> = { [t.column]: on };
  if (t.optOutStampColumn) patch[t.optOutStampColumn] = on ? null : now.toISOString();
  return patch;
}
