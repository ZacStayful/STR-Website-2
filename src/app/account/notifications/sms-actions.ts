'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { checkCode, requestCode } from '@/lib/sms/verify-server';
import { setContactEnabled } from '@/lib/sms/store';

/**
 * Account → Notifications, texts: send a code, check it, and the member's own
 * on/off. The per-type text switches go through setNotificationAction like
 * every other switch (they are registry entries).
 */

export interface SmsFormState {
  step: 'number' | 'code';
  /** The number as the member typed it, so "send a new code" can resend. */
  phone?: string;
  verificationId?: string;
  masked?: string;
  error?: string;
  notice?: string;
  done?: boolean;
}

async function signedInUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/account/notifications');
  return user;
}

export async function requestSmsCodeAction(prev: SmsFormState, formData: FormData): Promise<SmsFormState> {
  const user = await signedInUser();
  const phone = String(formData.get('phone') ?? prev.phone ?? '').trim();
  const result = await requestCode(user.id, phone);
  if (!result.ok) return { ...prev, error: result.error, notice: undefined };
  return {
    step: 'code',
    phone,
    verificationId: result.verificationId,
    masked: result.masked,
    notice: result.dryRun ? `Dry run: no text was sent to ${result.masked}. The code is in the server log.` : `We have texted a 6-digit code to ${result.masked}. It lasts 10 minutes.`,
  };
}

export async function verifySmsCodeAction(prev: SmsFormState, formData: FormData): Promise<SmsFormState> {
  const user = await signedInUser();
  const verificationId = String(formData.get('verificationId') ?? prev.verificationId ?? '');
  const consent = user.user_metadata?.sms_opt_in === true ? 'signup' : 'account';
  const result = await checkCode(user.id, verificationId, formData.get('code'), consent);
  // Tied to the code it was about, so a newer code does not show an old error.
  if (!result.ok) return { step: 'code', verificationId, error: result.error };
  revalidatePath('/account/notifications');
  return { step: 'number', done: true, notice: result.firstNumber ? 'Your number is verified and texts are on.' : 'Your new number is verified.' };
}

/** The member's own on/off for every text. STOP by reply is separate and wins over this. */
export async function setSmsEnabledAction(formData: FormData): Promise<void> {
  const user = await signedInUser();
  const on = formData.get('on') === '1';
  const ok = hasServiceRole() ? await setContactEnabled(createAdminClient(), user.id, on) : false;
  revalidatePath('/account/notifications');
  redirect(`/account/notifications?msg=${ok ? 'saved' : 'error'}`);
}
