import Link from 'next/link'

export const metadata = { title: 'Check your email · Stayful Intelligence' }

export default function CheckEmailPage() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
      <h1 className="text-2xl font-semibold text-foreground">Check your email</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We&apos;ve sent you a confirmation link. Click it to activate your account
        and get your 5 free reports.
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
