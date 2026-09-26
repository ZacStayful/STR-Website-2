/**
 * Every email a member can switch off, in one list.
 *
 * The Notifications panel (/account/notifications) renders this list, the
 * server writer (./server.ts) only writes columns named here, and every
 * sender reads its column before sending. Adding a notification type later
 * — missed deals, watchlist alerts, SMS — is one entry here plus one column
 * in supabase/schema.sql.
 *
 * Pure: no server-only, no Supabase. Tested.
 */

export type NotificationKey = 'daily_picks' | 'weekly_alerts' | 'credit_alerts';

export type NotificationColumn = 'sourcing_alerts' | 'alert_weekly' | 'alert_credit';

export interface NotificationType {
  key: NotificationKey;
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
    description: 'One property a day that fits your filter, by email. Each pick uses a little of your credit.',
    defaultOn: true,
    optOutStampColumn: 'sourcing_opted_out_at',
  },
  {
    key: 'weekly_alerts',
    column: 'alert_weekly',
    label: 'Weekly area alerts',
    description: 'A Monday email when a saved area’s enquiry trend flips, its data becomes Confirmed, or a listing in your pipeline moves.',
    defaultOn: true,
  },
  {
    key: 'credit_alerts',
    column: 'alert_credit',
    label: 'Picks paused / out of credit',
    description: 'A note when your daily picks pause because your credit ran out, and when your balance is running low.',
    defaultOn: true,
  },
];

/** Every column the registry reads: select these together. */
export const NOTIFICATION_COLUMNS = 'sourcing_alerts, sourcing_opted_out_at, alert_weekly, alert_credit';

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

/** The profile update that moves one switch, including its opt-out stamp. */
export function notificationPatch(key: NotificationKey, on: boolean, now: Date = new Date()): Record<string, boolean | string | null> {
  const t = notificationType(key);
  const patch: Record<string, boolean | string | null> = { [t.column]: on };
  if (t.optOutStampColumn) patch[t.optOutStampColumn] = on ? null : now.toISOString();
  return patch;
}
