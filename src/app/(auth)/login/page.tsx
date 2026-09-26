import Link from 'next/link'
import { LoginForm } from './login-form'
import { MagicLinkForm } from './magic-link-form'
import { GoogleButton } from '../google-button'
import { safeInternalPath } from '@/lib/safe-path'

export const metadata = { title: 'Sign in · Stayful Intelligence' }

type SearchParams = Promise<{ redirect?: string; error?: string; email?: string }>

// /auth/callback and /auth/confirm send their failure reason here.
function errorMessage(error: string | undefined): string | null {
  if (!error) return null
  if (error === 'link_expired' || /expired|invalid|already/i.test(error)) {
    return 'That sign-in link has expired or has already been used. Email yourself a fresh one below.'
  }
  if (error === 'missing_code' || error === 'missing_token') {
    return 'That sign-in link was incomplete. Email yourself a fresh one below.'
  }
  return `Sign-in failed: ${error}`
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { redirect, error, email } = await searchParams
  const redirectTo = safeInternalPath(redirect, '')
  const notice = errorMessage(error)
  const prefill = typeof email === 'string' && email.includes('@') ? email : ''

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Access your Stayful Intelligence dashboard.
      </p>

      {notice ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{notice}</p>
      ) : null}

      <div className="mt-6">
        <LoginForm redirectTo={redirectTo} />
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        OR
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton next={redirectTo} />

      <div className="mt-6 border-t border-border pt-5">
        <p className="text-sm font-medium text-foreground">No password? Sign in by email.</p>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          We&apos;ll send a one-tap link that signs you in, no password needed.
        </p>
        <MagicLinkForm redirectTo={redirectTo} email={prefill} />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-primary font-medium hover:underline">
          Start with £20 of free credit
        </Link>
      </p>
    </div>
  )
}
