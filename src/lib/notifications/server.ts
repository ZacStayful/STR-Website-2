import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { NOTIFICATION_COLUMNS, notificationPatch, notificationState, type NotificationKey, type NotificationRow, type NotificationState } from './registry';

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
  const legacy = await admin.from('profiles').select('sourcing_alerts, sourcing_opted_out_at, alert_weekly').eq('id', userId).maybeSingle();
  return legacy.data ? notificationState(legacy.data as NotificationRow) : null;
}
