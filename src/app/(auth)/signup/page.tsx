import Link from 'next/link'
import { SignupForm } from './signup-form'
import { GoogleButton } from '../google-button'

export const metadata = { title: 'Start your free trial · Stayful Intelligence' }

export default function SignupPage() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-foreground">Start with 5 free reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Full access to the analyser. No card required.
      </p>

      <div className="mt-6">
        <SignupForm />
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        OR
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton next="/estimate" />

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
