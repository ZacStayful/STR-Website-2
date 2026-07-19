'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ensureEnquiry } from '@/lib/apis/monday'

export type AuthState = { error: string | null }
// For flows that show a success message in place (resend, reset request) as
// well as an error.
export type FormState = { error: string | null; success: string | null }

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

  // Pass the email to the check-email page so it can offer a "resend" button.
  redirect(`/signup/check-email?email=${encodeURIComponent(email)}`)
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// Resend the signup confirmation email (e.g. it never arrived / expired).
export async function resendConfirmationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Enter your email address.', success: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/estimate` },
  })

  if (error) return { error: error.message, success: null }
  return { error: null, success: `Confirmation email resent to ${email}.` }
}

// Send a password-reset email. The link lands on /auth/callback (which
// exchanges the recovery code for a session) and forwards to /reset-password.
export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Enter your email address.', success: null }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=/reset-password`,
  })

  // Don't reveal whether an account exists — always show the same message.
  if (error) console.error('[auth] password reset request failed:', error.message)
  return {
    error: null,
    success: `If an account exists for ${email}, a reset link is on its way.`,
  }
}

// Set a new password. The user must already be in a recovery session (arrived
// via the reset link → callback exchanged the code).
export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      error: 'Your reset link has expired or is invalid. Please request a new one.',
    }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  redirect('/estimate')
}
