import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { NOTIFICATION_COLUMNS, NOTIFICATION_COLUMNS_BEFORE_BATCH_6, NOTIFICATION_COLUMNS_BEFORE_BATCH_8, notificationPatch, notificationsPatch, notificationState, type NotificationKey, type NotificationRow, type NotificationState } from './registry';

/**
 * The only writer of the notification columns. Service role, because the
 * panel has to be right on the very next render and the columns are not all
 * granted to `authenticated`. Every caller has already checked the session
 * or holds a valid pick token (the unsubscribe routes).
 */
export async function setNotification(userId: string, key: NotificationKey, on: boolean): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { error } = await createAdminClient().from('profiles').update(notificationPatch(key, on)).eq('id', userId);
  if (error) console.error('[notifications] profile update failed:', error.message);
  return !error;
}

/** Several switches in one write: a member's text switches, turned on together when they verify their number. */
export async function setNotifications(userId: string, keys: readonly NotificationKey[], on: boolean): Promise<boolean> {
  if (!hasServiceRole() || keys.length === 0) return false;
  const { error } = await createAdminClient().from('profiles').update(notificationsPatch(keys, on)).eq('id', userId);
  if (error) console.error('[notifications] profile update failed:', error.message);
  return !error;
}

/**
 * Every switch's position for the panel. A database that has not had the
 * newest column added yet falls back to the older columns rather than
 * showing nothing, so the panel keeps working through a deploy.
 */
export async function readNotifications(userId: string): Promise<NotificationState | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const full = await admin.from('profiles').select(NOTIFICATION_COLUMNS).eq('id', userId).maybeSingle();
  if (!full.error) return full.data ? notificationState(full.data as NotificationRow) : null;
  console.warn('[notifications] select failed (schema behind?):', full.error.message);
  // Each fallback only drops columns; a missing one reads as its default
  // (on for the emails, off for the Batch 8 texts).
  for (const columns of [NOTIFICATION_COLUMNS_BEFORE_BATCH_8, NOTIFICATION_COLUMNS_BEFORE_BATCH_6, 'sourcing_alerts, sourcing_opted_out_at, alert_weekly']) {
    const older = await admin.from('profiles').select(columns).eq('id', userId).maybeSingle();
    if (!older.error) return older.data ? notificationState(older.data as NotificationRow) : null;
  }
  return null;
}
