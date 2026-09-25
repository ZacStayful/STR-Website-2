import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { archiveWarningEmail, archivedEmail, type RetentionLead } from '@/lib/email/lead-retention';
import { warnCutoff, archiveCutoff, warnedBefore, purgeAfter, WARN_DAYS_BEFORE } from '@/lib/leads/retention';

/**
 * Nightly lead retention (src/lib/leads/retention.ts).
 *
 *   1. Warn    — leads 2 days from their 6-month mark: one email per customer.
 *   2. Archive — leads past the mark whose warning went out 2+ days ago.
 *   3. Notify  — newly archived leads: one email per customer, and only once
 *                it has SENT is the deletion date set.
 *   4. Purge   — delete leads whose deletion date has passed.
 *
 * The ordering is the safety: a lead is never archived without a sent
 * warning, and never deleted without a sent notice (or, for a lead the
 * customer archived themselves, the on-screen confirmation). If email is
 * down, leads simply wait — nothing is lost because a message was.
 *
 * Same auth as the other internal routes. `?dry=1` reports what each step
 * would touch and changes nothing.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/lead-retention?dry=1"
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Per step, per run. A backlog clears over a few nights rather than timing out. */
const BATCH = 500;

type Admin = ReturnType<typeof createAdminClient>;

interface Row extends RetentionLead {
  id: string;
  userId: string;
}

function toRow(r: Record<string, unknown>): Row {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: (r.name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function byOwner(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push(r);
    out.set(r.userId, list);
  }
  return out;
}

async function ownerEmails(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await admin.from('profiles').select('id, email').in('id', ids);
  for (const p of (data ?? []) as Array<{ id: string; email: string | null }>) {
    if (p.email) out.set(p.id, p.email);
  }
  return out;
}

const LEAD_COLUMNS = 'id, user_id, name, email, address, created_at';

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const admin = createAdminClient();
  const now = new Date();
  const summary = { dry, warned: 0, archived: 0, notified: 0, purged: 0, skippedNoEmail: 0, errors: [] as string[] };

  // ── 1. Warn ───────────────────────────────────────────────────────────
  try {
    const cutoff = warnCutoff(now).toISOString();
    const { data, error } = await admin
      .from('leads')
      .select(LEAD_COLUMNS)
      .is('archived_at', null)
      .is('archive_warned_at', null)
      .lte('last_activity_at', cutoff)
      .order('last_activity_at', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const groups = byOwner((data ?? []).map((r) => toRow(r as Record<string, unknown>)));
    const emails = await ownerEmails(admin, [...groups.keys()]);
    // Archive happens once the warning is WARN_DAYS_BEFORE old, so that is
    // the date to promise — including for a backlog already past its mark.
    const archiveOn = new Date(now.getTime() + WARN_DAYS_BEFORE * 86_400_000);

    for (const [ownerId, leads] of groups) {
      const to = emails.get(ownerId);
      if (!to) {
        // Without a way to warn them, these stay put. Never archive unwarned.
        summary.skippedNoEmail += leads.length;
        continue;
      }
      if (dry) {
        summary.warned += leads.length;
        continue;
      }
      const email = archiveWarningEmail({ leads, archiveOn });
      const sent = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
      if (!sent.sent) {
        summary.errors.push(`warn ${ownerId}: ${sent.reason ?? 'not sent'}`);
        continue;
      }
      const { error: upErr } = await admin
        .from('leads')
        .update({ archive_warned_at: now.toISOString() })
        .eq('user_id', ownerId)
        .in('id', leads.map((l) => l.id))
        .is('archived_at', null)
        .is('archive_warned_at', null)
        // Opened between the read and now? Then it no longer needs warning.
        .lte('last_activity_at', cutoff);
      if (upErr) summary.errors.push(`warn mark ${ownerId}: ${upErr.message}`);
      else summary.warned += leads.length;
    }
  } catch (err) {
    summary.errors.push(`warn: ${(err as Error).message}`);
  }

  // ── 2. Archive ────────────────────────────────────────────────────────
  try {
    const base = () =>
      admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .lte('last_activity_at', archiveCutoff(now).toISOString())
        .not('archive_warned_at', 'is', null)
        .lte('archive_warned_at', warnedBefore(now).toISOString());
    if (dry) {
      const { count } = await base();
      summary.archived = count ?? 0;
    } else {
      const { data, error } = await admin
        .from('leads')
        .update({ archived_at: now.toISOString(), archive_reason: 'inactive' })
        .is('archived_at', null)
        .lte('last_activity_at', archiveCutoff(now).toISOString())
        .not('archive_warned_at', 'is', null)
        .lte('archive_warned_at', warnedBefore(now).toISOString())
        .select('id');
      if (error) throw new Error(error.message);
      summary.archived = (data ?? []).length;
    }
  } catch (err) {
    summary.errors.push(`archive: ${(err as Error).message}`);
  }

  // ── 3. Notify ─────────────────────────────────────────────────────────
  try {
    const { data, error } = await admin
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('archive_reason', 'inactive')
      .not('archived_at', 'is', null)
      .is('archive_notified_at', null)
      .order('archived_at', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const groups = byOwner((data ?? []).map((r) => toRow(r as Record<string, unknown>)));
    const emails = await ownerEmails(admin, [...groups.keys()]);
    const deleteOn = purgeAfter(now);

    for (const [ownerId, leads] of groups) {
      const to = emails.get(ownerId);
      if (!to) {
        // No deletion date without a notice: these stay archived, restorable.
        summary.skippedNoEmail += leads.length;
        continue;
      }
      if (dry) {
        summary.notified += leads.length;
        continue;
      }
      const email = archivedEmail({ leads, deleteOn });
      const sent = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
      if (!sent.sent) {
        summary.errors.push(`notify ${ownerId}: ${sent.reason ?? 'not sent'}`);
        continue;
      }
      const { error: upErr } = await admin
        .from('leads')
        .update({ archive_notified_at: now.toISOString(), purge_after: deleteOn.toISOString() })
        .eq('user_id', ownerId)
        .in('id', leads.map((l) => l.id))
        // Restored in the meantime? Then it must not pick up a deletion date.
        .not('archived_at', 'is', null)
        .is('archive_notified_at', null);
      if (upErr) summary.errors.push(`notify mark ${ownerId}: ${upErr.message}`);
      else summary.notified += leads.length;
    }
  } catch (err) {
    summary.errors.push(`notify: ${(err as Error).message}`);
  }

  // ── 4. Purge ──────────────────────────────────────────────────────────
  // crm_deliveries cascade with the row; the prospect's /r/<token> link 404s.
  try {
    if (dry) {
      const { count } = await admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .not('archived_at', 'is', null)
        .lte('purge_after', now.toISOString());
      summary.purged = count ?? 0;
    } else {
      const { data, error } = await admin
        .from('leads')
        .delete()
        .not('archived_at', 'is', null)
        .lte('purge_after', now.toISOString())
        .select('id');
      if (error) throw new Error(error.message);
      summary.purged = (data ?? []).length;
    }
  } catch (err) {
    summary.errors.push(`purge: ${(err as Error).message}`);
  }

  if (summary.errors.length > 0) console.error('[lead-retention]', summary.errors.join('; '));
  return Response.json(summary);
}
