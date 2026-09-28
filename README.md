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

Vercel deploys `main` automatically. Ten things are **not** automated, and all
ten have to be done by hand.

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

### 5. Start activity tracking (Batch 9)

1. **Before merging, run `supabase/schema.sql`** (the "Batch 9: activity
   tracking" section adds four tables and five functions, nothing else).
   Previews use the live database, so the preview needs it too. Until it is
   run, nothing is recorded (a warning a minute in the logs) and
   `/admin/weekly-active` says the schema is missing; the site is unaffected.
2. **On the preview:** `/admin/weekly-active#backfill` → **Dry run** only. The
   real run is refused until something has been logged in production, so a
   preview can never fix the history cutoff too early.
3. **After the release, once a member has done something:** Dry run, then
   **Copy the history**, then copy it again: the second run must add nothing.
4. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/activity-retention` (02:35 UTC). It deletes events and
   visits older than 24 months; `?dry=1` (with the internal secret) counts
   only, and so does the button on the page.
5. **Switch off test accounts** in the Members table ("Exclude"). Admins
   (`ADMIN_EMAILS`) and `@stayful.co.uk` addresses are left out already.

### 6. Switch on the new prices (Batch 10)

1. **Before merging, run `supabase/schema.sql`** (the "Batch 10: analyser
   path + pricing" section). It adds three service-role tables
   (`deal_analyses`, `analysis_purchases`, `daily_deal_charges`), two columns
   on `saved_searches` and one on `profiles`, the new `billing_settings` rows,
   and, once only, moves top-up and adjustment credit from 1.5× to 1.3× (the
   setting and existing balances). Nothing is added to `ACCESS_COLUMNS`. Until
   it is run, a Full analysis says "Something went wrong" and charges nothing,
   and top-ups still spend at 1.5×. Straight after running it, check that no
   top-up bought while it ran kept the old rate:
   `select count(*) from credit_grants where kind in ('topup', 'adjustment') and spend_rate = 1.5 and remaining_pence > 0;`
   should be 0. If it is not, run the same `where` as `update credit_grants
   set spend_rate = 1.3 where …`, then and only then (a rate changed later on
   `/admin/billing` must never be undone).
2. **Live at merge:** Quick look (the ladder, 25p to £1), Full analysis of a
   feed deal (£4 on a plan, less what the account paid to open it), PMI's
   second opinion (+£2), saved analyses reused for 30 days, top-up credit at
   1.3×, `/terms`, `/privacy`, the Usage chip and page.
3. **Pick the date** for daily deals (33p a day) and 1:1 plan credit:
   `/admin/billing` → Deal prices → *New pricing from*, at least 14 days away.
   Saving it switches nothing on.
4. **Send the notice:** `/admin/billing` → Pricing notice → **Dry run**
   (audience per plan, a sample, the email itself), then **Send**. It is
   refused unless the date is at least 14 days away, mails each account at
   most once (`profiles.pricing_notice_sent_at`), and stops after about 45
   seconds: press Send again until it says everyone has it. The first send
   records the date announced (`billing_settings.pricing_notice_date`); the
   new prices start on the saved date only once it has been announced, and
   never before the date announced.
5. **The morning it starts:** `/api/internal/sourcing?dry=1` and
   `/api/internal/daily-digest?dry=1` (with the internal secret) report
   `chargeMode: "per_day"` (the sourcing run also `dailyPence: 33`); before
   the date they report `per_pick`. Monthly plans get the new credit at their first renewal on or
   after the date, annual plans at their first annual renewal after it.

### 7. Switch on the profile quiz (Batch 12)

1. **Before merging, run `supabase/schema.sql`** (the "Batch 12: profile
   quiz" section). It adds `profiles.about_you` (granted to `authenticated`
   like `market_goals`), the service-role table `profile_quiz`, and two
   `billing_settings` rows (`profile_complete_pence` = 500,
   `profile_credit_min_real_pct` = 75; both editable on `/admin/billing`).
   Nothing is added to `ACCESS_COLUMNS`. Until it is run, nothing is gated,
   no pill or card is shown, and the quiz says it cannot save.
2. **Straight after the deploy:** open `/today` as a member with no goals
   (a fresh sign-up): it must land on `/welcome`, and Today must not load
   until the first three questions are answered. Open it as an existing
   member: the header pill shows their percentage and Today shows the
   reminder card. A team member is never sent to the quiz.
3. **`/markets?goals=1`** (in emails already sent) now lands on `/profile`.
4. **Terms:** `/terms` states the profile-completion credit (amount and
   the "real answers" share read from `billing_settings`, so it always says
   what the site does; the clause disappears if `profile_complete_pence` is
   set to 0). Check the wording against the legal drafts, section B2, and
   replace it there if they differ.
5. **Check the dry runs:** `/api/internal/daily-digest?dry=1` and
   `/api/internal/sourcing?dry=1` (with the internal secret) still report
   as before; the profile line is inside each email, never an email of its own.

### 8. Switch on saved profiles (Batch 13)

1. **Before merging, run `supabase/schema.sql`** (the "Batch 13: saved
   profiles" section). It is additive and idempotent: new service-role
   tables `search_profiles`, `profile_today_lists` and
   `profile_daily_charges`; a nullable `profile_id` on `sourcing_sent`,
   `deal_reactions`, `checked_listings`, `deal_opens` and `sourcing_missed`;
   the triggers that keep the active profile and `market_goals` /
   `saved_areas` / `profile_quiz.answered` in step; the
   `create_search_profile` and `select_search_profile` functions; one
   `billing_settings` row (`saved_profiles_max` = 5). It gives every member a
   first profile called "My deals" holding their current answers and areas,
   tags their history with it, and copies today's Today lists across.
   Nothing is added to `ACCESS_COLUMNS`. Old code keeps working against it;
   until it is run the new code behaves as before (one profile, no labels,
   no switcher).
2. **Straight after the deploy:** as an existing member, the header pill
   opens the switcher and `/profiles` lists "My deals". Create a second
   profile: the price line shows first; Today, the deal pages and the
   Explorer follow whichever profile is active.
3. **Check the dry runs:** `/api/internal/sourcing?dry=1` reports one
   `wouldEmail` entry per running profile (`profile`), and
   `/api/internal/daily-digest?dry=1` lists each member's `profiles` with
   what each would be charged.
4. **The deploy day:** a member charged for daily deals by the old code that
   morning is not charged again for their active profile (the old
   `daily_deal_charges` row counts as its charge).
5. **Terms and privacy:** `/terms` sections 2A and 4A and the privacy
   policy's "Information about other people" were drafted for this batch
   (no legal draft existed for them). Have them checked before merging.
6. **Admin:** `/admin/profiles` shows profiles per member, running profiles
   per member, the share with two or more, and weekly active for one
   profile against two or more.

### 9. Switch on tailoring (Batch 14)

1. **Before merging, run `supabase/schema.sql`** (the "Batch 14: tailoring"
   section, at the end). Run it after Batch 13's section: it adds to that
   section's tables. It is additive and idempotent: `filter_modes` on
   `search_profiles`, `shown_ids` and `tailoring` on `profile_today_lists`,
   and a new service-role table `tailoring_prompts`. No `billing_settings`
   rows (every tailoring number is in `src/lib/tailoring/config.ts`) and
   nothing added to `ACCESS_COLUMNS`. The code reads each new column in a
   query of its own, so until it is run members get no must-have switches,
   no profile checks and no "never shown twice" record for replaced cards;
   Today itself still works.
2. **Straight after the deploy:** a member with no new answers sees exactly
   the Today they saw before (the golden test in
   `src/lib/today/choose.test.ts` pins it). "No new answers" means no real
   quiz answer beyond the goal fields Today already read, no must-have
   switch, no bedrooms preference, and no Keep, own open or Full analysis in
   the last 60 days (`usesTailoring` in `src/lib/tailoring/profile.ts`): any
   of those puts them on the tailored path. Answer a few quiz questions on a
   test account, then flip a must-have on `/profile` and watch Today change.
3. **Check the dry runs:** `/api/internal/sourcing?dry=1` and
   `/api/internal/daily-digest?dry=1` show each member's advice line,
   whether the teasers carry "Yes, more like this" / "Not for me", and
   whether "Act fast · new today" is on. Nothing is written.
4. **The browser extension** now shows "Most you can pay" instead of the
   10%-yield ceiling (`extension/src/content.ts`): it needs a Chrome Web
   Store release to reach members.
5. **Admin:** `/admin/tailoring` shows the keep rate on Today's 5 by role,
   profile completeness and deals wanted; open → Full analysis by what holds
   members back; and how often each tailoring action happened.

### 10. Switch on demand-led sourcing (Batch 15)

1. **Run `supabase/schema.sql`** (the "Batch 15: demand-led sourcing"
   section). It is additive and idempotent: a service-role table
   `demand_searches`, the `demand_search_reserve` and `demand_sourcing_month`
   functions, and six `billing_settings` rows (`demand_min_members` 2,
   `demand_monthly_cap_pence` 10000, `demand_paying_weight` 2,
   `demand_radius_areas` 5, `demand_active_days` 30,
   `demand_max_areas_per_profile` 10). Nothing is added to `ACCESS_COLUMNS`.
   Until it is run the demand job searches nothing and `/admin/demand` says
   so; the rest of the site does not read any of it.
2. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/demand-sourcing` (every 10 minutes 05:05–06:55 UTC).
3. **Check the dry run:** `/api/internal/demand-sourcing?dry=1` lists what it
   would search, each search's worst-case cost, the month's spend and what is
   left, and every skipped area with its reason. It asks the broker nothing
   and writes nothing. `/admin/demand` shows the same plan live.
4. **Then switch it on:** set `DEMAND_SOURCING_ENABLED=true` (off until then,
   like the text alerts). "Run a pass now" on `/admin/demand` works either
   way.
5. **The sweep changes on the same deploy:** passes skip searches an earlier
   pass finished today, so the sweep reaches its whole list (it stalled at
   about 30 of 108 a day), with areas members want first. `/admin/deals`
   shows each pass as "done today / list".

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
| `src/app/my-deals` | My deals: every deal a member is working on, grouped by stage (Kept, Contacted, Viewing, Offer, Secured, Passed), and the Reports tab. The merge of pipeline, Keep / Pass, opens and picks is `src/lib/listing/tracked.ts` (pure, tested); its reads are `tracked-server.ts`. The one list of kept and passed deals: old `/deals?view=kept` and `?view=passed` links redirect here, and `?show=passed` opens the Passed group |
| `src/app/reports` | `/reports/[id]` reopens a saved report (linked from emails and PDFs); `/reports` itself redirects to My deals' Reports tab |
| `src/app/picks` | Daily picks: every property the sourcing cron has emailed the member, with feedback and save-to-pipeline. `src/app/p/[token]` is where the email buttons land (public, token-keyed) |
| `src/app/admin/picks` | Daily picks admin: the feedback report, the test-pick and dry-run buttons, and `responses` — every answer a member has given, with the pattern cuts and a CSV export |
| `src/app/welcome` | The profile quiz (Batch 12): one question per screen, saved as it goes; `/profile` is the summary and editor. Rules in `src/lib/profile` (pure, tested), reads and writes in `src/lib/profile/server.ts`; the three mandatory questions gate every members-only page from `AppShell` |
| `src/app/admin/profile` | Profile quiz completion rate, where members stop, and where "Not sure" is chosen most |
| `src/app/profiles` | Saved profiles (Batch 13): up to five sets of search criteria per member (a sourcer keeps one per client). The active one is what the header shows and every page follows; each running (not paused) one gets its own Today's 5, section of the daily email and daily charge. Rules in `src/lib/profiles/rules.ts` (pure, tested), reads and writes in `src/lib/profiles/server.ts` (`activeProfileFor`, `runningProfilesFor` for later batches). The active profile's criteria are also the live `profiles.market_goals` / `saved_areas`, kept in step by triggers, so pages that follow the active profile read them unchanged. `/profiles/switch?to=<id>&next=…` is the email links' way in |
| `src/app/admin/profiles` | Saved profiles per member, running per member, the share with two or more, and weekly active split by one profile against two or more |
| `src/lib/tailoring` | Tailoring (Batch 14): what a profile's answers do to Today, Browse ("Best for you"), the Explorer, the cards' three numbers, the why-line and match, "widen and see", the profile checks and "Most you can pay". Every rule is pure and tested; every number is in `config.ts`; the reads and writes are the `*-server.ts` files. A member with no new answers takes the untouched path |
| `src/app/admin/tailoring` | Keep rate on Today's 5 by role, profile completeness and deals wanted; open → Full analysis by what holds members back; tailoring actions by step |
| `src/app/p/d` | Where a daily-email teaser's "Yes, more like this" / "Not for me" lands (public, keyed on the send's own token): a GET writes nothing, one confirming button records a Keep or a Pass |
| `src/app/admin/demand` | Demand vs supply (Batch 15): per postcode area × kind × house / flat, the members and profiles that want it beside the live deals, whether the sweep or the demand-led searches cover it, and the gap; this month's spend against the cap, the next pass's plan, the settings and the latest searches. Rules in `src/lib/sourcing-demand` (pure, tested), reads and writes in `src/lib/sourcing-demand/server.ts` (below) |
| `src/app/admin/weekly-active` | Weekly active against its targets, how members use the app, the per-member drill-down with the "Exclude from metrics" switch, the backfill and the retention count (below) |
| `src/app/account` | Account: the plan (pause, cancel), billing, notifications, what the member is looking for, a quieter "More" list and sign out; a team member sees their team in place of plan and billing. `/account/billing`: credit balance, top-ups, usage history |
| `src/lib/nav.ts` | The members' nav, and every "where does this live" rule more than one page needs: the kept/passed redirects, the goals editor's link (`GOALS_EDITOR_HREF`: the one line to repoint when it moves), Today's list anchor for the first-week checklist, Account's "More" links. Pure, tested |
| `src/app/api` | Route handlers, including the Stripe webhook and the cron endpoints |
| `src/lib/access.ts` | Billing state of an account: subscriber, paused, lapsed, pay-as-you-go |
| `src/lib/credit/` | The credit ledger: unit costs, metering, reservations, estimates, plans, perks |
| `src/lib/sms/` | Text alerts: Twilio sending and webhooks, verification codes, the renderer, the alerts run |
| `src/lib/activity/` | The activity log: what members do, visits, and the weekly-active figures (below) |
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

Saved profiles (Batch 13): a member with several running profiles still gets
one daily email, with a headed part for each profile (active first), each its
own pick and Today and its own day's charge; no deal is told twice. When the
credit runs out part-way the later profiles are left out and named. Once a
member has two profiles, change lines, the out-of-credit letter and Your week
name the profile each thing is for.

## Text alerts

`src/lib/sms`: a text within the hour when something changes on a deal a
member tracks. Off for everyone until the member verifies a UK mobile in
Account → Notifications (a 6-digit code, from the same number as the alerts).

- **What:** price drop, back on the market, getting attention, gone. Each has
  its own switch (registry entries, channel `sms`); all four turn on when a
  member first verifies. The content is Batch 6's `deal_alerts`, rendered by
  `render.ts` as one plain GSM-7 text of at most 160 characters. It never
  includes an address, postcode or listing link: bedrooms, type, town, prices
  and a link to My deals (`<site>/m`, which opens My deals marked as reached
  from a text, so the click is counted).
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

## Activity tracking

`src/lib/activity`: one log of what members do (`activity_events`), their
visits (`activity_visits`), and the weekly-active figures on
`/admin/weekly-active`, with a headline on `/admin`. Every table is service
role only: members cannot read any row, their own included. Nothing is
charged.

- **Recording:** `logActivity(userId, kind, opts)` in a page, server action or
  route handler (the write happens after the response and never blocks or
  throws); `recordActivity(...)` in code that already runs after the response
  (webhooks, crons, `after()` callbacks, the auto top-up). The kinds are in
  `kinds.ts`, each marked as counting towards weekly active or recorded only.
  A repeat with the same key (`dedupeKey`) is ignored, and so is an identical
  event within 60 seconds.
- **Never recorded:** an address, a postcode, a listing link, page content or
  anything typed. Extras are short tokens, checked in `event.ts`; a listing
  link given to the helper becomes a deal id and is not stored.
- **Visits:** `VisitHeartbeat` (in `AppShell`) posts to `/api/presence`: on a
  page load, once a minute while the tab is shown and in use (not after 5
  minutes idle), and when Today, a deal page or a saved report is on screen.
  A visit ends after 30 minutes with nothing happening.
- **Email and text clicks:** our own links in emails carry `?via=email`; the
  alert text links to `/m`, which redirects to `/my-deals?via=sms`. The
  heartbeat records the click and takes the marker off the address.
- **Weekly active:** a qualifying action in the week, Monday to Sunday UK
  time. The base is every account from the week it joined, less `ADMIN_EMAILS`,
  `@stayful.co.uk` and accounts switched off on the page. Billing groups
  (Paying, Paused, Cancelled, Never paid) are judged at the end of each week,
  and a team member is in their owner's group. Targets: 40% of all members, 60%
  of Paying and of Active paying.
- **History:** the backfill copies older tables (deal opens, Keep and Pass,
  reports, shares, top-ups, pick-email answers, next steps, plan changes) up
  to the first event logged live in production. Weeks before that undercount
  and are labelled.
- **Retention:** 24 months (`activity-retention`, nightly).
- **Batch 10's events:** `full_analysis` (once per purchase, when it
  completes), `pmi_addon` (PMI added later from the report; at purchase it is
  on the `full_analysis` event), `deal_open` for the open inside a one-tap Full
  analysis, `reminder_shown` (recorded only, sent from the browser once a
  reminder is on screen) and `reminder_acted` (a Full analysis started from the
  reminder's button). Their take-up figures are on `/admin/weekly-active`.

## Demand-led sourcing

`src/lib/sourcing-demand`: members' running saved profiles steer which extra
areas get searched, within a monthly spend cap.

- **Demand:** every running profile (Batch 13's `allProfilesFor` +
  `seatsFor`, as the daily run reads them) of members seen in the last
  `demand_active_days` days, less `ADMIN_EMAILS`, `@stayful.co.uk` and
  accounts switched off on `/admin/weekly-active`. A team counts once, as the
  account that pays. "Most profitable anywhere" adds no areas; chosen areas
  count; "near me" adds the home area plus the nearest
  `demand_radius_areas` inside the radius; existing units and a company's
  operating areas count too, at most `demand_max_areas_per_profile` a
  profile.
- **What is added:** an area × kind wanted by `demand_min_members` members
  that the marketplace sweep does not cover (the sweep takes every area with
  5+ analyser reports, so these are "early" areas; areas with no data cannot
  be screened and are never searched). Most wanted first, paying members
  counting ×`demand_paying_weight`. The sweep's own list is never shortened;
  it just searches members' areas first.
- **The cap:** each search claims its worst case against
  `demand_monthly_cap_pence` for the UK month before it asks, and is settled
  to what the meter recorded for it. When the cap is spent, demand-led
  searches stop until the 1st; the sweep, daily picks and the recheck never
  read it. A pass stops at the cap, after two searches in a row get no
  answer, at eight searches or after 44 s.
- **Cost:** a search is one PMI listings credit (2p) or one OnTheMarket page
  (0.2p nominal) while PMI is down. This month's spend:

  ```sql
  select public.demand_sourcing_month(jsonb_build_object('month',
    to_char(date_trunc('month', now() at time zone 'Europe/London'), 'YYYY-MM-DD')));
  ```

