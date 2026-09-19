'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createFunnel, getFunnel, updateFunnel, rotateFunnelToken } from '@/lib/funnels';
import { parseBrand, parseHexColour, parseEmail, parseLogoUrl, logoRejectionReason } from '@/lib/funnels/brand';
import { parseLeadRules } from '@/lib/leads/rules';

/**
 * Funnel management. Every write goes through the service role (the funnels
 * table grants nothing to `authenticated`), so each action resolves the
 * session itself and scopes by user id — an id from somewhere else reads and
 * writes nothing.
 */

const UUID = /^[0-9a-f-]{36}$/i;

async function member(): Promise<{ id: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}

/** A number from a form field, or undefined to leave it alone. */
function numField(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(String(v).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export interface FunnelState {
  error?: string;
  saved?: boolean;
  /** The freshly minted token, shown once after a rotate. */
  token?: string;
}

export async function createFunnelAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const name = String(formData.get('name') ?? '').trim();
  const funnel = await createFunnel(who.id, name);
  if (!funnel) return { error: 'We could not create that funnel just now. Please try again.' };
  revalidatePath('/leads/funnels');
  revalidatePath('/leads');
  return { saved: true };
}

export async function saveBrandAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'That funnel could not be found.' };

  // A logo we cannot render is refused with a reason rather than silently
  // dropped — a customer who pasted a PDF needs to know why it vanished.
  const logoRaw = String(formData.get('logoUrl') ?? '').trim();
  if (logoRaw && !parseLogoUrl(logoRaw)) {
    return { error: logoRejectionReason(logoRaw) ?? 'That logo could not be used.' };
  }

  const brand = parseBrand({
    companyName: formData.get('companyName'),
    logoUrl: logoRaw,
    primary: formData.get('primary'),
    background: formData.get('background'),
    replyToEmail: formData.get('replyToEmail'),
  });

  // Tell the customer when a value was dropped, rather than saving silently:
  // a colour that quietly does not apply is worse than being told why.
  for (const [name, label] of [['primary', 'brand colour'], ['background', 'page background']] as const) {
    const raw = String(formData.get(name) ?? '').trim();
    if (raw && !parseHexColour(raw)) {
      return { error: `The ${label} needs to be a six-digit hex value, like #1a73e8.` };
    }
  }
  const emailRaw = String(formData.get('replyToEmail') ?? '').trim();
  if (emailRaw && !parseEmail(emailRaw)) {
    return { error: 'That reply-to address does not look like an email address.' };
  }

  const ok = await updateFunnel(who.id, id, { name: String(formData.get('name') ?? '').trim(), brand });
  if (!ok) return { error: 'We could not save those changes just now. Please try again.' };
  revalidatePath(`/leads/funnels/${id}`);
  revalidatePath('/leads/funnels');
  return { saved: true };
}

export async function saveRulesAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'That funnel could not be found.' };

  const areas = (name: string) =>
    String(formData.get(name) ?? '')
      .split(/[,\s]+/)
      .map((a) => a.trim())
      .filter(Boolean);

  // parseLeadRules is tolerant by design: anything unusable becomes "no
  // filter", which lets leads through rather than rejecting every one.
  const leadRules = parseLeadRules({
    version: 1,
    bedroomsMin: formData.get('bedroomsMin'),
    bedroomsMax: formData.get('bedroomsMax'),
    grossRevenueMin: formData.get('grossRevenueMin'),
    maxAvgReviewCount: formData.get('maxAvgReviewCount'),
    postcodeAreas: areas('postcodeAreas'),
    excludePostcodeAreas: areas('excludePostcodeAreas'),
  });

  const ok = await updateFunnel(who.id, id, {
    leadRules,
    reportDepth: formData.get('reportDepth') === 'enhanced' ? 'enhanced' : 'standard',
    unqualifiedPolicy: formData.get('unqualifiedPolicy') === 'hold' ? 'hold' : 'crm_flagged',
    dailyCap: numField(formData.get('dailyCap')),
    dailySpendCapPence: numField(formData.get('dailySpendCapPounds')) !== undefined
      ? Math.round((numField(formData.get('dailySpendCapPounds')) as number) * 100)
      : undefined,
  });
  if (!ok) return { error: 'We could not save those rules just now. Please try again.' };
  revalidatePath(`/leads/funnels/${id}`);
  return { saved: true };
}

export async function rotateTokenAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'That funnel could not be found.' };
  const token = await rotateFunnelToken(who.id, id);
  if (!token) return { error: 'We could not change that link just now. Please try again.' };
  revalidatePath(`/leads/funnels/${id}`);
  revalidatePath('/leads/funnels');
  return { saved: true, token };
}

export async function toggleFunnelAction(formData: FormData): Promise<void> {
  const who = await member();
  if (!who) return;
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return;
  const funnel = await getFunnel(who.id, id);
  if (!funnel) return;
  await updateFunnel(who.id, id, { active: !funnel.active });
  revalidatePath(`/leads/funnels/${id}`);
  revalidatePath('/leads/funnels');
}
