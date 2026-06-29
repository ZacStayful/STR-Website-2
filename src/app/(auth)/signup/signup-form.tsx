'use client'

import { useActionState } from 'react'
import { signupAction, type AuthState } from '../actions'

const initialState: AuthState = { error: null }

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, initialState)

  return (
    <form action={action} className="space-y-4">
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
          We may text you about urgent account or report issues. No marketing.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="promo_code" className="text-sm font-medium">
          Discount code <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="promo_code"
          name="promo_code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={64}
          placeholder="e.g. WELCOME25"
          className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 text-sm uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Got a code? We&apos;ll apply it to your subscription when you upgrade.
        </p>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Creating account…' : 'Start free trial'}
      </button>
    </form>
  )
}
