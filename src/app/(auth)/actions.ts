'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ensureEnquiry } from '@/lib/apis/monday'

export type AuthState = { error: string | null }

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const redirectTo = String(formData.get('redirect') ?? '/estimate')

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }

  redirect(redirectTo)
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const fullName = String(formData.get('full_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const mobile = String(formData.get('mobile') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  // Optional discount code. We only sanity-check the format here (alphanumeric
  // plus - and _, normalised to uppercase); the code is validated for real
  // against Stripe's promotion codes at checkout time. Empty => no code.
  const promoRaw = String(formData.get('promo_code') ?? '').trim().toUpperCase()
  const promoCode = /^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(promoRaw) ? promoRaw : ''

  if (!fullName || !email || !mobile || !password) {
    return { error: 'Full name, email, mobile number, and password are all required.' }
  }
  if (fullName.length < 2) {
    return { error: 'Please enter your full name.' }
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  // Lightweight UK-friendly mobile sanity: digits/spaces/+/-/()/leading zero, ≥ 7 chars.
  const normalisedMobile = mobile.replace(/[\s()-]/g, '')
  if (!/^\+?[0-9]{7,15}$/.test(normalisedMobile)) {
    return { error: 'Please enter a valid mobile number.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/estimate`,
      data: {
        full_name: fullName,
        mobile: normalisedMobile,
        // handle_new_user() copies this onto the profile row. Omitted when
        // blank so the trigger's nullif() leaves promo_code null.
        ...(promoCode ? { promo_code: promoCode } : {}),
      },
    },
  })

  if (error) return { error: error.message }

  // The DB trigger handle_new_user() reads full_name + mobile out of
  // raw_user_meta_data and writes them onto the profile row. New profiles
  // start with reports_run = 0, giving them their 5 free reports.

  // Push the trial to Monday immediately — this is the most reliable point
  // to do it, because we have the name/email/mobile in hand and don't depend
  // on email confirmation firing or the user reaching /estimate. ensureEnquiry
  // dedupes by email, so the /auth/callback and /estimate hooks later adopt
  // this same row instead of creating a duplicate. Runs via after() so it
  // never delays the redirect to the check-email page.
  after(async () => {
    try {
      await ensureEnquiry({
        name: fullName,
        email,
        mobile: normalisedMobile,
        trialStartedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[signup] Monday trial create failed:', err)
    }
  })

  redirect('/signup/check-email')
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
