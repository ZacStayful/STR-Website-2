import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ResetPasswordForm } from './reset-form'

export const metadata = {
  title: 'Set a new password · Stayful Intelligence',
  robots: { index: false, follow: false },
}

// The password-reset email links to /auth/callback, which exchanges the
// recovery code for a session and forwards here. If there's no session (link
// expired, opened directly), tell the user to request a fresh link.
export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Reset link expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This password-reset link is invalid or has expired. Please request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-foreground">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a new password for {user.email}.
      </p>
      <ResetPasswordForm />
    </div>
  )
}
