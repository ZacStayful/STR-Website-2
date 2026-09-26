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
| `npm run package:extension` | Builds and zips the extension for the Chrome Web Store |

Tests run under Node's native type stripping, not a bundler. That means a test
file must use **relative imports with explicit `.ts` extensions** — no `@/`
aliases — and must not reach any module that imports `server-only`. This is why
the billing logic lives in `src/lib/**` with the Stripe and Supabase clients
injected, rather than inside the route handlers.

## Deploying

Vercel deploys `main` automatically. Three things are **not** automated, and all
three have to be done by hand.

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

Ten of them, listed with what each is for in `.env.example`. The endpoint is
`/api/stripe/webhook`. `invoice.paid` is what turns a subscription payment into
plan credit and `payment_intent.succeeded` is what credits a one-click top-up,
so without those two people pay and nothing arrives.

`customer.subscription.updated` is the one to double-check: it carries pause,
resume and scheduled cancellation. Without it `/account` still looks correct,
because the server actions write the columns directly, but the row quietly
drifts out of step with Stripe from then on.

More than one endpoint is supported, and needs one secret per endpoint. Stripe
signs each delivery with the secret of the endpoint it came from, so a second
endpoint whose secret is not configured has every delivery refused with a 400.
Put the second in `STRIPE_WEBHOOK_SECRET2`; every configured secret is tried
until one verifies, and each delivery logs which position matched so the
endpoints can be told apart without exposing a secret. Any event enabled on
both endpoints arrives twice, which is harmless — every event id is recorded
in `stripe_events` before it is handled, so a repeat delivery is acknowledged
and skipped and can never grant credit twice.

### 3. Create the `brand-assets` storage bucket

Needed before a customer can **upload** a funnel logo. Without it, the upload
button says logo storage is not set up and points them at the paste-a-URL
field instead — which still works, so this is degraded rather than broken.

Supabase dashboard → Storage → New bucket:

- Name **`brand-assets`**
- **Public**, because both surfaces that read a logo are anonymous: the funnel
  page a prospect opens, and the server-side fetch that embeds it in the PDF
- File size limit **2 MB**, allowed MIME types **`image/png`, `image/jpeg`**

Those last two are belt and braces. The upload already checks the real byte
length and sniffs the magic bytes server-side, because an extension is a claim
rather than evidence — but a bucket that also refuses the wrong thing costs
nothing.

No storage policy to write: writes are service-role and reads are public.

This one fails at **upload** time, not at deploy time, so nothing will tell you
it is missing until a customer tries.

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
| `src/app/my-deals` | My deals: every deal a member is working on, grouped by stage (Kept, Contacted, Viewing, Offer, Secured, Passed), and the Reports tab. The merge of pipeline, Keep / Pass, opens and picks is `src/lib/listing/tracked.ts` (pure, tested); its reads are `tracked-server.ts` |
| `src/app/reports` | `/reports/[id]` reopens a saved report (linked from emails and PDFs); `/reports` itself redirects to My deals' Reports tab |
| `src/app/picks` | Daily picks: every property the sourcing cron has emailed the member, with feedback and save-to-pipeline. `src/app/p/[token]` is where the email buttons land (public, token-keyed) |
| `src/app/admin/picks` | Daily picks admin: the feedback report, the test-pick and dry-run buttons, and `responses` — every answer a member has given, with the pattern cuts and a CSV export |
| `src/app/account` | Plan management (pause, cancel, sign out) and `/account/billing`: credit balance, top-ups, usage history |
| `src/app/api` | Route handlers, including the Stripe webhook and the cron endpoints |
| `src/lib/access.ts` | Billing state of an account: subscriber, paused, lapsed, pay-as-you-go |
| `src/lib/credit/` | The credit ledger: unit costs, metering, reservations, estimates, plans, perks |
| `src/lib/stripe/` | Stripe: Checkout, one-click top-ups, portal, grants and the webhook handler (injected deps so it can be tested) |
| `src/lib/billing/` | Webhook signature verification against every configured secret |
| `supabase/schema.sql` | The entire schema, run by hand |
| `extension/` | Chrome extension source |

Scheduled jobs are declared in `vercel.json` and live under
`src/app/api/internal/`.
