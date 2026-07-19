'use client'

import { useActionState } from 'react'
import { resendConfirmationAction, type FormState } from '../../actions'

const initial: FormState = { error: null, success: null }

export function ResendButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendConfirmationAction, initial)

  return (
    <form action={action} className="mt-6 space-y-2 text-left">
      <label htmlFor="resend-email" className="text-xs font-medium text-muted-foreground">
        Didn&apos;t get it? Resend to:
      </label>
      <div className="flex gap-2">
        <input
          id="resend-email"
          name="email"
          type="email"
          defaultValue={email}
          required
          placeholder="you@example.com"
          className="h-10 flex-1 rounded-lg border border-border bg-input/50 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 shrink-0 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {pending ? 'Sending…' : 'Resend'}
        </button>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-primary">{state.success}</p> : null}
    </form>
  )
}
