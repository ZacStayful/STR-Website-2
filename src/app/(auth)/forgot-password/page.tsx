import Link from 'next/link'
import { ForgotPasswordForm } from './forgot-form'
import { BRAND } from '@/lib/brand'

export const metadata = {
  title: 'Reset your password · Stayful Intelligence',
  robots: { index: false, follow: false },
}

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-foreground">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to set a new password.
      </p>

      <ForgotPasswordForm />

      <div className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Lost access to your email?</p>
        <p className="mt-1">
          If you can no longer receive email at your account address, we can help you
          recover your account after verifying your identity — email{' '}
          <a href={`mailto:${BRAND.contactEmail}?subject=Account%20recovery`} className="text-primary hover:underline">
            {BRAND.contactEmail}
          </a>{' '}
          with your name and mobile number and we&apos;ll sort it out.
        </p>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
