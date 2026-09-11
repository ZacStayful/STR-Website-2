# Stayful Intelligence

The Stayful Property Analyser, Market Explorer and browser extension.
Next.js (App Router) on Vercel, Supabase for auth and data, Stripe for billing.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill it in — see the comments in that file
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm test` | Unit tests (`node --test`, no bundler) |
| `npm run lint` | ESLint. Should report 0 errors |
| `npm run build` | Production build |
| `npm run build:extension` | Builds the Chrome extension into `extension/dist` |

Tests run under Node's native type stripping, not a bundler. That means a test
file must use **relative imports with explicit `.ts` extensions** — no `@/`
aliases — and must not reach any module that imports `server-only`. This is why
the billing logic lives in `src/lib/**` with the Stripe and Supabase clients
injected, rather than inside the route handlers.

## Deploying

Vercel deploys `main` automatically. Two things are **not** automated, and both
have to be done by hand.

### 1. Run `supabase/schema.sql` after any merge that changes it

Paste the whole file into the Supabase SQL editor. It is idempotent — every
statement is `create ... if not exists`, `add column if not exists` or
`drop policy if exists` — so re-running it is safe and is the intended way to
apply a change.

**This is not optional and it is not cosmetic.** The access gates select a fixed
column list (`ACCESS_COLUMNS` in `src/lib/access.ts`). A PostgREST select naming
a column that does not exist fails the whole query, the gate reads a null
profile, and every member — admins included — is redirected to the paywall. A
merge that adds a column and is not followed by this step takes the whole site
down. That has happened once already.

So: merge, run the schema, then check that a member page loads.

### 2. Enable the Stripe webhook events

Six of them, listed with what each is for in `.env.example`. The endpoint is
`/api/stripe/webhook`.

`customer.subscription.updated` is the one to double-check: it carries pause,
resume and scheduled cancellation. Without it `/account` still looks correct,
because the server actions write the columns directly, but the row quietly
drifts out of step with Stripe from then on.

### Environment variables

Set on Vercel to match `.env.local`. `.env.example` documents every variable,
which are required, and what breaks without them.

## Layout

| Path | What lives there |
|---|---|
| `src/app/(marketing)` | Public pages: landing, pricing, features, upgrade paywall |
| `src/app/(auth)` | Sign in, sign up, password reset |
| `src/app/estimate` | The analyser |
| `src/app/markets` | Market Explorer |
| `src/app/reports` | Saved report history |
| `src/app/account` | Plan management: pause, cancel, sign out |
| `src/app/api` | Route handlers, including the Stripe webhook and the cron endpoints |
| `src/lib/access.ts` | Who may use what. Every gate funnels through `hasAccess` |
| `src/lib/billing/` | Stripe webhook logic, injected clients so it can be tested |
| `supabase/schema.sql` | The entire schema, run by hand |
| `extension/` | Chrome extension source |

Scheduled jobs are declared in `vercel.json` and live under
`src/app/api/internal/`.
