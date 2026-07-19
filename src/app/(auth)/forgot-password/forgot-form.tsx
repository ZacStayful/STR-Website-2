'use client'

import { useActionState } from 'react'
import { requestPasswordResetAction, type FormState } from '../actions'

const initial: FormState = { error: null, success: null }

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initial)

  if (state.success) {
    return <p className="mt-4 text-sm text-primary">{state.success}</p>
  }

  return (
    <form action={action} className="mt-6 space-y-4">
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
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  )
}
