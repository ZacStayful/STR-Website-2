import Link from 'next/link'
import { LoginForm } from './login-form'
import { GoogleButton } from '../google-button'

export const metadata = { title: 'Sign in · Stayful Intelligence' }

type SearchParams = Promise<{ redirect?: string }>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { redirect } = await searchParams
  const redirectTo = redirect || '/estimate'

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Access your Stayful Intelligence dashboard.
      </p>

      <div className="mt-6">
        <LoginForm redirectTo={redirectTo} />
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        OR
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton next={redirectTo} />

      <p className="mt-6 text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-primary font-medium hover:underline">
          Start your 14-day free trial
        </Link>
      </p>
    </div>
  )
}
