'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createFunnel, getFunnel, updateFunnel, rotateFunnelToken } from '@/lib/funnels';
import { parseBrand, parseHexColour, parseEmail, parseLogoUrl, parseHttpsUrl, logoRejectionReason, activationBlockers, newFunnelBrand } from '@/lib/funnels/brand';
import { parseLeadRules } from '@/lib/leads/rules';
import { uploadLogo, deleteLogoIfOurs } from '@/lib/funnels/storage';
import { LOGO_MAX_BYTES } from '@/lib/funnels/brand';

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

/**
 * Refuses to create a funnel that could not work.
 *
 * The company name and privacy policy are checked BEFORE the row is inserted,
 * so a public link is never minted for a funnel that cannot go live. Handing
 * over a link and mentioning the requirement afterwards is how a customer ends
 * up with a token they have already pasted into their own website, wondering
 * why it returns nothing.
 */
export async function createFunnelAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const name = String(formData.get('name') ?? '').trim();

  const brand = newFunnelBrand({
    companyName: formData.get('companyName'),
    privacyUrl: formData.get('privacyUrl'),
  });
  if (!brand.ok) return { error: brand.error };

  const funnel = await createFunnel(who.id, name, brand.brand);
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

  const privacyRaw = String(formData.get('privacyUrl') ?? '').trim();
  if (privacyRaw && !parseHttpsUrl(privacyRaw)) {
    return { error: 'The privacy policy link needs to be a full https:// address.' };
  }

  const brand = parseBrand({
    companyName: formData.get('companyName'),
    logoUrl: logoRaw,
    primary: formData.get('primary'),
    background: formData.get('background'),
    replyToEmail: formData.get('replyToEmail'),
    privacyUrl: privacyRaw,
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

/**
 * Uploads a logo file and points the funnel's branding at it.
 *
 * A customer branding their funnel previously had to host a PNG somewhere
 * and paste the link — a fine answer for a developer and a poor one for a
 * property manager with logo.png on their desktop. The paste field stays for
 * anyone who already hosts their assets.
 *
 * The stored shape is identical either way: an https URL in `brand.logoUrl`.
 * So the funnel page, the PDF and every validation path are untouched by
 * this, which is the point.
 */
export async function uploadLogoAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'That funnel could not be found.' };

  // Ownership before anything is read off the request: an id from elsewhere
  // must not even get as far as costing us the bytes.
  const funnel = await getFunnel(who.id, id);
  if (!funnel) return { error: 'That funnel could not be found.' };

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a PNG or JPEG file to upload.' };
  }
  // The declared size, checked before the body is read into memory. The real
  // length is checked again inside uploadLogo, because this one is a claim.
  if (file.size > LOGO_MAX_BYTES) {
    return { error: `That file is too large. Logos have to be under ${Math.round(LOGO_MAX_BYTES / (1024 * 1024))} MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadLogo({ userId: who.id, funnelId: id, bytes });
  if (!result.ok || !result.url) return { error: result.error ?? 'That logo could not be uploaded.' };

  const previous = funnel.brand.logoUrl;
  const ok = await updateFunnel(who.id, id, { brand: { ...funnel.brand, logoUrl: result.url } });
  if (!ok) {
    // The save failed, so the file we just stored is unreferenced. Remove it
    // rather than leave an orphan nothing will ever look at again.
    await deleteLogoIfOurs(result.url);
    return { error: 'We could not save that logo just now. Please try again.' };
  }

  // Only once the new one is safely stored. Nothing else in this product
  // ever visits that bucket, so without this every re-upload leaves a file
  // behind for good — and `deleteLogoIfOurs` ignores a URL that was never
  // ours, so a customer's own hosted logo is left alone.
  await deleteLogoIfOurs(previous);

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

/**
 * Pause or resume. Going live is gated on the customer having supplied a
 * privacy policy and a company name: they are the data controller for
 * everyone who fills in their form, and a public page collecting names,
 * emails and home addresses with nothing to point a prospect at is not
 * something to ship. Pausing is never gated.
 */
export async function toggleFunnelAction(_prev: FunnelState, formData: FormData): Promise<FunnelState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'That funnel could not be found.' };
  const funnel = await getFunnel(who.id, id);
  if (!funnel) return { error: 'That funnel could not be found.' };

  if (!funnel.active) {
    const missing = activationBlockers(funnel.brand);
    if (missing.length > 0) {
      return { error: `Before this funnel can go live, add ${missing.join(' and ')} under Branding.` };
    }
  }

  const ok = await updateFunnel(who.id, id, { active: !funnel.active });
  if (!ok) return { error: 'We could not change that just now. Please try again.' };
  revalidatePath(`/leads/funnels/${id}`);
  revalidatePath('/leads/funnels');
  return { saved: true };
}
