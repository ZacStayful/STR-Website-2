import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { sendEmail, isEmailConfigured } from '../email/send';
import { brandedFrom } from '../email/from.ts';
import { newLeadEmail } from '../email/new-lead.ts';
import { outwardCode } from '../pdf/format';
import { siteUrl } from '../url';

/**
 * Batch 22f: emails a funnel's OWNER that a lead's report has finished.
 *
 * Once per lead, whichever door finished it (the live form or the drain) and
 * however often it is retried: the lead row is claimed (owner_notified_at,
 * set only while still null) before anything is sent, the send carries a
 * Resend idempotency key, and a failed send clears the claim so the next
 * finish can try again. Only to the owner's own login email — a team member
 * never gets it, and nothing here is addressed by anything a prospect typed.
 * Off when the funnel's "Email me each new lead" is off. Not charged.
 */
export async function notifyOwnerOfLead(o: { leadId: string; funnelId: string; ownerId: string; funnelName: string }): Promise<'sent' | 'off' | 'already' | 'failed' | 'skipped'> {
  if (!hasServiceRole() || !isEmailConfigured()) return 'skipped';
  const admin = createAdminClient();
  try {
    // The setting, read on its own so a database behind on the schema reads "on, but no claim column" and skips.
    const { data: f, error: fErr } = await admin.from('funnels').select('notify_new_lead').eq('id', o.funnelId).eq('user_id', o.ownerId).maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!f) return 'skipped';
    if ((f as { notify_new_lead?: boolean }).notify_new_lead === false) return 'off';

    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from('leads')
      .update({ owner_notified_at: nowIso })
      .eq('id', o.leadId)
      .eq('user_id', o.ownerId)
      .is('owner_notified_at', null)
      .select('id, name, email, phone, postcode, bedrooms, qualified, report_token, result')
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) return 'already';

    const release = async () => {
      await admin.from('leads').update({ owner_notified_at: null }).eq('id', o.leadId).eq('owner_notified_at', nowIso);
    };

    const { data: owner } = await admin.from('profiles').select('email').eq('id', o.ownerId).maybeSingle();
    const to = (owner as { email?: string | null } | null)?.email;
    if (!to) {
      await release();
      return 'skipped';
    }

    const lead = claimed as { name: string | null; email: string | null; phone: string | null; postcode: string | null; bedrooms: number | null; qualified: boolean | null; report_token: string | null; result: { shortLet?: { annualRevenue?: number } } | null };
    const copy = newLeadEmail({
      funnelName: o.funnelName,
      landlordName: lead.name,
      landlordEmail: lead.email,
      landlordPhone: lead.phone,
      area: outwardCode(lead.postcode) || null,
      bedrooms: lead.bedrooms,
      annualIncome: typeof lead.result?.shortLet?.annualRevenue === 'number' ? lead.result.shortLet.annualRevenue : null,
      qualified: lead.qualified,
      leadUrl: siteUrl(`/leads/${o.leadId}`),
      pdfUrl: lead.report_token ? siteUrl(`/r/${lead.report_token}/pdf`) : null,
      settingsUrl: siteUrl(`/leads/funnels/${o.funnelId}`),
    });
    const from = brandedFrom(process.env.EMAIL_FROM, 'Stayful Intelligence') ?? undefined;
    const res = await sendEmail({ to, subject: copy.subject, html: copy.html, text: copy.text, ...(from ? { from } : {}), idempotencyKey: `new-lead:${o.leadId}` });
    if (!res.sent) {
      await release();
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error(`[new-lead] email for lead ${o.leadId} failed:`, err);
    return 'failed';
  }
}
