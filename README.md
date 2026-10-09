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

Vercel deploys `main` automatically. Everything below is **not** automated,
and has to be done by hand, in the order given.

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

Twelve of them, listed with what each is for in `.env.example`. The endpoint is
`/api/stripe/webhook`. `invoice.paid` is what turns a subscription payment into
plan credit and `payment_intent.succeeded` is what credits a one-click top-up,
so without those two people pay and nothing arrives.

`customer.subscription.updated` is the one to double-check: it carries pause,
resume and scheduled cancellation. Without it `/account` still looks correct,
because the server actions write the columns directly, but the row quietly
drifts out of step with Stripe from then on.

**The endpoint's API version must be the one the `stripe` package reads**,
currently `2026-04-22.dahlia` (`node -p "require('stripe').API_VERSION"`); a
later `.dahlia` version also works, an older family does not. Stripe writes
every event in its endpoint's version, and the handler reads the newer shapes:
an invoice's subscription at `invoice.parent.subscription_details`, a
subscription's period on its items. An endpoint on an older version (an
account's default can be years old) still passes the signature check, but every
subscription invoice is skipped as "invoice without subscription", so a plan is
paid for and no credit arrives. An existing endpoint's version cannot be
changed: create a new one with `api_version` set (through the API if the
Dashboard's picker doesn't offer it), put its secret in `STRIPE_WEBHOOK_SECRET`,
redeploy, then turn the old one off. Do the same whenever the `stripe` package
moves to a new API version family.

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

### 11. Switch on deal checks (Batch 16)

Every marketplace deal earns its place on its own Airbnb comparables
instead of the area's average, says how sure its range is, and two cheaper
ways in get their own streams. In this order:

1. **Run `supabase/schema.sql`** (the "Batch 16: deal quality" section; the
   Batch 14 and 15 sections too if the database is still without them). It
   is additive and idempotent: the settings rows (`r2r_qualified_profit`
   6000, `auction_model`, `area_rent_daily_attempts` 40, `low_entry`,
   `deal_comps`, `deal_confidence`, `deal_checks`), the
   `analyser_reports_removed` archive, `provider_calls.raw_pence`, three
   spend functions, `marketplace_deals.stream` (filled in once for existing
   rows) and the shortlist index. Nothing is added to `ACCESS_COLUMNS`.
   Until it is run every setting falls back to its decided default, the
   spend views page through rows, the backfill clean-up refuses to delete,
   and deal rows are written without their stream.
2. **Clean up the past reports:** on `/admin/demand`, "Past reports" →
   Dry run, then Run (about £1.30 of geocoding; duplicates are archived
   before they are deleted). `/api/internal/report-backfill?dry=1` is the
   same plan.
3. **Read Step 0:** the "Deal checks · Step 0" panel on `/admin/demand`
   holds the comparison with past full analyses (run twice on 29 Sep 2026:
   11.5% typical gap against the 15% gate; the area average sits 16.7%).
   Nothing to do unless the check's method changes; `?reset=1` starts it
   again on the same cases.
4. **Check the crons:** Vercel → Settings → Cron Jobs lists
   `/api/internal/deal-checks` (03:40, 03:50, 04:00, 04:10, 04:20 UTC) and
   `/api/internal/low-entry-search` (03:00, 03:10, 03:20 UTC).
5. **Dry-run the checks:** `/api/internal/deal-checks?dry=1`, or "Dry-run
   today's checks" on `/admin/deals`: the day's slots by stream, what would
   be checked (area, bedrooms, stream, profit; never an address), the
   worst-case cost and what the day's cap has left. Asks nothing, writes
   nothing. The shortlist is empty until the switch is on.
6. **Then switch the checks on:** `DEAL_CHECKS_ENABLED=true`. From the next
   sweep a qualifying listing waits as `pending_check` for its own check
   (20 a UK day, £1 raw, by stream; `billing_settings.deal_checks`, editable
   on `/admin/deals`) instead of going live on the area's average. "Run a
   checks pass" on `/admin/deals` works either way.
7. **Bring the deals already live through a check:** on `/admin/deals`,
   either "Dry-run the re-check" then "Run a re-check pass" (sales by
   profit first, then rentals; £12 ceiling over every run, and the day's
   cap; press again to carry on) or "Count unchecked live deals" then
   "Retire every unchecked live deal" (the next sweep revives each onto the
   shortlist while it is still in the feed). `/api/internal/deal-recheck?dry=1`
   and `?retire=1&dry=1` are the same.
8. **The low-entry search:** "Dry-run low-entry search" then a few "Run a
   low-entry pass" presses on `/admin/deals` to see the nationwide count
   under the £150,000 cap (Batch 22c; about 18p a pass), then
   `LOW_ENTRY_SEARCH_ENABLED=true` for the cron. The cheap price (£150,000)
   and the search cap are settings on the same page.
9. **Market-warm** has its own switch now (`MARKET_WARM_ENABLED=false`
   stops the 04:45 cron) and `?dry=1`.

### 12. Interest-only mortgages (Batch 16b)

Every purchase deal is priced on an interest-only mortgage: the monthly
payment is the loan × the rate ÷ 12, and the loan is repaid when the
property is sold or refinanced. The one setting is
`DEFAULT_FINANCE.mortgageType` in `src/lib/listing/deal.ts` (`interest_only`;
the repayment formula is kept behind `repayment` and nothing selects it).
`mortgagePayment` is the one function the deal maths, "most you can pay"
(`maxPriceForProfit`, its exact inverse), Batch 17's refinance and Batch
28's buy-to-let read. Cash flow, cash-on-cash, the profit range on cards,
"most you can pay", the offer note, the Explorer verdict, the report page,
its PDFs and the reports API all move; cash in, stamp duty, setup, the
streams, qualification and every rent-to-rent figure do not. Nothing in the
schema or `billing_settings` changes, nothing is added to `ACCESS_COLUMNS`,
and the mortgage a member types into `/estimate` stays as entered. Every stored purchase deal (marketplace deals, picks, Explorer
checks, saved reports) reads at the current type wherever it is parsed
(`atCurrentMortgage`, `atCurrentMortgageResult`), so no screen shows a
repayment figure beside an interest-only one. Once, after deploying:

1. **Dry-run the backfill:** "Dry-run the interest-only backfill" on
   `/admin/deals`, or `/api/internal/mortgage-backfill?dry=1`: the rows to
   rewrite per table, the live sale deals on both formulas (cash flow and
   the profit check at each minimum in force) and five worked examples.
   Writes nothing.
2. **Run it:** "Run the interest-only backfill" rewrites the stored deal
   JSON to match what the screens already show (no spend; press again if
   it runs out of time; a second run finds nothing). Recorded in
   `marketplace_runs` as `mortgage_backfill`.

### 13. Project deals, and "Which deals do you want to see?" (Batch 17)

Two things arrive together. Every saved profile answers **"Which deals do
you want to see?"** (Short-let, BRRR, Rent-to-rent; Buy to let shows as
"Coming soon" and cannot be chosen), each chosen type with its own money
question, and Today's 5 become a mix of the chosen types (2 / 2 / 1 for
all three, 3 / 2 for two, shifting with Keeps; `billing_settings.today_mix`).
And a sale whose own words say it needs work can become a **Project (BRRR)
deal**: held for its comparables check and then a photo check (Claude,
within a daily allowance), costed as a guide, valued after works against
nearby sold prices, and shown only when the value added (value after works
less the price and the works at the high end) is at least £15,000 and 10%
of the value. Everything that decides it is a setting (`project_*` rows,
defaults in `src/lib/project/config.ts`). In this order:

1. **Run `supabase/schema.sql`:** the "Batch 17: project deals" section,
   after Batch 16's (and Batch 14's and 15's if the database is still
   without them). Additive and idempotent: `marketplace_deals.needs_work`
   and `.project`, two partial indexes, four private tables
   (`project_checks`, `project_prep`, `project_estimates`,
   `project_member_figures`: row-level security on, no policies), the
   `project_claim_check` function (service role only) and seven settings
   rows, `project_checks.enabled` among them **off**. Nothing is added to
   `ACCESS_COLUMNS`, and the new columns are in neither `DEAL_COLUMNS` nor
   `CARD_COLUMNS`: each is read with its own tolerant select, so the site
   keeps working before the section is run, but nothing Project-related
   happens until it is. The deal types need no column (they live in the
   profile's goals JSON).
2. **Check the keys:** `ANTHROPIC_API_KEY` (the photo check) and
   `PROPERTYDATA_API_KEY` (sold prices, listed-building and
   conservation-area checks) on Production and Preview. The Project checks
   panel on `/admin/deals` says when either is missing. The new unit costs
   (sold prices 2.5p a call; the photo check's own input and output token
   rates) are read from the code's seed until "Re-seed missing rows" on
   `/admin/billing` adds them to the table for editing.
3. **Move existing profiles onto deal types:** `/admin/profiles` → "Deal
   types" → Dry run (every profile's before and after; no address or email),
   then Run, then Run again: the second run must write nothing.
   `/api/internal/deal-types-backfill?dry=1` is the same dry run. Profiles
   with nothing to go on meet the question on their next visit, and until
   then see Short-let and Rent-to-rent, never BRRR.
4. **A week of dry runs, the Project checks still off.** They need Batch
   16's checks on first (`DEAL_CHECKS_ENABLED=true`, section 11): a Project
   candidate waits on the same shortlist for its comparables check. Each
   day, "Dry-run the Project checks" on `/admin/deals` (or
   `/api/internal/project-checks?dry=1`): the day's allowance and spend,
   what waits, and what a pass would do. Asks nothing, writes nothing.
5. **Confirm the sold-price reply once** (one credit, about 2.5p):
   `curl "https://api.propertydata.co.uk/sold-prices?key=$PROPERTYDATA_API_KEY&postcode=OX3+9DW&type=terraced_house&max_age=24&points=100"`.
   `parseSoldPrices` (`src/lib/apis/propertydata-parse.ts`) reads
   `data.raw_data[]`, each sale with `price`, `date` and either `distance`
   or `lat` / `lng`. If the reply is shaped differently, stop here and send
   it on (without the key): every candidate would otherwise end
   "too few sold prices" and never become a Project deal.
6. **Switch on, small:** tick "Project checks on" on `/admin/deals` and set
   "Project photo checks a day" to 1. The crons
   (`/api/internal/project-checks`, every ten minutes 04:25–05:55 UTC) then
   make at most one photo check a pass, within the day's allowance and the
   250p spend line (photo checks, sold prices and planning checks
   together); all of it is house spend, never a member's credit. Check the
   spend line on `/admin/deals` and the outcomes on `/admin/deals/projects`
   for a few days, then set the allowance back to 5.
7. **Bring the live deals through once:** in the same panel, "Dry-run the
   live-deal backfill" (counts and examples: area, bedrooms, type, the
   phrases, the decision; never an address; every example on
   `/admin/deals/projects`), then "Run the live-deal backfill" (it refuses
   while the Project checks are off). Sales already live whose words say
   they need work go back on the shortlist for their Project check, or are
   retired as a newcomer would be. `/api/internal/project-backfill?dry=1`
   is the same; a run that runs out of time carries on when pressed again.

Members' own working on a Project deal (edit, save, lock) is free and
private to them: a teammate never sees it, and a Full analysis report
shows the reader's own locked figures beside ours without storing them.

### 14. Switch on feedback and announcements (Batch 18)

Members can report a bug or suggest an idea from any members-only page (with
screenshots), see where each has got to on "Your feedback", and get an email
when its status changes. Admin sorts them on `/admin/feedback` and tells
members about new features and fixes with a banner from
`/admin/announcements`. In this order:

1. **Before merging, run `supabase/schema.sql`** (the "Batch 18: feedback
   and announcements" section; previews use the live database). It is
   additive and idempotent: new service-role tables `feedback_reports`,
   `feedback_screenshots`, `feedback_status_emails`, `announcements` and
   `announcement_views`; the `feedback_submit`, `feedback_status_claim` and
   `announcement_stats` functions; six `billing_settings` rows
   (`feedback_daily_limit` 10, `feedback_max_screenshots` 3,
   `feedback_screenshot_max_mb` 5, `feedback_screenshot_retention_days` 90,
   `feedback_admin_email` zac@stayful.co.uk, `announcement_max_age_days`
   30); and the private storage bucket `feedback-screenshots`. Nothing is
   added to `ACCESS_COLUMNS` or `profiles`. Until it is run the form says
   feedback isn't switched on yet, the admin pages say to run it, and no
   banner shows.
2. **Check the bucket is private:** `select id, public, file_size_limit,
   allowed_mime_types from storage.buckets where id = 'feedback-screenshots';`
   gives `public` = `false`. If the run printed a notice ("The
   feedback-screenshots bucket was not created") instead, create it by
   hand: Storage → New bucket → `feedback-screenshots`, Public **off**,
   allowed types `image/jpeg, image/png, image/webp`, 20 MB limit. Then
   `select policyname, cmd, roles, qual from pg_policies where schemaname =
   'storage';` must show nothing that opens every bucket to members (there
   were no storage policies at all when this batch was built). Only the service role reads
   the bucket; admin sees an image through a link that lasts 5 minutes, and
   members never get one.
3. **Vercel:** Settings → Environment Variables → "Automatically expose
   System Environment Variables" on, so each report records the app version
   (`VERCEL_GIT_COMMIT_SHA`); without it the version reads "unknown" and
   nothing else changes. `RESEND_API_KEY` and `EMAIL_FROM` are already set
   for the other emails; without them a report is still saved, admin shows
   "email to admin not sent yet", and the nightly run sends it once they
   are set (for reports up to 3 days old).
4. **After the deploy:** as a member, send a bug with a phone screenshot and
   an idea without one ("Feedback" in the header, or "Send feedback" at the
   foot of any page). Both reach zac@stayful.co.uk (a reply goes to the
   member) and `/admin/feedback`. Open one, choose Planned with a line for
   the member, **Preview emails**, then **Save**: the member gets one email,
   and "Your feedback" (Account → More) shows the status and the line.
5. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/feedback-retention` (02:45 UTC). `?dry=1` counts admin
   emails still to send, screenshots past the retention period or without
   their report, and the oldest image kept, and changes nothing.
6. **Announcements:** `/admin/announcements` → New announcement; the
   preview is what members see. Publish shows it to every member who joined
   before then (free, paid and team) for 30 days, until they tap Dismiss or
   "Take a look".
7. **Privacy:** the privacy policy's paragraph on feedback (what a report
   keeps, and that screenshots are deleted after 90 days) was drafted for
   this batch. Have it checked before merging.

### 15. Switch on cookie consent and Meta measurement (Batch 19)

A cookie banner (Accept / Reject, and "Cookie settings" at the foot of every
page), Meta's pixel and Conversions API for five conversions
(CompleteRegistration, ProfileComplete, FirstReport, Subscribe, Purchase),
and "Sign-ups by source" on `/admin/signups`. Nothing is sent to Meta, and
no Meta code or cookie reaches a browser, until the visitor taps Accept. In
this order:

1. **Before merging, run `supabase/schema.sql`** (the "Batch 19: consent
   and attribution" section; previews use the live database). It is
   additive and idempotent: new service-role tables `consent_records` (the
   proof of every choice), `member_consent` (each member's latest choice),
   `member_attribution` (which ad or link brought each new account) and
   `meta_conversions` (every conversion, and what was sent); the
   `member_consent_set` and `signup_source_facts` functions; and one
   `billing_settings` row, `meta_tracking_since`, set once to the moment
   the section first runs. The sign-up conversions only count for accounts
   made after it and Subscribe only for subscriptions started after it, so
   existing members never fire them. Nothing is added to `ACCESS_COLUMNS`
   or `profiles`, and there is no cron. Until it is run the site works but
   nothing is recorded or sent, and `/admin/signups` says so.
2. **Meta Events Manager → the dataset → Settings:** turn **Automatic
   advanced matching off** (required: the code only ever sends a hashed
   email and account number, and cannot switch Meta's own matching off);
   turn "Track events automatically without code" off; leave first-party
   cookies on; under Traffic permissions allow only the site's domain.
   Then Settings → Conversions API → generate an access token.
3. **Meta Business settings → Brand safety → Domains:** verify
   `stayful.co.uk`.
4. **Vercel → Environment Variables (Production):**
   `NEXT_PUBLIC_META_PIXEL_ID` (the dataset id, digits only) and
   `META_CAPI_ACCESS_TOKEN` (server only; never sent to the browser or
   logged). `NEXT_PUBLIC_` values are fixed at build time, so redeploy
   after setting it. Without the id there is no banner, pixel or server
   event; without the token the browser still sends all five conversions.
   The pixel only ever loads on the live site; a preview shows the banner
   but never loads it.
5. **Ads Manager → each ad → URL parameters:**
   `utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}`.
6. **To test:** Events Manager → Test events gives a code; set it as
   `META_TEST_EVENT_CODE` and redeploy, then run the checklist in the pull
   request. Every server event then carries the code and shows only under
   Test events, and `/admin/signups` warns that test mode is on. Remove it
   and redeploy when done. `META_DRY_RUN=true` logs what would be sent
   instead of sending it.
7. **Privacy:** the Cookies section and Meta in "Who we share it with" were
   drafted for this batch; have them checked before merging. The policy
   promises an email before any significant change: decide whether to send
   one before setting the dataset live (nothing in this batch sends it).
8. **Lead-form members:** this batch never sends CompleteRegistration for
   them. The n8n workflow "Stayful lead activated → Meta CAPI" (inactive)
   does that job; if it is switched on, move it to Graph API v26.0 and have
   it respect the member's cookie choice (`member_consent`).

### 16. Switch on the starter pack, the £5 decision, inactivity and the Monday funnel (Batch 20)

The £10 starter pack (£30 of credit) in place of the £20 welcome credit for
new members; the Starter-or-£10 decision at £5 for members with no plan;
Re-engage at 14 quiet days and daily picks paused at 25; and every member's
row and group on the Monday board "Stayful Intelligence enquiries". Each is
off until switched on below, and every number is a `billing_settings` row
editable on `/admin/lifecycle`. In this order:

1. **Before merging, run `supabase/schema.sql`** (the "Batch 20: starter
   pack, inactivity and Monday sync" section). Additive and idempotent: five
   `profiles` columns (`starter_pack_bought_at`, `starter_pack_snoozed_until`,
   `reengage_since`, `picks_paused_inactive_at`,
   `picks_paused_inactive_email_at`), service-role tables
   (`starter_pack_purchases`, `member_payments`, `member_refunds`,
   `member_active_days`, `member_engaged_days`, `monday_funnel_queue`,
   `monday_funnel_runs`, `monday_funnel_lock`), their functions, and eight `billing_settings`
   rows. `starter_pack_from` and `inactivity_from` start empty, which keeps
   the pack and the inactivity rules off. It also freezes the 12 Sep welcome
   backfill to accounts created before 13 Sep 2026: before this, every run of
   the schema granted £20 to every account without one. Nothing is added to
   `ACCESS_COLUMNS`.
2. **Stripe:** a product "Starter pack" with a one-off **£10 GBP** price; its
   id is `STRIPE_PRICE_STARTER_PACK`. The pack refuses to sell if the price's
   amount differs from `starter_pack_price_pence`. The webhook must deliver
   `checkout.session.completed`, `payment_intent.succeeded`,
   `payment_intent.amount_capturable_updated`, `payment_intent.canceled`,
   `charge.refunded` and `charge.dispute.created` (the pack is captured,
   granted, let go when its card hold is cancelled, and clawed back by them),
   from an endpoint on API version `2026-04-22.dahlia` (§2);
   `/admin/lifecycle` shows the last event received, and warns while none
   ever has.
3. **Vercel → Environment Variables (Production):** `STRIPE_PRICE_STARTER_PACK`;
   `CREDIT_ENFORCE=true` (without it £0 members can still run everything, so
   the pack buys nothing; `/admin/lifecycle` warns); and remove any old
   `MONDAY_COL_*`, `MONDAY_ENQUIRY_BOARD_ID` or `MONDAY_ENQUIRY_GROUP_ID`
   (no longer read). Leave `MONDAY_FUNNEL_ENABLED` unset for now.
4. **Mobile numbers:** `/admin/lifecycle` → Mobile numbers → Dry run, read the
   shared numbers, then Record the numbers. The oldest account keeps a
   shared number; no credit is touched.
5. **Monday:** `/admin/lifecycle` → Backfill: dry run, and read the table
   (every member, current group → new group, and every value). Then set
   `MONDAY_FUNNEL_ENABLED=true`, redeploy, and Run the backfill (again if it
   says it stopped early: it writes only what still differs). Rows in
   "Excluded" are never touched, and nobody gets a second row: a member whose
   number is on another member's row is left without one, and the sign-up
   row (as before) is made only when no row has their email or number, and
   never for an admin, a Stayful account or a team member. **Only then
   switch on the n8n trigger** on rows entering Re-engage: the backfill moves
   many rows at once.
6. **Inactivity:** set "Inactivity counted from" to the release date. Nobody
   is counted as quiet from before it, so night one does not move everyone
   who has been quiet since sign-up. The nightly (`/api/internal/monday-funnel`,
   every 10 minutes, the nightly part from 06:00 UK) then moves members into
   Re-engage at 14 days and pauses their picks at 25; any real action brings
   them straight back. Engaging by email or text counts here (a click through
   to the site, an answer or a setting changed from an email, but not an
   unsubscribe), though not towards weekly active or Monday's Last active,
   Active days and Active weeks. "Nightly: dry run" shows who would move.
7. **The starter pack:** set "Starter pack for accounts created from" (or
   Start now). From that moment new accounts get the pack offer and no £20
   welcome credit; accounts created before it are untouched and never see
   it. The public pages switch their copy within five minutes. The date can
   be moved: an account that already had the £20 is never offered the pack,
   and moving the date later (or clearing it) gives the £20, at their next
   sign-in, to the accounts created in between that have neither.
8. **Terms:** the new starter pack clause (section 2) shows once the pack's
   date is set; have it checked, and bump the page's date when it changes.

The member-facing surfaces: the welcome quiz (a pack screen once the welcome
questions are answered), a Today card ("Not now" hides it for a week), a line
on Account → Billing, and the pack in place of every dead end (the deal page's
Quick look box, the out-of-credit dialog, the banner, the 08:00 letter). At
£5 or less a member with no plan gets the Starter-or-£10 banner and one email
a cycle, inside the day's daily email, or alone in its slot once the day's
daily emails have gone (from 08:30 UTC); its buttons open
`/account/billing/choose`, which charges only when confirmed there.

### 17. The Batch 21 review fixes

Nine branches from the review of Batches 1–20 (`docs/reviews/batch-21-review.md`),
merged in the order 21a, 21d, then the rest. What each needs by hand, in the
order it is needed:

1. **Before the ads, and before `starter_pack_from` is set:** first add the
   `@stayful.co.uk` staff logins that use the product to `ADMIN_EMAILS` on
   Vercel (Production). Only `ADMIN_EMAILS` accounts bypass the credit gate,
   so a staff account left off the list is blocked at £0 the moment the flag
   flips (B41); being on the list also grants the `/admin` dashboard, so list
   only staff you are happy to make admins (a credit-only staff exemption,
   without admin access, would need a one-line change in `src/lib/credit/auth.ts`).
   Then set `CREDIT_ENFORCE=true`, and **run `supabase/schema.sql`** (the
   "Batch 21: review fixes" section, 21a): the atomic `credit_plan_cycle`
   function the webhook uses, the one-off forgiveness of every shadow-mode
   overdraft (an `adjust` row per member; the count is printed), the referral
   guard in `credit_redeem_code`, and `leads.input`. Idempotent; nothing is
   added to `ACCESS_COLUMNS`. Flipping the flag before the schema runs means
   no pack-era account can overdraw in between.
2. **Stripe:** enable `charge.dispute.closed` on the webhook endpoint (21c):
   a dispute that is won or withdrawn gives the clawed-back credit back.
3. **n8n:** `N8N_SHARED_SECRET` now opens only `/api/internal/leads/provision`
   (21e). Nothing to change unless an n8n workflow calls another internal
   route with it: those take `INTERNAL_API_SECRET`.
4. **Monday (board 18413002067):** add a Numbers column "Weeks since sign-up",
   put its id in `MONDAY_FUNNEL_WEEKS_COLUMN`, and point the Engagement %
   formula at it instead of `ROUNDUP(DAYS(TODAY(), Signed up) / 7, 0)` (21f):
   the site writes it with the same Monday–Sunday weeks as Active weeks, so
   the ratio can no longer read over 100% or divide by zero.
5. **Resend:** verify a neutral domain (not stayful.co.uk) and set
   `EMAIL_FROM_WHITELABEL` to a sender on it (21g), so a funnel prospect's
   report email does not arrive from Stayful's address. Optional: unset,
   `EMAIL_FROM` is used as before.
6. **Crons (21e):** `vercel.json` moves `listing-recheck` to 06:03, adds a
   fourth `sourcing` pass at 07:50, moves `picks-paused` to 08:20 (after the
   08:10 digest), `funnel-queue` to :07 and :37, and `project-checks` off the
   demand-sourcing minutes in hour 05. Vercel → Settings → Cron Jobs should
   list the new times after the deploy; the table below is the new order.
7. **Next.js 16.3.7 (21i):** a full click-through on the preview before it
   merges (sign-up on a phone, the quiz, Today, a deal page with a photo, a
   Full analysis, an `/estimate` report and its PDF, `/account/billing`,
   `/extension/connect`, a cron with `?dry=1`).
8. **The Facebook app:** test the sign-up from the Facebook app on a phone
   before the first ad goes live (21h): inside its browser the Google button
   is replaced by "open this page in your browser", and the confirmation
   email opens in the phone's real browser, where the sign-up's session is
   not, so the member signs in with the password they chose. Optional: send
   sign-up confirmations through the token-hash `/auth/confirm` link (Supabase
   → Authentication → Email templates, `{{ .TokenHash }}`), which needs no
   session from the sign-up's browser.

Nothing in 21h needs a setting: the new optional variables are documented in
`.env.example` (`EMAIL_FROM_WHITELABEL`, `MONDAY_FUNNEL_WEEKS_COLUMN`,
`CRON_SECRET`, the PriceLabs and broker budget lines).

### 18. The signup reveal and Stayful Intelligence (Batch 22)

1. **Before the branch merges, run `supabase/schema.sql`** (the "Batch 22:
   signup reveal" section). Idempotent and additive: service-role tables
   `signup_reveals`, `member_searches`, `member_search_finds`,
   `resume_intents` and `si_call_consents`; `profile_today_lists.choice`;
   `analysis_purchases.offer` and `first_deep` with their unique indexes;
   `profiles.si_calls` and `si_calls_changed_at`; the `member_search_claim`
   and `member_search_true_up` functions; and the `billing_settings` rows
   (thresholds, caps, offers, call prices). Nothing is added to
   `ACCESS_COLUMNS`. **Its first run stamps `reveal_from`**: only members
   created after that moment get the reveal and the notification choices,
   so run it at deploy time, not days before. Until it is run the reveal
   gate fails open (members go straight to Today) and `/admin/intelligence`
   says so.
2. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/member-searches` (every 5 minutes). `?dry=1` lists the
   searches it would continue or settle and writes nothing.
3. **Then switch member searches on:** set `MEMBER_SEARCH_ENABLED=true` (off
   until then). Off, the reveal still ranks the stock we have and offers the
   what-ifs; the free signup search and the paid deep search do nothing. Its
   spend is capped per search and per month (`signup_search_cap_pence`,
   `signup_search_monthly_cap_pence`, `deep_search_max_raw_pence`,
   `deep_search_monthly_cap_pence`).
4. **Watch it on `/admin/intelligence`:** reveals viewed, time to first Keep,
   strong-match and no-match shares, search cost per sign-up and deep-search
   revenue. No-match members by area are a column on `/admin/demand`.

### 19. Calls from Stayful Intelligence (Batch 23)

Stayful Intelligence calls members who said yes (Batch 22's call choice):
an intro call once, and a low-credit call offering auto top-up; it answers
callbacks to the one SI number at any hour and replies to texts. Everything
is in `src/lib/voice` (the persona is `src/lib/persona`); `/admin/calls`
shows every call, including the ones a safety rule blocked and why.

1. **Run `supabase/schema.sql`** (the "Batch 23: Stayful Intelligence calls"
   section). Idempotent and additive, service role only: `si_calls_log`,
   `si_call_charges`, `si_webhook_events`, `si_tool_calls`, the conversation
   log (`si_conversations`, `si_conversation_turns`,
   `si_conversation_questions`) and the `si_*` settings rows. Nothing on
   `profiles`, nothing in `ACCESS_COLUMNS`. The safety rules are unique
   indexes: one outbound call a member a UK day, one in flight, one intro
   ever, one low-credit call per credit landing.
2. **Twilio:** open the existing UK 07 number and check **Voice** is ticked
   under Capabilities; allow the UK under Voice → Geo permissions. Leave the
   Messaging Service's incoming-message webhook as it is
   (`/api/twilio/inbound`). Create a Standard API key for ElevenLabs.
   Set `TWILIO_FROM_NUMBER` to the number (+447…) if it isn't already.
3. **ElevenLabs → Agents → Phone numbers → Import from Twilio:** the number,
   the API key SID and secret, and the account auth token. Afterwards check
   in Twilio that only the **Voice** webhook changed and SMS still points at
   `/api/twilio/inbound`. Copy the phone number id.
4. **Create the agent** ("Stayful Intelligence") and copy its id. Choose the
   voice (British, female, warm, mid-pace) and paste its id into
   `ELEVENLABS_VOICE_ID` on Production and Preview: the analyser and the
   calls use the one voice.
5. **ElevenLabs: nothing to set by hand.** Don't add webhooks in
   ElevenLabs → Agents → Settings: those apply to every agent in the
   workspace, and your other agents use them. The Sync (step 7) does it on
   the Stayful Intelligence agent only: it creates the post-call webhook
   through the API (`<site>/api/voice/elevenlabs/webhook`, HMAC; `<site>`
   is `NEXT_PUBLIC_SITE_URL`, `https://intelligence.stayful.co.uk`, not the
   Squarespace `stayful.co.uk`) and keeps its secret encrypted with
   `CRM_ENCRYPTION_KEY` (ElevenLabs only ever gives the secret to whoever
   creates the webhook); it attaches it to the agent (transcript,
   call-initiation-failure and answering-machine events; no audio), sets
   the agent's own "who is ringing" webhook
   (`<site>/api/voice/elevenlabs/initiate`, header `x-si-secret` =
   `ELEVENLABS_INITIATE_SECRET`), switches on its fetch for inbound Twilio
   calls, and sets transcript retention.
6. **Vercel (Production):** `ELEVENLABS_AGENT_ID`,
   `ELEVENLABS_PHONE_NUMBER_ID`, `ELEVENLABS_INITIATE_SECRET` and
   `ELEVENLABS_TOOL_SECRET` (two long random strings, typed nowhere else),
   and `CRM_ENCRYPTION_KEY`. `ELEVENLABS_WEBHOOK_SECRET` only if you made a
   post-call webhook by hand (its HMAC secret). On Preview,
   `SI_CALLS_DRY_RUN=true`. Redeploy.
7. **Sync the agent:** `/admin/calls` → The agent → **Dry run**, read what
   would change, then **Sync to ElevenLabs** (the prompt from the persona,
   the scripts, the approved call answers from the knowledge base (Batch
   24, §22), the five tools, the voice, the limits, the two webhooks, and
   the number's incoming calls: they go only to the agent the number is
   assigned to, and callers hear busy when there is none).
   Every variable also gets an unknown-caller default, so a call whose
   details never arrive still starts instead of the caller hearing busy.
   The Dry run has a phone check (where Twilio sends the number's calls,
   Twilio's and ElevenLabs' last calls, where the agent asks who is
   ringing; saved in `billing_settings.si_phone_check`, and run by the
   5-minute calls cron whenever `si_phone_check_request` is set to a newer
   time), and says what it will create, which agent has the number now,
   if Twilio isn't sending the number's calls to ElevenLabs, if a secret
   is missing, and if
   ElevenLabs' workspace settings point at this site (set them back: other
   agents use them). Then ring the number from your own phone: callbacks
   work while calls are off.
8. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/si-calls` (every 5 minutes; that makes 36 cron entries —
   check your plan's limit). `?dry=1` lists what it would place, block,
   reconcile and purge, and changes nothing.
9. **Switch calls on:** `SI_CALLS_ENABLED=true`, last. Members who said yes
   before now get their intro within minutes (inside 9am–7pm on weekdays).
   Then run the click-through checklist with your own phone.

Prices: a call minute is the `si:call_minute` unit row on Billing admin (raw
13p ESTIMATE × 5); texts and the missed-call email are `si_text_pence` and
`si_email_pence` on `/admin/calls`. Handoffs and forwarded texts go to the
address on `/admin/feedback`.

### 20. Cheap deals first (Batch 22c)

"Low entry" means a cheap price now: a sale with an asking price of at
most £150,000 (`billing_settings.low_entry.cheapMaxPrice`), an auction lot
at its auction price. The old £50,000 cash-in bar is stored but unused.
Every card still shows the cash in. The daily checks give low entry 12 of
the 20 slots (top areas 3, rent-to-rent 5; spare slots go to low entry
first) and check the best return on cash first; a cheap candidate waits
14 days for its check. Today, the reveal and the picks email lift a
purchase's fit by its return on cash (1.5 points a percentage point over
6%, at most 15; `src/lib/listing/rank.ts`): order only, never eligibility.
The signup budget offers Under £100k and £100k–£200k instead of Under
£200k; a stored Under £200k still reads and works. A purchase under
£75,000 carries a lender note. No price, credit charge or profit figure
changes. `LOW_ENTRY_SEARCH_ENABLED` is not touched. Once, after deploying:

1. **Run the Batch 22c section of `supabase/schema.sql`** (idempotent;
   moves the settings once, marked by `batch22c_cheap_applied_at`).
2. **Re-stream:** "Dry-run the re-stream" on `/admin/deals` (or
   `/api/internal/restream-backfill?dry=1`): the counts per stream before
   and after, writes nothing. Then "Re-stream deals". No spend.
3. **Cheap re-screen (optional):** "Dry-run the cheap re-screen" (or
   `/api/internal/cheap-rescreen?dry=1`) shows how many stored listings at
   up to £150,000 would qualify on today's figures; "Re-screen cheap
   listings" adds them. No provider call.
4. **Watch:** the "Budget brackets" panel on `/admin/deals`.

### 21. Management companies (Batch 22f)

A management company's own ad points at `/for-management-companies`. An
account whose first touch is that page (cookie, the sign-up form's hidden
field, or Google's return), or who presses Start there, or chooses "Set up
your branded lead form instead" in the quiz, or "Get leads with your own
branded form" in Account, is stamped `profiles.signup_path = 'management'`.
All the ways in go through `/for-management-companies/start`. Until a
stamped account answers the three profile questions (from the Profile pill):

- no quiz or reveal in front of app pages;
- sign-in lands on Leads;
- daily picks are written off;
- no intro or low-credit call.

The setup is `/leads/setup`: the starter pack, then company, details and
where leads go, then go live and copy the link, button or embed. Only
`/f/*` may be framed by other sites (`src/lib/security/frame-headers.ts`).

Funnel leads are priced by volume tier per owner per UK month
(`src/lib/funnels/tiers.ts`; `billing_settings.funnel_tiers`,
`funnel_enhanced_extra_pence`): £5.00 for leads 1–20, £4.00 for 21–60,
£3.25 for 61–150 and £2.50 from 151, plus £2.00 for an enhanced report. The
tier price is a base price, so top-up credit pays it at 1.3×. A lead is
charged once, after its report is complete, by `funnel_lead_charge`, which
numbers and charges it in one statement. The funnel's address lookup is
included. Members' analyses, the API and `funnel_markup` are unchanged.
Owners whose first funnel predates `funnel_tiers_from` stay on the metered
price until `funnel_notice_days` (30) after their funnel-price email. Each
finished lead is emailed to the owner (per form; on by default).

Once, after deploying:

1. **Run the Batch 22f section of `supabase/schema.sql`** (idempotent).
   It seeds `funnel_tiers_from` with the moment it first runs: tier pricing
   starts then for new owners.
2. **Send the funnel owners' notice:** on `/admin/management`, press "Dry run
   the notice" (who, and the email), then Send. It is its own email and
   stamp (`funnel_price_notice_sent_at`), not the members' pricing notice.
3. **Meta:** in Events Manager, the custom events `mc_signup`,
   `mc_pack_paid` and `funnel_live` appear once they have fired (pixel only,
   with cookie consent). Build the ads' custom conversions on `funnel_live`.
4. **Check framing:** paste the embed from the setup's last step into a blank
   HTML page and submit it (Turnstile, the report and Download PDF inside the
   frame, on desktop and an iPhone).
5. **Watch:** `/admin/management`: page views → sign-ups → paid → live →
   first lead, median minutes to live, leads a month, revenue by tier. "Set a
   test month" sets an owner's month, so you can test the tiers.

### 22. The Stayful Intelligence knowledge base (Batch 24)

One table of answers Zac has approved (`si_knowledge`) is the only source for
Stayful Intelligence's chips, the phone agent and (Batch 26) the chat. Every
figure in an answer is a `{placeholder}` read from the settings when it is
shown, so a price change needs no edit. A nightly job groups the questions
it couldn't answer and drafts answers for approval; nothing a model writes
reaches a member until it is approved. Members can ask it to remember
preferences (only after they say yes) and see and delete them in Account.
Everything is in `src/lib/knowledge` (the contract for later batches is its
`README.md`); admin is `/admin/intelligence` (Gaps, Knowledge, Coverage) and
`/admin/conversations`.

Cut over on the preview (it shares the live database), so members never see
empty chips or an agent with no knowledge:

1. **Run `supabase/schema.sql`** (the "Batch 24: Stayful Intelligence
   knowledge" section). Idempotent and additive, service role only:
   `si_knowledge` (+ `si_knowledge_live`, `si_knowledge_history`),
   `si_knowledge_gaps`, `si_knowledge_gap_questions`, `si_gap_runs`,
   `si_member_facts`, their functions, seven `si_kb_*` / `si_gap_*` /
   `si_facts_max` / `si_question_retention_months` settings and four
   prompt-cache unit rows. Nothing on `profiles`, nothing in
   `ACCESS_COLUMNS`.
2. **On the preview, seed:** `/admin/intelligence/knowledge` → **Dry run**,
   read the list, then **Seed** (or
   `/api/internal/si-knowledge?step=seed&dry=1`, then without `dry`). Every
   entry arrives as a draft.
3. **Approve the entries** one by one on their pages (each shows the answer
   as members would see it now, every condition both ways). Until the call
   answers the agent needs are approved (`REQUIRED_CALL_SLUGS` in
   `src/lib/knowledge/agent.ts`), the agent keeps its old prompt, and the
   Knowledge page says which are missing.
4. **Merge.**
5. **`/admin/calls` → The agent → Dry run, then Sync to ElevenLabs** (the new
   prompt with the knowledge and the `remember_fact` tool). After this,
   approving or retiring a call answer re-syncs the prompt by itself, and the
   nightly job catches up if one was missed.
6. **The nightly job, dry:** `/admin/intelligence/gaps` → **Estimate** (no
   model calls), then **Dry run** (the real groups and drafts, written
   nowhere; its cost counts against the cap). Or
   `/api/internal/si-knowledge?dry=1&estimate=1`, then `?dry=1`.
7. **Switch it on:** `SI_GAP_JOB_ENABLED=true` on Production. It is house
   spend (never a member's credit), inside `si_gap_monthly_cap_pence` (default
   £15), at most `si_gap_max_groups_per_night` (default 20) drafts a night.
8. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/si-knowledge` (02:50 UTC daily; 39 cron entries). On
   Mondays it also emails last week's gaps and coverage to the address on
   `/admin/feedback` (`?step=weekly&dry=1` previews it), and every night it
   deletes members' questions older than `si_question_retention_months`
   (default 24).

### 23. Standout deals, deal calls, the auto top-up nudge and "I've noticed" (Batch 25)

When a new deal fits a member's main profile better than anything found for
them so far, Stayful Intelligence saves it to their My deals ("Saved for you
by Stayful Intelligence", free to open, "Not for me" with an undo) and, at
most `standout_calls_per_month` (2) times a UK month, rings them about it
(Batch 23's queue, call type `deal`: weekdays 09:00–19:00, consent, the
account owner, one outbound call a day — a deal call waits for the next
weekday when today's is used). Below the call floor (the higher of
`standout_call_min_balance_pence` and a minute's calling with the texts kept
back) a text and email go instead; members who can't be called hear in the
next daily email's "Saved for you". A slower spender (8–21 days from their
last credit to £5) gets one auto top-up text and email instead of that
credit's £5 notice. Today's profile check is now "I've noticed", on Passes as
well as Keeps, and changes nothing until the member taps Accept.

Everything is in `src/lib/standout` (rules, copy, notify and nudge are pure
and tested; settings in `settings.ts`, every number a `billing_settings` row
edited on `/admin/standout`); the prompts are `src/lib/tailoring/behaviour.ts`.

1. **Run `supabase/schema.sql`** (the "Batch 25: standout-deal calls"
   section; two earlier check lists were widened in place: `sms_messages.kind`
   adds `standout`, `nudge`; `si_calls_log.call_type` adds `deal`).
   Idempotent and additive, service role only: `deal_reactions.saved_by`,
   `standout_runs`, `standout_decisions`, `credit_nudges`,
   `si_calls_log_deal_uidx` and twelve `standout_*` / `slower_spender_*`
   settings; and `credit_debit_face` redefined so a call, text, email or
   seat never takes credit an open reservation holds (R2-13: a running
   analysis, deep search or funnel lead no longer overdraws because of a
   call). Nothing in `ACCESS_COLUMNS`.
2. **Dry run:** `/admin/standout` → **Dry run** (or
   `/api/internal/standout?dry=1`, `&only=<email>` for one member) lists
   every judgement with its reason and writes nothing. Twice gives the same.
3. **Saves on:** `STANDOUT_ENABLED=true` on Production. Until then the pass
   only judges, and the nudge is never claimed (the £5 notice runs as
   before).
4. **Knowledge:** `/admin/intelligence/knowledge` → **Dry run**, then
   **Seed**: six new drafts (`standout_calls`, `why_called`,
   `why_not_called`, `saved_for_you`, `auto_topup_nudge`,
   `noticed_prompts`) and changed drafts of `save`, `calls` and
   `calls_how`. Approve each.
5. **The agent:** `/admin/calls` → The agent → **Dry run**, then **Sync to
   ElevenLabs with tools** (the deal script and opener, the
   `deal_headline` / `deal_short` variables, the `deal_link` template and
   the new knowledge variables). Check `/api/internal/si-calls?dry=1` shows a
   queued deal call as `dry_run` with its variables.
6. **Calls on:** `STANDOUT_CALLS_ENABLED=true` (Batch 23's
   `SI_CALLS_ENABLED` still gates every call). Test with your own account
   first: `/admin/standout` → **Force a standout** skips only the thresholds.
7. **Check the cron:** Vercel → Settings → Cron Jobs lists
   `/api/internal/standout` at `35 * * * *` and `58 6 * * *` (41 cron
   entries).

### 24. The typed chat (Batch 26)

Members can type questions to Stayful Intelligence in two places, sharing one
conversation log (Batch 23's, channel `chat`):

- **Quick answers:** the header eye opens a box (a panel under the eye on a
  desktop, `/intelligence/ask` full screen on a phone). Haiku 4.5, the
  member's account basics and the approved answers only, one or two
  sentences. When a question needs their deals it says "Ask in the full view
  (about 8p)" and doesn't guess. Record only for weekly active.
- **The full view:** a box under the tap-to-ask chips on `/intelligence`.
  Sonnet 5.5 with read-only look-ups over the member's own deals, picks,
  profile, credit, Part F's what-ifs and why they were or weren't called.
  Streams; the eye thinks. A question here counts towards weekly active.

A question costs its actual tokens × `si_chat_markup` (5), charged once
through the credit system and only for a delivered answer: "I don't know",
"ask in the full view", a refusal, an error or a page closed part-way are
logged as house spend and never charged. An answer the server had already
finished (the network dropped without the page closing, say) is kept and
charged once: "Try again" shows it, and so does the member's history. Each
answer is sized
so it can never pass its ceiling (`si_chat_quick_ceiling_pence` 3p,
`si_chat_full_ceiling_pence` 25p) or the member's balance. Every figure in an
answer must be one a look-up, a setting or an approved answer gave it, and it
never gives advice, an address or a postcode, or changes anything itself (it
offers buttons the member taps). The tap-to-ask chips stay free. Everything
is in `src/lib/chat`; admin is the **Chat** tab of `/admin/intelligence`.

1. **Run `supabase/schema.sql`** (the "Batch 26: typed chat" section).
   Idempotent and additive, service role only: the conversation log's
   questions may now come from the chat (R2-87), `chat_turns` (tokens, the
   charge and the retry guard; never any text) and fifteen `si_chat_*`
   settings. Nothing in `ACCESS_COLUMNS`.
2. **Knowledge:** `/admin/intelligence/knowledge` → **Dry run**, then
   **Seed**: six new drafts (`chat_what`, `chat_cost`, `chat_full_view`,
   `chat_history`, `chat_no_advice`, `chat_is_ai`). Approve them, **and the
   other entries allowed on the chat** (most of Batch 24's): the chat only
   answers from approved entries, so until they are approved nearly every
   quick answer is "I don't know that one yet".
3. **Check the settings** on `/admin/intelligence/chat` (ceilings, floors,
   the price hints, the seconds between questions, the cap on unanswered
   questions a day).
4. **Switch it on:** `SI_CHAT_ENABLED=true` on Production (it needs
   `ANTHROPIC_API_KEY`, which the analyser already has). Off, the eye is the
   link to the view it always was.
5. **Check Vercel:** `vercel.json` opts `/api/chat/quick` and
   `/api/chat/full` into request cancellation (`supportsCancellation`), so a
   page closed mid-answer stops the model and isn't charged; nothing to set.
   Settings → Cron Jobs lists `/api/internal/si-chat` (02:40 UTC daily; 42
   cron entries). It takes the
   member's name off chat questions older than `si_transcript_retention_days`
   (90); `?dry=1` only counts. The transcripts themselves are deleted by
   Batch 23's `/api/internal/si-calls`, for every channel.

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
| `src/lib/deal-quality` | Deal quality (Batch 16): each deal's own comparables check (`checks.ts` rules, `checks-run.ts` the nightly job, `recheck-comps-run.ts` the one-off re-check, `search.ts` and `comps.ts` the search and the figures), Step 0's comparison with past analyses (`calibration.ts`, `calibrate-run.ts`), the auction model, the three streams and the nationwide low-entry search, the Monday backfill clean-up, and the settings (`config.ts`). Pure rules beside their `*-run.ts` files; every job has `?dry=1` and is recorded in `marketplace_runs` with who ran it |
| `src/app/p/d` | Where a daily-email teaser's "Yes, more like this" / "Not for me" lands (public, keyed on the send's own token): a GET writes nothing, one confirming button records a Keep or a Pass |
| `src/app/admin/demand` | Demand vs supply (Batch 15): per postcode area × kind × house / flat, the members and profiles that want it beside the live deals, whether the sweep or the demand-led searches cover it, and the gap; this month's spend against the cap, the next pass's plan, the settings and the latest searches. Rules in `src/lib/sourcing-demand` (pure, tested), reads and writes in `src/lib/sourcing-demand/server.ts` (below) |
| `src/app/admin/weekly-active` | Weekly active against its targets, how members use the app, the per-member drill-down with the "Exclude from metrics" switch, the backfill and the retention count (below) |
| `src/lib/feedback` | Feedback and announcements (Batch 18): the rules (`rules.ts`, `announcements.ts`; pure, tested), every fixed number (`config.ts`; the limits admin can change are `billing_settings` rows, edited on `/admin/feedback`), sending a report and the email to the admin address (`server.ts`), the private screenshot bucket (`storage.ts`), admin's reads and the status emails (`admin-server.ts`), the banner's reads and writes (`announcements-server.ts`) and the nightly run (`retention.ts`). The form is `src/components/feedback` (any page opens it with `openFeedback()`); the banner is `src/components/announcements` |
| `src/app/account/feedback` | "Your feedback": the member's own reports and where each has got to, with the line admin sent. Never the private note, the page, the device or the screenshots |
| `src/app/admin/feedback` | Feedback (Batch 18): totals by type and status, submissions per week, the list with its filters, and the settings; each report with its screenshots, what was captured with it, the status and its emails (Preview, then Save), a private note and duplicates |
| `src/app/admin/announcements` | Announcements: write, preview and publish the "What's new" banner, and for each one how many members were shown it, dismissed it or tapped "Take a look" |
| `src/lib/tracking` | Cookie consent and sign-up attribution (Batch 19): every number, name and wording (`config.ts`); where the banner shows and the pixel may send, and tidying the address (`surfaces.ts`); the consent cookie and its rules (`consent.ts`); reading a landing's utm tags and click id (`touch.ts`); the report sums (`report.ts`), all pure and tested. The browser side is `browser.ts` and `runtime.ts`; the server side `consent-server.ts`, `attribution-server.ts`, `signup-server.ts` (the one call at sign-up and sign-in) and `report-server.ts` |
| `src/lib/meta` | Meta's pixel and Conversions API (Batch 19): the settings (`env.ts`), hashing, click ids, the five conversions and their rules (`events.ts`), the payload and the send (`capi.ts`), all pure and tested; recording each conversion once and sending it (`conversions.ts`); the pixel in the browser (`pixel.ts`). `src/components/tracking` is the banner, "Cookie settings", the sign-up checkbox and `TrackingRoot` (rendered by the root layout after every page) |
| `src/app/admin/signups` | Sign-ups by source (Batch 19): per utm source, campaign and ad, the share who finish the profile, run a first report within 7 days, pay, and are weekly active in weeks 2–4; and whether Meta measurement is set up, with the last 20 conversions |
| `src/app/account` | Account: the plan (pause, cancel), billing, notifications, what the member is looking for, a quieter "More" list and sign out; a team member sees their team in place of plan and billing. `/account/billing`: credit balance, top-ups, usage history |
| `src/lib/nav.ts` | The members' nav, and every "where does this live" rule more than one page needs: the kept/passed redirects, the goals editor's link (`GOALS_EDITOR_HREF`: the one line to repoint when it moves), Today's list anchor for the first-week checklist, Account's "More" links. Pure, tested |
| `src/lib/knowledge` | The Stayful Intelligence knowledge base (Batch 24): templates and placeholders (`template.ts`, `placeholders.ts`, `render.ts`, `figures.ts`), matching (`match.ts`), the seed drafts (`seed.ts`), the service facts the nightly job drafts from (`service-facts.ts`), the agent's knowledge (`agent.ts`), member facts (`facts-rules.ts`), coverage and the Monday email (`coverage.ts`, `weekly.ts`), all pure and tested; the reads and writes are the `*-server.ts` files and `gap/` is the nightly job. Every number is in `config.ts` or a `billing_settings` row (`settings.ts`). `README.md` is the contract for Batches 25 and 26 |
| `src/lib/chat` | The typed chat (Batch 26): the settings (`settings.ts`, every number a `billing_settings` row edited on `/admin/intelligence/chat`) and structure (`config.ts`); what a question may cost and did cost (`budget.ts`), the figure and advice guard (`guard.ts`), the buttons (`actions.ts`), the prompts (`prompts.ts`, on top of the one persona), the look-ups' schemas (`tools.ts`) and the admin sums (`metrics.ts`), all pure and tested; claiming, holding, settling and charging a question (`turns-server.ts`), the conversation log, history, deletion and the 90-day rule (`log-server.ts`), the two surfaces (`quick-server.ts`, `full-server.ts`) and the member-scoped look-ups (`tools-server.ts`). Routes under `src/app/api/chat`; components in `src/components/intelligence/chat` |
| `src/lib/standout` | Standout deals (Batch 25): who a deal stands out for (`rules.ts`), how it is described (`copy.ts`), how the member is told (`notify.ts`) and the slower-spender nudge (`nudge.ts`), all pure and tested; the hourly pass (`run.ts`, `server.ts`), the last check before a deal call rings (`calls-server.ts`), the save's meaning elsewhere (`saved-server.ts`), "Saved for you" (`email-server.ts`) and the texts (`texts-server.ts`). Every judgement is a `standout_decisions` row with its reason. `/admin/standout` lists them (member, deal, deal type, match, profit against the minimum and its basis, saved, call, what they did) with a dry run and the settings |
| `src/app/admin/intelligence` | Stayful Intelligence admin: Overview (Batch 22's reveal), Gaps (what it couldn't answer, with the drafted answers, spend against the cap and the job's runs), Knowledge (every entry, approve / reject / retire, try a question, the seed, the placeholder catalogue) and Coverage (the weekly share answered from approved knowledge). Conversations is `src/app/admin/conversations` |
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
| 06:03 | `listing-recheck` | Nothing: records price and status changes on pipeline rows |
| 06:40, 06:55 | `briefings` | Nothing: writes each member's morning briefing (Batch 23b, below) |
| 06:55 | `deal-alerts` | Nothing: turns changes on tracked deals into `deal_alerts` |
| 07:00, 07:20, 07:40, 07:50 | `sourcing` | Today's 5: the charged pick, the rest of the member's Today, and changes |
| Mon 08:00 | `alerts` | Your week: deals missed, your deals, your areas |
| 06:58, then :35 hourly | `standout` | Saves standout deals; a deal call, a text and email below the call floor, or nothing (they go in "Saved for you" in the next daily email); the auto top-up nudge's text and email inside 08:00–20:00 (Batch 25) |
| 08:10 | `daily-digest` | The daily email for anyone who had none: Today's 5 without a pick, or changes only |
| 08:20 | `picks-paused` | The out-of-credit letter (and the away letter), for anyone the daily email could not go to, with changes |
| :40, 07:40–19:40 | `deal-alerts` | Nothing: the same collector hourly in the day, so texts can go within the hour |
| every 15 min, 07:00–19:45 | `sms-alerts` | At most one text a member a day (below) |

Each one takes `?dry=1` and reports who would get what.

Saved profiles (Batch 13): a member with several running profiles still gets
one daily email, with a headed part for each profile (active first), each its
own pick and Today and its own day's charge; no deal is told twice. When the
credit runs out part-way the later profiles are left out and named. Once a
member has two profiles, change lines, the out-of-credit letter and Your week
name the profile each thing is for.

Morning briefing (Batch 23b, `src/lib/briefing`): Today's 5 opens with a
greeting and two or three sentences from Stayful Intelligence about one data
angle. Code builds a fact sheet from data we hold (counts, the member's own
kept deals and pipeline; never a listing's title, description, agent text or
an address); the AI (Haiku 4.5) writes the words; a validator checks every
number, date and number word against the sheet and rejects hype, predictions,
advice, comparisons and addresses. A rejected, late or switched-off briefing
is the code's template opener, uncharged. A passed one is charged at raw cost
× 5 ("Daily briefing" on usage, about 1.4p, never more than 3p), after the
day's own charge and only if the balance covers it. £0: no briefing; the email
is exactly as before. One row per member per UK day (`member_briefings`)
makes retries safe. Nudges under the changes link deals that have sat in a
stage (Kept 7 days, Contacted 5, Viewing 3, Offer 7) to My deals. Members who
did not come in from the email see it once on Today, with Play (the speak
price on the button). `/admin/briefings` has the figures per day.

- **Deploy:** run `supabase/schema.sql` (the Batch 23b section), set
  `ANTHROPIC_API_KEY` (already used by the analyser), then check
  `/api/internal/briefings?dry=1` (add `&model=claude-sonnet-5-5` for the
  model trial). Nothing is written or charged by a dry run.
- **Switches:** `/admin/billing` → "AI briefings on" (off: template openers for
  everyone with credit, nothing charged; missing reads as off).
  `BRIEFINGS_PASS_ENABLED=false` stops the pass altogether (no briefings).

Feedback emails (Batch 18) are outside the cap too, like receipts: the email
to the admin address for each report, and the email a member gets when
admin marks their report Planned, Fixed or Built, or Not doing (at most once
for each status; `feedback_status_emails`). They are built in
`src/lib/email/feedback.ts` and sent with their own idempotency keys, never
through `notification_sends`, so they never use up a member's daily email.
The status email's dry run is **Preview emails** on `/admin/feedback/<id>`.

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
  answer, at eight searches or after 44 s; an area × kind with no answer
  twice in a day waits until tomorrow.
- **Cost:** a search is one PMI listings credit (2p) or one OnTheMarket page
  (0.2p nominal) while PMI is down. This month's spend:

  ```sql
  select public.demand_sourcing_month(jsonb_build_object('month',
    to_char(date_trunc('month', now() at time zone 'Europe/London'), 'YYYY-MM-DD')));
  ```

