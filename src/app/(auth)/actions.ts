'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createEnquiry } from '@/lib/monday/enquiries'

export type AuthState = { error: string | null }

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
}

const MOBILE_RE = /^\+?[\d\s()-]{7,}$/

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
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const mobile = String(formData.get('mobile') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!name || !email || !mobile || !password) {
    return { error: 'Name, email, mobile and password are all required.' }
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  if (!MOBILE_RE.test(mobile)) {
    return { error: 'Please enter a valid mobile number.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/estimate`,
      data: { name, mobile },
    },
  })

  if (error) return { error: error.message }

  // The DB trigger handle_new_user() inserts a profile row with the
  // default 14-day trial_ends_at and copies name/mobile from user metadata.
  // Push the enquiry to Monday and stash the item id on the profile so we
  // can update Email Verified / status later. Best-effort: a Monday outage
  // should not block signup.
  const userId = data.user?.id
  if (userId) {
    try {
      const mondayItemId = await createEnquiry({ name, email, mobile })
      await supabase
        .from('profiles')
        .update({ monday_item_id: mondayItemId })
        .eq('id', userId)
    } catch (err) {
      console.error('[signup] Monday createEnquiry failed:', err)
    }
  }

  redirect('/signup/check-email')
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
