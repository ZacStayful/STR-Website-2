'use client'

import { useActionState } from 'react'
import { signupAction, type AuthState } from '../actions'
import { PasswordField } from '../PasswordField'
import { AttributionFields } from '@/components/tracking/AttributionFields'
import { SignupConsentCheckbox } from '@/components/tracking/SignupConsentCheckbox'
import type { Choice } from '@/lib/tracking/consent'

const initialState: AuthState = { error: null }

/**
 * `consent`: the Meta pixel checkbox (Batch 19), with this device's choice
 * as the server saw it; null leaves it out (no dataset, or a team invite).
 */
export function SignupForm({ next = '', consent = null }: { next?: string; consent?: { initialChoice: Choice | null } | null }) {
  const [state, action, pending] = useActionState(signupAction, initialState)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <AttributionFields />
      <div className="space-y-1.5">
        <label htmlFor="full_name" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="mobile" className="text-sm font-medium">
          Mobile number
        </label>
        <input
          id="mobile"
          name="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="07700 900000"
          pattern="[0-9 +()\-]{7,}"
          className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          We only text you about urgent account issues, or deal alerts if you ask for them below.
        </p>
        <label className="flex items-start gap-2 pt-1 text-sm">
          <input type="checkbox" name="sms_opt_in" className="mt-0.5 h-4 w-4 shrink-0 rounded border-border" />
          <span>Text me when a deal I&apos;m tracking changes (you can turn this off any time)</span>
        </label>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <PasswordField id="password" name="password" autoComplete="new-password" minLength={8} />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      {consent ? <SignupConsentCheckbox initialChoice={consent.initialChoice} /> : null}
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Creating account…' : 'Start free trial'}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        By creating an account you agree to our{' '}
        <a href="/terms" target="_blank" className="underline underline-offset-2">terms</a> and{' '}
        <a href="/privacy" target="_blank" className="underline underline-offset-2">privacy policy</a>.
      </p>
    </form>
  )
}
