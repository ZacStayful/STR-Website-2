import Link from 'next/link'
import { SignupForm } from './signup-form'
import { GoogleButton } from '../google-button'
import { safeInternalPath } from '@/lib/safe-path'

export const metadata = { title: 'Start your free trial · Stayful Intelligence' }

type SearchParams = Promise<{ next?: string }>

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams
  const nextPath = safeInternalPath(next, '/estimate')
  // Arriving from a team invite: this login is for joining someone's team,
  // which pays for it — no free-credit pitch.
  const joiningTeam = nextPath.startsWith('/team/join')
  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      {joiningTeam ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Create your login</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the email address your invite was sent to. You&apos;ll join the team as soon as you&apos;ve confirmed it.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Start with £20 of free credit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full access to the analyser and Market Explorer. No card required.
          </p>
        </>
      )}

      <div className="mt-6">
        <SignupForm next={nextPath} />
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        OR
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton next={nextPath} />

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href={nextPath === '/estimate' ? '/login' : `/login?redirect=${encodeURIComponent(nextPath)}`}
          className="text-primary font-medium hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
