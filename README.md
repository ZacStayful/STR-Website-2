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

Vercel deploys `main` automatically. Four things are **not** automated, and all
four have to be done by hand.

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

### 4. Set up Twilio for text alerts

Until this is done no text is ever sent: every sender logs "not configured"
and skips, and both Twilio webhooks refuse every request (they cannot check
a signature without the auth token). Nothing else is affected.

1. **Upgrade the Twilio account to paid.** A trial account can only text
   numbers verified in Twilio and prefixes every text.
2. **Regulatory bundle.** Phone Numbers → Regulatory Compliance → create a
   *United Kingdom / Mobile / Business* bundle (company registration and proof
   of address). A UK mobile number cannot be bought without it; approval takes
   a few working days.
3. **Buy a UK mobile number** (+447…, SMS capable) under that bundle. It has to
   be a number, not an alphanumeric sender: a sender name like "Stayful"
   cannot receive replies, so "Reply STOP" would not work.
4. **Messaging Service.** Messaging → Services → create one (e.g. "Stayful
   alerts"), add the number to its sender pool, then:
   - Integration → *Send a webhook* → incoming messages to
     `https://<site>/api/twilio/inbound`, HTTP POST.
   - Opt-Out Management → turn on **Advanced Opt-Out** and set the STOP, START
     and HELP confirmations in UK English. When Twilio has already confirmed,
     the app records the keyword and does not reply a second time.
   - Delivery status needs no setting: every text carries its own
     `StatusCallback` to `/api/twilio/status`.
5. **Geo permissions.** Messaging → Settings → Geo permissions: **United
   Kingdom only**. Turn on SMS pumping protection if the account offers it.
6. **Vercel environment variables** (Production): `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`. On Preview add
   `SMS_DRY_RUN=true` as well, so previews log texts instead of sending them.
   Leave `SMS_ALERTS_ENABLED` unset until the test texts look right; members
   can verify their number before it is set.
7. **Run `supabase/schema.sql`** (the "Batch 8: sms" section), then check a
   member page and Account → Notifications load.
8. **Twilio low-balance alert** or auto-recharge, so texts do not stop quietly.
9. When the test texts are right, set **`SMS_ALERTS_ENABLED=true`**.

The UK price per text in `src/lib/credit/costs.ts` (`twilio:sms`) is an
estimate: confirm it against the Twilio console and correct it on
`/admin/billing`. Texts are free to members; the cost is house spend.

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
| `src/lib/sms/` | Text alerts: Twilio sending and webhooks, verification codes, the renderer, the alerts run |
| `src/lib/stripe/` | Stripe: Checkout, one-click top-ups, portal, grants and the webhook handler (injected deps so it can be tested) |
| `src/lib/billing/` | Webhook signature verification against every configured secret |
| `supabase/schema.sql` | The entire schema, run by hand |
| `extension/` | Chrome extension source |

Scheduled jobs are declared in `vercel.json` and live under
`src/app/api/internal/`.

## Member emails

Every non-billing email to a member is built in `src/lib/notify`. The content is
plain data (`message.ts`), rendered to email in one place (`render-email.ts`).

A member gets at most one of these a day, and two on Mondays. The cap is
enforced in one place, `notification_sends`: a capped email claims its slot
before it sends, and Resend's idempotency key is the slot. Billing and receipt
emails never go through the cap.

| UTC | Job | Sends |
|---|---|---|
| 06:00 | `listing-recheck` | Nothing: records price and status changes on pipeline rows |
| 06:55 | `deal-alerts` | Nothing: turns changes on tracked deals into `deal_alerts` |
| 07:00, 07:20, 07:40 | `sourcing` | Today's 5: the charged pick, the rest of the member's Today, and changes |
| 08:00 | `picks-paused` | The out-of-credit letter, instead of the daily email, with changes |
| Mon 08:00 | `alerts` | Your week: deals missed, your deals, your areas |
| 08:10 | `daily-digest` | The daily email for anyone who had none: Today's 5 without a pick, or changes only |
| :40, 07:40–19:40 | `deal-alerts` | Nothing: the same collector hourly in the day, so texts can go within the hour |
| every 15 min, 07:00–19:45 | `sms-alerts` | At most one text a member a day (below) |

Each one takes `?dry=1` and reports who would get what.

## Text alerts

`src/lib/sms`: a text within the hour when something changes on a deal a
member tracks. Off for everyone until the member verifies a UK mobile in
Account → Notifications (a 6-digit code, from the same number as the alerts).

- **What:** price drop, back on the market, getting attention, gone. Each has
  its own switch (registry entries, channel `sms`); all four turn on when a
  member first verifies. The content is Batch 6's `deal_alerts`, rendered by
  `render.ts` as one plain GSM-7 text of at most 160 characters. It never
  includes an address, postcode or listing link: bedrooms, type, town, prices
  and a link to My deals.
- **When:** 08:00–20:00 UK time, for changes recorded in the last 24 hours.
- **How many:** one a day at most (Batch 6's `notification_sends`, channel
  `sms`), and `billing_settings.sms_monthly_cap` (8) a UK calendar month.
  Several changes go in the same text.
- **Never twice:** `sms_messages.alert_ids`. A text does not close an alert;
  the daily email still carries it. The collector records changes for members
  who get texts even when their "Changes on deals I'm tracking" email is off;
  the emails still follow that switch.
- **STOP:** `/api/twilio/inbound` switches every account on that number off at
  once; START switches it back. A number that replied STOP gets no more
  verification codes either. Every text ends "Reply STOP to opt out".
- **Cost:** every text and its Twilio price is in `sms_messages`; the estimate
  is in `provider_calls` (`twilio:sms`). This month's spend:

  ```sql
  select count(*) as texts, sum(price) as usd, sum(segments) as segments
  from sms_messages
  where direction = 'outbound' and outcome in ('accepted', 'unknown')
    and created_at >= date_trunc('month', now());
  ```
