import Link from 'next/link'
import { ResendButton } from './ResendButton'
import { safeInternalPath } from '@/lib/safe-path'

export const metadata = { title: 'Check your email · Stayful Intelligence' }

type SearchParams = Promise<{ email?: string; next?: string }>

export default async function CheckEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const { email, next } = await searchParams
  const nextPath = safeInternalPath(next, '/estimate')

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
      <h1 className="text-2xl font-semibold text-foreground">Check your email</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We&apos;ve sent a confirmation link{email ? ` to ${email}` : ''}. Click it to
        activate your account and get your £20 of free credit.
      </p>

      <ResendButton email={email ?? ''} next={nextPath} />

      <p className="mt-4 text-xs text-muted-foreground">
        Check your spam folder if it hasn&apos;t arrived in a couple of minutes.
      </p>

      <Link
        href="/login"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted transition-colors"
      >
        Back to sign in
      </Link>
    </div>
  )
}
