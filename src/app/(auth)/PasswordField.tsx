'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Password input with a show/hide toggle. Reused across login, signup and
// reset-password so the "reveal password" behaviour is consistent everywhere.
export function PasswordField({
  id = 'password',
  name = 'password',
  autoComplete = 'current-password',
  minLength,
  required = true,
  placeholder,
}: {
  id?: string
  name?: string
  autoComplete?: string
  minLength?: number
  required?: boolean
  placeholder?: string
}) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        placeholder={placeholder}
        className="w-full h-10 rounded-lg border border-border bg-input/50 px-3 pr-10 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
