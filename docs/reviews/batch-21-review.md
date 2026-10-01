# Batch 21 review: Batches 1–20

**Reviewed at:** `91c76c20d31ef5387718dac8fdf96271144849a6` — origin/main, "Batch 20: the £10 starter pack, the £5 low-credit decision, inactivity, and the Monday sales funnel (#109)", merged 30 Sep 2026 12:01 BST. Since then one commit has landed on main, `cc75b66` (#110, 1 Oct 07:58 BST): README §2, `.env.example` and `scripts/stripe-setup.mjs` only (the Stripe endpoint must be on the `stripe` package's API version, and the setup script now lists all twelve events). No `src/` or `supabase/schema.sql` change, so every finding below stands; it also documents the payload-shape dependency noted against `invoice.paid` in the Stripe-events inventory (appendix G).

Read-only. Nothing in the repo, Supabase, Stripe, Monday or n8n was changed. Every check is against the code on main; README.md, PR descriptions and comments were treated as claims. JV matching is parked and was not reviewed. Written 1 Oct 2026.

Finding ids are per area (A1, B1 …); the `W…` id in brackets is the raw finding in the review's working files. Severity: **Critical** = money charged or granted wrongly, a data leak, or the site down · **High** = wrong numbers or a broken feature · **Medium** = works but fragile or confusing · **Low** = tidy-up. "Journey" is the first step at which a brand-new member from an ad would hit it.
## 1. Summary

**215 raw findings from 24 readings of the code, 10 merged as duplicates and 11 added from the day-one walk: 216 in all — 3 Critical · 19 High · 40 Medium · 154 Low.** I re-read every Critical and High against the code myself (the *Verified* line under each). A second, independent reader re-read every Medium against the code: none was refuted, 21 were true but overstated and now sit at Low, and one (F3, cash buyers' profit range) was understated and is now High; their notes are the *Second reader* line. The Lows are listed as reported. A separate reader walked a brand-new member's first day from the code (appendix E); the eleven problems it raised that no lens had reported are in section 4 as B46–B49, C32, C33, E28, F31–F33 and G27.

### Critical

- **G1** `/api/get-report` and `/report` are public and unlinked: anyone who types an email gets that sales lead's name and the link to their income-analysis PDF from the Management Leads board (5891626711), and the email is spliced raw into the Monday GraphQL query, so the whole board can be walked. Delete both files.
- **B1** A duplicate delivery of `invoice.paid` that lands while the first is still running (both webhook endpoints carry it; a fast redelivery) runs the handler twice. `grantPlanCycle` is check → expire → grant in three separate calls, so the second run zeroes the plan credit the first run just granted. The member paid £39.99 and sees "Plan credit expired". The same race is reachable from the 03:00 credit-sweep for annual plans.
- **D1** Reinstating a suspended team seat is keyed on `now`, so the hourly cron and the top-up webhook (or a Checkout top-up's two Stripe events) can each charge the owner £10 for the same seat.

### High, in the order a new member would meet them

| Step | Id | One line |
|---|---|---|
| sign-up | **E1** | Landing on `/welcome` logs `profile_started`, a weekly-active kind, so every sign-up counts as active in week 1 whether or not they answer a question. The number the ads will be judged on is inflated by construction. (A second reader notes this is deliberate and pinned by a test; Question 15.) |
| sign-up | **G2** | `next` is pinned at 16.2.1, which carries 2 critical and 10 high advisories (DoS reachable by any visitor); the fix is 16.3.7, blocked only by the exact pin. |
| the £10 pack | **B2** | In shadow mode a £0 member overdraws without limit; every later grant repays the overdraft first, so the pack's "£30 of credit" is eaten by it, and the day `CREDIT_ENFORCE` flips those members are refused everything until the debt is cleared. Nothing forgives an overdraft. |
| the £10 pack | **B3** | A transient Supabase error in any of the webhook's user look-ups is swallowed: the handler returns "no user", the route marks the event processed and answers 200. The member is charged, never credited, and Stripe never retries. |
| the profile quiz | **B46** | In shadow mode the quiz's 2p postcode geocode at question 3 is debited into overdraft, the balance reads "out", and the member is emailed "You're out of Stayful credit… reports and listing checks are paused" (and Monday gets "Hit zero") before the pack has even been offered. |
| the profile quiz | **F3** | A cash buyer's profit range subtracts a mortgage on /picks, the quiz's sample matches and the Your-week email, but not on Today, My deals or the daily email: two different numbers for the same deal. |
| the profile quiz | **B4** | With `CREDIT_ENFORCE=true` (README §16 step 3) a pack account is at £0 at question 3, the 0.4p geocode is refused, and the home is never placed on the map, so radius matching silently becomes postcode-area matching for ever. |
| the first deal | **B5** | The Full analysis button reads "Top up to run it · £4.00" when the balance is short, but pressing it runs the analysis anyway and debits into overdraft (shadow mode). |
| the first email | **D2** | A Resend 429 is treated as a final answer; the claimed slot is closed as failed and the member gets nothing that day. The digest and Your week send four at a time against a 2 req/s limit. |
| the first email | **D3** | The 08:10 digest works through members in fixed id order with a 50 s budget and no later pass, so once it overruns the same members get no daily email every day. Fine at 52 members; the first cron to degrade as sign-ups land. |
| the first payment | **B7** | One-click top-up: an error after the card was charged (a Meta or DB blip) falls through to Checkout, so the member is asked to pay again; and the idempotency nonce is minted per click, so a retry after a 502 is a second charge. |
| later | **B8** | Annual plans: the monthly slot keys collide for subscriptions ending on the 29th–31st; a 31st start gets 7 of 12 months of credit (simulated). |
| later | **B9** | Referral codes pay £10 to the referrer for every new account, with none of the welcome-credit abuse checks: ten disposable-email sign-ups = £100. |
| later | **B10** | The morning after `CREDIT_ENFORCE=true`, the 06:00 listing-recheck throws on the first watcher at or below £0 and stops rechecking for everyone. |
| later | **C1** | On white-label funnel reports the data-quality box still says "Book a web meeting with Stayful". |
| later | **C2** | Two "Presentation view" buttons on a funnel report open Stayful's own branded deck. |
| later | **C3** | A funnel run that fails is not refunded, stays `queued`, is re-run and charged again by the drain, and the prospect is told to resubmit (a second lead). |
| later | **C4** | Queued leads are re-run from address, postcode and bedrooms only: the prospect's 4-bed detached house with a garden becomes a 4-bed flat with no parking. |
| admin only | **E2** | Monday's *Engagement %* divides calendar Active weeks by `ROUNDUP(days/7)` blocks: routinely over 100%, and ÷0 on the sign-up day. |

### Must do before the Facebook ads start

1. **Set `CREDIT_ENFORCE=true` before `starter_pack_from`, and decide what happens to today's shadow-mode overdrafts** (Question 1). README §16 already orders it this way; B2, B5, B46 and B6 are what happens if it isn't. Branch **21b** then makes the flip safe: the quiz geocode (B4), the recheck cron (B10), "-£13.20" in the out-of-credit dialog (B27), staff accounts (B41).
2. **Weekly active must mean something on day one:** `profile_started` becomes record-only (E1) and the Monday *Engagement %* is fixed (E2) — branch **21f** and one board formula.
3. **The money core:** `one()` must throw (B3); the in-flight duplicate guard and an atomic plan cycle (B1); the top-up route's post-capture path and nonce (B7); the seat key (D1) — branch **21c**.
4. **The first email arrives:** Resend 429/4xx retry and slot release (D2, D5, D15), digest rotation (D3), the £0-member email decision (B6, Question 2) and no charged house picks for quiz drop-outs (B49, Question 16) — branch **21e**.
5. **Delete `/api/get-report` and `/report`** (G1) — branch **21d**, one commit, can go first.
6. **Next.js 16.3.7** (G2) — branch **21i** on its own, with a full build, the test suite and a click-through.
7. **Test the sign-up from the Facebook app on a phone** before the first ad goes live (F31): the confirmation link opening in Safari bounces to a password prompt, and Google sign-in is refused inside in-app browsers.
8. **21g** (funnel white-label) only matters if funnels are being sold alongside the ads.

### What came up clean

- `supabase/schema.sql` ran three times on a fresh Postgres 16 (with a Supabase shim) with 0 errors; the schema and seed dumps after run 1 and run 3 are identical, so a re-run changes nothing. The 42 notices on a *fresh* database are duplicate `add column if not exists` lines (A-area Lows). Every `ACCESS_COLUMNS` column exists. Every table and RPC the code names exists; one selected column does not (A5).
- All 90 public tables have RLS on; 14 carry member policies (all own-row or team-owner), the other 76 are service-role only, and the code reads them with the service-role client. No cross-member read was found on any id-, token- or slug-keyed page or route (table in the appendix); the two access gaps found are a suspended team seat (C7) and the public lead oracle (G1).
- All 12 Stripe events in `.env.example` are the 12 `case`s in the handler; every event id is claimed in `stripe_events` before handling; the Meta and Monday calls inside the webhook are wrapped or queued and cannot stop it finishing. Members who joined before the pack cutover keep their £20 (the backfill is frozen at 13 Sep 2026 and `packOffer` refuses anyone with a welcome grant). *Total paid* is keyed by Stripe id and refunds are cumulative, so redeliveries change nothing.
- Every cron route checks the internal secret first and fails closed; 21 of 23 have a real `?dry=1` (`credit-sweep` and `crm-deliveries` do not: D-area). No address, postcode or listing link reaches SMS, the activity log, Meta events or Monday rows.
- `npm test` 2,365 pass; `tsc` clean; `next build` clean; ESLint 0 errors / 67 warnings (50 unused variables, 5 `<img>`); `npm audit` 1 critical + 11 high, all fixed by `next@16.3.7` plus `npm audit fix` (G2, G-area).
## 2. How this was done

- Pre-flight: full history fetched; every batch merge on main listed (appendix D); the live database checked for every Batch 16–20 object; no branch or PR open.
- Mechanical: the schema run three times on a throwaway Postgres 16 (`/usr/lib/postgresql/16/bin`, a shim for the `auth`/`storage` schemas and roles) with dumps diffed between runs; `npm ci`, `test`, `lint`, `typecheck`, `build`, `audit`; scripts comparing `process.env` with `.env.example`, `vercel.json` with its routes, `ACCESS_COLUMNS` and every selected column with the schema; the live Monday board's columns and groups read; n8n searched for the re-engagement workflow (none exists for this board yet).
- Reading: 24 independent readings, two to five per area, each with a different question (double charge, wrong member, the flip day, the webhook, Batch 20; the 48-hour delay, addresses, cross-member access, funnels; crons, the cap, unsubscribe and Monday; the action inventory, exclusions, one definition of active; nav, orphans, duplicates; env, loose ends, failure modes, the mechanical output). Each returned findings with file, line, quoted code, an example and the smallest fix, plus the inventories the brief asked for and a list of what it checked and found clean (377 items, appendix F).
- Verification: I re-read every Critical and High against the code (and ran a simulation for B8); a second reader checked each Medium; Lows are as reported. Duplicates across readers were merged (10). The planned second finder round was cut short by a session limit. The day-one walk was re-run on its own (appendix E) and its findings folded in.
## 3. By journey step: what a brand-new member from an ad hits first

Critical, High and Medium findings only (Lows are in section 4).

**Sign-up and first sign-in**

- E1 · High · Every new sign-up is weekly active in week 1 by redirect alone: landing on /welcome logs the qualifying profile_started
- G2 · High · Production Next.js pinned at 16.2.1 carries 2 critical and 10 high advisories; the exact pin means npm audit fix cannot move it
- D4 · Medium · Email OK is true for a sign-up that never confirmed its email or signed in; nobody writes the board's Email Verified column
- E3 · Medium · Weekly-active base counts unconfirmed sign-ups; /admin/signups drops them, and inactivity treats them as quiet members
- F1 · Medium · Pricing's plan buttons link to /signup?plan=<code>, which nothing reads; signed-in members are bounced to Today
- F2 · Medium · Login page's "sign up" link drops the destination the member was sent to log in for
- G3 · Medium · ensureWelcomeGrant (the £20-or-pack decision at first sign-in, Batch 20) and the referral redemption have no test
- F31 · Medium · Signing up inside the Facebook in-app browser: the confirmation link opens in another browser and bounces to /login for the password; the Google button is refused in in-app browsers

**The £10 starter pack**

- B2 · High · Shadow-mode overdraft is repaid first by every later grant: the £10 pack's £30 is eaten, and the flip locks those members out with no sweep
- B3 · High · A transient Supabase error in any user lookup is answered 200 and the event is marked processed: the member is charged and never credited
- G4 · Medium · Every function that actually moves credit is SQL, and nothing in CI or the 2365 tests ever runs it
- G5 · Medium · The Stripe webhook is tested only up to its fake deps: grants.ts, deps.ts, auto-topup.ts, customer.ts and the starter-pack settle/grant/clawback server have no test
- B47 · Medium · Before the webhook runs, the member can open a second pack Checkout and get a second card hold
- B48 · Medium · "Not now" in the quiz only logs the tap: Today then shows the pack card and the red out-of-credit strip at once

**The profile quiz**

- B4 · High · Pack accounts start at £0, so the quiz's postcode geocode is refused and the home is never placed, even after they pay
- F3 · High · Cash buyers get a mortgage-laden profit range on /picks, the quiz's sample matches and the Your-week 'missed' line, but a no-mortgage range on Today, My deals and the daily email
- B46 · High · A pack-era member is emailed "You're out of Stayful credit" during the quiz, before the pack has been offered

**Today**

- C32 · Medium · The early-access banner offers only Upgrade although the pack (or any top-up) lifts the 48-hour delay; the day's Today list keeps the free-tier selection after they pay

**The first deal**

- B5 · High · 'Top up to run it' button runs the Full analysis (and the PMI add-on) anyway in shadow mode
- F6 · Medium · No not-found.tsx, error.tsx or global-error.tsx anywhere: a signed-in member who hits a 404 or a render error gets Next's unbranded default page with no nav
- F8 · Medium · Deal page's out-of-credit box promises a return that neither Top up nor See plans keeps

**The first report**

- B13 · Medium · A typed-address report has no once-only guard: a dropped stream then 'try again' charges a second full report
- G7 · Medium · Airbtics, Google Places, Geocode, Ticketmaster, autocomplete and ElevenLabs fetches have no timeout inside metered actions: a hang runs the report to the 60s kill and leaves the member's credit reservation held for up to 10 minutes
- G8 · Medium · GOOGLE_PLACES_API_KEY has no .env.example comment, and when it is missing or rejected every full report fails telling the member their postcode is wrong

**The first email**

- D2 · High · A Resend 429 (rate limit) is a definite failure that burns the member's day slot; the digest and Your week send four at a time with no backoff
- D3 · High · daily-digest: fixed member order plus a 50 s budget means the same members will get no daily email every day once the run overruns
- B6 · Medium · Shadow mode is not 'nothing blocked': the daily email is withheld at £0, the picks-paused letter goes out, and the out-of-credit emails say reports are paused when they are not
- D6 · Medium · Email OK and SMS OK refresh only on the 06:00 UK nightly: no queue on a settings change, unsubscribe, STOP or verification
- D7 · Medium · A mail scanner's GET of a pick email's Yes/No link is logged as email_feedback, which counts as 'engaging' and brings a quiet member back
- D8 · Medium · sourcing: the send loop only gets what is left after 44 s of verification, so each pass sends to a handful of members
- G9 · Medium · Resend send has no timeout: a hung Resend call holds the digest/alert cron until it is killed, and the claimed slot then counts the member's email as sent
- G10 · Medium · The daily digest's per-day charge and the profile/legacy double-charge guard have no test
- B49 · Medium · Members who never answered the mandatory questions still receive charged house picks

**The first payment**

- B1 · Critical · A concurrent duplicate Stripe delivery runs invoice.paid twice and can zero the plan credit the member just paid for
- B7 · High · One-click top-up: an error after the card was charged sends the member to Checkout (or 'try again') for a second charge
- A3 · Medium · Plan credit is defined twice with different numbers (billing_plans.monthly_credit_pence vs plan_credit_pence) and /account shows the old one
- F10 · Medium · /upgrade is a members-only page (protected, 'for signed-in members') but renders under the marketing layout: marketing nav with 'Sign in' and 'Start free trial', no members' nav

**Later (weeks in, teams, funnels, annual plans)**

- D1 · Critical · team-seats: reinstating a suspended seat can charge the owner £10 twice (period key is `now`)
- G1 · Critical · /api/get-report hands any caller a lead's name and income-analysis PDF for just an email, and splices the email raw into the Monday GraphQL query
- B8 · High · Annual plan: monthly slot keys collide for subscriptions started on the 29th-31st, so up to five months of credit are never granted
- B9 · High · Referral credit can be farmed: /api/billing/redeem grants £10 to redeemer and referrer with none of the welcome-credit abuse checks
- B10 · High · The day it flips, the 06:00 listing-recheck cron throws on the first £0 watcher and stops rechecking for everyone
- C1 · High · "Book a web meeting with Stayful" data-quality disclaimer renders on white-label funnel and /r report pages
- C2 · High · "Presentation view" buttons on a funnel report open Stayful's own branded slide deck
- C3 · High · Failed funnel run: owner is charged with no refund, the lead stays 'queued' and is run and charged again by the drain, and the prospect is told to resubmit (duplicate lead)
- C4 · High · Queued (out-of-credit) leads are re-run with default property spec: flat, no bathrooms, no parking, no outdoor space
- B17 · Medium · charge.dispute.created reverses credit at once, but a dispute that is later won or withdrawn never gives it back (no charge.dispute.closed handler)
- C7 · Medium · A paused (suspended) team seat can still open the team's unlocked deal sheets by URL
- C9 · Medium · PDF page six puts Stayful's management-service pitch in the customer's name
- C10 · Medium · "Stayful estimate" label on the second-opinion card of an enhanced-depth funnel report
- D10 · Medium · funnel-queue: no claim on a queued lead, so an overlapping run analyses and charges the customer twice
- D11 · Medium · The £5 decision for a member with daily picks off is deferred to 'the day's daily email', which they never get
- D12 · Medium · crm-deliveries: no claim before pushLead, so an overlapping run (or the cron plus 'send now') pushes the same lead to the customer's CRM twice
- D13 · Medium · funnel-queue: no time budget; five full analyses can exceed 60 s and a kill leaves the funnel's daily spend reserved
- E5 · Medium · No Leads (funnel owner) action is recorded: a management company working leads all week is not weekly active
- E6 · Medium · Explorer searches and area pages, the Browse grid, My deals, Picks and Reports pages have no view kind: only Today, a deal and a saved report count as 'looking'
- E7 · Medium · A member who uses the browser extension or API, or only browses /deals, /markets, /my-deals or /picks, is 'quiet': paused at 25 days despite using the product
- F11 · Medium · /markets shows two navs and two footers to a signed-in member: the marketing header (Sign in, Start free trial) above the members' strip
- F14 · Medium · Market Explorer's "Short-let net / yr" is labelled "after ... bills" but the calculator takes no bills off; the deal model does
- C33 · Medium · A lead-form member's first sign-in posts lead_activated to n8n with no consent check

**Admin only**

- E2 · High · Engagement % divides ISO-calendar Active weeks by ROUNDUP(days/7): routinely over 100% and ÷0 on sign-up day
- E9 · Medium · /admin/activity's 'Last active' is profiles.last_seen_at (any page load); Monday's 'Last active' is the last qualifying action — same label, different members

## 4. Findings by area

### A. Database (supabase/schema.sql)
18 findings: 1 Medium, 17 Low.
#### A3 · Medium · Plan credit is defined twice with different numbers (billing_plans.monthly_credit_pence vs plan_credit_pence) and /account shows the old one
- **Where:** `supabase/schema.sql:3453` · **Journey:** the first payment · **Fix branch:** 21a schema
- **What's wrong:** The credit-billing section seeds billing_plans.monthly_credit_pence as 1900/5000/14000/5000 (line 480-484) and the Batch 10 section seeds billing_settings.plan_credit_pence as 1900/3999/9900/3000 (line 3453). src/lib/stripe/grants.ts grants plan_credit_pence from new_pricing_from; src/lib/credit/summary.ts:59 says monthly_credit_pence is NOT the allowance. But /account (page.tsx:145) and /account/billing (BillingClient.tsx:95) still label the plan card from billing_plans.monthly_credit_pence, so once new_pricing_from is in force the card states a credit the member does not get.
- **How you'd hit it:** After new_pricing_from passes, a Pro subscriber renews and is granted £39.99 of plan credit. Their /account plan card reads 'Stayful Pro — £39.99 a month, £50 of credit every month'; the usage bar beneath it (which reads the real grant) shows £39.99.
- **Smallest fix:** Make the two agree: either have src/app/account/page.tsx and src/app/account/billing/page.tsx take the credit figure from the effective pricing (plan_credit_pence when the pricing date has passed, else monthly_credit_pence), or, once new pricing is live, update the billing_plans seed at supabase/schema.sql line 480-484 so monthly_credit_pence matches plan_credit_pence.
- **Second reader:** Confirmed. /account (account/page.tsx:145) and /account/billing (BillingClient.tsx:95) label the plan from billing_plans.monthly_credit_pence (Pro 5000, Scale 14000, annual 5000) while renewals grant plan_credit_pence (3999/9900/3000) for any period starting after new_pricing_from (deal-pricing.ts:339-343, grants.ts:24-27). Dormant until new_pricing_from is set; after that every renewed card overstates the credit. Fix: no — "plan_credit_pence once the date has passed" is still wrong for subscribers between that date and their own next renewal; label from the member's live grant instead (credit?.cycle?.allowancePence: getCreditSummary is already loaded at account/page.tsx:147 and BillingClient has cycle).

**Low (17, listed as reported, not independently verified):**

- **A1** profiles INSERT policy lets a member whose row is missing create one with any billing columns set — `supabase/schema.sql:128` · sign-up · branch 21a schema. _Fix:_ In supabase/schema.sql replace lines 127-130 with just `drop policy if exists "Users can insert own profile" on public.profiles;` (handle_new_user is SECURITY DEFINER and lead provisioning uses the …
- **A2** billing_plans seed is `on conflict do update`: every re-run resets plan name, price, interval, credit and perks to the file's values — `supabase/schema.sql:485` · the first payment · branch 21a schema. _Fix:_ In supabase/schema.sql line 485 change `on conflict (code) do update set ...` to `on conflict (code) do nothing` (keep the guarded line 492 update for the cadence), or add an admin edit path so the …
- **A4** profiles.monday_item_id is member-writable and the Monday funnel sync lets the stored link win over the email match — `src/lib/crm/monday-funnel/match.ts:137` · admin only · branch 21a schema. _Fix:_ Remove `monday_item_id,` from the `grant update (...)` list at supabase/schema.sql:435 and make the two fallbacks write it with createAdminClient() only (src/lib/auth/sign-in-hooks.ts:70 already …
- **A5** Report backfill selects bulk_jobs.report_id, a column that lives on bulk_job_rows; the guard that keeps bulk-job reports never works — `src/lib/deal-quality/backfill-run.ts:181` · admin only · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/deal-quality/backfill-run.ts:181 change .from('bulk_jobs') to .from('bulk_job_rows'), and log or return the read error instead of discarding it (a failed read should keep every row, not …
- **A6** The daily listing-check cap counts rows the member can delete themselves — `src/lib/listing/server.ts:230` · later · branch 21d privacy-access. _Fix:_ In src/lib/listing/server.ts:225-236 count from a table the member cannot write, with createAdminClient(): e.g. provider_calls (user_id, action_id) rows written by src/lib/credit/meter.ts for action …
- **A7** profiles.onboarding_skips (with its column grant to authenticated) is dead: no src file reads or writes it and the file the comment cites does not exist — `supabase/schema.sql:2026` · later · branch 21a schema. _Fix:_ Remove `alter table ... add column if not exists onboarding_skips` and `grant update (onboarding_skips)` (supabase/schema.sql:2026-2027) together with the comment, or replace the comment with the …
- **A8** profiles.referred_by_code is written by credit_redeem_code() but never read: who referred a member is recorded and then lost — `supabase/schema.sql:979` · later · branch 21a schema. _Fix:_ Either add referred_by_code to PROFILE_COLUMNS in src/lib/crm/monday-funnel/facts-server.ts:49 (and a Monday column) or to the admin profile page (src/lib/admin/profile-server.ts), or drop the write …
- **A9** profiles.updated_at is never maintained: no code writes it and no trigger touches it, so it always equals created_at — `supabase/schema.sql:60` · later · branch 21a schema. _Fix:_ Add a `before update on public.profiles` trigger that sets new.updated_at = now() in supabase/schema.sql (next to line 60), or drop the column and its grant entry (line 442).
- **A10** Top-up spend rate has three definitions: seed 1.5, Batch 10 move to 1.3, SQL fallback still 1.5 while the code's fallback is 1.3 — `supabase/schema.sql:699` · later · branch 21a schema. _Fix:_ In supabase/schema.sql line 699 change the fallback `else 1.5` to `else 1.3`, and update the line 528 seed to `"topup":1.3,"adjustment":1.3` so the file states one rate (the guarded Batch 10 block …
- **A11** Policy "Users can update own profile" is created twice; the first definition (no with check) is dead code — `supabase/schema.sql:133` · later · branch 21a schema. _Fix:_ Delete supabase/schema.sql lines 132-135 and let the block at 446-452 be the only definition (or move that block up in its place).
- **A12** funnel_hit, funnel_spend_reserve, funnel_spend_settle, funnel_alert_claim, funnel_hits_sweep and safe_numeric stay executable by anon/authenticated — `supabase/schema.sql:1392` · admin only · branch 21a schema. _Fix:_ After supabase/schema.sql:1495 add `revoke all on function public.funnel_alert_claim(uuid,text,timestamptz), public.funnel_hit(uuid,text,timestamptz,integer), …
- **A13** monday_funnel_runs.cursor is created and documented as the resume point but nothing ever writes or reads it — `supabase/schema.sql:5669` · admin only · branch 21a schema. _Fix:_ Drop `cursor text,` and the 'how far it got' clause from the comment in supabase/schema.sql (lines 5660-5669), or have sync-server.ts write it.
- **A14** Nine audit-trail columns are written and never read anywhere in src (stripe_price_id, cancel_reason_at, sms_messages.status_at, meta_conversions.server_sent_at, and five more) — `src/lib/stripe/webhook.ts:386` · admin only · branch 21c stripe-ledger. _Fix:_ Either read them where they were meant to be read (e.g. show stripe_price_id and cancel_reason_at on /admin/profiles via src/lib/admin/profile-server.ts) or drop the writes; nothing to change for …
- **A15** Check constraints guarded by `if not exists (constraint name)` never pick up a changed value list on an existing database — `supabase/schema.sql:5354` · admin only · branch 21a schema. _Fix:_ In supabase/schema.sql replace each `if not exists (select 1 from pg_constraint ... conname = 'X')` block with `alter table T drop constraint if exists X; alter table T add constraint X check (...)` …
- **A16** Welcome backfill's date guard does not exclude accounts whose welcome credit was withheld or that are team seats — `supabase/schema.sql:1006` · admin only · branch 21a schema. _Fix:_ In supabase/schema.sql line 1006 add `and profiles.welcome_withheld_reason is null and not exists (select 1 from team_members tm where tm.member_id = profiles.id)` to the loop's where clause.
- **A17** handle_new_user stamps profiles.created_at with now() instead of auth.users.created_at, so every date cutoff keys on trigger time (and the harness's cutoff test was a no-op) — `supabase/schema.sql:147` · admin only · branch 21a schema. _Fix:_ In supabase/schema.sql line 147-153 insert `created_at` too: `insert into public.profiles (id, email, full_name, mobile, created_at) values (new.id, new.email, ..., coalesce(new.created_at, now()))`.
- **A18** The file says the `private` schema is untracked and owned by other tools, yet it creates it, grants usage on it and defines seven functions in it — `supabase/schema.sql:2132` · admin only · branch 21a schema. _Fix:_ In supabase/schema.sql line 2132-2133 remove `private` from the untracked list and say instead that this file owns the private.* helpers listed above.


### B. Money and credit
49 findings: 1 Critical, 9 High, 6 Medium, 33 Low.
#### B1 · Critical · A concurrent duplicate Stripe delivery runs invoice.paid twice and can zero the plan credit the member just paid for
- **Where:** `src/app/api/stripe/webhook/route.ts:50` (also `src/lib/stripe/grants.ts`, `supabase/schema.sql`, `README.md`) · **Journey:** the first payment · **Fix branch:** 21c stripe-ledger · merged: W2-4
- **What's wrong:** The route claims the event id by inserting into stripe_events, but when the insert hits 23505 it only skips the event if processed_at is already set; a duplicate that arrives while the first delivery is still running (processed_at null) falls through and the handler runs a second time in parallel. README.md:66-69 says duplicates from a second endpoint are 'acknowledged and skipped and can never grant credit twice'; that is only true once the first delivery has finished. grantPlanCycle is a check-then-expire-then-grant in three separate database calls: with two parallel runs, B's check sees no grant, A expires the old cycle and inserts the new grant, then B's credit_expire_plan_grants zeroes A's fresh grant (it is kind 'plan', unexpired and remaining > 0) and B's credit_grant returns the now-empty existing row.
- **How you'd hit it:** Two endpoints (or a fast Stripe redelivery) deliver invoice.paid in_123 for a £39.99 Pro renewal within the same second. Delivery A inserts the stripe_events row; B gets 23505, reads processed_at = null and continues. Both reach grantPlanCycle; neither finds inv:in_123. A runs expirePlanGrants (old cycle zeroed) then grant (new £39.99 grant). B then runs expirePlanGrants, which writes an 'expire' row against A's new grant and sets remaining_pence = 0; B's grant returns the same id. The member's card was charged £39.99, /account/billing shows 'Plan credit expired' dated today with £0 spendable, tomorrow's picks are 'unfunded', and nothing in the logs says why.
- **Smallest fix:** In src/app/api/stripe/webhook/route.ts, when the claim returns 23505 and processed_at is null and the prior row has no error and was received less than the function limit ago, answer 500 (Stripe retries later, by which time processed_at is set and the duplicate is skipped). Independently make grantPlanCycle in src/lib/stripe/grants.ts atomic: one Postgres function that, under the profiles row lock, checks source_ref, expires the older plan grants and inserts the new one (or pass the new source_ref to credit_expire_plan_grants so it never zeroes it).
- **Verified:** Confirmed: route.ts:50-53 lets a duplicate with processed_at null run concurrently; grants.ts:37-41 is check → expire → grant in three calls; credit_expire_plan_grants zeroes every open plan grant. Also reachable from the 03:00 credit-sweep (W2-4 merged).

#### B2 · High · Shadow-mode overdraft is repaid first by every later grant: the £10 pack's £30 is eaten, and the flip locks those members out with no sweep
- **Where:** `supabase/schema.sql:900` (also `src/lib/credit/action.ts`, `src/lib/credit/meter.ts`, `src/lib/starter-pack/grant-server.ts`, `src/app/api/internal/credit-sweep/route.ts`, `src/lib/marketplace/open.ts`, `src/lib/analysis/deal-analysis.ts`) · **Journey:** the £10 pack · **Fix branch:** 21b credit-enforce · merged: W1-30
- **What's wrong:** With CREDIT_ENFORCE unset/false every metered debit passes allowNegative: true (meter.ts:171, open.ts:188, daily-deals-server.ts:94, deal-analysis.ts:601) and a failed reservation is only logged (action.ts:57), so a £0 account can overdraw without limit into the per-member 'overdraft:' adjustment grant. credit_available (schema.sql:708-711) counts that negative grant, so spendable_base_pence goes negative. credit_grant then repays the overdraft from EVERY new grant before the member sees it (schema.sql:900-907): the pack's £10 'topup' grant (rate 1.3) repays £7.69 of base debt and its £20 'welcome' bonus the rest (grant-server.ts:203-204). credit-sweep (route.ts:30-53) only expires due grants, seeds unit costs and grants annual slots; grep finds no forgiveness anywhere in src. The day the flag flips, credit_reserve/credit_debit compare against the same negative spendable, so those members get 402 on every paid button until their grants exceed the debt.
- **How you'd hit it:** A member from a Facebook ad signs up in the pack era (no £20 welcome), taps Not now on the pack screen, runs three Full analyses at £4 and a few Quick looks (£13 base overdraft; the nav chip reads -£13.00). They then buy the £10 pack: the £10 top-up grant repays £7.69, the £20 bonus repays £5.31, and £14.69 of the promised '£30 of credit' remains. A heavier user pays £10 and is left at £0, and the day CREDIT_ENFORCE=true is set they see 'You're out of credit' on every Quick look and Full analysis until a further top-up (repaying at 1.3x) exceeds the debt.
- **Smallest fix:** Before flipping, zero the shadow-mode overdrafts once (supabase/schema.sql: update credit_grants set remaining_pence = 0 where source_ref like 'overdraft:%' and remaining_pence < 0, writing a matching 'adjust' credit_transactions row per member), and set CREDIT_ENFORCE=true before the ads start so pack-era £0 accounts cannot overdraw. Until then, src/lib/credit/action.ts:56 should throw for a payer with no welcome grant (pass requireCredit for pack-era accounts).
- **Verified:** Confirmed: credit_grant (schema.sql:900-907) repays the overdraft grant from every new grant; meter.ts:171 and action.ts:56 allow negative in shadow mode; nothing in src forgives an overdraft. Rated High because README §16 step 3 orders CREDIT_ENFORCE=true before the pack date; Critical if the order is reversed.

#### B3 · High · A transient Supabase error in any user lookup is answered 200 and the event is marked processed: the member is charged and never credited
- **Where:** `src/lib/stripe/deps.ts:43` (also `src/app/api/stripe/webhook/route.ts`, `src/lib/stripe/webhook.ts`) · **Journey:** the £10 pack · **Fix branch:** 21c stripe-ledger
- **What's wrong:** Every findUserBy* dep goes through `one()`, which reads `.data` and ignores `.error`. supabase-js never throws; a timeout, 5xx or connection reset comes back as `{ data: null, error }`, so `one()` returns null, the handler returns `{ handled: false, note: 'no user for …' }`, the route writes `processed_at` and answers 200. Stripe never retries a 2xx. This sits in front of every grant path: invoice.paid (line 472), payment_intent.succeeded for a top-up (453) and for the starter pack (316), and checkout.session.completed (367). The whole 'record the id first so a retry can finish a half-done handler' design is bypassed because the handler does not fail — it politely gives up.
- **How you'd hit it:** A new member from an ad buys the £10 pack through Checkout. The card is captured; Stripe sends payment_intent.succeeded; Supabase returns a transient error on `profiles` for that one call. The route logs 'no user for starter pack', stamps processed_at, returns 200. The member has been charged £10, sees no credit, and no retry will ever come. After 8 days starter_pack_claim marks the reserved row failed, so they are even offered the pack again.
- **Smallest fix:** src/lib/stripe/deps.ts: make `one` throw when the query returns an error — `const { data, error } = await q; if (error) throw new Error(error.message); return (data as UserRow | null) ?? null;` — so the route answers 500 and Stripe retries.
- **Verified:** Confirmed: deps.ts:43 `one()` reads .data only; supabase-js returns {data:null,error} rather than throwing; the handler then returns handled:false and route.ts:58 stamps processed_at.

#### B4 · High · Pack accounts start at £0, so the quiz's postcode geocode is refused and the home is never placed, even after they pay
- **Where:** `src/lib/profile/server.ts:230` (also `src/lib/credit/meter.ts`, `src/lib/credit/welcome.ts`, `src/lib/onboarding/deal-filters.ts`, `src/lib/today/candidates.ts`, `src/lib/profile/questions.ts`) · **Journey:** the profile quiz · **Fix branch:** 21b credit-enforce
- **What's wrong:** A pack account gets no welcome credit, so at quiz question 3 ('Where should we look?', mandatory and answered before the pack screen at question 6) the balance is £0. placeHome runs the geocode through the meter; with CREDIT_ENFORCE=true (the README's step 3) the preflight in meter.ts:124-128 throws InsufficientCreditError for a 0.4p geocode, placeHome catches it and the member is told 'You're out of credit, so we couldn't place your postcode on the map yet'. placeHome runs only when the 'where' answer is saved with lat null (server.ts:230-231); nothing re-runs it when the pack's £30 lands, so the home stays unplaced and radius matching falls back to the postcode area alone (deal-filters.ts:44, candidates.ts:218-222).
- **How you'd hit it:** A member from the ad signs up, answers 'Where should we look?' with SK9 1AA and a 25-mile radius, sees 'You're out of credit…' on question 3, buys the pack on the next screen, and for ever after gets Today's deals only from postcode area SK, never the 25-mile radius they asked for, unless they happen to re-answer that question.
- **Smallest fix:** In src/lib/profile/server.ts run the quiz's first placement unmetered (it costs 0.4p; e.g. skipPreflight / requireCredit false with a free debit), or retry placeHome whenever an answer is saved or Today is built while goals.home.lat is null.
- **Verified:** Confirmed: profile/server.ts:306-316 geocodes through startAction/runMetered with no requireCredit opt-out, so meter.ts:124 throws for a £0 payer once CREDIT_ENFORCE=true; nothing retries placeHome when credit arrives.

#### B5 · High · 'Top up to run it' button runs the Full analysis (and the PMI add-on) anyway in shadow mode
- **Where:** `src/app/deals/_components/AnalysisPanel.tsx:203` (also `src/components/report/PmiAddonCard.tsx`, `src/lib/credit/deal-pricing.ts`, `src/lib/analysis/deal-analysis.ts`) · **Journey:** the first deal · **Fix branch:** 21b credit-enforce
- **What's wrong:** The price label is 'short' whenever spendableBasePence is below the price (deal-pricing.ts:219-221), with no regard to CREDIT_ENFORCE. The Full analysis button then reads 'Top up to run it · £4.00', but confirm() (lines 60-70) posts to /api/deals/[id]/analysis regardless, and startDealAnalysis only refuses when isEnforcing() (deal-analysis.ts:308, 379), so the run goes ahead and the £4 is debited into overdraft. PmiAddonCard.tsx:56 has the same label and add() has the same behaviour.
- **How you'd hit it:** A new member at £0 opens a deal, sees 'Top up to run it · £4.00', presses it expecting a top-up dialog, and instead the analysis runs and their balance reads -£4.00. Repeated a few times this is the overdraft that the pack later repays (finding 1).
- **Smallest fix:** In src/app/deals/_components/AnalysisPanel.tsx confirm() (and PmiAddonCard.tsx add()), when label.state === 'short' call openOutOfCredit({ mode: 'topup' }) and return instead of posting; or only mark a label 'short' when the summary's enforcing flag is true.
- **Verified:** Confirmed: AnalysisPanel.tsx:203 labels the button "Top up to run it" from priceLabel state short (deal-pricing.ts:219-221) but confirm() posts anyway; deal-analysis.ts:308 refuses only when isEnforcing().

#### B6 · Medium · Shadow mode is not 'nothing blocked': the daily email is withheld at £0, the picks-paused letter goes out, and the out-of-credit emails say reports are paused when they are not
- **Where:** `src/lib/listing/picks-run.ts:1041` · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** .env.example:71-73 and the /account/billing notice (BillingClient.tsx:82-86) say nothing is blocked in shadow mode. But the picks run and the 08:10 digest gate every send on the payer's spendable balance with no isEnforcing() check (picks-run.ts:1041-1071 PayerPurse; digest-run.ts:231-244), write sourcing_missed rows, and the 08:00 picks-paused letter sends whenever spendable < need (picks-paused-run.ts:213-221). Meanwhile afterDebit sends the out-of-credit email at state 'out' and the £5 low-credit decision at 'low' regardless of the flag (after-debit.ts:60-98): the out email says 'reports and listing checks are paused' (billing.ts:59) and the £5 email 'your daily deals and reports pause' (low-credit.ts:100), while the site runs every report and Quick look into overdraft. The extension popup likewise says 'out of credit' from /api/ext/me (ext/me/route.ts:17; extension/src/popup.ts:16) …
- **How you'd hit it:** A pack-era member at £0 gets no Today's 5 on day one and instead an 08:00 letter 'Your daily deals are waiting… couldn't send without credit', then after a Quick look an email saying 'Your credit is used up, so reports and listing checks are paused'; they open the deal page and run a £4 Full analysis without any block.
- **Smallest fix:** Decide one way: either make the purse honour shadow mode (skip the purse.take gate when !isEnforcing() in src/lib/listing/picks-run.ts and src/lib/notify/digest-run.ts) or fix the words: in src/lib/email/billing.ts:59 and src/lib/credit/low-credit.ts:100 say only 'your daily deals pause' when !isEnforcing(), and correct .env.example:71-73.
- **Second reader:** Confirmed. The picks run gates every send on the payer's balance with no isEnforcing() exemption (purse.take, picks-run.ts:1066), records sourcing_missed, and that triggers the picks-paused letter (picks-paused-run.ts:218-221). afterDebit sends the out-of-credit email whatever the flag (after-debit.ts:60-72) and it says "reports and listing checks are paused" (billing.ts:59), contradicting .env.example:71-72 and BillingClient.tsx:84. One overstatement: the digest's balance gate only applies from new_pricing_from (digest-run.ts:228).

#### B7 · High · One-click top-up: an error after the card was charged sends the member to Checkout (or 'try again') for a second charge
- **Where:** `src/app/api/billing/topup/route.ts:80` (also `src/components/credit/TopupButtons.tsx`) · **Journey:** the first payment · **Fix branch:** 21c stripe-ledger
- **What's wrong:** The try block that creates and confirms the off-session PaymentIntent also contains grantTopup, recordPayment, logConversion and getBalance. If any of those throws after pi.status === 'succeeded', the catch logs 'off-session charge failed, falling back to Checkout' and the route continues to create a Checkout session, so the browser is redirected to pay again. The Stripe idempotency key is topup:<user>:<nonce>, but TopupButtons generates crypto.randomUUID() on every click, so a second tap after a 502 is a new key and a new charge. The starter-pack route handles the same case correctly (returns ok: true, pending: true after a post-capture failure).
- **How you'd hit it:** A member with a saved card taps 'Top up £25' from the £5 low-credit email. Stripe confirms pi_A and takes £25. logConversion (Meta CAPI) times out and throws. The catch treats it as a failed charge, creates a Checkout session and returns { url }; TopupButtons sets window.location to Stripe Checkout, where the member, told nothing about pi_A, pays £25 again. The webhook grants pi_A's £25 too: two £25 card charges and £50 of credit for one intended top-up. Had the route returned 502 instead, the member would tap again with a fresh nonce and be charged twice the same way.
- **Smallest fix:** In src/app/api/billing/topup/route.ts split the try: only paymentIntents.create is allowed to fall back to Checkout; once pi.status === 'succeeded', wrap the rest in its own try and return { ok: true, pending: true } on failure (the webhook grants it). In src/components/credit/TopupButtons.tsx create the nonce once per mount (useState(() => crypto.randomUUID())) as StarterPackOffer and StarterConfirm do, so a retry reuses the idempotency key.
- **Verified:** Confirmed: topup/route.ts — grantTopup, recordPayment, logConversion and getBalance sit inside the try whose catch falls through to Checkout; TopupButtons.tsx:23 and LowCreditChoice.tsx:35 mint a new nonce per click.

#### B8 · High · Annual plan: monthly slot keys collide for subscriptions started on the 29th-31st, so up to five months of credit are never granted
- **Where:** `src/lib/stripe/grants.ts:117` (also `src/app/api/internal/credit-sweep/route.ts`) · **Journey:** later · **Fix branch:** 21c stripe-ledger
- **What's wrong:** ensureAnnualMonthlyGrant keys each slot on slotStart.toISOString().slice(0, 7) after setUTCMonth(start.getUTCMonth() + slot). For a start on the 31st, slot 1 ('Feb 31') overflows to 3 March and slot 2 is 31 March: both key 'annual:<sub>:2026-03', and the second is refused by the existing-source_ref check. The slot index itself also stalls (now.getUTCDate() < start.getUTCDate() subtracts one for most of every month). A simulation of every day of a year starting 31 Jan gives 7 grants instead of 12 and 155 days with no unexpired plan credit; a 29th or 30th start gives 11 grants and 31 uncovered days. The grant is idempotent, so no cron re-run repairs it.
- **How you'd hit it:** A member starts Pro Annual on 31 January (period end 31 January next year). They get January's credit, then March's on 1 March (keyed 2026-03, expiring 31 March). From 31 March until 1 May there is no plan grant at all: the sweep computes slot 2 as 31 March, key 2026-03, finds the March grant and returns. The same happens for July, September and November. They paid for twelve months and receive seven; the daily picks go unfunded for five months, and the account page shows 'Plan credit expired'.
- **Smallest fix:** In src/lib/stripe/grants.ts compute the slot boundaries with a month-add that clamps to the last day of the month (and derive `slot` from those clamped dates), or key the grant on the slot index (`annual:<sub>:<slot>`) instead of the calendar month, keeping the webhook's first-slot key in step.
- **Verified:** Confirmed by simulation (same arithmetic as grants.ts:111-124): period end on the 31st → 7 grants of 12 and 155 uncovered days; on the 29th/30th → 11 of 12 and 31 uncovered days; on the 28th or earlier → 12.

#### B9 · High · Referral credit can be farmed: /api/billing/redeem grants £10 to redeemer and referrer with none of the welcome-credit abuse checks
- **Where:** `src/app/api/billing/redeem/route.ts:32` (also `src/lib/credit/welcome.ts`, `supabase/schema.sql`) · **Journey:** later · **Fix branch:** 21c stripe-ledger
- **What's wrong:** The disposable-email and one-mobile-per-grant checks live only in ensureWelcomeGrant (which then redeems the sf_ref cookie). The manual redeem route calls credit_redeem_code directly for any signed-in non-team account. credit_redeem_code stops one account using two referral codes, but every fresh account can redeem one, and each redemption also pays the code owner referral_pence. Sign-up itself does not block disposable domains (isDisposableEmail is only referenced in welcome.ts and the funnel analyser).
- **How you'd hit it:** A member creates ten accounts on temporary-mail domains. Each is refused the £20 welcome credit (disposable_email) but POSTs /api/billing/redeem with the member's own referral code: each puppet receives £10 of adjustment credit and the member's real account receives 10 × £10 = £100 of spendable credit, all from a single person.
- **Smallest fix:** In src/app/api/billing/redeem/route.ts refuse referral-kind codes when the redeemer's profiles.welcome_withheld_reason is set (or when isDisposableEmail(member.email)), and/or move the owner reward into ensureWelcomeGrant's post-check path only; alternatively add the same check inside credit_redeem_code in supabase/schema.sql.
- **Verified:** Confirmed: redeem/route.ts has no disposable-email or mobile check; credit_redeem_code pays the owner referral_pence per new account; isDisposableEmail is only read by welcome.ts and the funnel route.

#### B10 · High · The day it flips, the 06:00 listing-recheck cron throws on the first £0 watcher and stops rechecking for everyone
- **Where:** `src/app/api/internal/listing-recheck/route.ts:228` (also `src/lib/listing/fetch.ts`, `src/lib/credit/meter.ts`, `src/lib/listing/server.ts`) · **Journey:** later · **Fix branch:** 21b credit-enforce
- **What's wrong:** The portal page fetch is metered against the first watcher's payer with no balance check (only the Airbnb branch at line 193 checks). fetchListingHtml (fetch.ts:67) returns meter(...) with a known quantity of 1 and no reservation, so with CREDIT_ENFORCE=true meter.ts:124-128 throws InsufficientCreditError before the fetch whenever the payer's spendable is below the 1p base price (any £0 or overdrawn member). resolveListing (server.ts:61) does not catch it, runMetered does not, and the route's for-loop has no try/catch, so the GET rejects with a 500. The crashed row's rechecked_at is never updated and the deferred list is never applied, so the same stalest listing heads the queue the next morning too.
- **How you'd hit it:** The morning after CREDIT_ENFORCE=true, the recheck reaches a Rightmove listing tracked by a member at -£3 from shadow mode. The cron 500s; no member's tracked listings get price-drop or removed alerts from then on until that one member tops up above their debt.
- **Smallest fix:** In src/app/api/internal/listing-recheck/route.ts wrap the per-URL body in try/catch that counts the row as skipped and defers it (or pass skipPreflight through fetchListingHtml for the cron), mirroring the isEnforcing() balance check the Airbnb branch already does at line 193.
- **Verified:** Confirmed: fetch.ts:67 meters the page fetch with a known quantity, meter.ts:124-128 throws before the fetch when enforcing and the payer is at or below £0; the portal loop in listing-recheck/route.ts:218-230 has no try/catch, unlike the Airbnb branch at :193.

#### B13 · Medium · A typed-address report has no once-only guard: a dropped stream then 'try again' charges a second full report
- **Where:** `src/app/api/analyse/route.ts:129` · **Journey:** the first report · **Fix branch:** 21c stripe-ledger
- **What's wrong:** The report claim (claimReportRun) exists only when the request carries a checkedListingId (a pipeline row). A report typed on /estimate has none, so nothing ties two runs of the same address together. The run is handed to after(), so when the SSE connection drops the server still finishes, saves the report to /reports and charges the reservation; the page shows an error and the button is enabled again. A second submission reserves and charges a second identical report.
- **How you'd hit it:** A member on a phone types an address on /estimate and taps Get report (~£1.50 of credit). The connection drops at 40%; the page says 'Something went wrong. Please try again.' The server finishes, saves the report and charges it. They tap again and are charged again for the same address; /reports then holds two identical reports and Usage two lines.
- **Smallest fix:** In src/app/api/analyse/route.ts, before reserveAnalysis, look for a saved_searches row for this user with the same postcode and address created in the last few minutes (or a running claim keyed on a hash of the input) and answer already_reported with its id, as the pipeline-row path does.
- **Second reader:** Partly. The once-only claim runs only with a checkedListingId (analyse/route.ts:130) and the report keeps running in after() (route.ts:186) after the browser drops; the page then shows "Analysis stream ended unexpectedly. Please try again." with the button enabled (estimate/page.tsx:886), so a retry saves a second report. The cost is overstated: PropertyData, Airbtics (report id cached 24 h) and PMI come from the broker cache, and cache hits are charged nothing (meter.ts:146-148); the retry is charged mainly for the uncached Google Places ×6, geocode and Ticketmaster calls (under £1 at ×5 markup). Fix: no — a saved_searches lookup misses the case where the first run is still going; take a claim on user + normalised address/postcode/bedrooms and answer report_running / already_reported, as claimReportRun does.

#### B17 · Medium · charge.dispute.created reverses credit at once, but a dispute that is later won or withdrawn never gives it back (no charge.dispute.closed handler)
- **Where:** `src/lib/stripe/webhook.ts:699` · **Journey:** later · **Fix branch:** 21c stripe-ledger
- **What's wrong:** A dispute claws back the full disputed amount (pack: the credit share; top-up: −dispute.amount under `pi:<id>:disputed`) the moment it is opened. Stripe reports the outcome on charge.dispute.closed (status won / lost / warning_closed), which is neither in the .env.example list nor in the switch, so a won dispute — a bank-initiated 'transaction not recognised' the member then confirms, or one you win with evidence — leaves the member permanently out of the credit they paid for. There is also no admin path to reverse it other than a manual adjustment.
- **How you'd hit it:** A member's bank auto-disputes the £10 pack as unrecognised. Their £30 of credit goes to −£30-share immediately. They tell the bank it was them; the dispute closes 'won'. Nothing happens on our side: the member is still at £0 (or negative) credit and has been charged £10.
- **Smallest fix:** src/lib/stripe/webhook.ts: add `case 'charge.dispute.closed'` that, when `dispute.status === 'won'` or `'warning_closed'`, grants back the adjustment taken under `pi:<id>:disputed` (positive adjustment with source_ref `pi:<id>:dispute_won`), and add the event to .env.example / the dashboard endpoint.
- **Second reader:** Confirmed. The switch handles only charge.refunded and charge.dispute.created (webhook.ts:698-699); charge.dispute.closed falls to default (:718-719). The clawback is a negative adjustment under pi:<id>:disputed (deps.ts:92) or starter_pack_clawback for a pack (grant-server.ts:258-266), and nothing reverses either. charge.dispute.created also fires for inquiries that close as warning_closed with no money taken, so those members lose credit too. Fix: no — also reverse the pack path, and give back exactly what was taken (read the :disputed grant) rather than dispute.amount; add charge.dispute.closed to the Stripe endpoint and .env.example:60.

#### B46 · High · A pack-era member is emailed "You're out of Stayful credit" during the quiz, before the pack has been offered
- **Where:** `src/lib/credit/after-debit.ts:60` (also `src/lib/profile/server.ts`, `src/lib/credit/meter.ts`, `src/lib/email/billing.ts`) · **Journey:** the profile quiz · **Fix branch:** 21b credit-enforce
- **What's wrong:** In shadow mode the quiz's postcode geocode at question 3 (about 2p) is debited into overdraft (meter.ts:165-192) and meter.ts:192 then runs afterDebit, which finds the balance 'out' (spendable ≤ 0.5p, pricing.ts:102), stamps hit_zero_at, queues Monday's "Hit zero" and sends outOfCreditEmail ("You're out of Stayful credit… reports and listing checks are paused", billing.ts:55-60) because alert_credit defaults to true (schema.sql:1977). The pack screen comes three screens later. With CREDIT_ENFORCE=true the geocode is refused instead (B4).
- **How you'd hit it:** A member from an ad signs up at 11:02, answers "Near me, SK9 1AA" at 11:05 and at 11:05 receives an email saying they are out of credit and their reports are paused, before they have seen a deal or the pack offer. Their Monday row reads Billing status "Hit zero".
- **Smallest fix:** Run the quiz's placement unmetered for an account that has never held credit (B4's fix: skipPreflight and no debit, or bill it to the house), and in src/lib/credit/after-debit.ts skip the out-of-credit email and the hit-zero stamp while the account has never held a grant, leaving the pack offer to the quiz and Today.
- **Verified:** Confirmed by me: meter.ts:192 calls afterDebit after every billable debit; after-debit.ts:60-72 sends the email for state 'out'; lowBalanceState returns 'out' at ≤ 0.5p (pricing.ts:102); alert_credit defaults to true (schema.sql:1977). Raised by the day-one walk.

#### B47 · Medium · Before the webhook runs, the member can open a second pack Checkout and get a second card hold
- **Where:** `src/app/api/billing/starter-pack/route.ts:65` · **Journey:** the £10 pack · **Fix branch:** 21c stripe-ledger
- **What's wrong:** The purchase row is created by the webhook's settle step, so until it runs the member is still eligible (starter-pack/server.ts:34-39, 62-83) and the red banner's "Get £30 for £10" (CreditBanner.tsx:37-48), the Today card and the billing pages open a fresh Checkout session (route.ts:155-167; the nonce keys only the one-click path). The second authorisation is blocked by the claim and cancelled (grant-server.ts:142-152), so nothing is charged twice, but the member sees a second temporary hold and the return page says "on its way" again.
- **How you'd hit it:** On a slow webhook the member returns to /today?pack=1, reads "on its way", taps the red banner's Get £30 for £10 and pays again; their bank shows two £10 holds for a day or two.
- **Smallest fix:** In src/lib/starter-pack/server.ts treat a Checkout session created in the last 30 minutes as 'already_had' (store the session id and time when the route creates it), so every surface hides the offer until the webhook settles.

#### B48 · Medium · "Not now" in the quiz only logs the tap: Today then shows the pack card and the red out-of-credit strip at once
- **Where:** `src/components/starter-pack/actions.ts:28` · **Journey:** the £10 pack · **Fix branch:** 21c stripe-ledger
- **What's wrong:** The quiz's Not now (starter-pack/actions.ts:28-32) logs starter_pack_not_now and nothing else; only the Today card's Not now snoozes (starter-pack/server.ts:114-120). A member who declines in the quiz lands on Today with the pack card and, at £0, the red "You're out of credit" strip (B12).
- **How you'd hit it:** A member taps Not now on the pack screen, finishes the quiz and lands on Today, where the first things on screen are the pack card and a red strip saying they are out of credit.
- **Smallest fix:** Have the quiz's Not now call snoozeStarterPack (the same snooze as the Today card), and show the amber "Start with £30 of credit for £10" strip rather than the red one for an account that has never held credit (B12).

#### B49 · Medium · Members who never answered the mandatory questions still receive charged house picks
- **Where:** `src/lib/listing/picks-run.ts:437` · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** welcome_checked_at is stamped on the first visit, before the quiz gate (AppShell.tsx:60-70), and the picks audience is sourcing_alerts plus welcome_checked_at (picks-run.ts:297-316), so a member who closed the quiz on screen one gets a house pick (picks-run.ts:437-447) each morning, charged per pick (10p) or per day (33p) from their £20 welcome credit (picks-run.ts:1553-1573), with a "profile N% done" line.
- **How you'd hit it:** A member signs up, bounces off the quiz and never returns; every morning for weeks their welcome credit pays for a house pick they did not ask for, until it is gone and the out-of-credit letter follows.
- **Smallest fix:** In src/lib/listing/picks-run.ts (and digest-run.ts) skip members whose mandatory questions are unanswered, or send them the profile nudge without a charged pick (Question 16).

**Low (33, listed as reported, not independently verified):**

- **B11** normaliseMobile gives '+44 07700 900123' a different key from '07700 900123', so the mobile once-per-person check can be sidestepped — `src/lib/credit/abuse.ts:31` · sign-up · branch 21c stripe-ledger. _Fix:_ In src/lib/credit/abuse.ts, after the '+' branch drop a leading 0 that follows the country code (e.g. replace /^\+44 ?0/ with '+44' before stripping non-digits).
- **B12** A brand-new pack account sees the red 'You're out of credit' strip on its first page, before the quiz has mentioned the pack — `src/components/credit/CreditBanner.tsx:38` · Today · branch 21b credit-enforce. _Fix:_ In src/lib/starter-pack/rules.ts give packCopy a first-visit line (e.g. when the account has had no credit: 'Start with £30 of credit for £10') and use it in CreditBanner (and the quiz warning) …
- **B14** grantTopup's replay check is not atomic: a top-up's two Stripe events can both pass it and send two receipts — `src/lib/stripe/grants.ts:76` · the first payment · branch 21c stripe-ledger. _Fix:_ In src/lib/stripe/grants.ts, have credit_grant report whether it inserted (return the id and compare with a pre-read, or add an `inserted` flag) and run the receipt, reinstateSeats and …
- **B15** checkout.session.completed grants a top-up without checking payment_status; a delayed-notification payment method would be credited before the money arrives — `src/lib/stripe/webhook.ts:417` · the first payment · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/webhook.ts payment-mode branch: `if (session.payment_status !== 'paid') return { handled: true, note: 'awaiting async payment' };` before the top-up grant, leaving …
- **B16** Listing-recheck cron keeps charging members whose picks are paused (inactivity or out of credit) and has no per-member cap — `src/app/api/internal/listing-recheck/route.ts:188` · later · branch 21b credit-enforce. _Fix:_ In src/app/api/internal/listing-recheck/route.ts skip rows whose payer is in inactivePausedIds() (src/lib/inactivity/server.ts) or whose spendable balance is below the run's estimated cost, and treat …
- **B18** With STRIPE_TAX on, a full top-up refund claws back the VAT-inclusive charge against ex-VAT credit, pushing the member's ledger below zero — `src/lib/stripe/webhook.ts:712` · later · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/webhook.ts charge.refunded/dispute branch: compute the clawback as `packClawbackPence({ creditPence: Number(pi.metadata.amount_pence), chargedPence: charge?.amount ?? …
- **B19** invoice.paid has no email fallback and marks an unmatched invoice processed: an old Payment Link subscriber (or one whose invoice.paid beats checkout.session.completed) pays and gets no credit, with no retry — `src/lib/stripe/webhook.ts:470` · later · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/webhook.ts invoice.paid: after the customer lookup add `if (!user && invoice.customer_email) user = await deps.findUserByEmail(invoice.customer_email);` (same fallback as …
- **B20** Marketing FAQ hard-codes £20 welcome credit, 'from £19/month', 'from £10' and '1.3×' instead of reading billing settings — `src/lib/faqs-data.ts:33` · sign-up · branch 21h product-nav-health. _Fix:_ Build the cost answer in src/lib/faqs-data.ts from getBillingSettings()/getPlans() (welcomeGrantPence, min plan price, min preset, spendRates.topup), as Pricing.tsx and starter-pack/rules.ts …
- **B21** Plus-addressed and dotted emails are different email_keys, so the email leg of once-per-person only catches an exact re-use — `src/lib/supabase/email-key.ts:12` · sign-up · branch 21c stripe-ledger. _Fix:_ In src/lib/starter-pack/server.ts and grant-server.ts derive the claim's email_key with a pack-specific key that strips a +tag and, for gmail.com/googlemail.com, dots (leave emailKey itself alone: it …
- **B22** Starter pack 'one per mobile number' reads the editable profiles.mobile, not the claimed mobile_key — `src/lib/starter-pack/grant-server.ts:84` · the £10 pack · branch 21c stripe-ledger. _Fix:_ In src/lib/starter-pack/grant-server.ts claim() and src/lib/starter-pack/server.ts load(), use profiles.mobile_key (falling back to normaliseMobile(mobile) only when the key is null) so the number …
- **B23** The webhook route sets no maxDuration and awaits an un-timed Resend call (pack receipt, payment-failed email); every cron sets 60 s — `src/app/api/stripe/webhook/route.ts:12` · the £10 pack · branch 21c stripe-ledger. _Fix:_ src/app/api/stripe/webhook/route.ts: `export const maxDuration = 60;` and in src/lib/email/send.ts pass `signal: AbortSignal.timeout(8000)` to the Resend fetch.
- **B24** A pack account can be shown 'welcome credit withheld' copy on Billing for credit it was never going to get — `src/app/account/billing/page.tsx:61` · the £10 pack · branch 21b credit-enforce. _Fix:_ In src/app/account/billing/page.tsx pass welcomeWithheld only when the account is not a pack account (isPackAccount(created_at, settings.lifecycle) is false).
- **B25** First-week checklist reward is a code constant (100p) with '£1' hard-coded in the Today card — `src/lib/today/checklist.ts:47` · Today · branch 21h product-nav-health. _Fix:_ Add checklist_step_pence to billing_settings (src/lib/credit/unit-costs.ts), read it in src/lib/today/checklist-server.ts and pass it to src/app/today/_components/Checklist.tsx.
- **B26** Deal open: a stale pending row lets two simultaneous opens both debit the same action id — `src/lib/marketplace/open.ts:82` · the first deal · branch 21c stripe-ledger. _Fix:_ In src/lib/marketplace/open.ts, make the stale-row refresh conditional (`.eq('opened_at', existing.opened_at)` and require a row back) so only one request owns the retry, or delete the stale pending …
- **B27** After the flip the out-of-credit dialog can say 'you have -£13.20': the 402 payload does not clamp a negative balance — `src/lib/credit/http.ts:28` · the first report · branch 21b credit-enforce. _Fix:_ In src/lib/credit/http.ts:28 use Math.max(0, Math.round(err.availablePence)) as open.ts already does.
- **B28** A £5 notice deferred before 08:30 UTC may never go for a member with picks off and no pending alerts — `src/lib/credit/after-debit.ts:94` · the first email · branch 21e messages-crons. _Fix:_ In src/lib/credit/after-debit.ts, when lowCreditMayGoAlone is false, still send the notice alone once the day's slot is free (e.g. let the digest's low-notice pass include every member with …
- **B29** A £0 invoice (100%-off promotion code, coupon, or a trial's first invoice) grants a full cycle of plan credit — `src/lib/stripe/webhook.ts:517` · the first payment · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/webhook.ts invoice.paid: if this is not intended, `if ((invoice.amount_paid ?? 0) <= 0 && reason === 'subscription_create') return { handled: true, note: '£0 invoice: no credit' }` (or …
- **B30** A payment with no card fingerprint passes the card leg of once-per-person and stores nothing for later claims — `supabase/schema.sql:5282` · the first payment · branch 21a schema. _Fix:_ In src/app/api/billing/starter-pack/route.ts pass payment_method_types: ['card'] on the pack Checkout, and in grant-server.ts treat a captured pack with no fingerprint as something to log loudly (or …
- **B31** With STRIPE_TAX=true the pack costs £12 through Checkout but £10 on a saved card, while the copy says 'Buy for £10' — `src/app/api/billing/starter-pack/route.ts:165` · the first payment · branch 21c stripe-ledger. _Fix:_ In src/app/api/billing/starter-pack/route.ts drop the automatic_tax spread from the pack's Checkout (or make the pack's Stripe price tax-inclusive), so both paths charge starter_pack_price_pence.
- **B32** Team seat price is a code constant (1000) and '£10' is repeated in the team page and three emails — `src/lib/team/rules.ts:14` · later · branch 21h product-nav-health. _Fix:_ Add a seat_price_pence billing setting parsed in src/lib/credit/unit-costs.ts, read it in src/lib/team/seats.ts and pass the amount into the copy in src/app/account/team/page.tsx and …
- **B33** A member who leaves a team keeps welcome_withheld_reason 'team_member', so their own account can never earn the profile £5 or checklist £1s — `src/lib/team/invites.ts:200` · later · branch 21c stripe-ledger. _Fix:_ In src/lib/team/remove.ts, when the login is kept, clear welcome_checked_at/welcome_withheld_reason where the reason is 'team_member' so the next sign-in re-runs ensureWelcomeGrant (which decides …
- **B34** Referral code amount is frozen at creation while the owner's reward reads the live setting — `src/lib/credit/referral.ts:29` · later · branch 21c stripe-ledger. _Fix:_ In supabase/schema.sql credit_redeem_code grant the redeemer credit_setting_num('referral_pence', c.amount_pence) for kind='referral', or update credit_codes.amount_pence for referral codes when the …
- **B35** A member's own API key and MCP tool already refuse at £0 today while the site runs everything — `src/app/api/v1/analyse/route.ts:43` · later · branch 21b credit-enforce. _Fix:_ If the member API is meant to follow the site, drop requireCredit from the opts in src/app/api/v1/analyse/route.ts:43 and src/lib/api/mcp-tools.ts:408 (keep it on /api/f/[token] and funnel-queue); …
- **B36** Top-up clawback is keyed once per (payment, reason): a second partial refund is not reversed — `src/lib/stripe/deps.ts:92` · admin only · branch 21c stripe-ledger. _Fix:_ In src/lib/stripe/deps.ts refundTopup, reuse the starter pack's pattern: key each clawback on the cumulative amount (`pi:<id>:refunded:<amount_refunded>`) and grant only the difference from what is …
- **B37** Admin credit adjustment is keyed on Date.now(), so a double submit grants twice — `src/app/admin/billing/actions.ts:153` · admin only · branch 21c stripe-ledger. _Fix:_ In src/app/admin/billing/actions.ts include a hidden per-render nonce in the form and use it in the sourceRef (`admin:<email>:<nonce>`), so a repeat of the same form is a replay.
- **B38** Dead subscriberTransitionEmail carries stale hard-coded report prices (£4.85 / £8.60) — `src/lib/email/billing.ts:98` · admin only · branch 21e messages-crons. _Fix:_ Delete subscriberTransitionEmail from src/lib/email/billing.ts, or compute the figures from estimateAction() if it is ever needed.
- **B39** checkout.session.completed falls back to matching the payer by email, which can credit a different profile — `src/lib/stripe/webhook.ts:366` · admin only · branch 21c stripe-ledger. _Fix:_ In src/lib/stripe/webhook.ts drop the email fallback for checkout.session.completed (or require the email match to be unique) and log 'no user' so the admin links it by hand.
- **B40** Monday in shadow mode: 'Hit zero' is stamped (and re-stamped every 30 days) for members who are still using the site, with a negative Credit balance — `src/lib/credit/after-debit.ts:66` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/credit/after-debit.ts:66 stamp hit_zero_at only when isEnforcing() (or only when !p.hit_zero_at, so the date is the first time), and clamp the Monday balance at 0 in …
- **B41** @stayful.co.uk accounts are billed like members and will be blocked at £0 on the flip; only ADMIN_EMAILS bypass — `src/lib/admin.ts:27` · admin only · branch 21b credit-enforce. _Fix:_ Either add the staff accounts to ADMIN_EMAILS in Vercel before the flip, or in src/lib/admin.ts:27 have isAdminEmail also accept the STAFF_DOMAIN used by src/lib/activity/metrics.ts:150 if staff …
- **B42** customer.subscription.created/updated with a non-live status (e.g. 'incomplete' for a subscription made by hand) is treated as 'ended': subscription_ended_at set, credit expired, an 'ended' churn row for someone who never started — `src/lib/stripe/webhook.ts:560` · admin only · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/webhook.ts: treat 'incomplete' as not-yet-live rather than ended — `if (sub.status === 'incomplete') return { handled: true, note: 'awaiting first payment' };` before computing `ended`.
- **B43** invoice.payment_failed on a one-off (non-subscription) invoice still marks the member past_due and emails 'payment failed' — `src/lib/stripe/webhook.ts:667` · admin only · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/webhook.ts invoice.payment_failed: `if (!subId) return { handled: false, note: 'invoice without subscription' };` to mirror invoice.paid.
- **B44** The 8-day sweep in starter_pack_claim can turn a captured-but-ungranted pack into a £10 top-up and reopen the offer — `supabase/schema.sql:5276` · admin only · branch 21a schema. _Fix:_ In src/lib/starter-pack/grant-server.ts, when the row is 'failed' (never 'blocked') and the PaymentIntent has succeeded, grant it as the pack and move the row to granted rather than as a top-up; or …
- **B45** Clearing or moving the cutover later while a pack Checkout is in flight can grant both the £20 and the pack — `src/lib/lifecycle/settings-server.ts:55` · admin only · branch 21c stripe-ledger. _Fix:_ In src/lib/credit/welcome.ts, before granting, re-check starter_pack_purchases for a reserved/granted row for the user (any status in the last day), and skip the grant when one exists.


### C. Free vs paid, and privacy
33 findings: 4 High, 5 Medium, 24 Low.
#### C1 · High · "Book a web meeting with Stayful" data-quality disclaimer renders on white-label funnel and /r report pages
- **Where:** `src/app/estimate/page.tsx:2052` (also `src/lib/apis/airbtics.ts`, `src/lib/analysis/run.ts`, `src/app/r/[token]/page.tsx`) · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** The report view prints `r.dataQuality.disclaimer` verbatim with no funnel guard. Every disclaimer string Airbtics produces when comparables are thin (rural areas, unusual guest counts, a failed lookup) ends in "Book a web meeting with Stayful…" (airbtics.ts:331, 1162, 1535-1536, 1639, 1802, 1805; run.ts:370). Only the Calendly link beneath it is gated on `!funnel` (line 2062), so the author knew this block was a Stayful pitch but left the sentence itself. The string is also saved into `leads.result`, so it shows on the prospect's permanent /r/<token> page and in the customer's lead view.
- **How you'd hit it:** A prospect fills in Acme Lettings' funnel for a cottage in a rural postcode. The report opens under Acme's logo and colours with a yellow "Limited Data Available" box reading "Only 3 comparable properties… Book a web meeting with Stayful for a detailed, personalised assessment." They google Stayful and find a competitor of Acme.
- **Smallest fix:** In src/app/estimate/page.tsx around line 2061, when `funnel` is set, strip the Stayful sentence before rendering (e.g. `funnel ? r.dataQuality.disclaimer.replace(/\s*Book a web meeting with Stayful[^.]*\./, '') : r.dataQuality.disclaimer`), or make the strings in src/lib/apis/airbtics.ts neutral and move the Stayful CTA into the existing `!funnel` branch.
- **Verified:** Confirmed: estimate/page.tsx:2061 prints r.dataQuality.disclaimer unguarded; the Airbtics strings at airbtics.ts:331/1162/1535/1639/1802 and run.ts:370 end "Book a web meeting with Stayful"; /r/[token] renders the same EstimatePage.

#### C2 · High · "Presentation view" buttons on a funnel report open Stayful's own branded slide deck
- **Where:** `src/app/estimate/page.tsx:1441` (also `src/app/presentation/PresentationDeck.tsx`, `src/app/presentation/_lib/tokens.ts`, `src/app/presentation/_lib/caseStudies.ts`) · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** Both the sidebar button (lines 1441-1445) and the "See this report as a presentation" banner (1977-1984) call `openPresentation` with no `funnel` guard. It writes the analysis to localStorage and opens `/presentation` in a new tab, a page built on "Stayful brand tokens" that renders `<Image src="/assets/stayful-logo.png" alt="Stayful">` and links Stayful case-study PDFs. The FAQ, narrator, ReportOptions and Calendly links were all gated for funnels; these two buttons were missed.
- **How you'd hit it:** A prospect on Acme Lettings' funnel finishes their report, clicks the green "Presentation view →" banner, and a new tab opens at stayful.co.uk/presentation showing a Stayful-logoed deck with Stayful's case studies for the property they just entered.
- **Smallest fix:** In src/app/estimate/page.tsx wrap the sidebar block at line 1440 and the CTA banner at line 1967 in `{!funnel && (...)}` (same pattern as the FAQ at line 3188).
- **Verified:** Confirmed: estimate/page.tsx:1441 and :1979 call openPresentation with no funnel guard; /presentation renders the Stayful logo (PresentationDeck.tsx:194).

#### C3 · High · Failed funnel run: owner is charged with no refund, the lead stays 'queued' and is run and charged again by the drain, and the prospect is told to resubmit (duplicate lead)
- **Where:** `src/app/api/f/[token]/analyse/route.ts:225` (also `src/app/api/internal/funnel-queue/route.ts`, `src/app/api/analyse/route.ts`, `src/lib/leads/store.ts`, `src/lib/credit/action.ts`) · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** When `runAnalysis` throws (or the 60 s function limit kills it), the route sends an error and settles the spend cap but (a) never calls `refundAction`, unlike the member route which refunds 'Report failed' at /api/analyse:321, so every provider call metered before the failure stays debited to the owner; (b) never moves the lead off `status='queued'`, so the funnel-queue cron re-runs it and charges the full report again; (c) the prospect is told "Please try again shortly" / "Analysis stream ended unexpectedly. Please try again" and `captureLead` has no dedupe on (funnel_id, email), so a resubmission inserts a second lead that also runs. The earlier fix in completeLead only covers the save-after-success path. A GeocodeError variant leaves an un-geocodable lead queued and retried every 30 minutes for 14 days.
- **How you'd hit it:** Airbtics is slow; a prospect's report on Acme's funnel times out at 60 s. Acme is debited for the geocode-onwards calls (no refund). The prospect resubmits and gets a report (charge 2). Thirty minutes later the drain runs the first row again (charge 3), pushes a second Monday item and emails the prospect a second report link. Acme paid ~2.5 reports for one lead.
- **Smallest fix:** In src/app/api/f/[token]/analyse/route.ts catch block (line 225): `await refundAction(prepared.ctx.actionId, 'Report failed')` and update the lead to a non-queued state (e.g. `status: 'failed'` with `updated_at`), and in captureLead (src/lib/leads/store.ts:52) return an existing queued/failed lead for the same funnel_id+email+postcode from the last hour instead of inserting another.
- **Verified:** Confirmed: f/[token]/analyse/route.ts:225-237 catch sends an error and settles the spend cap but never refunds the action or moves the lead off queued; funnel-queue/route.ts:54-63 re-reads status=queued; captureLead inserts unconditionally.

#### C4 · High · Queued (out-of-credit) leads are re-run with default property spec: flat, no bathrooms, no parking, no outdoor space
- **Where:** `src/app/api/internal/funnel-queue/route.ts:83` (also `src/lib/analysis/input.ts`, `src/lib/leads/store.ts`, `supabase/schema.sql`) · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** `leads` stores only address, postcode and bedrooms (schema.sql:1154-1157). The drain rebuilds the analysis input from those three fields, so `parseAnalysisInput` defaults propertyType to 'flat', bathrooms to undefined, parking to none and outdoorSpace to the default. The report the prospect is emailed and the CRM receives is for a different property than they described, with different revenue.
- **How you'd hit it:** A prospect enters a 4-bed detached house, 3 bathrooms, driveway, garden on Acme's funnel while Acme is out of credit. Acme tops up; the drain runs the lead as a 4-bed flat with no parking or garden. The prospect's emailed report and Acme's Monday item carry that lower, wrong figure.
- **Smallest fix:** Add an `input jsonb` column to `leads` and store `parsed.input` in captureLead (src/lib/leads/store.ts:62); in the drain use that stored input instead of rebuilding from three columns.
- **Verified:** Confirmed: funnel-queue/route.ts:83-89 rebuilds the input from address, postcode and bedrooms; leads has no column for the rest.

#### C7 · Medium · A paused (suspended) team seat can still open the team's unlocked deal sheets by URL
- **Where:** `src/app/deals/[id]/page.tsx:104` · **Journey:** later · **Fix branch:** 21h product-nav-health
- **What's wrong:** The deal page resolves the team owner with payerFor() and passes payerId to dealSheet(), which treats the owner's deal_opens as the member's unlock and returns priv (address, listing URL, photos, snapshot). Neither the page nor dealSheet checks payer.suspended. Everywhere else a paused seat is shut out: leads throw SeatPausedError, My deals falls back to 'own' (tracked-server.ts:110), reports lose the team RLS policy (active_team_owner requires suspended_at is null), and openDealAction refuses. So the paused member still reads every address the team has paid to unlock, as long as they know (or bookmarked) the deal id.
- **How you'd hit it:** An owner's seat renewal fails and the member's seat is suspended. The member opens /deals/<id> for a deal a teammate unlocked last month and still sees its full address, Rightmove link and photos, although /my-deals, /leads and /reports have all gone quiet for them.
- **Smallest fix:** In src/app/deals/[id]/page.tsx (and src/lib/marketplace/open.ts dealSheet callers such as project-actions.ts and api/deals/[id]/project/route.ts) pass the member's own id instead of payerId when payer.suspended, matching trackedScope.
- **Second reader:** Partly. Understated. deals/[id]/page.tsx:104 feeds the owner's payerId to dealSheet (:107) and open.ts:257-258 returns the private data from the owner's opens; no suspended check in the page, the layout or AppShell. The paused member does not even need a deal id: /deals/opened/page.tsx:46 lists every deal the team opened, with links. An entitlement gap for a seat still on the team, not a leak to outsiders. Fix: no — /deals/opened/page.tsx:46 must use the member's own id when payer.suspended, and the same switch is needed on the deal page, project-actions.ts:35 and api/deals/[id]/project/route.ts:51.

#### C9 · Medium · PDF page six puts Stayful's management-service pitch in the customer's name
- **Where:** `src/lib/pdf/report/Page6Plan.tsx:84` · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** `StayfulReport` always renders Page6Plan (StayfulReport.tsx:65). For a branded report it substitutes the customer's company name into Stayful's own service copy: "How {Company} grows your returns", "We build direct bookings systematically, without any extra effort from you", "{COMPANY} HANDLES EVERYTHING: Listing setup, Guest management, Cleaning coordination, Pricing optimisation, Direct booking growth", "NEXT STEP · FREE 30-MINUTE CALL — Book your Airbnb Profitability Action Plan". The web report drops the FAQ for funnels for precisely this reason (page.tsx:1272-1281, 3183-3188), but the PDF the prospect downloads and the CRM receives still makes these claims on the customer's behalf.
- **How you'd hit it:** A mortgage broker runs a funnel. Their prospect's PDF ends with "Acme Mortgages HANDLES EVERYTHING — Guest management, Cleaning coordination" and "Book your Airbnb Profitability Action Plan, free 30-minute call", services Acme does not offer.
- **Smallest fix:** In src/lib/pdf/StayfulReport.tsx line 65 render `<Page6Plan>` only when `ours` (no brand), or give branded reports a neutral closing page with just the customer's contact line.
- **Second reader:** Confirmed. StayfulReport.tsx:65 renders Page6Plan for every report with the customer's name: "How ${company} grows your returns" (Page6Plan.tsx:84), "${company.toUpperCase()} HANDLES EVERYTHING" (:137), "How we rank in the top 20% of listings" (:31), "Book your Airbnb Profitability Action Plan" (:157); render.tsx:76-78 removed only the booking link for funnels. Most of the HANDLED list suits the management companies Leads targets, but the specific promises are Stayful's. Fix: no — rendering Page6Plan only when ours still lists "THE PLAN" in page 1's contents and the "0X / 0N" totals (sections.ts:65 always includes 'plan'): add a plan: ours flag to SectionAvailability, or keep the page for funnels with neutral text when !ours.

#### C10 · Medium · "Stayful estimate" label on the second-opinion card of an enhanced-depth funnel report
- **Where:** `src/app/estimate/_components/SecondOpinionCard.tsx:19` · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** When a funnel's `report_depth` is 'enhanced', `r.secondOpinion` is set and page.tsx:2026 renders SecondOpinionCard with no funnel guard. Its first tile is hard-coded "Stayful estimate" beside "PMI projection".
- **How you'd hit it:** Acme sets its funnel to enhanced reports. Every prospect's report shows a card "STAYFUL ESTIMATE £31,200 | PMI PROJECTION £29,800" under Acme's branding.
- **Smallest fix:** Give SecondOpinionCard an `oursLabel` prop and pass `funnel ? `${funnelLabel(funnel)} estimate` : 'Stayful estimate'` from src/app/estimate/page.tsx:2026.
- **Second reader:** Confirmed. f/[token]/analyse/route.ts:128 produces r.secondOpinion for enhanced funnels; estimate/page.tsx:2026 renders SecondOpinionCard with no funnel guard and SecondOpinionCard.tsx:19 hard-codes "Stayful estimate", where the page elsewhere uses funnel ? funnelLabel(funnel) : "Stayful" (:1947, :3322).

#### C32 · Medium · The early-access banner offers only Upgrade although the pack (or any top-up) lifts the 48-hour delay; the day's Today list keeps the free-tier selection after they pay
- **Where:** `src/app/deals/_components/EarlyAccessBanner.tsx:14` · **Journey:** Today · **Fix branch:** 21d privacy-access
- **What's wrong:** hasEverPaid counts last_topup_at (access.ts:237), so the £10 pack lifts the delay, but the banner's only call to action is Upgrade and the pack copy never says so (rules.ts:117-136); and the stored Today list keeps the free-tier selection until 07:00 UTC after they pay (selection.ts:89-101).
- **How you'd hit it:** A pack-era member sees "3 new deals are in early access. Paid members are seeing them now. Upgrade", buys the pack instead, and Today still shows yesterday's free-tier list until the next morning.
- **Smallest fix:** Name the pack and top-ups on the banner for pack-era accounts, and re-choose Today when the account's tier changes (clear the stored list on the first grant).

#### C33 · Medium · A lead-form member's first sign-in posts lead_activated to n8n with no consent check
- **Where:** `src/lib/auth/sign-in-hooks.ts:38` · **Journey:** later · **Fix branch:** 21e messages-crons
- **What's wrong:** Batch 19 gates every Meta event on the member's consent, but the older lead-activation hook fires on first sign-in regardless (sign-in-hooks.ts:38-59) and its stated purpose is to tell the ad platform that the lead became a member. Only lead-form members. README §15 step 8 says the inactive n8n workflow must respect member_consent if switched on; the hook itself sends without checking.
- **How you'd hit it:** A lead provisioned from a lead form signs in for the first time having rejected cookies; the hook posts their user id and email to n8n anyway.
- **Smallest fix:** In src/lib/auth/sign-in-hooks.ts read member_consent for the user before posting (or include the consent state in the payload so the workflow can honour it).

**Low (24, listed as reported, not independently verified):**

- **C5** Buying the £10 starter pack silently upgrades the member to the paid tier for early access, and no copy anywhere tells them — `src/lib/starter-pack/rules.ts:117` · the £10 pack · branch 21d privacy-access. _Fix:_ In src/lib/starter-pack/rules.ts packCopy(), take freeDealDelayHours and add one clause to body/cardBody/deadEnd when it is > 0, e.g. '... and you see new deals 48 hours before free members'; pass …
- **C6** A paid member who receives a colleague's share link to a fresh deal is treated as signed out: 'Available to members ... Join free', with no way into the deal — `src/app/d/[token]/page.tsx:37` · later · branch 21d privacy-access. _Fix:_ In src/app/d/[token]/page.tsx load(): call createSupabaseServerClient().auth.getUser(); when a user is present use dealVisibilityFor(user.id, isAdminEmail(user.email)) instead of …
- **C8** Stayful's favicon.ico is injected into every funnel and report page ahead of the customer's icon — `src/app/f/[token]/page.tsx:114` · later · branch 21g funnel-whitelabel. _Fix:_ Move src/app/favicon.ico to public/favicon.ico (the root layout's `icons` config in src/app/layout.tsx:12-19 already lists the icons it wants and the funnel page overrides that config correctly); …
- **C11** Prospect engagement beacon sends the property address and behaviour from white-label pages to Stayful's /api/track and stores a 'stayful_sessions' key in their browser — `src/app/estimate/page.tsx:706` · later · branch 21g funnel-whitelabel. _Fix:_ In src/app/estimate/page.tsx line 708 change the guard to `if (result && !funnel)` so the tracker never starts on a funnel or lead report.
- **C12** The public area teaser 'hides' the top-3 photos with a CSS blur only; the docblock claims no photo — `src/app/(marketing)/short-let-deals/[slug]/page.tsx:75` · sign-up · branch 21d privacy-access. _Fix:_ In src/app/(marketing)/short-let-deals/[slug]/page.tsx either drop the <img> for signed-out visitors (and fix the docblock) or accept the photo is public and remove the blur and the 'no photo' claim.
- **C13** A member's home postcode is written to the server log when geocoding fails — `src/lib/profile/server.ts:315` · the profile quiz · branch 21b credit-enforce. _Fix:_ In src/lib/profile/server.ts line 315 log only the reason (and at most the outcode), e.g. `console.warn(`[profile] could not place home: ${why}`)`.
- **C14** A pasted listing's URL is written to the server log when the parser fails — `src/lib/listing/server.ts:75` · Today · branch 21d privacy-access. _Fix:_ In src/lib/listing/server.ts line 75 log the source and listing id hash rather than the URL, or drop the URL from the message.
- **C15** The daily pick email (address, portal photo, listing link) is sent before the pick is charged; a failed debit still leaves the deal open at £0 — `src/lib/listing/picks-run.ts:1516` · the first email · branch 21e messages-crons. _Fix:_ In src/lib/listing/picks-run.ts move the per-part debit loop (lines 1544-1576) ahead of sendEmail, and only build the address-bearing pick section for rows whose debit succeeded (or refund and skip …
- **C16** Email tokens never expire and keep acting for the member after they unsubscribe — `src/app/p/[token]/actions.ts:12` · the first email · branch 21d privacy-access. _Fix:_ In src/lib/listing/picks-server.ts recordReaction/applyPickRelaxation (token branch) and src/lib/tailoring/email-answers-server.ts teaserAnswerContext, refuse a token older than N days (compare …
- **C17** A refunded or disputed starter pack (or top-up) leaves last_topup_at set, so the member keeps paid-tier early access forever — `src/lib/starter-pack/grant-server.ts:249` · later · branch 21c stripe-ledger. _Fix:_ In src/lib/starter-pack/grant-server.ts clawbackStarterPack (and stripe/grants.ts's refundTopup), when the refund covers the whole charge and the profile has no subscription history, clear …
- **C18** A free member's kept deal that goes off market and comes back vanishes from My deals (and its alerts) for 48 h, because a revival restarts the early-access window — `src/lib/listing/tracked-server.ts:230` · later · branch 21d privacy-access. _Fix:_ In src/lib/listing/tracked-server.ts, build a set of deal ids the viewer has reacted to (from `reactions`) and add `!reactedIds.has(id)` to the skip condition on line 230, matching …
- **C19** The analyser's public deal sheet (/deal/<token>) publishes the address and portal link of a pool deal a paid member has opened, while /d/<token> withholds even the photo inside the window — `src/app/deal/[token]/page.tsx:39` · later · branch 21d privacy-access. _Fix:_ In src/lib/listing/share.ts sharedListingByToken (or in src/app/deal/[token]/page.tsx), look the row's canonical_url up in marketplace_deals and, when it is a live deal that fails dealVisible() under …
- **C20** My deals comment claims a member can become free again 'after a plan ends'; hasEverPaid is sticky, so the branch it explains fires for a different reason — `src/app/my-deals/page.tsx:104` · later · branch 21d privacy-access. _Fix:_ Reword the comment on src/app/my-deals/page.tsx:104-105 to name the real causes (a revived deal whose window restarted; a team seat under an owner who has not paid).
- **C21** /profiles/switch changes the member's active profile on a plain GET — `src/app/profiles/switch/route.ts:26` · later · branch 21f activity-inactivity-monday. _Fix:_ In src/app/profiles/switch/route.ts require a same-origin Referer/Sec-Fetch-Site for the state change, or have the GET render a one-click confirm form (as the unsubscribe routes do) and do the switch …
- **C22** /api/track is an unauthenticated dead endpoint that logs whatever it is sent — `src/app/api/track/route.ts:7` · later · branch 21d privacy-access. _Fix:_ Delete src/app/api/track/route.ts and the syncTimeOnSiteToMonday stub in src/lib/apis/monday.ts (and the client tracker that calls it, src/lib/tracker.ts) or gate the route on isSameOriginJson.
- **C23** A lead's report token lets anyone render an arbitrary PDF with that prospect's email on the cover — `src/app/api/generate-pdf/route.tsx:35` · later · branch 21d privacy-access. _Fix:_ In src/app/api/generate-pdf/route.tsx, when ?r= is given render lead.result from leadByReportToken() and ignore the body (or redirect to /r/<token>/pdf).
- **C24** Prospect's report email is sent from Stayful's address (display name only is the customer's) — `src/lib/email/lead-report.ts:38` · later · branch 21g funnel-whitelabel. _Fix:_ Add a neutral white-label sending identity (e.g. `EMAIL_FROM_WHITELABEL=reports@<neutral-domain>` verified in Resend) and use it in src/lib/email/lead-report.ts:39 instead of EMAIL_FROM; longer term, …
- **C25** <meta name="generator" content="Stayful"> is emitted on every funnel and lead-report page — `src/app/layout.tsx:11` · later · branch 21g funnel-whitelabel. _Fix:_ Remove `generator` from src/app/layout.tsx:11 (it has no user-facing value), or set `generator: undefined` in the two generateMetadata functions.
- **C26** A bad funnel link, a purged report link, or a render error shows Next's default page titled "Stayful — income-estimate software…" with Stayful icons — `src/app/f/[token]/page.tsx:131` · later · branch 21g funnel-whitelabel. _Fix:_ Add src/app/f/[token]/not-found.tsx and src/app/r/[token]/not-found.tsx with neutral copy ("This link is no longer available"), and a src/app/f/layout.tsx + src/app/r/layout.tsx exporting a neutral …
- **C27** ?preview=1 / ?preview=report on a LIVE funnel is honoured for anyone, not just the owner — `src/app/f/[token]/page.tsx:82` · later · branch 21g funnel-whitelabel. _Fix:_ In src/app/f/[token]/page.tsx `resolve()` line 82-86, for a live funnel only return the preview view when `await ownerOf(token)` is non-null; otherwise ignore the parameter and serve the live form.
- **C28** Owner opening their own paused link (without ?preview) triggers the 'paused_hit' alert email to themselves — `src/app/f/[token]/page.tsx:150` · later · branch 21g funnel-whitelabel. _Fix:_ In the paused branch of src/app/f/[token]/page.tsx (line 140) call `ownerOf(token)` before scheduling the alert and skip `raiseFunnelAlertById` when it resolves; the cookie read only happens on …
- **C29** Stayful's Meta pixel dataset id is serialised into every funnel page's RSC payload — `src/app/layout.tsx:32` · later · branch 21g funnel-whitelabel. _Fix:_ Mount TrackingRoot from route-group layouts for tracked surfaces (marketing, app) rather than the root layout, or have TrackingRoot read the id from a `<meta>` emitted only by those layouts, so …
- **C30** Internal-route secrets are compared with === rather than a constant-time compare — `src/lib/internal-auth.ts:22` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/internal-auth.ts compare with crypto.timingSafeEqual over equal-length buffers (as src/lib/sms/verify.ts:54 does).
- **C31** crm-deliveries cron has no ?dry=1 mode although it sends prospects' personal data to third parties — `src/app/api/internal/crm-deliveries/route.ts:28` · admin only · branch 21g funnel-whitelabel. _Fix:_ In src/app/api/internal/crm-deliveries/route.ts read `dry` from the URL and, when set, return the due `crm_deliveries` ids (the query at src/lib/crm/deliver.ts:258-264) without calling `runDelivery`.


### D. Scheduled jobs and messages
28 findings: 1 Critical, 2 High, 8 Medium, 17 Low.
#### D1 · Critical · team-seats: reinstating a suspended seat can charge the owner £10 twice (period key is `now`)
- **Where:** `src/lib/team/seats.ts:174` (also `src/lib/stripe/grants.ts`, `src/app/api/internal/team-seats/route.ts`) · **Journey:** later · **Fix branch:** 21c stripe-ledger · merged: W1-22
- **What's wrong:** chargeSeat dedupes on the unique key (member_id, period_start). renewDueSeats passes periodStart = seat_paid_until (deterministic, safe). reinstateSeats passes periodStart = now, a fresh timestamp per run, so the unique key never matches across two runs. Two callers can run at once: the hourly cron (/api/internal/team-seats at :25) and grantTopup → reinstateSeats({ownerId}) from the Stripe webhook (src/lib/stripe/grants.ts:85-86). Both read the suspended row, both insert a team_seat_charges row with different period_start values, both debitFace £10, both then clear suspended_at. The window per seat is the debit + awaited afterDebit (which can call Stripe) + two Resend emails, i.e. seconds, and the whole reinstate loop is sequential over up to 200 rows. A Vercel double-fire of the cron has the same effect for every suspended seat that is now affordable.
- **How you'd hit it:** Owner O has one suspended seat. At 10:24:58 O tops up £20; the webhook's reinstateSeats reads the seat and starts chargeSeat(periodStart=10:24:59). At 10:25:00 the cron's reinstateSeats reads the same seat (still suspended_at != null), chargeSeat(periodStart=10:25:00) inserts a second claim and debits another £10. O's ledger shows two 'Team seat — <name>' lines and the balance is £0 instead of £10; both runs email 'seat restored' twice.
- **Smallest fix:** In reinstateSeats (src/lib/team/seats.ts), claim the row before charging: `update team_members set suspended_at = null where member_id = r.member_id and suspended_at = r.suspended_at` with `.select()`, skip the seat when no row came back, and only then chargeSeat. Alternatively key the reinstatement charge on the stored suspended_at (periodStart: new Date(r.suspended_at)) so the unique key dedupes, and set seat_paid_until from now separately.
- **Verified:** Confirmed: seats.ts:174 periodStart = now; the unique key (member_id, period_start) therefore never matches a second run; callers: hourly cron, grantTopup (two Stripe events can both pass its non-atomic check), grantStarterPack.

#### D2 · High · A Resend 429 (rate limit) is a definite failure that burns the member's day slot; the digest and Your week send four at a time with no backoff
- **Where:** `src/lib/email/send.ts:72` (also `src/lib/notify/digest-run.ts`, `src/lib/notify/week-run.ts`, `src/lib/notify/sends.ts`) · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** sendEmail treats every 4xx as final and never retries or backs off (line 72). Resend's default API limit is 2 requests/second and it answers 429 rate_limit_exceeded. The 08:10 digest and the Monday Your week run 4 senders in parallel (digest-run.ts:255, week-run.ts:280); each 429 comes back as {sent:false, reason:'http_429'} and the caller closes the claimed slot as 'failed' (digest-run.ts:371, week-run.ts:358), which slotsInUse then counts as used for the rest of the day. The member gets nothing that morning and nothing else (the letter, the £5 decision) can use the slot.
- **How you'd hit it:** Launch morning, 40 new members are due the 08:10 digest. Four workers post to Resend in the same second; Resend answers 429 for some. Those members' notification_sends rows go to 'failed', they get no Today's 5 that day, their pending deal changes wait until tomorrow, and the admin sees only emailFailures in the log.
- **Smallest fix:** In src/lib/email/send.ts treat 429 like a 5xx: retry under the same Idempotency-Key after the Retry-After header (or ~600 ms), up to three times; and lower mapLimit(open, 4) in src/lib/notify/digest-run.ts:255 and mapLimit(plans, 4) in src/lib/notify/week-run.ts:280 to 2.
- **Verified:** Confirmed: send.ts:72 returns on any 4xx (429 included) with no retry; the caller then finishSend(false) and slotsInUse counts the failed row as the day used.

#### D3 · High · daily-digest: fixed member order plus a 50 s budget means the same members will get no daily email every day once the run overruns
- **Where:** `src/lib/notify/digest-run.ts:255` (also `src/lib/notify/alerts-collect.ts`) · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** The audience is read ordered by id (line 103) and processed by mapLimit(open, 4, …) in that order. When elapsed() > 50 s every remaining member is marked out_of_time and there is no later pass (the digest runs once at 08:10). Before the loop, todayPlans({create: true, concurrency: 6}) runs todaySelection for every seat, lowCreditNoticesFor reads Stripe for everyone due, and each send is ~12 sequential DB calls plus Resend. Because the order is stable (ids), the members cut are the same ones every day; deal-alerts (alerts-collect.ts:36-40, 131) rotates by a daily hash for exactly this reason, the digest does not. Estimate: ~1 s per todaySelection /6 and ~1.5 s per send /4 puts the run at ~35 s today (52 profiles) and past 50 s at roughly 80-120 members with picks on. This is the first cron to break as sign-ups from the ads land, and it is the fallback email for every member the picks passes could not send to.
- **How you'd hit it:** At 110 members, the digest at 08:10 reaches 50 s after member ~90 in id order. The ~20 members with the highest-sorting ids (including a member who signed up yesterday) get reason 'out_of_time' and no email; they get the same result tomorrow and every day after, while everyone else is emailed daily.
- **Smallest fix:** In src/lib/notify/digest-run.ts sort `open` by a daily rotation before mapLimit (reuse the rotation(id, day) hash from src/lib/notify/alerts-collect.ts, or order by the member's last notification_sends.sent_at ascending), and log ranOutOfTime. Optionally add a second digest schedule at 08:25 that only picks up members whose slot is still free.
- **Verified:** Confirmed: digest-run.ts:103 orders by id, :255-260 drops the rest at 50 s with no later pass; picks-run.ts:308 orders by id too. Not a problem at 52 members; it is the first cron to degrade as sign-ups land.

#### D4 · Medium · Email OK is true for a sign-up that never confirmed its email or signed in; nobody writes the board's Email Verified column
- **Where:** `src/lib/crm/monday-funnel/facts.ts:74` · **Journey:** sign-up · **Fix branch:** 21e messages-crons
- **What's wrong:** emailOkFor needs only an '@' in the email and sourcing_alerts OR alert_missed true. Both columns default true (schema.sql:1040, :2534) and the profile row is created by the auth.users trigger at signUp, before the confirmation link is clicked. The site's own emails all require welcome_checked_at (first sign-in), so Email OK says yes to addresses the site itself would never email. The board's 'Email Verified' checkbox (boolean_mm3a1wy9) has no writer anywhere in src, so n8n cannot compensate. inactivityEligible does not require a sign-in either, so an unconfirmed account reaches Re-engage 14 days after sign-up.
- **How you'd hit it:** Someone clicks the Facebook ad, types an email with a typo and never confirms. Fourteen days later the nightly moves their row to Re-engage with Email OK ticked and Email Verified unticked-forever. n8n emails the mistyped address (or, with a real address, a person who never agreed to anything beyond a sign-up form).
- **Smallest fix:** In src/lib/crm/monday-funnel/facts-server.ts add welcome_checked_at to PROFILE_COLUMNS and in src/lib/crm/monday-funnel/facts.ts make emailOkFor also require Boolean(p.welcome_checked_at); optionally also write Email Verified (boolean_mm3a1wy9) from the same fact by adding it to COLUMNS in config.ts.
- **Second reader:** Confirmed. emailOkFor (facts.ts:74-76) needs only an '@' plus sourcing_alerts or alert_missed, both default true (schema.sql:1040, :2534), and handle_new_user creates the profile at sign-up before the email is confirmed (schema.sql:147); loadFacts drops only no_email/admin/staff/team; inactivityEligible and runInactivityStep take every profile with no sign-in check; nothing writes Email Verified (boolean_mm3a1wy9). Latent while MONDAY_FUNNEL_ENABLED is off and inactivity_from is empty.

#### D6 · Medium · Email OK and SMS OK refresh only on the 06:00 UK nightly: no queue on a settings change, unsubscribe, STOP or verification
- **Where:** `src/lib/notifications/server.ts:12` · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** The one notifications writer (setNotification / setNotifications), the Texts on/off (setContactEnabled), STOP/START (stopNumber/startNumber) and a first verified number (checkCode) all change what Email OK / SMS OK derive from, but none of them calls queueFunnelSync; FunnelReason has no such reason. Every other row-changing event queues the member (grep: signup, starter_pack, topup, plan, payment_failed, refund, hit_zero, low_credit, next_deal, came_back). So the two checkboxes n8n 'must check before sending' are stale for up to ~24 h after the member changes their mind. The nightly also reads facts once per pass (sync-server.ts:234) and writes up to 50 s later, so a change inside that window is written stale and not corrected until the next night.
- **How you'd hit it:** A member enters Re-engage on Tuesday's 06:00 nightly with Email OK ticked. At 09:00 they one-click unsubscribe from that morning's Today's 5 (daily_picks off; alert_missed already off). Monday still shows Email OK = true until Wednesday 06:00. An n8n step in the sequence that sends at 12:00 emails someone who unsubscribed three hours earlier.
- **Smallest fix:** Add 'notifications' to FunnelReason in src/lib/crm/monday-funnel/queue-server.ts and call queueFunnelSync(userId, 'notifications') at the end of setNotification/setNotifications in src/lib/notifications/server.ts, in setContactEnabled and after stopNumber/startNumber in src/lib/sms/store.ts (look up user_ids from the rows the update returned), and after setNotifications in src/lib/sms/verify-server.ts:156.
- **Second reader:** Confirmed. notifications/server.ts:12-17, sms/store.ts:100-134 (setContactEnabled, stopNumber, startNumber) and verify-server.ts:156 never call queueFunnelSync and FunnelReason has no reason for them, so Email OK and SMS OK refresh only on the nightly or an unrelated event. Latent while MONDAY_FUNNEL_ENABLED is off; bites once that switch and the n8n Re-engage trigger are on.

#### D7 · Medium · A mail scanner's GET of a pick email's Yes/No link is logged as email_feedback, which counts as 'engaging' and brings a quiet member back
- **Where:** `src/app/p/[token]/page.tsx:45` · **Journey:** the first email · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** The pick page logs email_feedback on a bare GET of ?a=yes / ?a=no (the file's own comment says a bare click can come from a mail scanner and so never changes the search, but it still records the reaction and the activity). email_feedback is in EMAIL_ENGAGEMENT_KINDS and has no extras.on, so isEngagement returns true, log.ts calls cameBack, and the SQL nightly counts an engaged day. rules.ts claims engagement is 'recorded from the signed-in page itself, so a mail scanner opening links is not one' — true for email_click (presence.ts needs a session), false for this path. Members behind link-prefetching mail security (Outlook Safe Links, Proofpoint) never reach Re-engage and their daily picks never pause for inactivity.
- **How you'd hit it:** A member on an Outlook 365 mailbox stops opening anything. Every morning their Today's 5 arrives, Safe Links prefetches /p/<token>?a=yes, email_feedback is logged, member_engaged_days gets today, and they are never moved to Re-engage or paused; the pick (and, per_day, the daily deals charge) keeps going for a member who has not looked at the site in weeks.
- **Smallest fix:** In src/lib/inactivity/rules.ts isEngagement, treat email_feedback with extras.via === 'link' as not engaging (keep the form answer, via 'form', engaging); or drop the logActivity at src/app/p/[token]/page.tsx:45 and keep only the confirmed-form log in actions.ts:17.
- **Second reader:** Confirmed. p/[token]/page.tsx:42-46 logs email_feedback on a bare GET of ?a=yes / ?a=no (links in every pick email, picks.ts:522-523); isEngagement returns true (rules.ts:49-53), log.ts:55 calls cameBack, and the nightly SQL counts it too (schema.sql:5484). The sibling /p/d page records nothing on a GET, so this is the one path a mail scanner can trigger. Latent until inactivity_from is set. Fix: no — changing isEngagement is not enough because lifecycle_active_days_sync applies its own SQL rule (schema.sql:5484, :5500); drop the logActivity at page.tsx:45 and keep the confirmed form's log (actions.ts:17).

#### D8 · Medium · sourcing: the send loop only gets what is left after 44 s of verification, so each pass sends to a handful of members
- **Where:** `src/lib/listing/picks-run.ts:1299` · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** Budgets: queries stop at 30 s, page verification at 40 s, Today lists waited for until 44 s, the whole run 50 s. verify() does one resolveListing page fetch per candidate (Rightmove/OnTheMarket, 1-3 s each) for every member with candidates, so with tens of members the verification phase runs to its 40 s limit. The send loop then starts at 40-44 s and each send is ~12 sequential DB calls plus Resend (~1.5-2 s), so roughly 3-6 members are sent per pass; 3 passes ≈ 10-18 members a day with a pick. Members left over fall to the 08:10 digest, which sends Today's 5 without a pick (the paid pick is the product the ad promises). The order is starved-first (sourcing_last_sent_at nullsFirst) so it rotates, but the daily ceiling is fixed by the clock, not by membership.
- **How you'd hit it:** 40 members are enrolled with candidates. The 07:00 pass verifies pages until 40 s, then emails 5 members by 50 s (the rest 'out_of_time'). 07:20 and 07:40 do the same. ~25 members get the digest at 08:10 with teasers but no pick, every day; a new member's first morning is likelier to be a pick-less digest than the pick.
- **Smallest fix:** In src/lib/listing/picks-run.ts lower VERIFY_UNTIL_MS and DAILY_READY_BY_MS (e.g. 28 s / 32 s) so the send loop has ~18 s, and cap page verifications per pass (e.g. 12) with the rest sent on 'precheck ok' as already allowed; or add a 4th pass at 08:00 before picks-paused.
- **Second reader:** Partly. The budgets are as quoted (picks-run.ts:112-124) and verification (:1142) runs before the sequential send loop (:1280, :1299), so sending gets what is left before 50 s. But the throughput maths assumes every check is a 1-3 s page fetch: resolveListing first reads a 24-hour listing_snapshots cache (listing/server.ts:53), results are reused per listing and across passes, and after 40 s candidates that passed the precheck are picked with no fetch. "3-6 members per pass" is an unmeasured worst case; the run summaries' ranOutOfTime / out_of_time entries would show whether it happens. Fix: no — a 28 s VERIFY_UNTIL_MS is below the 30 s QUERY_BUDGET_MS and would skip page checks entirely when queries run long (sending possibly sold picks). Check the summaries first; if real, add a fourth sourcing pass at 07:50 UTC.

#### D10 · Medium · funnel-queue: no claim on a queued lead, so an overlapping run analyses and charges the customer twice
- **Where:** `src/app/api/internal/funnel-queue/route.ts:54` · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** The route reads leads with status='queued' and runs reserveSpend → reserveAnalysis → runAnalysis → completeLead. Nothing moves the lead out of 'queued' until completeLead at the very end, and nothing locks it. Two runs in the same minute (Vercel can fire a cron twice, and maxDuration means a run can still be inside its 3rd lead when the next fires) both read the same ≤5 leads and both run a full paid analysis for each. The funnel's daily spend cap (funnel_spend_reserve) is per-run worst case and does not know the same lead is being run twice. src/lib/leads/store.ts:106-116 records that this exact 'queued → ran twice → charged twice, duplicate CRM item and email' outcome has already happened once via a different path.
- **How you'd hit it:** Customer C's funnel is short of credit at 09:00 and lead L is queued. C tops up at 10:20. Two funnel-queue invocations at 10:30 both see L queued, both reserve, both run the £x report (PropertyData, Airbtics calls), both call completeLead. C's usage shows two report charges for one prospect and, if a CRM is connected, two deliveries are queued for L.
- **Smallest fix:** Before reserveSpend in src/app/api/internal/funnel-queue/route.ts, claim the lead: `admin.from('leads').update({ status: 'running' }).eq('id', lead.id).eq('status', 'queued').select('id')`; skip when no row came back; on failure set it back to 'queued' in the catch. (Add 'running' to the status set the queue query ignores.)

#### D11 · Medium · The £5 decision for a member with daily picks off is deferred to 'the day's daily email', which they never get
- **Where:** `src/lib/credit/after-debit.ts:94` · **Journey:** later · **Fix branch:** 21e messages-crons
- **What's wrong:** When a no-plan member crosses to £5 or less by a debit before 08:30 UTC, afterDebit returns without sending or stamping (line 94), on the comment's promise that the picks run or the 08:10 digest will carry the notice. Both only read members in their audience: the picks run's dailyIds (picks on) and the digest's `open`, which is built from profiles with sourcing_alerts = true plus members with pending deal_alerts (digest-run.ts:100, 113, 253). A member who turned Daily picks off and has no changes waiting is in neither, so the notice waits for their next debit after 08:30 UTC, which may be days away or never.
- **How you'd hit it:** A member with Daily picks switched off runs a report at 08:00 BST (07:00 UTC) taking them from £7 to £3. No email goes. If their next spend is a week later they hear then; if they stop spending at £3 they never get the Starter / £10 top-up decision.
- **Smallest fix:** In src/lib/credit/after-debit.ts, read sourcing_alerts with the profile (line 48) and, when it is false, skip the lowCreditMayGoAlone gate and call sendLowCreditAlone at once (the daily-slot claim still stops a second email that day).
- **Second reader:** Confirmed. Before 08:30 UTC after-debit.ts:94 neither sends nor stamps; the only other readers are picks-run.ts:1181 (daily picks on) and digest-run.ts:253 (open: sourcing_alerts true plus pending deal_alerts). A member with daily picks off and no pending alerts who spends before 08:30 UTC hears only at their next spend after 08:30, or never. Live today: low_credit_pence defaults to 500 (lifecycle/settings.ts:51).

#### D12 · Medium · crm-deliveries: no claim before pushLead, so an overlapping run (or the cron plus 'send now') pushes the same lead to the customer's CRM twice
- **Where:** `src/lib/crm/deliver.ts:272` · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** drainDeliveries selects pending rows due now and calls runDelivery for each. runDelivery re-reads the row, renders the PDF and calls provider.pushLead without first moving the row out of 'pending'; finish() updates status only afterwards. enqueueDelivery({immediate: true}) inserts a pending row with next_attempt_at = now and runs it at once, so the every-10-minutes cron can pick the same row in the same window; a double-fired cron does the same for every due row. The route also has no ?dry=1.
- **How you'd hit it:** Customer C clicks 'send now' on lead L at 10:29:59; the row is inserted pending with next_attempt_at=now and pushLead starts (PDF render ~3 s). The 10:30 cron selects the same pending row and pushes it too. C's Monday board shows two items for L.
- **Smallest fix:** In src/lib/crm/deliver.ts runDelivery, claim the row first: `update crm_deliveries set status = 'sending', updated_at = now() where id = ? and status = 'pending'` with `.select('id')`; return null when nothing came back; finish() writes sent/pending/failed as now. A dry run would list the due rows (id, lead_id, connection_id, attempts) and skip runDelivery.
- **Second reader:** Confirmed. deliver.ts:170-172 calls provider.pushLead and only then finish(row, result), with no status change before the push; drainDeliveries (:258-279) takes any due 'pending' row; neither provider guards a second push (providers/monday.ts:89 is a plain create_item; the webhook a plain POST). Every row comes from enqueueDelivery({ immediate: true }), so the every-10-minutes cron can grab a "send now" row mid-push; a run killed after the push but before finish() (up to 10 PDF deliveries per 60 s, no time budget) also re-pushes. Fix: no — a 'sending' claim as written leaves a row stuck forever if the function dies between the claim and finish(); claim with a lease (set next_attempt_at = now()+5 min where id = ? and status = 'pending' and next_attempt_at <= now(), returning id) or add a takeover for stale 'sending' rows, and give drainDeliveries a time budget.

#### D13 · Medium · funnel-queue: no time budget; five full analyses can exceed 60 s and a kill leaves the funnel's daily spend reserved
- **Where:** `src/app/api/internal/funnel-queue/route.ts:31` · **Journey:** later · **Fix branch:** 21g funnel-whitelabel
- **What's wrong:** MAX_PER_RUN is 5 and the loop has no elapsed() check. Each lead is a full analysis (geocode, floor area, ~15 PropertyData questions, Airbtics comps, long-let, etc.), typically 15-40 s. Three or more queued leads can push the function past maxDuration and Vercel kills it mid-analysis. The `finally { settleSpend(...) }` then never runs, so funnel_spend_reserve's worst-case claim stays in funnel_hits for the rest of the UK day (reserveSpend refuses later leads with 'daily_spend_cap' although nothing was spent), the credit reservation waits for its TTL, and the lead stays queued and is re-run next time, repeating the provider calls.
- **How you'd hit it:** Customer C's balance was short overnight; 4 leads are queued. C tops up. The 10:30 run finishes leads 1-2 in 45 s and is killed inside lead 3. Lead 3's worst-case (say £2.50) stays reserved against C's £5 daily cap; at 11:00 the run retries lead 3 (reserving another £2.50), and lead 4 is refused 'daily_spend_cap' until tomorrow even though only two reports were run.
- **Smallest fix:** In src/app/api/internal/funnel-queue/route.ts add `const started = Date.now()` and `if (Date.now() - started > 25_000) break;` at the top of the loop (start no new lead late), and/or drop MAX_PER_RUN to 2; the */30 cadence clears a backlog anyway.
- **Second reader:** Confirmed. route.ts:31 MAX_PER_RUN = 5 and the loop at :72 has no elapsed-time check under maxDuration = 60; the spend reservation is undone only in finally (:150), which a kill skips; funnel_spend_reserve's claim lasts the UK day and is shared with live submissions and autocomplete, so a stuck claim can refuse live prospects' reports that day. The credit reservation does expire (10-minute TTL) before the next run. Fix: no — "don't start a new lead after 25 s" still lets one begin at 24 s and run past 60 s; stop starting new leads after about 15 s (one or two per run); every 30 minutes still clears about 96 a day.

**Low (17, listed as reported, not independently verified):**

- **D5** A send Resend definitely refused (4xx other than 409) is closed as 'failed' and never released, so the day's slot is burnt with no email sent — `src/lib/notify/sends.ts:50` · the first email · branch 21e messages-crons. _Fix:_ In src/lib/notify/sends.ts add abandonSend(admin, id) that deletes the row where status = 'sending', and in each capped sender call it instead of finishSend(false) when res.reason starts with …
- **D9** The £0 out-of-credit email (with the starter-pack offer), the on-plan 80% low-balance email and the auto-top-up warning are uncapped and fire from the 07:00 pick debit, seconds after Today's 5 — `src/lib/credit/after-debit.ts:72` · later · branch 21e messages-crons. _Fix:_ In src/lib/credit/after-debit.ts, for the no-plan out-of-credit case, defer as the £5 decision does: skip the email before 08:30 UTC (lowCreditMayGoAlone) so the 08:00 picks-paused letter, which …
- **D14** There is no marketing-email consent: 'Email OK' is a proxy built from two product switches (Daily picks OR Weekly: deals I missed) — `src/lib/crm/monday-funnel/facts.ts:69` · sign-up · branch 21e messages-crons. _Fix:_ Add a 'marketing' entry to NOTIFICATION_TYPES in src/lib/notifications/registry.ts (column alert_marketing, defaultOn true, shown on the panel, added to NOTIFICATION_COLUMNS and schema.sql), and …
- **D15** A failed Resend call at 07:00 spends the member's whole day: no retry at 07:20 and the digest skips them — `src/lib/listing/picks-run.ts:1524` · the first email · branch 21e messages-crons. _Fix:_ In src/lib/notify/sends.ts slotsInUse, treat status 'failed' like a stale claim (not in use) and let claim_notification_slot (supabase/schema.sql) take over a 'failed' row; the Resend Idempotency-Key …
- **D16** listing-recheck debits the first watcher for each nightly page fetch with no balance check (the Airbnb path has one) — `src/app/api/internal/listing-recheck/route.ts:228` · later · branch 21b credit-enforce. _Fix:_ In src/app/api/internal/listing-recheck/route.ts apply the same isEnforcing()/getBalance guard to the portal loop (skip the URL when every watcher's payer is at zero), or meter portal rechecks as …
- **D17** team-seats and lead-retention send their emails before the conditional mark, so an overlapping run emails twice — `src/lib/team/seats.ts:126` · later · branch 21c stripe-ledger. _Fix:_ In src/app/api/internal/lead-retention/route.ts do the conditional update first (`.select('id')`) and email only the ids that came back; in src/lib/team/seats.ts email only when the suspend update …
- **D18** A Resend 409 (slot key already used) is recorded as a failed send by every capped sender, so the alerts the earlier email carried are told again — `src/lib/listing/picks-run.ts:1515` · later · branch 21e messages-crons. _Fix:_ In the capped senders (picks-run.ts:1524, digest-run.ts:371, week-run.ts:358, picks-paused-run.ts:287/405, low-credit-server.ts:164) treat res.reason === 'http_409' as sent, as …
- **D19** An SMS withdrawn at the last look closes the day's text slot as 'failed', so no text can go that day — `src/lib/sms/alerts-run.ts:181` · later · branch 21e messages-crons. _Fix:_ In src/lib/sms/alerts-run.ts:181 delete the 'sending' row (a new abandonSend in src/lib/notify/sends.ts) instead of finishSend(false) when nothing reached Twilio.
- **D20** The switchable credit emails (out of credit, running low) carry no unsubscribe link or List-Unsubscribe header, only 'Manage notifications' — `src/lib/email/billing.ts:20` · later · branch 21e messages-crons. _Fix:_ In src/lib/email/billing.ts give outOfCreditEmail and lowBalanceEmail a 'Stop these emails' link and pass headers from listUnsubscribeHeaders (a stored send token via markSending, as …
- **D21** deal-checks reads the day's cap only from finished runs, so two overlapping runs can each spend the whole cap — `src/lib/deal-quality/checks-run.ts:307` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/deal-quality/checks-run.ts runDealChecks, insert the marketplace_runs row first with summary {inProgress: true, rawCostPence: 0} (as project-checks' openRun does) and update it at the end; …
- **D22** Dry runs of sourcing and daily-digest call Stripe (cardSummary) for every member due the low-credit notice — `src/lib/listing/picks-run.ts:529` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/credit/low-credit-server.ts give lowCreditNoticesFor a `preview` option that returns {kind} without calling noticeFor (or passes card: null), and pass it from the dry branches of …
- **D23** market-warm has no time budget: a cold snapshot build plus four region buys can exceed 60 s and the build is lost — `src/app/api/internal/market-warm/route.ts:53` · admin only · branch 21e messages-crons. _Fix:_ In src/app/api/internal/market-warm/route.ts use getAreaCardsWithin(35_000) (src/lib/market/cached.ts, which keeps the build alive) instead of getAreaCards(), and skip the key-stats warm when the …
- **D24** provider_calls has no index on action_id; demand-sourcing scans it once per search to settle the claim — `src/lib/sourcing-demand/server.ts:342` · admin only · branch 21a schema. _Fix:_ Add to supabase/schema.sql: `create index if not exists provider_calls_action_idx on public.provider_calls (action_id);` (also serves actionSpend in src/lib/credit/action.ts and actionAlreadyCharged …
- **D25** The n8n-held secret can trigger every internal route, including real sends and backfills — `src/lib/internal-auth.ts:24` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/internal-auth.ts take an optional allowlist: `authoriseInternal(request, { n8n: false })` defaulting to refusing N8N_SHARED_SECRET, and pass `{ n8n: true }` only from the routes n8n …
- **D26** The admin 'picks are now daily' notice takes the member's daily slot, displacing that day's Today's 5 if pressed before 07:00 UTC, and carries no unsubscribe link — `src/lib/listing/daily-notice-run.ts:65` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/listing/daily-notice-run.ts refuse a non-dry press before 08:30 UTC (or after the 08:10 digest only), and pass newSendToken() to markSending plus listUnsubscribeHeaders on the send as the …
- **D27** 'Signed up' can be stamped with the first sign-in date (or a UTC date) by the sign-up row, and the funnel never corrects it — `src/lib/auth/sign-in-hooks.ts:66` · admin only · branch 21e messages-crons. _Fix:_ In src/lib/auth/sign-in-hooks.ts:66 pass trialStartedAt: profile.created_at ?? undefined (as src/app/estimate/layout.tsx:64 already does), and in src/app/(auth)/actions.ts store the id ensureEnquiry …
- **D28** Schedule collisions the pre-computed list missed: project-checks and demand-sourcing share every minute of hour 05, and funnel-queue lands on the busiest minutes — `vercel.json:105` · admin only · branch 21e messages-crons. _Fix:_ In vercel.json move project-checks' hour-05 schedule off the demand minutes (e.g. '2,12,22,32,42,52 5 * * *') and funnel-queue to '7,37 * * * *'; optionally listing-recheck to '3 6 * * *'. Update the …


### E. Weekly active, inactivity and the Monday figures
28 findings: 2 High, 5 Medium, 21 Low.
#### E1 · High · Every new sign-up is weekly active in week 1 by redirect alone: landing on /welcome logs the qualifying profile_started
- **Where:** `src/lib/profile/server.ts:432` (also `src/app/welcome/page.tsx`, `src/components/AppShell.tsx`, `src/lib/activity/kinds.ts`) · **Journey:** sign-up · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** AppShell sends every member without the three mandatory answers to /welcome (requireProfileStart). The welcome page calls markQuizOpened on render, which logs profile_started (inApp = qualifying) before a single question is answered. So a member who signs up from an ad and closes the quiz screen still counts as active in their sign-up week; profile_resumed (also qualifying) is logged once a day on any later visit to the page.
- **How you'd hit it:** 200 people sign up from the first Facebook campaign in a week; 120 bounce off the quiz's first screen. /admin/weekly-active shows 200 active members that week (100% of the sign-up cohort), because each got a 'Started the profile quiz' event from the redirect. Week 2 then shows the real 80, and the drop looks like churn rather than a bounce.
- **Smallest fix:** In src/lib/activity/kinds.ts make profile_started (and profile_resumed) recordOnly, or move the profile_started log in src/lib/profile/server.ts from markQuizOpened to the first answerQuestion.
- **Verified:** Confirmed: welcome/page.tsx:62 calls markQuizOpened on render, which logs profile_started (kinds.ts:89, inApp = qualifying). Raised to High because weekly active is the number the ads are judged on and every sign-up is "active" in week 1 by redirect alone.
- **Second reader:** Partly, rated Low. The mechanism is right (welcome/page.tsx:66 → profile/server.ts:432 logs profile_started, an inApp kind). But it is deliberate and tested: profile/activity.test.ts:11-14 asserts profile_started and profile_resumed are qualifying. "Every new sign-up" is overstated: only sign-ups who confirm and sign in reach /welcome.

#### E2 · High · Engagement % divides ISO-calendar Active weeks by ROUNDUP(days/7): routinely over 100% and ÷0 on sign-up day
- **Where:** `supabase/schema.sql:5522` (also `src/lib/crm/monday-funnel/config.ts`, `src/lib/crm/monday-funnel/values.ts`, `src/lib/crm/monday-funnel/facts-server.ts`) · **Journey:** admin only · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** The site writes Active weeks as the number of distinct Monday–Sunday (date_trunc('week')) UK weeks that hold a member_active_days row (schema.sql 5522, facts-server.ts:164, values.ts:59). The board's own 'Weeks since sign-up' formula is ROUNDUP(DAYS(TODAY(), Signed up) / 7, 0), i.e. seven-day blocks from the sign-up date, and 'Engagement %' is Active weeks ÷ that (monday-board.txt). The two count different things: a member who signs up on a Saturday or Sunday touches two calendar weeks inside one seven-day block, so calendar weeks touched is always ≥ seven-day blocks, and the ratio is inflated for every member in their first weeks. On the sign-up day DAYS() is 0 so the divisor is 0. The site never writes the formulas (config.ts:92 NEVER_WRITTEN) so nothing in code corrects it. A second, smaller skew: Active days/weeks come only from the activity log (backfill floor + 24-month retention; member_active_days is filled from activity_events by id from the first nightly on, 5446–5508), so an account older than the backfill floor has fewer Active weeks than 'since sign-up' promises and Engagement % under-reads for old members.
- **How you'd hit it:** A member signs up on Sunday 27 Sep 2026 and views Today that day and again on Monday 28 Sep. On Tuesday 29 Sep the board shows Active weeks 2, Weeks since sign-up ROUNDUP(2/7)=1, Engagement 200%. Ten days after a Sunday sign-up with a Today view most days: Active weeks 3, Weeks since sign-up 2, Engagement 150%. On the sign-up day itself Engagement % is a divide-by-zero.
- **Smallest fix:** Either change the board formula to count calendar weeks (e.g. ROUNDUP((DAYS(TODAY(), Signed up) + WEEKDAY(Signed up)) / 7, 0) or equivalent Monday-start arithmetic), or have the site write a 'Weeks since sign-up' number computed with the same rule as lifecycle_member_stats (ISO Mon–Sun weeks from the sign-up week to this week, inclusive) in src/lib/crm/monday-funnel/values.ts and point the Engagement % formula at that column.
- **Verified:** Confirmed from the live board (formula_mm7m1jef, formula_mm7mjdrc) and schema.sql:5522 (count(distinct date_trunc('week', day))).

#### E3 · Medium · Weekly-active base counts unconfirmed sign-ups; /admin/signups drops them, and inactivity treats them as quiet members
- **Where:** `supabase/schema.sql:3059` · **Journey:** sign-up · **Fix branch:** 21a schema
- **What's wrong:** handle_new_user inserts a profiles row on auth.users insert (schema.sql 140–162), and sign-up uses supabase.auth.signUp with emailRedirectTo, so the account exists before the email is confirmed ((auth)/actions.ts:82-86). activity_weekly_facts 'members' is every profiles row (3043–3060) and computeWeeklyActive only removes admin, @stayful.co.uk and the manual switch-off list (metrics.ts:159-170), so an ad click that signs up and never confirms sits in the weekly-active base from that week on and is never active. /admin/signups leaves the same account out (report.ts:181-184, from auth.users.last_sign_in_at at schema.sql 5137), so the two pages disagree on who a member is, exactly when ads start. The inactivity step also counts them (server.ts:102 reads every profile; rules.ts:89 anchors quiet days on created_at): 14 days after an unconfirmed sign-up the account is marked Re-engage and the …
- **How you'd hit it:** Facebook sends 100 clicks; 40 fill in the sign-up form, 25 confirm. /admin/signups shows 25 sign-ups; /admin/weekly-active's base for that week is 40, so 10 active members read as 25% instead of 40%, and the 40% target is missed on paper. Two weeks later 15 unconfirmed accounts appear in Monday's Re-engage group.
- **Smallest fix:** In supabase/schema.sql activity_weekly_facts, make the function security definer (as signup_source_facts is) and add 'signed_in', au.last_sign_in_at is not null to each 'members' entry (left join auth.users au on au.id = pr.id); in src/lib/activity/metrics.ts exclusionFor/computeWeeklyActive treat signed_in false as excluded with reason 'never_signed_in' (shown in the excluded list, not the base); in src/lib/inactivity/server.ts skip never-signed-in accounts (or read the same flag) so they are never marked.
- **Second reader:** Confirmed. handle_new_user creates a profile on every auth.users insert (schema.sql:146-162) while sign-up still sends people to /signup/check-email; the weekly-active base is every profiles row (schema.sql:3043-3060) less admin, staff and manual exclusions; /admin/signups drops !signed_in (report.ts:181-184); the inactivity nightly reads every profile with no sign-in filter (inactivity/server.ts:100-105) counting from created_at (rules.ts:89), so unconfirmed sign-ups reach Re-engage at 14 days. The n8n trigger does not exist yet, so today the harm is the Monday Re-engage group and the weekly-active base.

#### E5 · Medium · No Leads (funnel owner) action is recorded: a management company working leads all week is not weekly active
- **Where:** `src/app/leads/lead-actions.ts:121` · **Journey:** later · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** None of the Leads server actions (create/brand/rules/toggle a funnel, archive/restore leads, move a lead's stage, mint/revoke an API key, CRM integrations, push to Monday) calls logActivity, and kinds.ts has no lead_* kind. Their visits are recorded with action_count 0, they never get a member_active_day, and if they are not on a plan (credit-funded funnels) the nightly marks them quiet after 14 days and pauses picks at 25 while they use the product daily.
- **How you'd hit it:** A letting agent runs a funnel and moves 15 leads through stages every day for a month on pay-as-you-go credit. /admin/weekly-active never shows them active; on day 14 the nightly sets reengage_since and Monday moves them to Re-engage; the drill-down shows visits with 0 actions.
- **Smallest fix:** Add a `lead_action` inApp kind (and `api_key_created`) to src/lib/activity/kinds.ts and call logActivity in src/app/leads/lead-actions.ts (setLeadStageAction, archive/restore), src/app/leads/actions.ts (create/toggle funnel) and src/app/leads/api/actions.ts (mintKeyAction), ids and stage names only.
- **Second reader:** Confirmed. No file under src/app/leads calls logActivity or recordActivity (e.g. setLeadStageAction, lead-actions.ts:140-143); kinds.ts has no lead or funnel kind. Because of rules.ts:68, a pay-as-you-go funnel owner who only works /leads is marked quiet at 14 days and paused at 25.

#### E6 · Medium · Explorer searches and area pages, the Browse grid, My deals, Picks and Reports pages have no view kind: only Today, a deal and a saved report count as 'looking'
- **Where:** `src/lib/activity/heartbeat.ts:35` · **Journey:** later · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** viewFor() recognises /today, /deals/<uuid> and /reports/<uuid> only. The Explorer's market search and area pages (/markets, /markets/[area]), the deals grid (/deals), My deals, Picks and the reports list are visits with no event. In the Explorer only star/unstar, listing actions and the enquiry are logged (markets/actions.ts). A member who researches areas or reviews their pipeline all week without pressing one of those buttons is not weekly active and can be marked quiet.
- **How you'd hit it:** A member opens the Explorer every evening, compares six areas and reads their area pages, but stars nothing. Their week shows 5 visits, 0 actions, not active. On the 14th such day the nightly sets reengage_since.
- **Smallest fix:** In src/lib/activity/heartbeat.ts extend viewFor() to return { type: 'explorer' } for /markets and /markets/<area> and { type: 'my_deals' } for /my-deals, add matching inApp kinds (explorer_view, my_deals_view) in kinds.ts, and handle them in src/lib/activity/presence.ts with a per-day dedupe key like today_view.
- **Second reader:** Confirmed. viewFor returns a view only for /today, /deals/<uuid> and /reports/<uuid> (heartbeat.ts:38-43) and parsePing accepts only those (heartbeat.ts:129-130). The Explorer's pasted-link search does count (listing_check, api/listing/resolve/route.ts:43); area search, area pages, /deals, /my-deals, /picks and /reports log nothing. Fix: no — the View type (heartbeat.ts:22) and parsePing (:127-131) must accept the new types too, or /api/presence silently drops them.

#### E7 · Medium · A member who uses the browser extension or API, or only browses /deals, /markets, /my-deals or /picks, is 'quiet': paused at 25 days despite using the product
- **Where:** `src/lib/inactivity/rules.ts:49` · **Journey:** later · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** isEngagement accepts only QUALIFYING_KINDS plus the six email/text kinds. extension_check and api_report are recordOnly (kinds.ts:158-159), so a member who checks listings in the extension every day never clears reengage_since or picks_paused_inactive_at and is marked at 14/25 days. Page views count only for Today, a deal page and a saved report (presence.ts:53-58; heartbeat.ts viewFor 35-44): opening the /deals grid, /markets, /my-deals or /picks logs nothing, so a member who bookmarks one of those and reads it daily without a Keep/Pass is equally quiet. The README's 'any real action brings them straight back' (§16.6) and the away letter's 'Sign in to start them again' are therefore not true for these members: they are signed in and acting.
- **How you'd hit it:** A property sourcer installs the extension and checks 5 listings a day on Rightmove for a month without opening stayful.co.uk (the extension answers inline). On day 14 they move to Re-engage on Monday; on day 25 their daily picks stop and they get 'We've paused your daily deals while you're away'. Checking another listing the next morning does not restart them; only a site action does.
- **Smallest fix:** In src/lib/inactivity/rules.ts add 'extension_check' and 'api_report' to the engaged kinds (a separate ENGAGED_EXTRA list alongside EMAIL_ENGAGEMENT_KINDS, passed to lifecycle_active_days_sync as `engaged`), keeping them out of QUALIFYING_KINDS so weekly active is unchanged; optionally log a recordOnly 'page_view' from the heartbeat for the grid pages and include it too.
- **Second reader:** Confirmed. extension_check and api_report are record-only (kinds.ts:158-159); isEngagement accepts only QUALIFYING_KINDS plus EMAIL_ENGAGEMENT_KINDS (rules.ts:38, 49-53); cameBack fires only when isEngagement is true (activity/log.ts:55); heartbeat.ts:35-44 records a view only for /today, /deals/<uuid> and /reports/<uuid>. Narrower than stated: only members not on a live, trialling or paused plan can be marked (rules.ts:65-68).

#### E9 · Medium · /admin/activity's 'Last active' is profiles.last_seen_at (any page load); Monday's 'Last active' is the last qualifying action — same label, different members
- **Where:** `src/lib/admin/activity.ts:97` · **Journey:** admin only · **Fix branch:** 21f activity-inactivity-monday
- **What's wrong:** Three 'active' clocks run side by side. (1) profiles.last_seen_at is stamped by AppShell on any members-only page render, at most hourly (AppShell.tsx:48), and by the estimate layout and /api/analyse; it drives /admin/activity's column labelled 'Last active' (activity.ts:97 latest of last_seen_at, deal opens, reports, credit debits; page.tsx:38), /admin home's 'Last seen', /admin/deals' 'members seen in the window' count (deals/page.tsx:158) and demand sourcing's 'seen in the last demand_active_days days' (sourcing-demand/server.ts:61). (2) member_active_days (qualifying kinds only, UK day) drives Monday's Last active / Active days / Active weeks and the inactivity clock. (3) activity_events directly drives /admin/weekly-active. A member who opens the app but takes no qualifying action (reads the /deals grid, /markets, /account) is 'active today' on /admin/activity and in demand …
- **How you'd hit it:** Zac looks at /admin/activity for a member and sees Last active: today. He opens the Monday board: the same member sits in Re-engage (14+ days inactive) with Last active 3 weeks ago. Both are 'right' by their own rule; nothing on either page says which rule it uses.
- **Smallest fix:** In src/app/admin/activity/page.tsx rename the column to 'Last seen' (and in lib/admin/activity.ts the field) or compute it from lifecycle_member_stats last_day so it matches Monday; add a one-line note on /admin/activity and /admin (home) that 'Last seen' is any page load while 'Weekly active' and Monday's 'Last active' are actions.
- **Second reader:** Partly, rated Medium. activity.ts:97 lastActiveAt = latestOf(last_seen_at, opens, reports, spent) labelled "Last active"; Monday's is the last qualifying day. Worse than stated: spent is every credit_transactions debit (page.tsx:69), which includes the automatic daily-picks and daily-deals charges, so a member who never opens the app shows "Last active: today" every day their picks run. Fix: no — drop spent from lastActiveAt (activity.ts:97) or keep only member-caused debits, then relabel the column "Last seen".

**Low (21, listed as reported, not independently verified):**

- **E4** Daily-email 'Open Today' for a non-active saved profile counts as an in-app action and loses the email click — `src/app/profiles/switch/route.ts:26` · the first email · branch 21f activity-inactivity-monday. _Fix:_ In src/app/profiles/switch/route.ts, when the request carries ?via=email|sms, append it to the redirect target (`next`) so the heartbeat records the click, and pass source: 'email_link' to …
- **E8** The 'Exclude from metrics' switch is ignored by the Monday funnel and the inactivity nightly — `src/lib/crm/monday-funnel/facts-server.ts:89` · admin only · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/crm/monday-funnel/facts-server.ts loadFacts, read activity_excluded_accounts once and add reason 'excluded' to `left` (no row, and never a create/move); in src/lib/inactivity/server.ts …
- **E10** Disposable-email and admin-made production test accounts are only kept out of ad numbers and Monday by hand — `src/lib/apis/monday.ts:104` · sign-up · branch 21f activity-inactivity-monday. _Fix:_ If they should not count: add isDisposableEmail to exclusionFor in src/lib/activity/metrics.ts (reason 'disposable') and to neverARow in src/lib/apis/monday.ts / loadFacts, so the switch is not …
- **E11** 'Save to My deals' after opening a deal is not recorded — `src/app/deals/actions.ts:71` · the first deal · branch 21f activity-inactivity-monday. _Fix:_ In src/app/deals/actions.ts savePipelineAction, after a successful save log `stage_move` with extras { to: 'kept', via: 'save', item: `l-${result.checkedListingId}` } (or a new pipeline_saved kind).
- **E12** email_click / sms_click from the heartbeat are written without a source, so the row can read 'web' when a visit is already open — `src/lib/activity/presence.ts:50` · the first email · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/activity/presence.ts pass `source: ping.via === 'email' ? 'email_link' : 'sms_link'` in the recordActivity call on line 50.
- **E13** One email click to /profile or /account/feedback is recorded twice (heartbeat email_click plus the page's own *_email_click) — `src/app/profile/page.tsx:67` · the first email · branch 21f activity-inactivity-monday. _Fix:_ Either drop the page-level logs (src/app/profile/page.tsx:67, src/app/account/feedback/page.tsx:56) and derive take-up from email_click plus the visit's first view, or give the page log the same …
- **E14** A pick-email reasons form that adds a deal type logs the qualifying profile_edited, so an email answer counts as weekly active — `src/app/p/[token]/actions.ts:20` · the first email · branch 21d privacy-access. _Fix:_ In src/app/p/[token]/actions.ts log the type change as email_feedback extras (e.g. added: 'rent') instead of profile_edited, or add a recordOnly profile_edited_email kind in src/lib/activity/kinds.ts …
- **E15** Self-serve pause / cancel / keep-plan can be logged twice when Stripe's webhook beats the profile write — `src/app/account/actions.ts:157` · the first payment · branch 21f activity-inactivity-monday. _Fix:_ In src/app/account/actions.ts pass a dedupeKey to logSubscriptionEvent's logActivity (e.g. `sub:${ctx.subscriptionId}:${input.kind}:${state.currentPeriodEnd}`) and use the same key in …
- **E16** Creating a second saved profile records two counted actions (created + switched) — `src/app/profiles/actions.ts:77` · later · branch 21f activity-inactivity-monday. _Fix:_ In src/app/profiles/actions.ts createProfileAction, call switchProfile with an option that skips its logActivity (or record the switch in the created event's extras and return before logging in …
- **E17** A STOP or START text reply is not in the activity log at all — `src/app/api/twilio/inbound/route.ts:57` · later · branch 21f activity-inactivity-monday. _Fix:_ Add recordOnly kinds sms_stop / sms_start to src/lib/activity/kinds.ts (sms_start in EMAIL_ENGAGEMENT_KINDS), make stopNumber/startNumber in src/lib/sms/store.ts return the affected user ids, and …
- **E18** Leaving a team, removing a member, connecting the extension and API PDF downloads are not recorded — `src/app/account/team/actions.ts:65` · later · branch 21f activity-inactivity-monday. _Fix:_ Add kinds (team_leave, team_remove, extension_connected, api_pdf recordOnly) in src/lib/activity/kinds.ts and log in src/app/account/team/actions.ts, src/app/extension/connect/actions.ts and …
- **E19** A pause or plan change made by the admin in the Stripe dashboard is logged as the member's own weekly-active action — `src/lib/activity/kinds.ts:196` · later · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/activity/kinds.ts planActivityKind, return null for 'paused' and 'plan_changed' when source === 'stripe' (the app's own actions already log them with source 'self_serve'), keeping only …
- **E20** Stripe webhook logs plan_pause / plan_cancel / plan_change / plan_start as the member's qualifying action whoever made the change — `src/lib/stripe/webhook.ts:234` · later · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/activity/kinds.ts planActivityKind, return null for 'paused', 'cancel_scheduled', 'cancel_reverted' and 'plan_changed' unless source === 'self_serve' (as already done for 'resumed'); pass …
- **E21** The 60-second identical-event guard drops a genuine second action of any kind logged with no extras and no deal — `supabase/schema.sql:2894` · later · branch 21a schema. _Fix:_ Give those calls an identifying extra (e.g. area: 'LS' for area_saved, the checked listing id for listing_check) or a dedupeKey, in the listed call sites; leave the SQL as is.
- **E22** A member who comes back in the seconds between the nightly's active-days sync and its marks write can be paused that same morning — `src/lib/inactivity/server.ts:172` · later · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/inactivity/server.ts, before writing setPaused/setReengage, re-check the ids against activity_events with id > synced.upTo (one select of user_id where id > v_to and kind in ENGAGED_KINDS) …
- **E23** lifecycle_active_days_sync can skip an activity_events row for good when its insert commits after the sync's read but its id is below the new watermark — `supabase/schema.sql:5468` · later · branch 21a schema. _Fix:_ In supabase/schema.sql lifecycle_active_days_sync, bound the page by time as well as id: take rows with id > v_from and occurred_at < now() - interval '2 minutes' (activity_log's v_at is the call …
- **E24** A paid-up subscriber who booked cancellation is 'cancelled' for inactivity at once: an annual Pro who cancels renewal early can lose daily picks for the rest of a paid year — `src/lib/inactivity/rules.ts:65` · later · branch 21f activity-inactivity-monday. _Fix:_ If not intended: in src/lib/inactivity/rules.ts inactivityEligible, treat a booked cancellation as still on-plan while accountStatus is 'paid' (return !onPlan only), so cancelling members are judged …
- **E25** Sign-ups by source silently stops applying the 'Exclude' switch when the weekly-active read fails — `src/lib/tracking/report-server.ts:62` · admin only · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/tracking/report-server.ts read activity_excluded_accounts directly (one select, as lib/admin/profile-server.ts does) instead of deriving `manual` from the weekly report.
- **E26** /admin/profiles and /admin/tailoring ignore a failed read of activity_excluded_accounts — `src/lib/admin/profile-server.ts:26` · admin only · branch 21f activity-inactivity-monday. _Fix:_ In src/lib/admin/profile-server.ts (and tailoring/admin-server.ts) treat excludedRes.error as 'failed' (or surface it), as quizRes.error is.
- **E27** Preview-deployment events count as qualifying days while tracking_since ignores them — `supabase/schema.sql:3084` · admin only · branch 21a schema. _Fix:_ Add `and not (e.extras ? 'env')` to the qdays/weekly/last selects in activity_weekly_facts and to lifecycle_active_days_sync in supabase/schema.sql (backfilled rows stay).
- **E28** The pack's Checkout return (/today?pack=1) is not treated as a Stripe return, so the browser copy of Purchase cannot fire there — `src/lib/tracking/config.ts:158` · the £10 pack · branch 21f activity-inactivity-monday. _Fix:_ Add /today?pack=1 to the Stripe-return rule in src/lib/tracking/config.ts.


### F. Product direction
33 findings: 1 High, 8 Medium, 24 Low.
#### F1 · Medium · Pricing's plan buttons link to /signup?plan=<code>, which nothing reads; signed-in members are bounced to Today
- **Where:** `src/components/credit/SubscribeButton.tsx:18` · **Journey:** sign-up · **Fix branch:** 21h product-nav-health
- **What's wrong:** For a signed-out visitor every plan's button is `/signup?plan=<code>`. No file reads a `plan` search param on the sign-up path: src/app/(auth)/signup/page.tsx destructures only `next`, actions.ts carries only `next`, /auth/callback and landing.ts ignore it, so the chosen plan is dropped and the new member lands on /welcome → /today with no plan and no prompt. /pricing and the home page render `<Pricing />` with the default `signedIn=false`, so an existing member (e.g. arriving from the pricing-notice email's /pricing link) also gets the /signup link, and the proxy's already-signed-in rule bounces them to /today instead of a plan.
- **How you'd hit it:** A visitor from an ad reads /pricing, presses "Start free" under Scale, signs up, confirms their email, answers the quiz and arrives on Today as a pay-as-you-go member with the starter-pack card; nothing mentions Scale. A paying member who clicks Pricing in the footer and presses "Choose Scale" is sent to /today.
- **Smallest fix:** In SubscribeButton.tsx:18 link to `/signup?next=${encodeURIComponent(`/upgrade?plan=${planCode}`)}` (or drop the param), and on src/app/(marketing)/pricing/page.tsx:54 pass `signedIn`/`currentPlanCode` from the session as /upgrade does.
- **Second reader:** Confirmed. Signed-out plan buttons link to ?plan=<code> (SubscribeButton.tsx:18); the sign-up page reads only next (signup/page.tsx:11-14); /pricing and / render Pricing with signedIn=false; proxy.ts:43 reads only redirect and next, so a signed-in member goes to /today. Fix: no — change SubscribeButton to /signup?next=/upgrade?plan=… which fixes both cases (proxy.ts:43 honours next); passing the session into /pricing would make a revalidate = 300 page dynamic.

#### F2 · Medium · Login page's "sign up" link drops the destination the member was sent to log in for
- **Where:** `src/app/(auth)/login/page.tsx:70` · **Journey:** sign-up · **Fix branch:** 21h product-nav-health
- **What's wrong:** The proxy sends a signed-out visitor to `/login?redirect=<path+query>` and the page keeps it for the password form, Google and magic-link forms, but the "No account? …" link is a bare `/signup`. The signup page does the reverse correctly (`/login?redirect=…`). So anyone who arrives at a members' page without an account and chooses to sign up loses the page.
- **How you'd hit it:** A member shares a deal page link (/deals/<id>) with an investor who has no account. The investor is bounced to /login?redirect=/deals/<id>, presses the sign-up link, confirms their email, and lands on /welcome → /today; the deal they were sent is gone. Same for a /markets/leeds link or a /my-deals link pasted in WhatsApp.
- **Smallest fix:** In src/app/(auth)/login/page.tsx:70 use `href={redirectTo ? `/signup?next=${encodeURIComponent(redirectTo)}` : '/signup'}` (mirror of signup/page.tsx:55).
- **Second reader:** Confirmed. The login page keeps redirectTo for its forms but the sign-up link is a bare /signup (login/page.tsx:70). One example is wrong (/markets is not protected, proxy.ts:5); a real case is a team invitee who taps "I already have one" (team/join/page.tsx:48) and then signs up, losing the invite.

#### F3 · High · Cash buyers get a mortgage-laden profit range on /picks, the quiz's sample matches and the Your-week 'missed' line, but a no-mortgage range on Today, My deals and the daily email
- **Where:** `src/app/picks/page.tsx:152` (also `src/lib/profile/server.ts`, `src/lib/notify/week-run.ts`, `src/lib/marketplace/card-view.ts`, `src/lib/marketplace/most-you-can-pay.ts`) · **Journey:** the profile quiz · **Fix branch:** 21h product-nav-health
- **What's wrong:** Batch 14's memberFinance() (src/lib/marketplace/most-you-can-pay.ts) is the one rule that a cash buyer borrows nothing (depositPct 100), and cardView applies it, so Today, My deals, the deal sheet, the daily email and the public pick-answer page agree. Three live paths pass goals.finance raw instead: the /picks page's PickCard, the profile quiz's sample matches (profile/server.ts sampleMatches) and the Your-week email's single-profile 'missed' section (week-run.ts:328, while its saved-profiles branch at :240 uses memberFinance). For a cash buyer those show the same deal with a mortgage taken off.
- **How you'd hit it:** A member answered "buying with cash" in the quiz. A £200k 2-bed with £30k area gross shows "£850–£1,150/mo · cash flow after the mortgage" on Today's card, but the same listing on /picks (and as a sample match in the quiz) reads about "£150–£450/mo", the 25% deposit mortgage deducted.
- **Smallest fix:** Replace the raw finance with memberFinance(goals) from src/lib/marketplace/most-you-can-pay.ts at src/app/picks/page.tsx:152, src/lib/profile/server.ts:411 and src/lib/notify/week-run.ts:328.
- **Second reader:** Confirmed, rated High. memberFinance returns depositPct 100 for a cash buyer (most-you-can-pay.ts:164-167) and cardView does the same (card-view.ts:122-123). Three live paths pass the raw finance: /picks (picks/page.tsx:152), the quiz's sample matches (profile/server.ts:411) and the single-profile Your-week email (week-run.ts:328, whereas :240 uses memberFinance). The cash answer only sets buyer.funding (questions.ts:815-824), so a cash buyer's stored deposit is not 100% and these surfaces subtract a mortgage.

#### F6 · Medium · No not-found.tsx, error.tsx or global-error.tsx anywhere: a signed-in member who hits a 404 or a render error gets Next's unbranded default page with no nav
- **Where:** `src/app/deals/[id]/page.tsx:108` · **Journey:** the first deal · **Fix branch:** 21h product-nav-health · merged: W2-98
- **What's wrong:** `find src/app -name 'not-found*' -o -name 'error*' -o -name 'global-error*'` returns nothing, and the root layout (src/app/layout.tsx:22-35) renders only children. Every notFound() in the members' area therefore shows Next's plain '404 | This page could not be found.' with no Stayful branding, no Today · My deals · Account strip and no link anywhere. notFound() is thrown for a withdrawn/expired deal, for an early-access deal opened by an account that has never paid (src/app/deals/[id]/page.tsx:106-108), for a saved report the member cannot read (src/app/reports/[id]/page.tsx:29), for a lead (src/app/leads/[id]/page.tsx:71-88) and for a non-admin on /admin (src/app/admin/page.tsx:68). An unhandled server error likewise falls to Next's default 'Application error' screen with nothing to tap.
- **How you'd hit it:** A new member follows a deal link from this morning's email; the deal was withdrawn overnight. They see a white page reading '404 This page could not be found.' with no logo and no way to Today. Same for a new member who opens a shared /deals/<id> link to an early-access deal before they have paid.
- **Smallest fix:** Add src/app/not-found.tsx (branded, with a link to /today and one to /) and src/app/error.tsx ('use client', with a retry button and a /today link). Keep the copy identical for the admin 404 so the admin area stays hidden.
- **Second reader:** Partly. No not-found, error or global-error file anywhere under src/app, so every notFound() shows Next's default page without AppShell: an early-access deal opened by a never-paid account (open.ts:261), an unreadable report, a lead, /admin. But the headline example is wrong: a withdrawn deal is not a 404 (loadDealById has no status filter, server.ts:174-181; the sheet renders "Off the market", deals/[id]/page.tsx:333, 409).

#### F8 · Medium · Deal page's out-of-credit box promises a return that neither Top up nor See plans keeps
- **Where:** `src/app/deals/[id]/page.tsx:289` · **Journey:** the first deal · **Fix branch:** 21h product-nav-health
- **What's wrong:** The copy says "Top up or upgrade and you'll come straight back here", and both buttons carry ?redirect=/deals/<id>. Nothing honours it: /account/billing's page reads only `topup` and `subscribed` (`searchParams: Promise<{ topup?: string; subscribed?: string }>`), the top-up checkout's success_url is the fixed `returnUrl('/account/billing', { topup: '1' })`, and the subscribe checkout's success_url is `returnUrl('/account/billing', { subscribed: '1', plan: planCode })`; /upgrade uses the param only for its "← Back" link and the login bounce.
- **How you'd hit it:** A new member opens their first deal with £0.30 left, reads "Top up or upgrade and you'll come straight back here", presses Top up, pays £10 on Stripe, and lands on /account/billing with a "top-up received" banner. The deal they were about to Quick-look is not there; they have to find it again via Today or My deals.
- **Smallest fix:** Either read `redirect` on src/app/account/billing/page.tsx (safeInternalPath, dealReturnPath) and pass it to POST /api/billing/topup as `returnTo` so route.ts:100 can use it as success_url (and likewise src/app/api/billing/subscribe/route.ts:121), or change the sentence at line 285 to say where they will land.
- **Second reader:** Confirmed. The deal page says "Top up or upgrade and you'll come straight back here." (deals/[id]/page.tsx:286) but /account/billing reads only topup and subscribed (billing/page.tsx:22); both checkouts return to fixed URLs (topup/route.ts:100, subscribe/route.ts:121); a saved-card top-up toasts in place (TopupButtons.tsx:34-35).

#### F10 · Medium · /upgrade is a members-only page (protected, 'for signed-in members') but renders under the marketing layout: marketing nav with 'Sign in' and 'Start free trial', no members' nav
- **Where:** `src/app/(marketing)/upgrade/page.tsx:26` · **Journey:** the first payment · **Fix branch:** 21h product-nav-health
- **What's wrong:** The plan chooser sits in the (marketing) route group, so its chrome is src/app/(marketing)/layout.tsx: the marketing Nav and Footer. proxy.ts lists /upgrade in PROTECTED_PREFIXES and the page itself redirects anonymous visitors to /login, so its only audience is signed-in members, yet they get a header whose calls to action are 'Sign in' and 'Start free trial' and no Today · My deals · Account strip, no usage chip, no credit banner and no Feedback button. Every low-credit path lands here: CreditBanner 'Upgrade plan' (src/components/credit/CreditBanner.tsx:68), the deal page's 'Or upgrade' link (src/app/deals/[id]/page.tsx:276), Account's ManagePlan checkoutHref '/upgrade' (src/app/account/page.tsx:177), the extension and markets gates.
- **How you'd hit it:** A member on £0 taps 'Upgrade plan' in the red banner. The page they land on has the public site's header: 'Start free trial' as the primary button. Tapping it sends them to /signup, which proxy.ts bounces to /today, so they never reach the plan they were choosing. There is no Today/My deals/Account link on the page; the only way back is the small '← Back' at the foot (rendered only when the credit summary loaded).
- **Smallest fix:** Move src/app/(marketing)/upgrade/page.tsx to src/app/upgrade/page.tsx and add src/app/upgrade/layout.tsx that returns `<AppShell active="account" redirectTo="/upgrade">{children}</AppShell>` (wrap the Pricing section in a `.sf-page-v3` div so its marketing styles still apply).
- **Second reader:** Confirmed. /upgrade is in the (marketing) group whose layout is Nav + main + Footer ((marketing)/layout.tsx:12-14), yet proxy.ts:5 protects it and the page sends anonymous visitors to /login (upgrade/page.tsx:43-45). Fix: no — wrapping only Pricing is not enough: .upgrade, .upgrade-title, .wrap-narrow and .upgrade-foot are scoped under .sf-page-v3 (globals.css:1499, 3647-3733). Wrap the whole page in a sf-page-v3 div inside AppShell; this also puts /upgrade behind the quiz gate.

#### F11 · Medium · /markets shows two navs and two footers to a signed-in member: the marketing header (Sign in, Start free trial) above the members' strip
- **Where:** `src/app/markets/layout.tsx:57` · **Journey:** later · **Fix branch:** 21h product-nav-health
- **What's wrong:** For any signed-in member the Market Explorer layout renders the marketing `<Nav />` (Home, Market Explorer, Methodology, Why us, Features, Calculator, Pricing, Case studies, Sign in, Start free trial) and then the AppShell, which draws the members' strip (Today · My deals · Account …) directly under it, and closes with both the marketing `<Footer />` and AppShell's MembersFooter. Only the signed-out branch (state === 'anon') should carry marketing chrome; the signed-in branch wraps AppShell in it too.
- **How you'd hit it:** A member opens Account › More › Market Explorer. The page has a full marketing header with 'Sign in' and 'Start free trial' buttons, then a second dark strip with Today · My deals · Account, then the explorer, then the marketing footer and the members' feedback footer. Tapping 'Sign in' bounces them to /today (proxy.ts) which looks like a glitch.
- **Smallest fix:** In src/app/markets/layout.tsx, on the signed-in branch return `<div className={fontVars}><AppShell active="markets" redirectTo="/markets"><div className="mx">{children}</div></AppShell></div>` and drop the two `.sf-page-v3` Nav/Footer wrappers (keep them only in the `state === 'anon'` branch).
- **Second reader:** Confirmed. The signed-in branch renders <Nav /> then <AppShell active="markets"> then <Footer /> (markets/layout.tsx:59-63); Nav always shows Sign in and Start free trial (Nav.tsx:49-53), which proxy.ts:39-44 bounces to /today; AppShell adds its own MembersFooter, so two navs and two footers.

#### F14 · Medium · Market Explorer's "Short-let net / yr" is labelled "after ... bills" but the calculator takes no bills off; the deal model does
- **Where:** `src/lib/market/tab-model.ts:280` · **Journey:** later · **Fix branch:** 21h product-nav-health
- **What's wrong:** Three cost models exist and are documented as deliberate (screen.ts 0.44 + fixed costs; analysis.ts 0.52 net, no fixed costs; deal.ts 0.52 net + £250 pcm bills). The Explorer's long-let-vs-short-let card uses analysis.ts's calculateFinancials (gross × 0.52) yet captions the figure "after management, cleaning, bills". The same revenue on a deal sheet / PDF ("Net operating / yr", deal.ts) is £3,000 lower because bills are subtracted there. Two live paths give two different "net" figures and the Explorer's label claims bills it never deducts.
- **How you'd hit it:** A member opens Market Explorer for an area with £30,000 gross: the card says "Short-let net / yr £15,600 · after management, cleaning, bills". A deal in that area with the same gross shows "Net operating / yr £12,600" on its PDF. £3,000 apart, and the first is mislabelled.
- **Smallest fix:** In src/lib/market/tab-model.ts:280 change the sub to "after platform, management and cleaning; before bills and mortgage" (or, if the Explorer should match the deal model, subtract DEFAULT_COSTS.billsPcm × 12 in src/lib/market/verdict.ts before it is shown).

#### F31 · Medium · Signing up inside the Facebook in-app browser: the confirmation link opens in another browser and bounces to /login for the password; the Google button is refused in in-app browsers
- **Where:** `src/app/auth/callback/route.ts:27` · **Journey:** sign-up · **Fix branch:** 21h product-nav-health
- **What's wrong:** When the confirmation link is opened in a different browser from the sign-up (the Facebook in-app browser, then the phone's mail app opening Safari), the PKCE verifier cookie is missing and the member is sent to /login?error=confirmed_elsewhere, "Your email is confirmed — sign in to continue" (callback/route.ts:27-30). If they do not sign in, welcome_checked_at stays null: no picks, no digest, no CompleteRegistration (signup-server.ts:62). /auth/confirm already accepts a token-hash link without a verifier (confirm/route.ts:9-17) but the sign-up email uses the callback. The Google button has no in-app-browser handling (google-button.tsx:11-35), and Google refuses OAuth inside in-app browsers.
- **How you'd hit it:** Ad tap → Facebook's browser → sign up → "check your email" → Mail app → Safari → "Your email is confirmed — sign in to continue" → the password they typed in another app ten minutes ago. Some stop here, and nothing is ever recorded for them.
- **Smallest fix:** Send sign-up confirmations through the token-hash /auth/confirm link (no verifier needed), and detect in-app browsers to replace the Google button with "Open in your browser". Test the whole path from the Facebook app on a phone before the first ad goes live.

**Low (24, listed as reported, not independently verified):**

- **F4** There is no mobile nav: the one header strip wraps to two or three rows on a phone because the Profile pill, the usage chip (up to '£20.00 · about 4 days of daily deals') and the Feedback button share the row with the three items — `src/components/AppSwitcher.tsx:34` · Today · branch 21h product-nav-health. _Fix:_ In src/components/credit/UsageChip.tsx wrap the ' · about N days of daily deals' suffix in `<span className="hidden sm:inline">` (the title attribute keeps the detail), and in AppSwitcher give the …
- **F5** First-week checklist's "Keep 3 deals" counts card Keeps only; My deals' "kept" counts pipeline rows too — `src/lib/today/checklist-server.ts:178` · Today · branch 21h product-nav-health. _Fix:_ In evidenceFor (src/lib/today/checklist-server.ts) count keeps as the member's own tracked items at KEPT_STATUS (loadTrackedDeals(userId, { scope: 'own' }) from src/lib/listing/tracked-server.ts) …
- **F7** A deal sheet lights 'Today' whatever the member came from, and its only back link is '← All deals' → /deals, a page that is not in the nav — `src/app/deals/[id]/page.tsx:259` · the first deal · branch 21h product-nav-health. _Fix:_ In src/app/deals/[id]/page.tsx read `back` from searchParams through dealReturnPath() and render `<Link href={back ?? '/deals'}>← {back ? returnLabel(back) : 'All deals'}</Link>`; have the My deals …
- **F9** Pick run prices a pool deal's automatic open from a fresh re-screen, every other path from the stored annual_profit; the two can land in different ladder bands — `src/lib/listing/picks-run.ts:1028` · the first email · branch 21e messages-crons. _Fix:_ In priceOf (src/lib/listing/picks-run.ts:1024-1029) price a pool deal from the marketplace row's stored annual_profit (the row the urlToDealId map came from) rather than cand.screening?.surplus.
- **F12** /extension/connect (Account › More › Browser extension) has no shell at all: no nav, no footer, no feedback, no way back — `src/app/extension/connect/page.tsx:29` · later · branch 21h product-nav-health. _Fix:_ Add src/app/extension/connect/layout.tsx returning `<AppShell active="account" redirectTo="/extension/connect">{children}</AppShell>` (the layout must sit at connect/, not extension/, because …
- **F13** Marketing pages (/, /pricing, /features, /methodology, /income-calculator, /demo, /extension, /privacy, /terms) show 'Sign in' and 'Start free trial' to a signed-in member; the Nav has no idea who is viewing — `src/components/marketing-v3/Nav.tsx:45` · later · branch 21h product-nav-health. _Fix:_ In src/app/(marketing)/layout.tsx read the session (createSupabaseServerClient().auth.getUser()) and pass `signedIn` to <Nav />; in Nav.tsx render a single 'Open Today' (/today) button in place of …
- **F15** /api/track still imports and calls syncTimeOnSiteToMonday, a documented no-op stub — `src/app/api/track/route.ts:31` · sign-up · branch 21d privacy-access. _Fix:_ Remove the import and call at src/app/api/track/route.ts:31-32 and delete syncTimeOnSiteToMonday from src/lib/apis/monday.ts:214-220.
- **F16** The quiz gate blocks the only Sign out: /account is behind requireProfileStart and /welcome has no sign-out, so a member who has not answered the three mandatory questions cannot sign out — `src/components/AppShell.tsx:70` · the profile quiz · branch 21h product-nav-health. _Fix:_ Add a small `<form action={signOutAction}><button>Sign out</button></form>` beside the MembersFooter on src/app/welcome/page.tsx (signOutAction from src/app/(auth)/actions.ts).
- **F17** Quiz 'not sure' finance answers hard-code copies of DEFAULT_FINANCE (25% / 5.5% / £500) — `src/lib/profile/questions.ts:937` · the profile quiz · branch 21h product-nav-health. _Fix:_ Import DEFAULT_FINANCE from src/lib/listing/deal.ts in src/lib/profile/questions.ts (lines 937, 943) and src/app/welcome/Quiz.tsx:333 and spread depositPct / mortgageRatePct / targetMarginPcm from it.
- **F18** Signed-out click on an area link lands on the Explorer's product page, whose Sign in goes to /markets, not the area — `src/app/markets/_components/product/MarketExplorerProductPage.tsx:14` · the first email · branch 21h product-nav-health. _Fix:_ Give MarketExplorerProductPage a `returnTo` prop and render it from src/app/markets/[area]/page.tsx:54 with `/markets/${meta.slug}` in the login/signup hrefs (or add '/markets/' to PROTECTED_PREFIXES …
- **F19** /profile and /profiles are outside the proxy, so their own login bounce drops the email marker and the question id — `src/app/profile/page.tsx:45` · the first email · branch 21f activity-inactivity-monday. _Fix:_ Add '/profile' and '/profiles' to PROTECTED_PREFIXES in src/proxy.ts:5 (the proxy keeps `pathname + request.nextUrl.search`), leaving the in-page redirects as the no-Supabase fallback.
- **F20** /team/join for a signed-in person who cannot join is a dead-end card: no nav and no link out — `src/app/team/join/page.tsx:54` · later · branch 21h product-nav-health. _Fix:_ In src/app/team/join/page.tsx, when `user` is set and `blocker` is non-null, add below the copy a `<Link href="/today">Go to Today</Link>` and, for wrong_email, a SignOutForm.
- **F21** /report is an orphan legacy lead-magnet page, public and indexable, still wired to the landlord Monday board — `src/app/report/page.tsx:12` · later · branch 21d privacy-access. _Fix:_ Delete src/app/report and src/app/api/get-report (and '/report' from src/lib/tracking/surfaces.ts:38, '/report/' from src/app/robots.ts:28), or if old links matter, replace page.tsx with …
- **F22** /str-report and /str-report/presentation are an orphan second analyser with their own maths — `src/app/str-report/page.tsx:27` · later · branch 21h product-nav-health. _Fix:_ Delete src/app/str-report (and '/str-report' from src/lib/tracking/surfaces.ts:40, the README:372 mention), or make src/app/str-report/page.tsx `redirect('/estimate')`.
- **F23** /dashboard is protected and disallowed but has no route — `src/proxy.ts:5` · later · branch 21h product-nav-health. _Fix:_ Remove '/dashboard' from src/proxy.ts:5 and src/app/robots.ts:24, or add a `src/app/dashboard/page.tsx` that does `redirect('/today')`.
- **F24** Dead sourcingEmail builder still tells members to edit goals in the Explorer — `src/lib/listing/sourcing.ts:580` · later · branch 21h product-nav-health. _Fix:_ Delete `sourcingEmail` (src/lib/listing/sourcing.ts:565-597) and any test that exercises it.
- **F25** /api/listing/quick-estimate has no caller — `src/app/api/listing/quick-estimate/route.ts:22` · later · branch 21h product-nav-health. _Fix:_ Delete src/app/api/listing/quick-estimate/route.ts (and its test if any), or wire it to the surface it was written for.
- **F26** SMS priority keeps its own 'active stage' set instead of deriving it from PIPELINE_STATUSES (Secured left out) — `src/lib/sms/choose.ts:53` · later · branch 21h product-nav-health. _Fix:_ In src/lib/sms/choose.ts derive ACTIVE_STAGES from PIPELINE_STATUSES (every key after 'watching' and before 'passed'), or document that Secured is excluded on purpose.
- **F27** For the admin, 'Admin' and 'Dashboard' sit inside the nav strip styled exactly like nav items, so the admin's nav reads Admin · Today · My deals · Account · Dashboard — `src/components/AppSwitcher.tsx:49` · admin only · branch 21h product-nav-health. _Fix:_ In src/components/AppSwitcher.tsx render the Dashboard link with the chip style used by UsageChip (rounded pill, 12px) after the ProfilePill, and drop the bare 'Admin' span (the chip already says …
- **F28** /demo-report and /presentation are public 'temporary preview' routes that render the members' analyser outside the shell, and the code says to remove them — `src/app/demo-report/page.tsx:5` · admin only · branch 21h product-nav-health. _Fix:_ Delete src/app/demo-report/ (its comment says so) and give src/app/presentation/page.tsx `robots: noindex` plus a 'Back to the report' link; or move both under a members' layout.
- **F29** Dead second reader of the kept list: keptDealIds has no importers and the /deals ?view=kept filter is unreachable — `src/lib/marketplace/reactions-server.ts:116` · admin only · branch 21h product-nav-health. _Fix:_ Delete keptDealIds from src/lib/marketplace/reactions-server.ts and the 'kept' member of DealView / the 'kept' branch of reactionFilter (src/lib/marketplace/grid.ts:25,173; …
- **F30** Dead free/paid helpers in access.ts: isPro, isLapsedSubscriber, hasLiveSubscription have no importers, and isPro is a third 'paid' rule — `src/lib/access.ts:48` · admin only · branch 21h product-nav-health. _Fix:_ Delete isPro, isLapsedSubscriber and hasLiveSubscription from src/lib/access.ts (hasSubscriptionHistory stays: accountStatus and hasEverPaid use it).
- **F32** Copy left behind by the pack: the quiz's done screen says "From tomorrow" though Today already has a list; buying from the quiz returns to /today and drops its remaining questions; the sign-up page title still says "Start your free trial" — `src/app/welcome/Quiz.tsx:181` · the profile quiz · branch 21h product-nav-health. _Fix:_ Reword Quiz.tsx:181, return the pack purchase to the quiz when it started there, and make the sign-up title follow publicOffer.
- **F33** Possible first-render race: the first /today hit may store a day's list chosen before any quiz answers (unverified) — `src/app/today/page.tsx:59` · Today · branch 21h product-nav-health. _Fix:_ Write a test that renders /today for a brand-new account and asserts no profile_today_lists row is stored before the mandatory answers; if it is, clear the list when the mandatory set completes.


### G. Code health
27 findings: 1 Critical, 1 High, 7 Medium, 18 Low.
#### G1 · Critical · /api/get-report hands any caller a lead's name and income-analysis PDF for just an email, and splices the email raw into the Monday GraphQL query
- **Where:** `src/app/api/get-report/route.ts:23` (also `src/app/report/page.tsx`, `src/proxy.ts`, `src/lib/apis/monday.ts`, `.env.example`) · **Journey:** later · **Fix branch:** 21d privacy-access · merged: W1-76
- **What's wrong:** The route is unauthenticated (proxy.ts protects only page prefixes; /report and /api/get-report are public). It takes {email} from the body, interpolates it straight into a GraphQL document sent with the site's MONDAY_API_KEY (`compare_value: ["${email.toLowerCase().trim()}"]`, no escaping, no variables), and returns leadName, fileUrl and fileName for the first item on the Management Leads board (5891626711). Anyone who knows or guesses a lead's email gets their name and their analyser PDF (address, income figures). Because the email is unescaped, a quote in it rewrites the query: `x"], operator: not_any_of` turns the rule into 'every row whose email is not x', which returns rows one at a time and lets the board be walked without knowing any email. The 404 wording also differs between 'no lead' and 'no report yet', so email existence on the board is confirmed either way. Side notes: `process.env.MONDAY_API_KEY!` is read at module scope with no MONDAY_API_TOKEN fallback (unlike src/lib/apis/monday.ts:44 and the documented fallback in .env.example:274), and .env.example:275 names /api/track as the other MONDAY_API_KEY reader although its Monday sync is now a no-op (src/lib/apis/monday.ts:218-220).
- **How you'd hit it:** A stranger POSTs {"email":"jane@example.com"} to https://intelligence.stayful.co.uk/api/get-report and receives {leadName:"Jane Smith", fileUrl:"https://…monday…/Stayful-Analyser.pdf"}; with email `x"], operator: not_any_of` they receive the first lead on the board instead, and by adding each email they learn to the not_any_of list they walk every lead.
- **Smallest fix:** In src/app/api/get-report/route.ts pass the email as a GraphQL variable ($email: [String]) instead of string interpolation, add the same per-IP rate limit /api/analyse uses, and either require a token the lead was emailed or return only a 'we have emailed your report' response and send the PDF link to that address; read the key through the shared token() helper in src/lib/apis/monday.ts. Update .env.example:274-275 to name the real readers.
- **Verified:** Confirmed: no auth, no rate limit, email interpolated into the GraphQL document, returns leadName + fileUrl; nothing links to /report (only src/lib/tracking/surfaces.ts lists it).

#### G2 · High · Production Next.js pinned at 16.2.1 carries 2 critical and 10 high advisories; the exact pin means npm audit fix cannot move it
- **Where:** `package.json:28` (also `next.config.ts`, `src/app/api/deals/photo/route.ts`, `src/app/welcome/_components/QuizPhoto.tsx`, `.github/workflows/ci.yml`) · **Journey:** sign-up · **Fix branch:** 21i next-16.3.7
- **What's wrong:** `next` is pinned to exactly `16.2.1` (line 28) and `eslint-config-next` to `16.2.1` (line 45). npm audit reports next as the one direct vulnerable dependency: critical GHSA-p293-qw3h-jr36 (unauthenticated RCE on Windows-hosted servers) and GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE in the Image Optimization API when AVIF files are used), plus high advisories for Middleware/Proxy bypass (GHSA-492v-c6pp-mqqv dynamic route parameter injection, GHSA-267c-6grr-h53f segment-prefetch, GHSA-26hh-7cqf-hhc6, GHSA-6gpp-xcg3-4w24), DoS in Server Components/Server Actions/Cache Components, SSRF in rewrites and Server Actions. The fix is next@16.3.7 (fixAvailable, not semver-major) but it is 'outside the stated dependency range' because of the exact pin, so only an explicit bump fixes it. Reachability on this app: the image optimizer is on (next.config.ts images.formats includes image/avif; next/image is used in 9 files including src/app/welcome/_components/QuizPhoto.tsx on the quiz); there are no remotePatterns, so /_next/image only fetches same-origin URLs, and the only same-origin route returning arbitrary image bytes is /api/deals/photo, which proxies portal photo bytes with the upstream content-type passed through under a signed URL. The middleware-bypass advisories are mitigated: /today, /account/billing and all 20 /admin pages check the session or isAdminEmail themselves. The DoS advisories need nothing but a visitor. CI (.github/workflows/ci.yml) runs lint/typecheck/test but never npm audit, so this stays invisible.
- **How you'd hit it:** Facebook ads go live; a visitor (or a bot hitting the ad landing page) exercises GHSA-m99w-x7hq-7vfj or GHSA-mg66-mrh9-m8jx against the Vercel function and every new member's /welcome quiz times out during the launch window. Less likely but real: a hostile AVIF at a portal listing's photo URL reaches sharp/libheif through /_next/image?url=/api/deals/photo?id=…&sig=… on the production function.
- **Smallest fix:** package.json: change `"next": "16.2.1"` and `"eslint-config-next": "16.2.1"` to `16.3.7` (npm install next@16.3.7 eslint-config-next@16.3.7), re-run npm run build and npm test; this also lifts the nested postcss 8.4.31 and sharp 0.34.5 that only the next upgrade can fix.
- **Verified:** Confirmed from npm audit (scratchpad/mech/audit.json): next 16.2.1 carries 2 critical and 10 high advisories; the fix is next@16.3.7 (minor), blocked only by the exact pin.

#### G3 · Medium · ensureWelcomeGrant (the £20-or-pack decision at first sign-in, Batch 20) and the referral redemption have no test
- **Where:** `src/lib/credit/welcome.ts:69` · **Journey:** sign-up · **Fix branch:** 21c stripe-ledger
- **What's wrong:** welcome.ts decides on the first sign-in whether a member gets the £20 welcome grant or is a pack account (created_at vs starter_pack_from), after the disposable-email and mobile-clash checks, stamps welcome_checked_at before granting, clears it again on a failed grant or an unreadable cutover setting, and redeems the sf_ref referral code. referral.ts (ensureReferralCode) is the other half. Neither is imported by any test; the pure pieces around them (abuse.ts, lifecycle/settings.ts isPackAccount) are. The ordering of the stamp and the clears is exactly the kind of logic a fake admin client would pin.
- **How you'd hit it:** A signup arrives after the cutover. If the `isPackAccount` branch (line 75) is reordered below the grant, or the postponed-decision clear (line 71) is dropped, every pack-era member is granted £20 welcome credit on top of being offered the £10 pack (money granted wrongly), or a pre-cutover member whose grant failed once is left permanently without credit. No test fails.
- **Smallest fix:** In src/lib/credit/welcome.ts split the decision into a pure `welcomeDecision({ createdAt, cutover, teamRole, disposable, mobileClash })` returning 'grant' | 'pack' | 'postpone' | withheld reason, test it in welcome.test.ts, and keep ensureWelcomeGrant as the thin writer.
- **Second reader:** Confirmed. No test imports credit/welcome.ts or credit/referral.ts; only the pure pieces around them are tested. The ordering that decides who gets money (stamp first, clear on unreadable cutover, pack branch before grant, clear after a failed grant: welcome.ts:49-59, 70-73, 75-78, 87) has no test.

#### G4 · Medium · Every function that actually moves credit is SQL, and nothing in CI or the 2365 tests ever runs it
- **Where:** `src/lib/credit/ledger.ts:6` · **Journey:** the £10 pack · **Fix branch:** 21a schema
- **What's wrong:** The money logic lives in Postgres: credit_reserve/credit_debit/credit_refund/credit_grant/credit_expire_plan_grants/credit_redeem_code (supabase/schema.sql 728-952), credit_debit_face (1815), claim_notification_slot (2425), activity_log (2861), activity_weekly_facts (3013), starter_pack_claim (5259), starter_pack_clawback (5306), member_refund_set (5376). src/lib/credit/ledger.ts says so itself ('Thin wrappers over the credit_* Postgres functions') and no-ops without a service role, so a unit test can never reach them. No test file imports ledger.ts, meter.ts, action.ts or after-debit.ts either (src/lib/credit: 34 modules, 11 with a test, none of them the ledger). The CI workflow runs lint, typecheck and node --test only. The pre-computed Postgres run proves schema.sql loads three times with 0 errors, but nothing asserts what the functions do.
- **How you'd hit it:** A later batch edits credit_grant's ON CONFLICT (source_ref) or credit_debit's allow-negative branch. Lint, typecheck and all 2365 tests stay green, CI merges it, and a member whose invoice.paid is redelivered by Stripe gets a second plan cycle (or a member's £10 pack debits below zero). The first signal is a balance on /account/billing.
- **Smallest fix:** Add a second job to .github/workflows/ci.yml with a postgres:16 service that runs `psql -f supabase/schema.sql` (already proven to load) followed by a new supabase/tests/money.sql of assertions: credit_grant twice with the same p_source_ref inserts one row; credit_debit with p_allow_negative=false raises P0402 when short; starter_pack_claim returns blocked on a second claim for the same email/number/card; starter_pack_clawback returns the proportional share.
- **Second reader:** Confirmed. ci.yml runs only lint, typecheck and node --test. No test imports credit/ledger.ts, meter.ts, action.ts or after-debit.ts, and ledger.ts:79-80 returns EMPTY_BALANCE without a service role. The only SQL check, supabase/credit-smoke.sql, is run by hand and is out of date: it asserts the old 1.5 top-up rate (lines 30-31) which schema.sql:3466-3470 changed to 1.3, and has nothing for starter_pack_claim/clawback, member_refund_set or credit_debit_face. Fix: no — commit a shim like the review's scratchpad/pg/shim.sql (or use the Supabase CLI's local database), then run credit-smoke.sql updated to 1.3 and extended with the starter-pack checks, rather than a new money.sql.

#### G5 · Medium · The Stripe webhook is tested only up to its fake deps: grants.ts, deps.ts, auto-topup.ts, customer.ts and the starter-pack settle/grant/clawback server have no test
- **Where:** `src/lib/stripe/webhook.test.ts:10` · **Journey:** the £10 pack · **Fix branch:** 21c stripe-ledger
- **What's wrong:** The 55 webhook tests inject `fakeDeps()` and assert which dep the handler called with what. The route (src/app/api/stripe/webhook/route.ts:57) runs the same handler with `liveWebhookDeps()`, and nothing tests that live side: src/lib/stripe/grants.ts (grantTopup, grantPlanCycle: 130 lines), deps.ts (129), auto-topup.ts (65), customer.ts (74), and src/lib/starter-pack/grant-server.ts (274 lines: claim, settleStarterPack capture-or-cancel, grantStarterPack once, clawbackStarterPack) are all 'NO TEST IMPORTS IT'. The only 'test' of auto-topup.ts and grants.ts is src/lib/credit/topup-receipt.test.ts, which greps their source text. The pure pack rules (rules.ts: packGrants, packClawbackPence, packLive) are tested, but the code that turns a captured £10 PaymentIntent into £30 of credit exactly once, and cancels a repeat, is not.
- **How you'd hit it:** A member from an ad buys the £10 starter pack. grantStarterPack's first-time detection (grant-server.ts:235 `return first ? 'granted' : 'already'`) regresses so the row's granted_at is set before the check, or grantTopup is called with the £10 charged instead of the £30 credit. The webhook tests still pass (they see deps.grantStarterPack('granted')), the member is charged £10 and sees £0 or £10 on Today's pack card.
- **Smallest fix:** Give src/lib/starter-pack/grant-server.ts and src/lib/stripe/grants.ts an injected deps object (the pattern webhook.ts already uses: stripe.paymentIntents.retrieve/capture/cancel, admin.rpc, grant) and add grant-server.test.ts and grants.test.ts: first pack → capture called once and credit_grant called with credit_pence; repeat → cancel called and 'blocked'; redelivery → 'already' with no second grant; refund → starter_pack_clawback called with the proportional share.
- **Second reader:** Confirmed. webhook.test.ts runs handleStripeEvent with fakeDeps() and stubs settleStarterPack/grantStarterPack/clawbackStarterPack (lines 677-685); the route passes liveWebhookDeps(). No test imports stripe/grants.ts, customer.ts or starter-pack/grant-server.ts; auto-topup.ts, grants.ts and deps.ts are only read as source text. The capture-or-cancel and grant-once code (grant-server.ts:108-140, 178-235) never runs in a test.

#### G7 · Medium · Airbtics, Google Places, Geocode, Ticketmaster, autocomplete and ElevenLabs fetches have no timeout inside metered actions: a hang runs the report to the 60s kill and leaves the member's credit reservation held for up to 10 minutes
- **Where:** `src/lib/apis/airbtics.ts:558` · **Journey:** the first report · **Fix branch:** 21h product-nav-health
- **What's wrong:** lib/timeout.ts exists but these provider calls pass no `signal`: airbtics.ts:558 (report/all POST), :603 (poll GET, inside a 25s loop that only bounds the loop, not each request), :636 (readReport), google-places.ts:78, geocode.ts:29, ticketmaster.ts:30, app/api/address-autocomplete/route.ts:195, app/api/speak/route.ts:60. PMI, PropertyData, PriceLabs, PlanIt, listing pages, Monday, Twilio, Turnstile and CAPI all carry AbortController/AbortSignal timeouts. /api/analyse (maxDuration 60) reserves the worst-case cost first (analyse/route.ts:153-158); when the platform kills the function mid-hang the `finally { finish() }` never runs and the reservation stays until its TTL (ledger.ts:96 default 10 minutes), during which `getBalance().spendableBasePence` is lower.
- **How you'd hit it:** A new member runs their first report on /estimate; Airbtics accepts the report/all POST and never replies. After 60s the function dies, the member sees 'Analysis stream ended unexpectedly. Please try again.' (estimate/page.tsx:886), tries again and, with a £10 pack, is told they don't have enough credit because the first run's reservation is still counted for up to 10 minutes.
- **Smallest fix:** Add `signal: AbortSignal.timeout(20_000)` (report/all), `AbortSignal.timeout(8_000)` (poll/read) in src/lib/apis/airbtics.ts, and `AbortSignal.timeout(8_000)` on the Google, Ticketmaster, autocomplete and ElevenLabs fetches, so the existing catch paths (refund + 'you haven't been charged') run instead of a platform kill.
- **Second reader:** Partly. True: the cited fetches have no signal (airbtics.ts:558/603/636, google-places.ts:78, geocode.ts:29, ticketmaster.ts:30); a platform kill skips run.ts:522-523 finally { finish() } so the 10-minute hold keeps counting, and it also skips analyse/route.ts:321 refundAction, so provider calls already debited (meter.ts:167) stay charged. Overstated: autocomplete and speak reserve nothing (no maxBasePence); a fresh £30 pack member can still retry (report max ≈ 809 base pence against ≈ 2,769); only members with under about £16 left are blocked.

#### G8 · Medium · GOOGLE_PLACES_API_KEY has no .env.example comment, and when it is missing or rejected every full report fails telling the member their postcode is wrong
- **Where:** `src/lib/analysis/run.ts:216` · **Journey:** the first report · **Fix branch:** 21h product-nav-health
- **What's wrong:** geocodePostcode throws 'GOOGLE_PLACES_API_KEY is not set in environment variables.' (src/lib/apis/geocode.ts:23) or 'Geocoding API returned HTTP 403' / 'API status: REQUEST_DENIED' when the key is absent, expired or over quota. run.ts catches every geocode failure and rethrows GeocodeError, whose fixed text is the one error message /api/analyse forwards verbatim to the browser (route.ts:322-323). So a configuration fault is reported to the member as a typo in their postcode. .env.example:182 lists the key with no comment on what it is for or what breaks without it, although it is the one key every report depends on before anything is charged.
- **How you'd hit it:** The Google key is rotated in the Google console but not on Vercel. A new member runs their first report and sees 'Could not geocode the provided postcode. Please check it and try again.', retries three times with different spacing, and leaves; the log line 'Geocoding failed:' is the only clue.
- **Smallest fix:** In src/lib/analysis/run.ts only throw GeocodeError when Google answered ZERO_RESULTS/INVALID_REQUEST for the postcode (have geocode.ts throw a distinct error for a missing key or non-OK/REQUEST_DENIED) so other causes fall to the generic 'unexpected error' branch; add a comment to .env.example:182 saying every full report geocodes first and fails without it.
- **Second reader:** Confirmed. geocode.ts:22-23 throws when the key is missing and line 39 on any non-OK status (REQUEST_DENIED, OVER_QUERY_LIMIT included); run.ts:215-220 turns each into GeocodeError whose fixed text is "Could not geocode the provided postcode. Please check it and try again." (run.ts:97), passed through by analyse/route.ts:322, /api/v1/analyse:64, /api/f/[token]/analyse:226 and mcp-tools.ts:418. .env.example:182 is a bare GOOGLE_PLACES_API_KEY=.

#### G9 · Medium · Resend send has no timeout: a hung Resend call holds the digest/alert cron until it is killed, and the claimed slot then counts the member's email as sent
- **Where:** `src/lib/email/send.ts:65` · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** `fetch(RESEND_ENDPOINT, { method: 'POST', headers, body })` has no `signal`, so a Resend that accepts the TCP connection but never answers blocks until the route's maxDuration (60s on every cron) kills the function. The digest marks the slot `status: 'sending'` before the call (src/lib/notify/sends.ts:66) and only `finishSend` (sends.ts:74) resolves it; the slot check at sends.ts:107-108 treats only stale `claimed` rows as free, so a row stuck in `sending` is 'in use' and the member's email for that day is never sent. Every transactional email (welcome, low-credit, pack letter, password/plan emails) shares this fetch.
- **How you'd hit it:** Resend has a partial outage at 08:10; the daily-digest cron sends member 3's email and the request hangs. At 60s Vercel kills the run: members 4-40 get no email that morning, and member 3's slot sits in 'sending' so a re-run skips them too.
- **Smallest fix:** In src/lib/email/send.ts add `signal: AbortSignal.timeout(10_000)` to the fetch (the catch already maps a thrown fetch to reason 'network' and retries once when keyed).
- **Second reader:** Confirmed. src/lib/email/send.ts:65 fetch(RESEND_ENDPOINT, …) has no signal, and no caller wraps sendEmail in withTimeout. A hung reply runs into the cron's maxDuration = 60 (daily-digest/route.ts:22). digest-run.ts:363 marks the row 'sending' before the call, and claim_notification_slot only takes over rows where status = 'claimed' (schema.sql:2447-2450), so the stuck member's daily slot is lost for that day. One hang stalls one of the four mapLimit lanes and the run never returns.

#### G10 · Medium · The daily digest's per-day charge and the profile/legacy double-charge guard have no test
- **Where:** `src/lib/notify/digest-run.ts:383` · **Journey:** the first email · **Fix branch:** 21e messages-crons
- **What's wrong:** digest-run.ts (396 lines) decides per profile whether a day is charged (`chargeFor(i)`: per_day mode, not admin, and that part has teasers) and calls chargeDailyDeals; daily-deals-server.ts (106 lines) writes the guard row into profile_daily_charges or daily_deal_charges before debiting, treats 23505 as already_charged, and consults the legacy daily_deal_charges row so the active profile is not charged twice across the Batch 13 deploy. Neither file is imported by any test. Only the pure helpers (dailyChargeDay, PayerPurse, dailyDealsLine in daily-deals.ts) are tested. The picks run (picks-run.ts, 1612 lines, the per-pick charge before the pricing date) is likewise untested.
- **How you'd hit it:** A new member with two running profiles gets her second-day email. If chargeFor(i) or the (profile_id, day) guard regresses, she is charged todays5DailyPence twice for one email, or charged for a changes-only email; /account/billing Usage shows two 'Daily deals' lines for the same day and no test failed.
- **Smallest fix:** chargeDailyDeals already takes `admin` as its first argument: add src/lib/listing/daily-deals-server.test.ts with a fake admin asserting 23505 → already_charged with no debit, a legacy daily_deal_charges row → already_charged for the active profile, and one debit with profile_id in meta otherwise; then extract digest-run.ts's chargeFor/mode decision into a pure function and test it.
- **Second reader:** Confirmed. No test imports notify/digest-run.ts or listing/daily-deals-server.ts; picks-run.ts is only checked as text. Untested: the legacy-row guard for the active profile (daily-deals-server.ts:70-76), the 23505 → already_charged path (line 83), chargeFor at digest-run.ts:314.

**Low (18, listed as reported, not independently verified):**

- **G6** A failure in the quiz's post-save bookkeeping (credit grant, Meta log, match count) throws out of the server action after the answer is saved, and the Quiz has no catch: the member lands on the default error page mid-quiz — `src/app/welcome/Quiz.tsx:111` · the profile quiz · branch 21b credit-enforce. _Fix:_ In src/lib/profile/server.ts wrap lines 270-280 (settleProfileCredit, matchCountFor, logConversion) in try/catch that logs and returns `{ ok: true, warning: null, view: … }` with `credit` defaulting …
- **G11** /str-report is a live public page whose 'market data' is invented from a postcode checksum ('For now, use deterministic seeded variation') — `src/app/str-report/_lib/market.ts:3` · later · branch 21h product-nav-health. _Fix:_ Delete src/app/str-report (and its presentation sub-route) or add a permanent redirect from /str-report to /estimate in next.config.ts redirects().
- **G12** Sign-in and sign-up show Supabase's raw error.message, so an Auth outage reads as 'fetch failed' or 'Database error saving new user' — `src/app/(auth)/actions.ts:46` · sign-up · branch 21h product-nav-health. _Fix:_ In src/app/(auth)/actions.ts map errors: if `error.status >= 500 || /fetch failed|network|timeout/i.test(error.message)` return 'We couldn't reach our sign-in service. Please try again in a minute.'; …
- **G13** NEXT_PUBLIC_SITE_URL has no comment and three different fallbacks (marketing site, localhost, or no link) when it is unset — `src/lib/url.ts:2` · sign-up · branch 21h product-nav-health. _Fix:_ Make src/app/(auth)/actions.ts and src/lib/crm/deliver.ts use siteUrl() from src/lib/url.ts (one fallback), and add a comment at .env.example:95 saying every email link, auth redirect and Twilio …
- **G14** Stripe client uses the SDK's 80-second default timeout on billing routes that set no maxDuration, so a hung Stripe leaves the pack/top-up button spinning until the platform kills the function — `src/lib/stripe/client.ts:14` · the £10 pack · branch 21c stripe-ledger. _Fix:_ src/lib/stripe/client.ts:14 → `new Stripe(key, { timeout: 20_000, maxNetworkRetries: 1 })`, and `export const maxDuration = 30` on the billing routes.
- **G15** Today, the deal page and My deals return null when getUser() yields no user: a blank white page instead of a redirect — `src/app/today/page.tsx:69` · Today · branch 21h product-nav-health. _Fix:_ Replace `if (!user) return null;` with `if (!user) redirect('/login?redirect=/today')` (and the matching path) in src/app/today/page.tsx, src/app/deals/[id]/page.tsx and src/app/my-deals/page.tsx.
- **G16** Narration's Anthropic client has the SDK's 10-minute default timeout on a 30-second route: a slow call is platform-killed and the credit reservation lingers — `src/app/api/summarise/route.ts:106` · the first report · branch 21h product-nav-health. _Fix:_ src/app/api/summarise/route.ts:106 → `new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 })`.
- **G17** Member-facing licensing notes are hard-dated 'as of July 2026' / 'due to open in autumn 2026' and are now stale (today is 30 Sep 2026) — `src/lib/data/str-licensing.ts:97` · the first report · branch 21h product-nav-health. _Fix:_ Re-verify the two schemes and update the dates/wording in src/lib/data/str-licensing.ts:97-99 (and the header comment), or phrase them without a fixed month and keep a `verifiedOn` constant the panel …
- **G18** Airbtics 'TEMPORARY (remove once a few weeks of reports have been compared)' diagnostic still runs and logs on every report — `src/lib/apis/airbtics.ts:1454` · admin only · branch 21h product-nav-health. _Fix:_ Remove lines 1454-1465 of src/lib/apis/airbtics.ts (or gate them behind an AIRBTICS_DEBUG env check).
- **G19** Three tests pin source text with regexes instead of testing behaviour, and the receipt one accepts an empty email — `src/lib/credit/topup-receipt.test.ts:19` · admin only · branch 21h product-nav-health. _Fix:_ For src/lib/stripe/auto-topup.ts give maybeAutoTopup an injected grantTopup and assert the email argument's value in a real test; keep live-filter and wiring as clearly labelled 'pins' or replace …
- **G20** A cache-key test reads the wall clock twice (test and live code), so it flakes on the last minute of a month — `src/lib/broker/questions-propertydata.test.ts:125` · admin only · branch 21h product-nav-health. _Fix:_ Give the propertydata questions' key() a `now` parameter (src/lib/broker/questions-propertydata-defs.ts) defaulting to new Date(), and pass a fixed date in questions-propertydata.test.ts:125-127.
- **G21** BROKER_BUDGET_<PROVIDER> is a live daily spend cap documented only in a test and a comment; the test deletes it instead of restoring it — `src/lib/broker/config.ts:80` · admin only · branch 21h product-nav-health. _Fix:_ .env.example: add `BROKER_BUDGET_<PROVIDER>=` and `BROKER_MEMBER_BUDGET_<PROVIDER>=` with the pence/day note from src/lib/broker/config.ts:6-7; in src/lib/broker/resolve.test.ts restore the saved …
- **G22** npm test prints 275 MODULE_TYPELESS_PACKAGE_JSON warnings (1,100 lines) before the results — `package.json:13` · admin only · branch 21i next-16.3.7. _Fix:_ package.json:13: `"test": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test 'src/**/*.test.ts'"` (or add "type": "module" and re-check the scripts/*.mjs and extension build).
- **G23** Five env vars the code reads are documented nowhere: PRICELABS_API_KEY, PRICELABS_AS_PRIMARY, PMI_API_BASE, VERCEL_PROJECT_PRODUCTION_URL, CALIBRATION_API_URL — `src/lib/analysis/run.ts:160` · admin only · branch 21h product-nav-health. _Fix:_ Add PRICELABS_API_KEY, PRICELABS_AS_PRIMARY, PMI_API_BASE and VERCEL_PROJECT_PRODUCTION_URL to .env.example with one line each on what they change (and CALIBRATION_API_URL under the calibration …
- **G24** .env.example still says ANTHROPIC_API_KEY is only the voice narrator; since Batch 17 it also runs the project photo check — `.env.example:113` · admin only · branch 21h product-nav-health. _Fix:_ Extend the comment at .env.example:113-115 to name src/lib/project/photo-check-server.ts and say the project photo check is skipped without the key.
- **G25** CRON_SECRET, which every one of the 33 Vercel crons needs, has no CRON_SECRET= line and a stale comment about 'the weekly cron' — `.env.example:219` · admin only · branch 21h product-nav-health. _Fix:_ Add a `CRON_SECRET=` line with a comment next to INTERNAL_API_SECRET in .env.example (:221) saying Vercel sends it on every cron in vercel.json and that all crons are refused without it.
- **G26** NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is in .env.example but nothing reads it — `.env.example:67` · admin only · branch 21h product-nav-health. _Fix:_ Delete line 67 from .env.example.
- **G27** The pack is offered even when STRIPE_PRICE_STARTER_PACK is unset: Buy then fails with a 503 — `src/lib/starter-pack/server.ts:41` · the £10 pack · branch 21c stripe-ledger. _Fix:_ Include the price's presence in the offer's 'off' condition in src/lib/starter-pack/server.ts (and show it on /admin/lifecycle's readiness panel).


## 5. Proposed fix plan

Nine branches, each from a fresh `origin/main`, each owning its files so they cannot collide. **Every `supabase/schema.sql` change lives in 21a** (one labelled section, `-- Batch 21: review fixes`, idempotent) and 21a merges and is run first; a code branch that needs a new SQL function waits for it. 21i (the Next.js bump) stands alone. Two deliberate re-pointings so no file is in two branches: E1 and E20 are fixed in `src/lib/activity/kinds.ts` (not `profile/server.ts` / `webhook.ts`), and E2's fix is on the Monday board formula or in `values.ts`. Marks: 💷 changes a price or a number members see · 👤 changes existing members' experience · 🗄️ needs a schema run · 🧭 a business decision in section 6 first.

| Branch | Findings | Files it touches | Marks |
|---|---|---|---|
| **21a schema** | A1, A2, A3, A7–A13, A15–A18, B30, B44, E3, E21, E23, E27, G4, A5's SQL side; the SQL half of B2 (overdraft decision), B1 (an atomic `credit_plan_cycle` function), B9 (referral guard in `credit_redeem_code`), C4 (`leads.input`) | `supabase/schema.sql` (+ `src/lib/credit/ledger.ts`, `src/lib/crm/monday-funnel/match.ts`, `src/lib/sourcing-demand/server.ts` for A4, A10, D24) | 🗄️ 💷 (overdraft forgiveness changes balances) 🧭 Q1, Q5 |
| **21b credit-enforce** | B2 (code half), B4, B5, B10, B46 (the email half with 21e's `after-debit.ts`), B12, B16, B24, B27, B35, B41, C13, D16, G6 | `src/lib/credit/http.ts`, `src/lib/profile/server.ts`, `src/app/deals/_components/AnalysisPanel.tsx`, `src/components/report/PmiAddonCard.tsx`, `src/app/api/internal/listing-recheck/route.ts`, `src/lib/admin.ts`, `src/components/credit/CreditBanner.tsx`, `src/app/account/billing/page.tsx`, `src/app/api/v1/analyse/route.ts`, `src/app/welcome/Quiz.tsx` | 👤 (the flip blocks £0 members; staff accounts) 🧭 Q1, Q3 |
| **21c stripe-ledger** | B1 (route guard + use of the new function), B3, B7, B8, B9 (route side), D1, B47, B48, G27, B13–B15, B17–B19, B21–B23, B26, B29, B31–B34, B36–B39, B42, B43, B45, C17, D17, G3, G5, G14, A14 | `src/app/api/stripe/webhook/route.ts`, `src/lib/stripe/{webhook,deps,grants,client}.ts`, `src/app/api/billing/{topup,redeem,starter-pack}/route.ts`, `src/components/credit/{TopupButtons,LowCreditChoice}.tsx`, `src/lib/team/{seats,invites}.ts`, `src/lib/starter-pack/grant-server.ts`, `src/lib/credit/{abuse,referral,welcome}.ts`, `src/lib/supabase/email-key.ts`, `src/lib/lifecycle/settings-server.ts`, `src/lib/marketplace/open.ts`, `src/app/admin/billing/actions.ts`, `src/app/api/analyse/route.ts`, tests | 💷 (B8 grants missing annual months; B9 stops referral rewards for withheld accounts) 🧭 Q4, Q5, Q6 |
| **21d privacy-access** | G1, C6, C12, C32, C14, C16, C18–C23, A6, C5, E14, F15 | `src/app/api/get-report/route.ts` and `src/app/report/page.tsx` (delete), `src/app/api/track/route.ts` (delete), `src/app/d/[token]/page.tsx`, `src/app/deal/[token]/page.tsx`, `src/app/p/[token]/actions.ts`, `src/app/api/generate-pdf/route.tsx`, `src/app/(marketing)/short-let-deals/[slug]/page.tsx`, `src/lib/listing/{server,tracked-server}.ts`, `src/app/my-deals/page.tsx`, `src/lib/starter-pack/rules.ts` | 👤 (C5 pack copy; C6 share page for signed-in members) |
| **21e messages-crons** | B6, B49, C33, D2, D3, D5–D9, D11–D13 (D10/D13 funnel-queue → 21g), D14–D28, B28, B40, C15, G9, G10, F9 | `src/lib/email/{send,billing}.ts`, `src/lib/notify/{digest-run,sends}.ts`, `src/lib/listing/{picks-run,daily-notice-run}.ts`, `src/lib/sms/alerts-run.ts`, `src/lib/credit/after-debit.ts`, `src/lib/notifications/server.ts`, `src/lib/crm/monday-funnel/facts.ts`, `src/lib/auth/sign-in-hooks.ts`, `src/lib/internal-auth.ts`, `src/lib/deal-quality/checks-run.ts`, `src/app/api/internal/market-warm/route.ts`, `vercel.json` | 👤 (which emails arrive and when) 🧭 Q2, Q7, Q8, Q16 |
| **21f activity-inactivity-monday** | E1, E2, E4–E13, E28, E15–E20, E22, E24–E26, A5, F19, C21 | `src/lib/activity/{kinds,heartbeat,presence}.ts`, `src/lib/inactivity/{rules,server}.ts`, `src/lib/crm/monday-funnel/facts-server.ts`, `src/lib/tracking/report-server.ts`, `src/lib/admin/{activity,profile-server}.ts`, `src/lib/apis/monday.ts`, `src/lib/deal-quality/backfill-run.ts`, `src/app/profiles/switch/route.ts`, `src/app/p/[token]/page.tsx`, `src/app/{profile,account,account/team,deals,profiles,leads}/…actions`, `src/app/api/twilio/inbound/route.ts` | 💷 (E1 lowers week-1 weekly active to the truth) 🧭 Q9, Q10, Q11, Q15 |
| **21g funnel-whitelabel** | C1–C4, C8–C11, C24–C31, D10, D12, D13 | `src/app/estimate/page.tsx`, `src/app/estimate/_components/SecondOpinionCard.tsx`, `src/lib/apis/airbtics.ts` and `src/lib/analysis/run.ts` (the strings), `src/app/api/f/[token]/analyse/route.ts`, `src/app/api/internal/{funnel-queue,crm-deliveries}/route.ts`, `src/lib/leads/store.ts`, `src/lib/crm/deliver.ts`, `src/app/f/[token]/page.tsx`, `src/app/r/[token]/`, `src/lib/pdf/report/Page6Plan.tsx`, `src/lib/email/lead-report.ts`, `src/app/layout.tsx` | 💷 (C3 refunds failed runs) |
| **21h product-nav-health** | F1–F8, F10–F14, F16–F18, F20–F33, C7, G7, G8, G11–G13, G15–G21, G23–G26, B20, B25, B32, A3's copy side | nav and shells (`src/components/{AppSwitcher,AppShell}.tsx`, `src/app/markets/layout.tsx`, `src/app/(marketing)/upgrade/page.tsx`, `src/app/extension/connect/page.tsx`, `src/app/deals/[id]/page.tsx`, new `error.tsx`/`not-found.tsx`), orphans (`src/app/{demo-report,str-report}`, `src/app/api/listing/quick-estimate`, `src/proxy.ts`), duplicates (`src/lib/market/tab-model.ts`, `src/lib/access.ts`, `src/lib/marketplace/reactions-server.ts`, `src/lib/profile/questions.ts`, `src/lib/sms/choose.ts`, `src/lib/listing/sourcing.ts`), `.env.example`, `src/lib/url.ts`, `src/app/(auth)/…`, timeouts (`src/lib/stripe/client.ts` is 21c's; `src/app/api/summarise/route.ts`, `src/lib/apis/airbtics.ts` fetch signals), tests | 👤 (nav, 404/error pages) 💷 (F14 relabel) 🧭 Q12 |
| **21i next-16.3.7** | G2, G22 | `package.json`, `package-lock.json` | 👤 (whole site; full click-through) |

Suggested order: 21d (G1, same day) → 21a (merge, run the schema) → 21c and 21b → 21e and 21f → 21i → 21g and 21h. Each branch gets tests where a test could have caught the bug (B1, B3, B7, B8, B9, D1, D2, D5, E1, C3 at least), and before hand-back: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, plus the diff review the brief lists.

## 6. Questions before I fix

Each is a business decision; the default is what I'd do if I hear nothing.

1. **Shadow-mode overdrafts (B2).** Members who ran things at £0 since Batch 10 carry a negative balance nobody told them about. When `CREDIT_ENFORCE` flips they are refused everything until it is repaid, and any pack or top-up repays it first. *Default:* forgive every existing overdraft once in 21a (zero the `overdraft:` grants with a matching `adjust` transaction, keep a count), set `CREDIT_ENFORCE=true` the same day, and never let a pack-era account overdraw (21b). Alternative: make them repay, and say so in an email.
2. **A new member who taps "Not now" on the pack (B6).** They are at £0, so there is no Today's 5 email, the out-of-credit letter goes at 08:00 on day one, and Today shows the red out-of-credit strip (B12). Is that the intended pack-era experience? *Default:* keep the charged pick off, but let the daily email go with the teasers only (no charged pick, no address) for a £0 member, and swap the day-one letter for the pack offer. Alternative: a small free allowance for the first N days.
3. **Staff accounts (B41).** `@stayful.co.uk` accounts are billed like members and will be blocked at £0 on the flip; only `ADMIN_EMAILS` bypass. *Default:* treat the staff domain as admin for credit, as the metrics already do.
4. **Referral rewards for accounts whose welcome credit was withheld (B9).** *Default:* no referral reward, no referral credit, when `welcome_withheld_reason` is set (disposable email, re-used mobile); the sign-up still works.
5. **£0 invoices (B29).** A 100%-off code or a trial's first invoice grants a full month of plan credit. *Default:* keep it (it is a promotion you chose to give) and write it down in the README; tell me if the credit should scale with what was paid.
6. **Won disputes (B17).** A dispute claws credit back the moment it opens; a won or withdrawn dispute never gives it back because `charge.dispute.closed` is not subscribed. *Default:* subscribe to it and restore the credit on `won`.
7. **The uncapped credit emails (D9).** The out-of-credit, low-balance and auto-top-up warnings go seconds after the 07:00 pick debit, outside the cap, so a member can get Today's 5 and "You're out of credit" in the same minute. *Default:* keep them outside the cap (they are billing warnings) but delay any sent within 10 minutes of a daily email, or fold the out-of-credit one into the next day's letter. Alternative: cap them.
8. **"Email OK" on Monday (D4, D6, D14).** It is a proxy (Daily picks OR Weekly missed deals on), true for unconfirmed sign-ups, and refreshed only nightly. *Default:* queue a Monday update on every notification change, STOP and verification (D6), require `welcome_checked_at` (D4), and rename the board column's description to say what it is; add a real "news and offers" switch only if the n8n sequence will send marketing rather than product email.
9. **Cancelling subscribers and inactivity (E24).** A paid-up member who booked a cancellation is eligible for Re-engage and picks-paused at once, for the rest of a paid term. *Default:* not eligible until the plan actually ends.
10. **"Exclude from metrics" on Monday and inactivity (E8).** Switched-off test accounts still get a Monday row, move between groups and can be paused. *Default:* excluded accounts are left out of the funnel and the nightly entirely.
11. **Monday *Engagement %* (E2).** *Default:* the site writes a *Weeks since sign-up* number computed the same way as *Active weeks* (ISO weeks) and the formula divides by it; the alternative is to change the board formula by hand.
12. **Explorer "Short-let net / yr" (F14).** The Explorer nets 52% with no bills; a deal sheet's "Net operating" also takes £250/month of bills, £3,000 a year apart for the same gross. *Default:* relabel the Explorer card ("before bills and mortgage"); the alternative is to subtract bills there too, which moves every Explorer verdict.
13. **Pack buyers get the paid tier (C5).** Buying the pack sets `last_topup_at`, which gives 48-hour early access, but no copy says so. *Default:* intended; add one line to the pack screen and the Terms clause.
14. **Next.js 16.3.7 (G2).** *Default:* yes, in 21i, with the full test suite, a production build and a click-through on the preview before it merges.
15. **Does opening the quiz count as weekly active (E1)?** Today it does (`profile_started` is a qualifying kind, and a test pins it), so every confirmed sign-up is active in week 1. *Default:* no — make it record-only; the first answer (`profile_answered`) already counts, so week 1 then measures members who did something.
16. **Charged house picks for quiz drop-outs (B49).** A member who closes the quiz on screen one still gets a house pick every morning, charged to their welcome credit. *Default:* no picks until the mandatory questions are answered; send the profile nudge instead.

## 7. Appendix

### A. Mechanical checks (origin/main at 91c76c2, Node 22.22.2)

| Check | Result |
|---|---|
| `npm test` | 2,365 tests, 2,365 pass, 0 fail, 0 skipped (25 s). 275 `MODULE_TYPELESS_PACKAGE_JSON` warnings printed first (G22). |
| `npm run lint` | 0 errors, 67 warnings: 50 `@typescript-eslint/no-unused-vars`, 5 `@next/next/no-img-element`, the rest in `src/lib/apis/airbtics.ts`, `src/lib/analysis.ts`, `src/lib/apis/monday.ts`, `src/lib/listing/picks-run.ts`, `src/app/str-report/…`, `src/components/…` (full list in the working files). |
| `npm run typecheck` | clean |
| `npm run build` | clean, no warnings |
| `npm audit --audit-level=high` | 20 advisories: 1 critical (`next` 16.2.1 → 16.3.7), 11 high (`brace-expansion`, `browserslist`, `fast-uri`, `hono`, `ip-address`, `js-yaml`, `nanoid`, `path-to-regexp`, `postcss` and `sharp` via `next`, `ws` via `@supabase/supabase-js`), 5 moderate, 3 low. `npm audit fix` clears all but the `next` chain; `next@16.3.7` clears that. |

### B. schema.sql on a throwaway Postgres 16

Shim: roles `anon`, `authenticated`, `service_role`, `supabase_auth_admin`; `auth.users`, `auth.uid()`, `auth.jwt()`, `auth.role()`; `storage.buckets` / `storage.objects`; `pgcrypto`. Run 1 (fresh): 0 errors, 42 notices (duplicate `add column if not exists`, `drop … if exists` on nothing). Two `auth.users` rows inserted (one dated 1 Sep 2026, one today): both got a profile and a first search profile; neither got a welcome grant from the file (the backfill is frozen). Runs 2 and 3: 0 errors, 376 notices each (all "already exists, skipping"). `pg_dump --schema-only` and the seed rows are byte-identical between run 1 and run 3. All 90 tables have RLS on; 19 policies on 14 tables; 50 functions, every one `security definer` with `search_path` pinned except the five funnel counters and `safe_numeric` (A12). The live project runs Postgres 17; nothing in the file is version-specific.

### C. Static cross-checks

- `ACCESS_COLUMNS` (`src/lib/access.ts:251`): all nine columns exist on `profiles`.
- Every `.from('<table>')` (73 tables) and `.rpc('<fn>')` (44 functions) in `src/` exists in the schema; one selected column does not: `bulk_jobs.report_id` (A5).
- Schema tables no `.from()` reads: `credit_allocations`, `credit_reservations`, `credit_code_redemptions`, `airbtics_report_cache`, `admin_users`, `admin_password_resets`, `bulk_job_rows`, `pipeline_checklist_ticks`, `pipeline_step_events`, `activity_visits`, `activity_meta`, `profile_daily_charges`, `member_refunds`, `member_active_days`, `member_engaged_days`, `member_active_days_state`, `monday_funnel_lock` — all reached through SQL functions, none dead.
- Env: the code reads 9 variables `.env.example` does not document (`PRICELABS_API_KEY`, `PRICELABS_AS_PRIMARY`, `PMI_API_BASE`, `VERCEL_PROJECT_PRODUCTION_URL`, `CALIBRATION_API_URL`, `NODE_ENV`, and three test-only ones) and `.env.example` lists one nothing reads (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`). No server-only variable is read in a `'use client'` file; the seven `NEXT_PUBLIC_` values are all public by nature.
- Crons: 33 entries over 23 routes; every route exists, checks `authoriseInternal` first, and declares `maxDuration = 60`; 21 honour `?dry=1`, `credit-sweep` and `crm-deliveries` do not. Exact-slot collisions: 03:00 (`credit-sweep`, `low-entry-search`), 04:00 (`planning-signals`, `deal-checks`), every 10 minutes (`crm-deliveries`, `monday-funnel`); minute-level overlaps in D28.
- TODO / FIXME / "later batch": 9 matches, none an open promise (G-area Loose ends).
- Live data today (approx. rows): profiles 52, marketplace_deals 781, provider_calls 36,494, sourced_listings 6,159, analyser_reports 839, notification_sends 180, activity_events 77, search_profiles 52, member_active_days 15.

### D. Batch merges on main (squash commits, UK time)

| Batch | PR | Commit | Merged |
|---|---|---|---|
| 1 | #83 | 296e07d | 26 Sep 10:02 |
| 2 | #82 | ddbcef6 | 26 Sep 10:10 |
| 3 | #86 | 8033bc3 | 26 Sep 11:10 |
| 4 (part A, #85 fea21b6 11:17; follow-up #88 aeac8e4 14:00) | #87 | 0c44d8a | 26 Sep 13:14 |
| 5 | #90 | 3fc5237 | 26 Sep 15:02 |
| 6 | #91 | 0742a2d | 26 Sep 17:35 |
| 7 | #92 | c744e5d | 27 Sep 08:17 |
| 8 | #93 | fe0c435 | 27 Sep 09:01 |
| audit of 1–8 | #94, #95 | 4852128, 08a9a34 | 27 Sep 10:11, 10:24 |
| 9 | #96 | 7f47f77 | 27 Sep 11:45 |
| 10 | #97 | 24bbde4 | 27 Sep 14:11 |
| advisor fixes | #98 | d622aad | 27 Sep 15:18 |
| 11 | #99 | 8d067f2 | 27 Sep 15:43 |
| 12 | #100 | bf1b388 | 27 Sep 17:32 |
| 13 | #101 | 808305d | 28 Sep 08:59 |
| 14 | #102 | 312a7e7 | 28 Sep 12:16 |
| 15 | #103 | 1096db1 | 28 Sep 13:02 |
| 16 | #104 | b918629 | 29 Sep 09:03 |
| 16b | #107 | 9e95705 | 29 Sep 11:34 |
| 17 | #105 | fb159df | 29 Sep 14:13 |
| 18 | #106 | dcf82e3 | 29 Sep 14:41 |
| 19 | #108 | 70534fb | 29 Sep 21:16 |
| 20 | #109 | 91c76c2 | 30 Sep 12:01 |

None missing, none merged twice, all in order (16b before 17 by design). Every batch branch's head equals its merged PR head. Also on main: #84, #89 (schema notes); #110 (Stripe webhook API-version docs, merged 1 Oct 07:58 BST, after the review).

### E. A new member's first day, from the code

Read by a separate reader from the code at 91c76c2 (nothing was run); paths are repo-relative. It answers the seven questions I set for a brand-new member who taps a Facebook ad on their phone.

**1. Sign-up → confirm → first sign-in.** Email sign-up sends the confirmation link to `/auth/callback?confirm=1` (`src/app/(auth)/actions.ts:26-32, 82-94`) and shows `/signup/check-email`. The callback exchanges the PKCE code, runs the sign-in hooks and lands on `/today` (`src/lib/auth/landing.ts:25, 43-49`). If the link is opened in a different browser from the one that signed up (the Facebook in-app browser, then Safari), the verifier cookie is missing and the member is sent to `/login?error=confirmed_elsewhere`: "Your email is confirmed — sign in to continue" (`src/app/auth/callback/route.ts:27-30`). The quiz gate runs before Today: `AppShell` grants the welcome credit, stamps `welcome_checked_at` (`src/components/AppShell.tsx:60-64`) and `requireProfileStart` redirects to `/welcome` (`src/lib/profile/server.ts:155-159`). The gate is not three questions: roles, deal types, where, plus one money question per chosen deal type, 4–6 screens (`src/lib/profile/questions.ts:12-14, 202-285`). The pack screen is `PackScreen` in `src/app/welcome/Quiz.tsx:277-290`, shown once on the answer that completes the mandatory set (`Quiz.tsx:122-126`). With `starter_pack_from` empty the pack is off (`src/lib/starter-pack/rules.ts:46`), £20 is granted silently (`src/lib/credit/welcome.ts:69-81`) and the quiz start screen mentions only "£5 of credit when you finish". With it set: no welcome credit, balance £0, the pack screen ("Start with £30 of credit for £10 … Buy for £10 / Not now"); "Not now" only logs the tap, it does not snooze (`src/components/starter-pack/actions.ts:28-32`); buying returns to `/today?pack=1`, not to the quiz (`src/app/api/billing/starter-pack/route.ts:163-164`).

**2. Day-one Today.** Not empty: the page calls `todaySelection` directly, which chooses and stores a list on the spot (`src/app/today/page.tsx:104-106`, `src/lib/today/selection.ts:89-139`), cut to deals live for 48 h for free members (`selection.ts:316`), with the closest deal stored as a near miss when nothing matches (`src/lib/today/choose.ts:108-148`); the list holds until 07:00 UTC. The empty state ("Nothing new for you today. New deals arrive every morning. Widen what you're looking for…") appears only if even the near miss is empty; free members also see "N new deals are in early access. Paid members are seeing them now" with an Upgrade button. One wording slip: the quiz's done screen says "From tomorrow, your Today's 5 is picked from them" (`Quiz.tsx:181`) though a list exists straight away.

**3. The 48-hour delay.** "Paid" is `hasEverPaid`: any subscription history, plan code or `last_topup_at` (`src/lib/access.ts:230-239`), read on the payer's row (`src/lib/marketplace/tier.ts:17-33`); free accounts get `free_deal_delay_hours` = 48 (`src/lib/marketplace/visibility.ts:29-50`), applied to Today, the grid, deal pages (404), opens, picks and the digest. A £10 pack buyer counts as paid, but only once the webhook has captured and granted (`src/lib/starter-pack/grant-server.ts:161-170`); before that they are free. A £20-welcome-only member is never paid for the delay (the welcome grant does not set `last_topup_at`).

**4. Back from Checkout before the webhook.** `/today?pack=1` reads `latestPurchaseFor`; before the webhook there is no row, so it says "Thanks: your £30 of credit is on its way. Refresh the page in a moment…" (`rules.ts:155`) and hides the pack card on that view only. The member stays eligible until the webhook's settle step creates the purchase row, so the red banner's "Get £30 for £10" button on the same page, the Today card and the billing pages still open a fresh Checkout (`src/app/api/billing/starter-pack/route.ts:65-66, 155-167`). What stops a second charge: manual capture, the once-per-person claim (account, email, mobile, card) and the cancel of the blocked authorisation (`grant-server.ts:142-152`); the member still sees a temporary hold on their card, and the second return says "on its way" again unless its webhook has already run.

**5. The first deal open and the ladder.** The ladder is 25p / 40p / 60p / 80p / £1 by annual profit (`src/lib/marketplace/ladder.ts:25-31`). A £0 pack-era member with `CREDIT_ENFORCE` off sees "Quick look · 40p" and "Full analysis · £4"; Quick look skips the balance check (`open.ts:96-99`) and debits with `allowNegative` into an overdraft at rate 1; the Full analysis button reads "Top up to run it · £4" but starts the purchase and charges £4 into overdraft on completion (`AnalysisPanel.tsx:203, 58-69`; `deal-analysis.ts:308-312, 598-618`); the "not enough credit" pack panel never appears because it needs `msg=insufficient_credit`, which only an enforcing `openDeal` returns. With £30 of pack credit: the £20 bonus (rate 1) is spent first, then the £10 top-up part at 1.3×; Quick look 25p–£1, Full analysis £4 (one tap on an unopened deal totals £4 including the Quick look; £5.20 once the bonus is gone, shown as "£4 on a plan"), PMI +£2; "about 7" analyses = round((2000 + 1000/1.3) / 400).

**6. The first email.** The picks run (07:00/07:20/07:40 UTC) emails every account with `sourcing_alerts` true (default) and `welcome_checked_at` set (`picks-run.ts:297-316`), skipping inactive, paused, already-sent and all-profiles-paused members; an incomplete quiz is included (`welcome_checked_at` is stamped on the first visit, before the gate) and gets a house pick plus a "profile N% done" line. The charge is taken after the send (`picks-run.ts:1553-1573`): per pick today (a pool deal at the ladder price, any other pick at `pmi:daily_pick` 2p × 5 = 10p), 33p a day from `new_pricing_from` once the notice date is set. The credit check before sending ignores `CREDIT_ENFORCE` (`picks-run.ts:1036-1081`): a £20 member gets the 07:00 email charged from welcome credit; a pack-era £0 member is marked `no_credit` and gets the 08:00 letter "Your daily deals are waiting" with the pack offer, which uses the day's slot so the 08:10 digest skips them.

**7. Meta events.** All five events have one dedupe key each (`src/lib/meta/events.ts:46-50`). Gates (`src/lib/meta/conversions.ts:242-297`): `meta_tracking_since` must exist; CompleteRegistration, ProfileComplete and FirstReport only for accounts created after it; lead-form accounts never fire CompleteRegistration; admins, staff, excluded and team seats never fire anything; without Accept an event is held and sent only if they accept within 60 minutes; the server re-checks consent at send time and sends live only from production with a token; the pixel loads only after Accept on tracked pages. CompleteRegistration is recorded at sign-up if Supabase returned a session, else at first sign-in; ProfileComplete when the whole quiz is first complete; FirstReport on the first finished Full analysis or analyser report; Purchase from the one-click route or the webhook. Gap: the Checkout return `/today?pack=1` is not treated as a Stripe return (`src/lib/tracking/config.ts:158-167`), so the browser copy of Purchase cannot fire there (the server copy still goes). Without consent: no pixel or CAPI event fires; the exceptions are the lead-form member's first sign-in, which posts `lead_activated` to n8n with no consent check (`src/lib/auth/sign-in-hooks.ts:38-59`), and the UTM tags and Facebook click id, which are saved first-party for every sign-up (`src/lib/tracking/touch.ts:243-261`).

**Problems the walk raised** (those not already in section 4 were added there as B46–B49, C32, C33, E28, F31–F33, G27): the overdraft repaid at 1.3× (B2); an "out of credit" email during the quiz (B46); "Top up to run it" runs anyway (B5); a second Checkout and card hold before the webhook (B47); the in-app-browser confirmation bounce (F31); "Not now" does not snooze (B48); the free banner offers only "Upgrade" though the pack lifts the delay (C32); members who never answered the mandatory questions still receive charged house picks (B49); "From tomorrow" and buying from the quiz drops its remaining questions (F32); a possible first-render race on `/today` storing a list before any answers (F33, unverified); the pack offered when Stripe is not configured (G27); the sign-up title "Start your free trial" in pack mode (F32); the lead-form n8n hook without a consent check (C33); the Purchase browser event lost on the pack return (E28).

### F. Checked and found clean (377 items, by reading)

What each reading looked at and found no fault with; the note is the reader's own.

**A · idempotency & duplicates** (16)

- Functions defined more than once
- Triggers dropped and recreated with a different body
- Index or add-column definition changed under the same name (the `if not exists` blind spot)
- billing_settings seeds
- Batch 10 spend_rate 1.5 → 1.3 move
- marketplace_deals.stream fill-in (Batch 16)
- search_profiles first-profile creation (Batch 13)
- Untagged-history and profile_today_lists copies (Batch 13)
- saved_searches.owner_id and marketplace_deals.live_since backfills
- sourcing_alerts backfill guard
- meta_tracking_since set-once, starter_pack_from / inactivity_from start null
- create type / alter type add value / create extension
- grant / revoke / comment on / alter column set default
- Section order on a fresh install
- storage.buckets feedback-screenshots upsert
- handle_new_user on conflict do nothing / credit_grants source_ref uniqueness

**A · RLS & grants** (15)

- profiles: is the `revoke update ... from anon, authenticated` at schema.sql:431 still effective after later grants?
- profiles update policy has a with check (449-452)
- Every session-client write to profiles touches only granted columns
- Any table with RLS-and-no-policy read through the session client (silently empty)?
- Can a member read or change another member's rows through the 14 policied tables?
- saved_searches: can a member forge owner_id, deal_id or analysed_at?
- Triggers that fire on member-session writes reach service-role-only tables
- SECURITY DEFINER functions executable by anon/authenticated
- DEFINER functions without set search_path (advisor fix #98)
- RPCs that take a user id are called with server-derived ids
- Views and the private schema
- Storage
- Browser-side use of the anon key
- Credit ledger client
- checked_listings.profile_id and share_token member-writable

**A · code vs schema columns** (14)

- 943 .from() builder chains in src/: every column named in select (literal, constant or template), insert/upsert/update literal keys, onConflict, eq/neq/gt/gte/lt/lte/in/is/like/ilike/not/filter/order/contains/overlaps/match, .or() conditions and relation embeds exists on its table
- Every fixed column list resolves to existing columns: ACCESS_COLUMNS, PAID_TIER_COLUMNS, NOTIFICATION_COLUMNS(+BEFORE_BATCH_6/8), DEAL_COLUMNS (39), CARD_COLUMNS/PUBLIC_DEAL_COLUMNS (33), OPEN_COLUMNS, PICK_COLUMNS, PIPELINE_COLUMNS, QUIZ_COLUMNS, PROFILE_COLUMNS ×4 (account page, low-credit, Monday facts, search_profiles), SAFE_COLUMNS, LEAD_COLUMNS, INVITE_COLUMNS, CONTACT_COLUMNS, MEMBER_REPORT_COLUMNS, FAMILY_COLUMNS, RANKING_COLUMNS, BROWSE_RANK_COLUMNS, PURCHASE_COLUMNS, EVENT_COLUMNS, REPORT_COLUMNS, BROWSER_COLUMNS, stripe/deps SELECT
- 105 non-literal payloads read by hand on the money/gate tables: profiles (account/actions writeProfile ×4, stripe/webhook patches + subscriptionColumns, after-debit, welcome, inactivity write(), notificationPatch, leads/provision, credit-sweep), provider_calls (meter.ts row), subscription_events (row()), deal_opens (open.ts insert, picks-run upsert), checked_listings (open.ts, listing/server.ts, recheck, mortgage-backfill), sourcing_sent/sourcing_missed (picks-run, missedRowFor), sms_contacts/sms_messages (store.ts, twilio status, verify, alerts-run), meta_conversions (setStatus), member_attribution (attributionRow), analysis_purchases (deal-analysis, pmi-addon), daily/profile_daily_charges, checklist_steps, profile_today_lists (storeTailoring), profile_quiz, deal_reactions (stage-server, reactions-server), marketplace_deals (recordColumns, priceChangeColumns, absorb inserts/revive/confirm, server.ts failure/live, checks-run, project check-run), deal_alerts (AlertInsert), saved_areas, announcements/announcement_views, api_keys, funnels, crm_connections/crm_deliveries, leads (touchPatch, markLeadPushed, restore), unit_costs, analyser_reports (reportRowFor, compFieldsFrom), project_prep/project_checks, monday_funnel_runs, activity_excluded_accounts, pipeline ticks/events
- 49 .rpc() calls: every named argument matches the function's parameter names in functions.txt (credit_*, funnel_*, provider_spend_*, claim/finish_notification_*, project_claim_check, sms_verification_attempt)
- 27 p-jsonb RPC calls: keys passed vs keys the SQL body reads (activity_log ⇔ ActivityCall, activity_visit_touch, activity_backfill/retention/weekly_facts, lifecycle_*, monday_funnel_enqueue/lease, feedback_*, announcement_stats, member_refund_set, member_consent_set, mobile_key_assign, starter_pack_claim/clawback, demand_*, create/select_search_profile, signup_source_facts)
- Relation embeds and their FKs: leads→funnels (leads_funnel_id_fkey), marketplace_deals→deal_reactions (deal_reactions_deal_id_fkey) exist in the dump
- Column-level grants vs session-client writes: the only non-service-role updates on profiles are last_seen_at, market_goals(+_updated_at) and monday_item_id, all in the grant list (schema.sql:432-443); tables with 'revoke all from authenticated' (marketplace_deals, deal_opens, team_*, sourcing_missed, deal_reactions, checklist_steps, notification_sends, deal_alerts, sms_*, activity_*, pipeline_*) are touched only through createAdminClient()
- Types: numeric(14,4) pence columns (credit_*, deal_opens, *_daily_charges, provider_calls.base/charged/raw, analysis_purchases, sourcing_sent) come back as JSON numbers and no Number.isInteger/parseInt guard rejects fractions; integer columns are written rounded or preset-validated (provider_calls.cost_pence Math.round, subscription_events.mrr_pence monthlyPence rounds, auto_topup_threshold Math.round, auto_topup_amount validated against presets, credit_codes.amount_pence Math.round, meta_conversions.value_pence from Stripe integer amounts)
- profiles.plan CHECK (plan in ('free','pro')): every write in src is 'free' or 'pro'
- Timestamps compared as strings: only calibrate-run.ts:360/367 compares started_at strings, both sides from the same marketplace_runs rows; all other time filters are server-side .gte/.lt on ISO strings
- jsonb read as text: no JSON.parse of a row field anywhere in src; jsonb columns (market_goals, about_you, deal, screening, snapshot, stats, extras, payload) are used as objects
- 'Read but never written' scan: every column that looked select-only (marketplace_deals outcode/town/raw_type/tenure/suitability/listed_date/reduced_at/last_*/revived_*, checked_listings.listing_status, deal_opens.status_at_open, profiles.current_period_end/cancel_reason_comment/sms_*, sourcing_missed.need_pence, member_attribution.fbclid_at, meta_conversions.server_http, subscription_events.mrr_pence/reason_comment, sms_contacts.consent_source, stripe_events.received_at) is written by a patch/builder (recordColumns, priceChangeColumns, applyLiveResult, notificationPatch, missedRowFor, attributionRow, setStatus, row()) or a default
- Tables with no .from() in src (credit_allocations, credit_reservations, credit_code_redemptions, bulk_job_rows, activity_visits/meta, profile_daily_charges is used via a variable table name, member_refunds, member_active_days(_state), member_engaged_days, monday_funnel_lock, airbtics_report_cache, admin_users, admin_password_resets, pipeline_* via constants) are written and read by SQL functions or through constants
- Dynamic-table chains (.from(table) in daily-deals-server, mortgage-backfill-run loadPending, profiles/deal-tags tagMap, admin/next-steps, my-deals/next-step-actions, pipeline/events, pipeline/server, activity/admin-server builder-in-variable) resolved by hand

**B · double charge** (17)

- credit_grant idempotency
- Daily deals charge (per profile) across three sourcing passes and the digest
- Daily email once-only
- Deal open (Quick look) double tap
- Full analysis and PMI add-on
- Starter pack (checkout.session.completed and payment_intent.succeeded both arriving, plus the one-click route)
- Welcome credit and the schema backfill
- Referral and promo codes
- Auto top-up
- One-click Starter subscription (low-credit decision)
- Upgrade difference and subscription end
- Team seat renewal and invite accept
- Reservation timeout and overdraft
- Meter and refunds
- House spend (project checks, demand searches, funnel caps)
- Credit sweep re-run
- stripe_events claim failure other than a duplicate

**B · wrong member / should not charge** (17)

- Team members spend the owner's credit on every metered door
- Suspended seats cannot spend
- Team-seat double charge
- Saved profiles profile_id vs user_id
- Token links act without charging
- Webhook idempotency and retries
- Top-up / pack / subscription mapping to the member
- Dry runs write nothing
- Picks stop the same day for inactivity or credit
- Pack buyer and the profile £5
- Welcome-credit abuse checks
- Prices read from billing_settings / unit_costs
- Stripe price vs setting for the pack
- credit_spend_rate SQL fallback 1.5 vs TS 1.3
- Auto top-up threshold default
- Admins and @stayful.co.uk accounts
- Paused subscriptions

**B · CREDIT_ENFORCE & gates** (11)

- Admin accounts (ADMIN_EMAILS) never blocked or charged on the flip
- Demand and house paths never read a member's balance
- Team members of an owner at £0
- Paused plans keep their credit
- Free members' 48h feed, the Today page and the welcome quiz
- Explorer and PDFs
- Members mid-reservation when the flag flips
- Pack grant amount and idempotency
- Public/funnel endpoints are unaffected by the flip
- Default-off switches hide no member charge
- Mechanical checks

**B · Stripe webhook** (17)

- Listed vs handled events
- stripe_events recorded before handling; retry of a half-done handler
- Pack: checkout.session.completed vs payment_intent.amount_capturable_updated vs payment_intent.succeeded (order not guaranteed)
- Top-up: checkout.session.completed vs payment_intent.succeeded vs the one-click route vs auto top-up
- invoice.paid vs invoice.payment_succeeded
- Total paid counts a redelivered payment once and subtracts refunds
- Batch 19 Meta CAPI inside the webhook
- Batch 20 Monday inside the webhook
- Churn log / activity log inside the webhook
- Billing emails inside the webhook
- STRIPE_WEBHOOK_SECRET2 and the signature check
- Mapping a payment to a member
- Late customer.subscription.deleted for a superseded subscription
- Manual plans
- Pack refund/dispute
- Refund of a subscription invoice
- Webhook unit tests

**B · Batch 20 starter pack & payments** (14)

- Price check: the route refuses to sell when the Stripe price is not a one-off GBP price equal to starter_pack_price_pence (src/app/api/billing/starter-pack/route.ts:41-47,73-77); the one-click path charges the setting's amount directly (route.ts:104).
- Two checkouts / double buy: the claim is made after authorisation and before capture (starter_pack_claim, schema.sql:5259-5296, serialised on the profile row and the partial unique indexes); a second PaymentIntent is blocked ('account'/'race') and cancelled, never charged (grant-server.ts:144-152); a repeat captured by hand becomes a plain £10 top-up (grant-server.ts:194-197).
- Card hold never counted in Total paid: paymentFromIntent returns null while amount_received is 0 (payments/rules.ts:57-58); checkout.session.completed records a payment only for kind 'topup' (webhook.ts:417-423); a released hold's charge.refunded is skipped (webhook.ts:293, 348).
- Redelivered payment_intent.succeeded, route+webhook, Checkout+PaymentIntent: member_payments keyed by pi:/inv: with ignoreDuplicates (payments/server.ts:30-35); grants idempotent on source_ref (schema.sql:889-891, unique index 547).
- Refund and partial refund: member_refund_set keeps the largest cumulative amount_refunded (schema.sql:5376-5389); the pack clawback takes the same share, cumulatively, under the row lock (rules.ts:145-149; schema.sql:5306-5327); a refund arriving before the grant nets to zero.
- Subscription invoices and top-ups in Total paid: invoice.paid → inv:<id> with the invoice's PaymentIntent for refund matching (webhook.ts:466-478); top-ups → pi:<id> from either the route or the webhook (topup/route.ts:72; webhook.ts:462).
- Existing members never lose credit, never see the pack, never get both: packOffer returns existing_member when created before the cutover or a welcome:<id> grant exists (rules.ts:46-47); ensureWelcomeGrant grants only when the account is not a pack account and postpones when the cutover cannot be read (welcome.ts:69-81); no path debits an existing member's credit except a pack refund clawback.
- Cutover moved later or cleared: strandedByCutoverMove + reopenWelcomeCheck clear welcome_checked_at only for accounts with neither a welcome grant nor a reserved/granted pack, before and after the save (settings-server.ts:38-67; admin/lifecycle/actions.ts:41-58); moved earlier: nothing changes and accounts with the £20 are never offered the pack.
- Welcome backfill freeze: schema.sql:1006 limits the backfill to accounts created before 2026-09-13; three runs on a fresh Postgres were identical.
- £5 decision cadence: once per 30 days via last_low_balance_email_at (low-credit.ts:27,61-62), stamped only after a successful send (picks-run.ts:1539; digest-run.ts:379; low-credit-server.ts:166); inside the picks/digest daily email, or alone in the capped 'low_credit' daily slot (cap.ts:24-31; low-credit-server.ts:151), alone from a debit only from 08:30 UTC (low-credit.ts:72-76; after-debit.ts:94).
- /account/billing/choose charges only when confirmed: the page is a plain GET (choose/page.tsx); Starter is POST /api/billing/subscribe with a per-attempt nonce idempotency key and a Stripe-side live-plan check before creating (subscribe/route.ts:78-96); the £10 top-up is POST /api/billing/topup (STRIPE_PRICE_TOPUP_1000 via Checkout, or a 1000p PaymentIntent on the saved card) with a nonce (topup/route.ts:41,66).
- One eligibility rule: every surface reads starterPackStateFor → packOffer (starter-pack/server.ts:307-317); after purchase starter_pack_bought_at is stamped once (grant-server.ts:164) and the granted row blocks by account, email and number; 'Not now' on Today only sets starter_pack_snoozed_until (rules.ts:56-64) and every other surface, plus ?offer=pack, stays open.
- A prior top-up does not block the pack: accountStatus treats only a live/manual plan as 'paid' (access.ts:160-180), and onPlan is paid/subscription_trial/paused (starter-pack/server.ts:314).
- Batch 20 settings seeded with on conflict do nothing (schema.sql:5193-5203); the pack is off until starter_pack_from is set; every pack read fails closed to 'off' (starter-pack/server.ts:287-304,330-345).

**C · 48-hour delay** (13)

- Delay defined once
- Pack buyer is paid for the delay (Batch 20)
- Team members
- Per profile or per member
- Tier read failure
- live_since integrity
- Early-access banner and badge
- Unit tests
- Counts vs grid cutoff
- Extension, /api/v1, PDFs
- SMS and email alerts
- Expiry vs window
- Act fast on delayed deals

**C · addresses, postcodes, links** (17)

- Card column rule
- Deal page RSC payload
- /d/<token> share
- Emails
- SMS
- Meta
- Monday rows
- Activity log
- Photo route
- Explorer map
- Welcome sample deals and tailoring widen
- My deals / deal_alerts
- JSON APIs and MCP
- RLS
- Project deals
- Sitemap / robots
- Twilio logs

**C · cross-member access** (16)

- Admin routes behind an admin check, not just a signed-in check
- Internal routes require the secret
- Reports (/reports/[id], PMI add-on, deleteReport, v1 reports)
- Deal actions and project figures
- Saved profiles by id
- Token pages entropy
- Share pages expose nothing about the sharer
- Feedback
- Extension and v1 API
- Teams: removed member and shared reports
- Leads and funnels by id / CSV export / lead report page
- Presence, consent, attribution, tracking
- Twilio and Stripe webhooks
- Open redirects
- Server actions exported from 'use server' files
- Public marketing deals page

**C · funnel pages (white label)** (22)

- Cookie banner on /f and /r
- Meta pixel / CAPI on funnel pages
- Consent records for funnel visitors
- Email time-on-site beacon on funnels
- CompleteRegistration for lead-form members
- FirstReport / activity for funnel runs
- Members' Monday board vs customers' CRM
- leads vs profiles separation
- Weekly-active base and demand-sourcing member count
- LEAD_ACTIVATION_WEBHOOK_URL flow
- Funnel-queue dry run
- Lead-retention dry run and purge
- completeLead double-charge guard (Batches 10-20)
- Address autocomplete billed to funnel owner
- PDF chrome, document properties, logo fallback, booking QR
- Fonts and asset URLs
- Turnstile
- RSC payload of FunnelMode
- Lead report email body
- CompetitorsPanel 'a recent Stayful report' line
- Preview spends nothing
- npm test

**D · crons** (13)

- Auth on all 23 cron routes
- dry=1 writes nothing (21 routes that have it)
- credit-sweep and crm-deliveries have no dry
- Notification slot claim
- Daily-deals charge guard
- Locks with lease expiry
- deal-alerts idempotency and pacing
- Morning chain 06:55 → 07:00/20/40 → 08:00 → 08:10
- sms-alerts vs deal-alerts :40
- activity-retention 02:35 vs monday-funnel nightly
- Time budgets present
- Recheck jobs paging large tables
- Mechanical logs

**D · the one-message-a-day cap** (13)

- Monday second slot
- Letter vs digest on one morning
- Your week + daily email + text on a Monday
- Nothing-to-say sends never burn a slot
- Idempotency key = slot on every capped send
- Time zone of the cap vs the crons
- Inactivity letter timing
- Feedback, receipts, billing, team, funnel and lead emails outside the cap
- Pricing notice outside the cap
- SMS cap and quiet hours
- One-click unsubscribe
- Supabase auth emails
- No hidden senders

**D · unsubscribe, settings and Monday Email OK / SMS OK** (17)

- Every capped member email reads its registry switch before sending, and the dry run reads the same switch as the real run
- 'Changes on deals I'm tracking' vs the SMS collector
- Unsubscribe mechanism: RFC 8058 one-click POST plus a side-effect-free GET confirm page, token per send, switches behind each email
- STOP switches every account on that number off at once; START restores; HELP replies; a repeat MessageSid is harmless; everything signature-checked
- A number that replied STOP gets no verification code; a STOP after the code wins over the code; a number verified elsewhere is refused
- Verified-number requirement and SMS_ALERTS_ENABLED
- SMS and email daily slots cannot block each other
- An unsubscribe click is not engaging; a click through to the site is
- Email OK truth table for the brief's cases
- SMS OK truth table for the brief's cases
- The older sign-up row and the funnel sync never write the same item with different values
- Race between the queue drain and the nightly
- Senders that read no switch are transactional or service notices
- Picks-paused letter without a slot row degrades to no List-Unsubscribe header
- SMS OK degrades to false when sms_contacts cannot be read
- Every outbound text carries the opt-out line and is one GSM-7 segment
- Mechanical: the rule tests behind these checks pass

**E · member actions inventory** (16)

- No code writes activity_events, activity_visits or member_engaged_days except through the activity_log / activity_visit_touch RPCs and the SQL backfill/sync functions
- Heartbeat view paths match the real routes
- Top-up, auto top-up and starter pack are logged once whether the route or the webhook lands first
- deal_open is one event per member and deal across Quick look and Full analysis
- full_analysis, pmi_addon, report_run and api_report are logged once, after the member has the result
- Keep / Pass / undo / pass reasons are each one event with the profile id
- stage_move is logged once per path (dropdown, next-step advance, open-with-stage, Explorer) and the My deals enquiry is logged once as next_step, not also management_enquiry
- Server-render logs (profile_viewed, *_shown, starter_pack_shown) cannot be triggered by link prefetch
- Unsubscribes never count as engagement
- Record-only kinds are deduped so a page reload does not pile up rows
- Extras never carry an address, postcode or link
- The 60 s double-submit window only applies to calls without a dedupe key and compares kind, deal and extras against the member's latest row
- The nightly and the admin page use the same kind lists from kinds.ts
- Mail scanners cannot switch profiles or answer teasers
- npm test passes with the activity suites
- SMS alert links carry the marker

**E · what must not count** (18)

- Email opens
- /api/track and /api/tracking/*
- Crons and background jobs
- Auto top-up
- Monday syncs, backfills, retention, listing recheck
- Admin actions
- Record-only kinds
- Heartbeat beats
- Unsubscribe links
- SMS click
- Dedupe keys
- Monday Excluded group
- Team members in weekly active
- Admin/staff matching consistency
- Server-render logs vs prefetch
- Signed-in only presence
- README example accounts
- Tests

**E · one definition & inactivity** (15)

- One list of qualifying kinds
- Same week and day rule in TS and SQL
- /admin/signups does not use last_sign_in_at as 'active'
- A paying subscriber is never moved to Re-engage or paused
- Acting today cannot leave a member paused tonight
- Pause stops the daily charge
- Pause does not survive a payment
- Away letter capped
- Unsubscribe is not engagement
- inactivity_from empty = rules off
- Team member handling is consistent with its documentation
- Monday Excluded group never entered or left
- Re-engage since is cleared on the board when they come back
- Nightly ordering against the picks run
- n8n Re-engage trigger

**F · the nav** (10)

- src/lib/nav.ts + nav.test.ts
- Funnel-owner rule
- Same items and order on desktop and mobile
- Every AppShell layout (today, deals, my-deals, reports, picks, estimate, account, profile, profiles, leads)
- Admin pages leaking into members' nav
- Funnel pages /f/[token]
- Header pill / Usage chip / Feedback button are not nav items
- Welcome quiz gating
- Public token pages (/d, /r, /p, /p/d, /deal/[token])
- Mechanical logs

**F · orphans and dead links** (14)

- Batch 4/5/11 redirects still exist and work
- Token pages exist
- Email links survive sign-out on proxied prefixes
- Query params in links are read by their pages
- Anchors exist
- Area links by postcode code resolve
- Static asset literals all present
- OpenAPI paths have routes
- next.config redirects
- Chrome extension links resolve
- Admin dynamic routes
- Sitemap/robots consistency
- Mechanical logs
- Sourcing cron does not send the dead sourcingEmail

**F · duplicates** (15)

- Mortgage maths is one function
- Credit balance is one number
- Weekly active is one definition
- 48-hour rule
- Listing URL parsing
- Consent source
- Internal secret
- Daily email builders
- Your-week recap and My deals
- Deal tier vs Monday on pack buyers
- billing_settings shared keys
- Two low-balance emails
- Today card vs My deals row
- Two Monday integrations
- postcodeAreaOf callers

**G · env vars & secrets** (17)

- Fail-open: Twilio webhooks
- Fail-open: Stripe webhook
- Fail-open: internal routes
- Fail-open: DEALS_PHOTO_SECRET / EXTENSION_IDS / ADMIN_EMAILS / CALIBRATION_BYPASS_SECRET
- Switch defaults vs .env.example
- Server env inside 'use client' files
- Server → client props / RSC payload
- next.config.ts and extension bundle
- Hardcoded secrets / committed env files
- Secrets in logs
- Error messages returned to the browser
- Admin pages echoing config
- Photo URL signing and PDF generation
- Turnstile
- MONDAY_API_KEY vs MONDAY_API_TOKEN fallback
- Indirect env reads
- Mechanical logs

**G · TODOs and failure modes** (20)

- cookies()/headers()/draftMode() without await
- middleware vs proxy (Next 16.2.1)
- 'use cache' / cacheComponents / unstable_cache
- export const revalidate on member pages
- Build / typecheck / tests / lint
- Stripe webhook when Supabase is down
- Stripe webhook when Monday is down
- Monday from member paths
- Meta CAPI
- Turnstile
- Twilio
- PMI / PropertyData / PriceLabs / PlanIt / listing-page fetches
- Credit meter on RPC failure
- Full analysis reservation release
- Deal open charge when the listing has gone
- Starter pack paid-but-ungranted
- Swallowed catches on member paths
- Route handlers leaking stacks
- Cron routes
- Schema re-run

**G · tests, lint, build, audit** (20)

- npm run typecheck
- npm run build
- npm test totals
- ESLint errors
- Tests and the live database
- Tests and the network
- Golden test (today/choose.test.ts)
- Env-mutating tests
- Stripe webhook signature and secrets
- Stripe webhook handler event coverage
- ACCESS_COLUMNS
- Email cap rules
- 48-hour delay rules
- Inactivity precedence, activity kinds, weekly-active computation, Monday values, Meta event mapping, consent rules, nav, pipeline merge
- Middleware/proxy bypass advisories
- Supabase realtime / ws
- MCP SDK express/hono paths
- CI
- Random in tests
- Timing-based tests

### G. Inventories

The tables the brief asked for, as the readers returned them (file:line references are to origin/main at 91c76c2).

#### Stripe events

_B · Stripe webhook_

| event | in .env.example | handled where | effect | idempotency | Meta/Monday inside? | verdict |
|---|---|---|---|---|---|---|
| checkout.session.completed | yes | webhook.ts 361–441 | subscription mode: links customer + subscription, plan/status/period/started_at, plan_source, terms_accepted_at, churn 'started', Monday queued; credit waits for invoice.paid. payment mode: saves card; top-up → grantTopup `pi:<pi>`, activity, Meta Purchase, Total paid row; starter pack → settleStarterPack (claim once per person, capture or cancel) | stripe_events id claimed before handling; grant idempotent on source_ref; settle idempotent (claim RPC by PI, capture/cancel with idempotency keys) | Meta Purchase (try/catch, CAPI capped 3 s); Monday = DB enqueue only | OK. Grants a top-up without checking payment_status (F: delayed methods); 'no user' answered 200 (F: one() swallows errors) |
| invoice.paid | yes | webhook.ts 463–546 | Total paid row `inv:<id>`; profile plan/status/period/customer; churn 'recovered' if it was past_due; billing_reason create/cycle/manual/null → grantPlanCycle `inv:<id>` (annual: `annual:<sub>:<YYYY-MM>`, first month only, sweep does the rest); subscription_update → grantUpgradeDifference; Meta Subscribe (first paid invoice, once per member) | claim; grant idempotent on source_ref; Total paid ignoreDuplicates; Subscribe keyed per user | Meta Subscribe; Monday enqueue (payment row, grant, churn log) | Concurrent duplicate can expire the fresh grant (F); no email fallback → Payment Link subscriber lost (F); relies on 2025-03+ payload shape (F); £0 invoice grants full credit (F) |
| invoice.payment_failed | yes | webhook.ts 665–687 | stripe_subscription_status 'past_due'; paymentFailedEmail (awaited, never throws); churn 'past_due' once per episode | claim; profile write idempotent; email re-sent on a retry | Monday enqueue ('payment_failed') | OK; a non-subscription invoice also marks past_due (F) |
| customer.subscription.created | yes | webhook.ts 551–661 | links a subscription made by hand; mirrors status/period/pause/cancel columns; churn 'started' (source manual if plan_source manual) | claim; state re-derived in full from the object | Monday enqueue | OK; status 'incomplete' treated as ended (F) |
| customer.subscription.updated | yes | same branch | pause / resume / scheduled cancel / un-cancel / plan change mirrored; churn paused/resumed/cancel_scheduled/cancel_reverted/plan_changed/recovered logged only on a state CHANGE vs the row | claim; re-derived state; change-detection prevents duplicate churn rows | Monday enqueue | OK |
| customer.subscription.deleted | yes | same branch | plan → free (kept if plan_source manual), plan_code null, expirePlanGrants, subscription_ended_at, churn 'ended' with reason (self-serve → portal feedback → payment_failed); ignored when the customer still has a live subscription (plan switch) | claim; expire idempotent | Monday enqueue | OK |
| payment_intent.succeeded | yes | webhook.ts 447–462 (top-up); 309–337 handleStarterPackPaid (pack) | top-up (metadata.kind=topup): saves card, grantTopup `pi:<pi>` (also done by the one-click route / auto top-up: same key), activity `topup:pi:<pi>`, Meta Purchase (not for auto), Total paid `pi:<pi>`. pack: grantStarterPack (`pi:<pi>` + `pack_bonus:<pi>`), receipt + Monday once (reserved→granted CAS), activity, Meta Purchase, Total paid; a repeat charged anyway becomes a plain top-up. Subscription-invoice PIs ignored | grants idempotent under the profile row lock; activity/Meta/Total paid keyed on the PI | Meta Purchase; Monday enqueue | OK; 'no user' answered 200 (F) |
| payment_intent.amount_capturable_updated | yes | webhook.ts 440–446 | pack only: settleStarterPack (claim; capture a first pack / cancel a repeat) | idempotent (claim RPC, idempotency keys) | none (Monday only later, on grant) | OK |
| payment_intent.canceled | yes | same branch | pack only: settle → PI canceled → claim row marked failed (member may try again) | idempotent | none | OK |
| payment_method.attached | yes | webhook.ts 688–696 | saves the PM as the member's one-click card and the customer's default | idempotent | none | OK |
| charge.refunded | yes | webhook.ts 698–715 | Total paid: member_refund_set (cumulative, greatest) for any charge; pack: cumulative clawback of the credit share (starter_pack_clawback); top-up: −amount_refunded once under `pi:<pi>:refunded`; released authorisation (captured=false) ignored | refund row idempotent; pack clawback cumulative; top-up clawback keyed ONCE | Monday enqueue ('refund') from recordRefund / pack clawback | Second partial refund of a top-up never clawed back (F); VAT-inclusive clawback vs ex-VAT grant (F); PI fetched twice, lenient second (F) |
| charge.dispute.created | yes | same branch | pack: clawback of dispute.amount share; top-up: −dispute.amount under `pi:<pi>:disputed`; NOT written to member_refunds | idempotent per reason | Monday enqueue on the pack path only; none on the top-up path | Won dispute never restored — no charge.dispute.closed (F); not taken off Total paid despite the .env.example claim (F) |
| charge.dispute.closed / charge.dispute.funds_withdrawn | no | not handled (default: ignored) | — | — | — | Not sent, not handled: outcome of a dispute is never learned |
| checkout.session.async_payment_succeeded / async_payment_failed | no | not handled | — | — | — | Not sent, not handled: matters only if a delayed-notification payment method is enabled |
| invoice.payment_succeeded | no | not handled | — | — | — | Correct: invoice.paid is the one subscribed, so no double grant |
| payment_intent.payment_failed | no | not handled | — | — | — | One-click failures are handled synchronously in the routes; fine |

Listed vs handled: the 12 events in .env.example (README says twelve) are exactly the 12 `case`s in handleStripeEvent; no handled event is missing from the list and no listed event is unhandled. Recording order: the event id is inserted into stripe_events BEFORE handling; `processed_at` is written only after the handler returns; a throw leaves processed_at null and answers 500, so Stripe's retry re-runs the handler (route.ts 41–65). A handler that returns `handled:false` is stamped processed just like a success — that is what turns every 'no user' and 'not a …' answer into a permanent drop.

#### Credit paths

_B · double charge_

| path | where charged | amount source | once-only mechanism | double-tap | retry | redelivery | cron re-run | verdict |
|---|---|---|---|---|---|---|---|---|
| Daily deals day (Today's 5), per running profile | src/lib/listing/daily-deals-server.ts:78-96 from picks-run.ts:1581 and digest-run.ts:386 | billing_settings.todays_5_daily_pence (default 33) | guard row inserted BEFORE debit: profile_daily_charges PK (profile_id, day) / daily_deal_charges PK (user_id, day); email slot claim_notification_slot + Resend key sendKey('daily',user,day); charged only after res.sent | n/a | n/a | n/a | 07:00/07:20/07:40 passes and 08:10 digest share the key; runs abort if team lookup fails | OK |
| Daily pick price (pre-new-pricing per-pick mode) | src/lib/listing/picks-run.ts:1558 | pmi daily_pick unit cost × markup, or deal_open ladder (priceOf) | sourcing_sent unique (user_id, canonical_url); debit after send keyed action_id = row id; reset to 0 on failure | n/a | n/a | n/a | later passes skip members sent today (line 334) and slot_used | OK |
| Quick look / deal open | src/lib/marketplace/open.ts:167-190 | billing_settings.deal_open_ladder (openPricePence) | deal_opens unique (user_id, canonical_url) pending row before debit; actionAlreadyCharged on recovery; 5-min in-flight window; refund if retired before flip | second tab gets already-open or 'failed' | crash recovery flips, no second debit | n/a | n/a | OK (Low: stale pending row race) |
| Full analysis (feed deal) | src/lib/analysis/deal-analysis.ts:322-340 claim, 377 reserve, 601 debit | billing_settings.full_analysis_pence less open credit; pmi_addon_pence | analysis_purchases_running_uidx (user, deal) pending; run_started_at taken once; readableReportFor refuses a re-sale; charged only after the report is saved; 15-min hold released | 'running' | stale purchase settled (3 min / run window) | n/a | n/a | OK |
| PMI second opinion (on a report) | src/lib/analysis/pmi-addon.ts:116-121 claim, 134 reserve, 204 debit | billing_settings.pmi_addon_pence | analysis_purchases_pmi_running_uidx (report_id) pending; saved_searches update only where result->>secondOpinion is null | 'running' / already_done | stale claim released | n/a | n/a | OK |
| Address report (/estimate → /api/analyse) | src/app/api/analyse/route.ts:131 claim, 158 reserve; per-call debit src/lib/credit/meter.ts:167 | unit_costs × markup (estimateAction worst case) | checked_listings.report_started_at claim ONLY with a pipeline row; reservation; refundAction on failure/unsaved; report_run activity keyed on actionId | with a pipeline row: 409 report_running; plain address: none | dropped stream → server finishes via after() and charges; a retry charges again | n/a | n/a | Medium (plain address) |
| API v1 report | src/app/api/v1/analyse/route.ts:47 | same, standard markup, requireCredit | reservation only | n/a | a client retry is a second charged run (documented API behaviour) | n/a | n/a | OK (expected) |
| Quick view (paste box, extension /api/ext/check) | src/lib/listing/server.ts:141 | unit costs (quick_view estimate) | reservation; broker cache hits never charged; LISTING_RESOLVES_PER_DAY cap | cache | cache | n/a | n/a | OK |
| Funnel lead report (public) | src/lib/funnels/caps.ts:70 funnel_spend_reserve + /api/analyse with funnelId, requireCredit | owner's credit at ×2 markup; daily cap | reserve/settle upsert; Turnstile single-use token; IP throttle | n/a | a lead's retry is another run (by design) | n/a | n/a | OK |
| Starter pack (£10 → credit) | src/lib/starter-pack/grant-server.ts:203-204; SQL starter_pack_claim (schema.sql 5259) | billing_settings.starter_pack_price_pence / starter_pack_credit_pence | starter_pack_purchases PK on PaymentIntent + partial unique on user/email/mobile/card under profile lock; manual capture with idempotency keys; grants keyed pi:<id> and pack_bonus:<id>; status move .eq('status','reserved') | nonce per mount; Stripe idempotencyKey | route failure after capture returns ok/pending, webhook completes | checkout.session.completed, amount_capturable_updated, payment_intent.succeeded all safe | n/a | OK |
| Starter pack clawback (refund/dispute) | src/lib/starter-pack/grant-server.ts:249-273; SQL starter_pack_clawback | packClawbackPence share of credit | cumulative under profile lock, keyed base and base:<refunded> | n/a | n/a | idempotent | n/a | OK |
| Welcome credit (£20, pre-cutover accounts) | src/lib/credit/welcome.ts:81 | billing_settings.welcome_grant_pence | credit_grants unique source_ref welcome:<user>; welcome_checked_at stamp; pack accounts skipped; schema backfill frozen to created_at < 2026-09-13 | idempotent | idempotent | n/a | n/a | OK |
| Profile-complete £5 | src/lib/profile/server.ts:338 | billing_settings.profile_complete_pence | source_ref profile_complete:<user>; profile_quiz.credit_grant_id | idempotent | idempotent | n/a | n/a | OK |
| First-week checklist £1s | src/lib/today/checklist-server.ts:117 | STEP_REWARD_PENCE (hard-coded) | source_ref checklist:<step>:<user> | idempotent | idempotent | n/a | n/a | OK |
| Promo / referral code (redeemer and owner) | SQL credit_redeem_code (schema.sql 952) via src/app/api/billing/redeem/route.ts:32 and welcome.ts:102 (sf_ref cookie) | credit_codes.amount_pence; billing_settings.referral_pence for the owner | PK (code, user_id) on credit_code_redemptions under profile + code locks; one referral per account; grants keyed code:<code>:<user> / referral:<code>:<user> | code_already_used | same | n/a | n/a | OK |
| Top-up via Checkout | webhook.ts:452 (checkout.session.completed) and 483 (payment_intent.succeeded) → src/lib/stripe/grants.ts:74-97 | PI metadata amount_pence (topup presets) | credit_grant idempotent on pi:<id> (unique index) | n/a | n/a | credit once; receipt email, reinstateSeats and funnel sync run per delivery that passes the non-atomic read | n/a | Medium (side effects) |
| Top-up one click (saved card) | src/app/api/billing/topup/route.ts:55-70 | topupPresetsPence | Stripe idempotencyKey topup:<user>:<nonce>; grant pi:<id> | button disabled while busy, but nonce is per click (TopupButtons.tsx:23) | post-charge error falls through to Checkout or 'try again' with a new nonce → second charge | webhook grant is a replay | n/a | High |
| Auto top-up | src/lib/stripe/auto-topup.ts:35-54 | profiles.auto_topup_amount_pence / threshold | auto_topup_last_at 10-min claim by conditional update; Stripe key autotopup:<user>:<minute>; grant pi:<id>; decline switches it off | n/a | n/a | webhook grant is a replay | n/a | OK |
| Plan cycle credit (invoice.paid) | webhook.ts:536-540 → src/lib/stripe/grants.ts:30-48 | billing_plans.monthly_credit_pence or billing_settings.plan_credit_pence (planCreditFor) | source_ref inv:<invoice> (annual:<sub>:<YYYY-MM>); check → expire → grant are three separate calls; stripe_events claim lets an in-flight duplicate through | n/a | n/a | sequential replay OK; CONCURRENT duplicate can zero the new grant | n/a | Critical |
| Upgrade difference (subscription_update invoice) | src/lib/stripe/grants.ts:56-72 | planCreditFor(to) minus plan grants already granted this period | source_ref inv:<invoice>; recomputed from granted rows | n/a | n/a | replay grants 0 | n/a | OK |
| Annual monthly slots | src/app/api/internal/credit-sweep/route.ts:40 → grants.ts:104-129 | planCreditFor(pro_annual) | source_ref annual:<sub>:<YYYY-MM> | n/a | n/a | n/a | re-run same day: same key, once; but keys collide for 29th-31st starts → months skipped | High |
| Subscription ended → plan credit expired | webhook.ts:597 expirePlanGrants | n/a | zeroing is idempotent; listSubscriptions guard against a late delete | n/a | n/a | idempotent | n/a | OK |
| Top-up refund / dispute clawback | src/lib/stripe/deps.ts:88-93 | charge.amount_refunded or dispute.amount | source_ref pi:<id>:refunded / :disputed | n/a | n/a | replay refused; a second PARTIAL refund also refused | n/a | Low |
| Team seat £10 / 30 days (accept, renew) | src/lib/team/seats.ts:30-52; SQL credit_debit_face (schema.sql 1815) | SEAT_PRICE_PENCE = 1000 (hard-coded) | team_seat_charges unique (member_id, period_start) inserted before debit; renew uses period_start = seat_paid_until; accept guarded by team_members insert | 23505 → already_paid | claim row deleted on debit failure | n/a | hourly cron: deterministic key | OK |
| Team seat reinstatement | src/lib/team/seats.ts:174 (periodStart: now) | SEAT_PRICE_PENCE | same unique key but period_start = now (not deterministic) | n/a | n/a | two top-up deliveries → two reinstates → two charges | top-up + hourly cron can overlap | High (race) |
| £5 low-credit decision (Starter / £10 top-up) | src/app/account/billing/choose → /api/billing/subscribe (route.ts:86-97) and /api/billing/topup | decisionOffer: Starter price; topup preset 1000 | subscribe: nonce per mount, Stripe key subscribe:<user>:<plan>:<nonce>, subscriptions.list HOLDS_A_PLAN guard; email links never charge (confirm page) | disabled while busy | subscribe OK; top-up as above | n/a | notice sent once per 30-day cycle (last_low_balance_email_at) | OK (top-up: see above) |
| Admin adjustment | src/app/admin/billing/actions.ts:153 | form pence | source_ref admin:<email>:<Date.now()> — not idempotent | double submit grants twice | same | n/a | n/a | Low (admin) |
| Project deals: photo checks / sold prices (Batch 17) | src/lib/project/check-run.ts:567 project_claim_check, 584 runMetered userId null | house spend under deal_checks cap (projectCapPence) | pg_advisory_xact_lock + (canonical_url, check_day) claim at worst case; member's working is free | n/a | n/a | n/a | overlapping passes serialised by the lock | OK |
| Demand searches | SQL demand_search_reserve (schema.sql 4102) from src/lib/sourcing-demand/run.ts | house spend under billing_settings.demand_monthly_cap_pence | advisory lock + demand_searches_daily_uidx (day, area, kind) | n/a | n/a | n/a | 5-6am passes serialised; duplicate refused | OK |
| Geocode when placing a home postcode | src/lib/profile/server.ts:306 | unit cost (google geocode) | meter preflight; pennies | n/a | n/a | n/a | n/a | OK |

#### Gates by CREDIT_ENFORCE

_B · CREDIT_ENFORCE & gates_

| gate | file:line | today (false) | when true | who is blocked wrongly |
|---|---|---|---|---|
| isEnforcing() itself | src/lib/credit/http.ts:22 | `process.env.CREDIT_ENFORCE === 'true'` else shadow | — | — |
| Reservation at the start of every metered action: address reports (/api/analyse:158), quick view (/api/listing/resolve:37, /api/listing/quick-estimate:44, /api/ext/check:44), narrate (/api/summarise:113), speak (/api/speak:47), autocomplete (member) | src/lib/credit/action.ts:56 | InsufficientCreditError logged, action runs, debits overdraft (meter.ts:171 allowNegative) | throws → 402 insufficient_credit → out-of-credit modal (client.ts:39) | members with a shadow-mode overdraft (no sweep: credit-sweep/route.ts:30-53); non-admin @stayful accounts; team members of a £0 owner get 'Ask the account owner' (by design) |
| Per-call meter preflight (unreserved calls with a known quantity) | src/lib/credit/meter.ts:124 | skipped | throws when base price > spendable | listing-recheck cron page fetch crashes the run (finding 3); a shadow run without a reservation that straddles the redeploy fails mid-run |
| /api/credit/estimate `sufficient` → client preflight() modal before /estimate Run and the PMI card | src/app/api/credit/estimate/route.ts:43 | always sufficient (no modal) | modal when spendable < worst case | overdrawn members; admins exempt |
| Quick look (openDeal) balance pre-check | src/lib/marketplace/open.ts:96 | skipped; debit at :188 allowNegative | insufficient_credit → deal page message / pack offer (deals/[id]/page.tsx:138) | overdrawn members; pool picks already open are unaffected |
| Full analysis pre-check and hold | src/lib/analysis/deal-analysis.ts:308, 379 | skipped; run unheld; final charge allowNegative (:601) | 402 → modal | overdrawn members; team of a £0 owner |
| PMI second opinion | src/lib/analysis/pmi-addon.ts:93, 138 | skipped | 402 | same |
| Airbnb tracked-listing refresh in the recheck | src/app/api/internal/listing-recheck/route.ts:193 | refreshed and charged even at ≤ £0 | skipped at ≤ £0 | none (the portal page fetch at :228 has no such guard: finding 3) |
| Credit summary `enforcing` → banner copy, billing notice, admin pages | src/lib/credit/summary.ts:146; CreditBanner.tsx:56; BillingClient.tsx:82; admin/billing/page.tsx:89; starter-pack/admin-server.ts:53 | 'tracked but not enforced' notice; out banner says new usage counts against next credit | notice gone; 'You're out of credit. Top up or upgrade' | — |
| Funnel lead reports (/api/f/[token]/analyse, funnel-queue) | src/app/api/f/[token]/analyse/route.ts:158; src/app/api/internal/funnel-queue/route.ts:100 | explicit balance check + requireCredit: refuses today | unchanged | owners with a shadow overdraft: leads queue with a daily out_of_credit alert (already today) |
| Member API /api/v1/analyse and MCP analyse_property | src/app/api/v1/analyse/route.ts:43; src/lib/api/mcp-tools.ts:408 | requireCredit: 402 today | unchanged | finding 8 |
| Address autocomplete | src/app/api/address-autocomplete/route.ts:183 | requireCredit only with a funnel token; member session runs | 402 → silent empty suggestions (AddressAutocomplete.tsx:100 silent) | none |
| Daily picks / Today's 5 email (07:00 passes) | src/lib/listing/picks-run.ts:1041-1071 (PayerPurse) | withheld today when payer's spendable < 33p; sourcing_missed written | unchanged | pack-era £0 members never get the email (design); overdrawn members |
| 08:10 digest | src/lib/notify/digest-run.ts:231-244 | same purse | unchanged | same |
| 08:00 picks-paused letter | src/lib/listing/picks-paused-run.ts:213-221 | sent today when spendable < need | unchanged | — |
| Saved profiles' daily charge | src/lib/listing/daily-deals-server.ts:63-104 | charged per running profile in order; unfunded profiles named | unchanged | — |
| Team seats £10 | src/lib/team/seats.ts:43 (credit_debit_face, schema.sql:1828-1833 never overdrafts) | suspended at insufficient today | unchanged | owner with an overdraft but a positive plan grant still pays seats (debit_face ignores the overdraft grant) |
| Extension check / me | src/app/api/ext/check/route.ts:46; src/app/api/ext/me/route.ts:17 | check runs; popup already says 'out of credit' at ≤ 0 | check 402 → 'locked no_credit' (extension/src/content.ts:202) | as the reservation row |
| PDFs (deal-pdf by share token, market-pdf) | src/app/api/deal-pdf/route.tsx:12; src/app/api/market-pdf/route.tsx:17 | no credit gate (access state only) | no credit gate | none |
| Explorer /markets | src/lib/market/gate.ts:49 | no credit gate | no credit gate | none |
| Project deals | open via openDeal (row above); checks are house spend (src/lib/project/check-run.ts:584, 832) | — | — | none |
| Demand / house spend | sourcing-demand/run.ts:208; deal-quality/checks-run.ts:126; low-entry-run.ts:244; marketplace/sweep-run.ts:169; recheck-run.ts:170; market/cached.ts:43; sms/send.ts:117; picks-run.ts:642,705,1144 | runMetered userId: null, never charged | unchanged | none |
| Pack grant (£10 topup + £20 welcome) | src/lib/starter-pack/grant-server.ts:203-204; schema.sql:900-907 | granted whole, but repays any overdraft first | unchanged | overdrawn members (finding 1) |
| Out-of-credit email, £5 decision, Monday Hit zero | src/lib/credit/after-debit.ts:60-98 | all fire today | unchanged | findings 4, 5 |
| Admin bypass | src/lib/credit/meter.ts:119; action.ts:50; open.ts:95; deal-analysis.ts:308 | never charged, usage logged bypass=true | unchanged | @stayful non-admins not covered (finding 7) |

#### Pack surfaces

_B · Batch 20 starter pack & payments_

| surface | file | rule used | shows to pre-cutover member? | shows after purchase? | shows after snooze? |
|---|---|---|---|---|---|
| Welcome quiz pack screen (after the 6 mandatory questions) | src/app/welcome/page.tsx:81-82; src/app/welcome/Quiz.tsx:123-124,192-200 | starterPackStateFor(user).offer.eligible, and not editing, not a team member, mandatory questions not yet done; "Not now" only logs (packNotNowAction) | No (existing_member) | No (bought) | Yes (snooze hides only the Today card), but only while the mandatory questions are unfinished |
| Today card | src/app/today/page.tsx:88,185; src/components/starter-pack/StarterPackCard.tsx | pack.showTodayCard = eligible and not inside starter_pack_snoozed_until (rules.ts:56-60), or ?offer=pack with eligible; hidden on the ?pack=1 return | No | No | No (Yes with ?offer=pack from the letters) |
| Today purchase note (?pack=1 return from Checkout) | src/app/today/page.tsx:86,180-183 | latestPurchaseFor (last 24h) → returnMessage; no row yet reads as "on its way" | n/a | Yes: "Your £30 of credit is on your account" | n/a |
| Account → Billing "Pay as you go" line | src/app/account/billing/page.tsx:48-49,64-65; src/components/starter-pack/StarterPackLine.tsx | !plan && starterPackStateFor.offer.eligible | No | No (the credit row is relabelled "Starter pack bonus") | Yes |
| Deal page Quick look box (short of credit) | src/app/deals/[id]/page.tsx:140-142,266-271 | insufficient credit && starterPackStateFor.offer.eligible | No | No | Yes |
| Credit banner (low/out strip) | src/components/credit/CreditBanner.tsx:38-45; src/lib/team/credit.ts:26-33 | snapshot.pack = starterPackStateFor.offer.eligible for a non-team, non-admin member, when state is low or out | No | No | Yes |
| Out-of-credit dialog | src/components/credit/OutOfCreditModal.tsx:26-33,83-91 | snapshot.pack captured when the dialog opens; "Not now" only logs | No | No | Yes |
| Out-of-credit email | src/lib/credit/after-debit.ts:32-41,70-72; src/lib/email/billing.ts:55-60 | noPlan && isPackAccount(created_at) && starterPackStateFor.offer.eligible → button /today?offer=pack | No | No | Yes |
| £5 low-credit email, kind 'pack' | src/lib/credit/low-credit-server.ts:70-77; src/lib/credit/low-credit.ts:101-103 | isPackAccount && starterPackStateFor.offer.eligible (else the Starter-or-£10 decision) → /today?offer=pack | No | No | Yes |
| Picks-paused 08:00 letter | src/lib/listing/picks-paused-run.ts:230-232; src/lib/listing/picks-paused.ts:135-152 | starterPackStateFor.offer.eligible → subject/body/button /today?offer=pack instead of "Top up" | No | No | Yes |
| /account/billing/choose (email buttons' landing page) | src/app/account/billing/choose/page.tsx:55-69 | summary.noPlan && starterPackStateFor.offer.eligible shows the pack box instead of Starter/£10 | No | No | Yes |
| Inactivity re-engage letter | src/lib/inactivity/letter.ts | no pack mention | No | No | No |
| Public pages (signup, login, check-email, pricing, landing, FAQ, Market Explorer, deal pages, terms) | src/lib/starter-pack/public.ts:230-234; src/lib/starter-pack/rules.ts:165-220 | packLive(now): the cutover instant has passed; not per member | Yes (public copy: a pre-cutover member on /login reads "New here? £10 gets you £30") | Yes (public) | Yes (public) |

#### 48-hour delay: every surface a deal can reach a member

_C · 48-hour delay_

| surface | file:line | delay applied? | how | verdict |
|---|---|---|---|---|
| Rule and tier definition | src/lib/marketplace/visibility.ts:27-45; src/lib/marketplace/tier.ts:17-38; src/lib/access.ts:230-243; src/lib/credit/unit-costs.ts:150; supabase/schema.sql:1945-1964 | — | billing_settings.free_deal_delay_hours (default 48, 0 switches off); tier = hasEverPaid(payer): any subscription history, plan/plan_code, last_topup_at, admin; team member takes owner's; read failure → free; live_since stamped by trigger on every transition to live, null = brand new | OK. Pack buyer IS paid (grant-server.ts:165-166 stamps last_topup_at) |
| Today page: list, pick, count, banner | src/app/today/page.tsx:76, 108-109, 146, 158 | yes | dealVisibilityFor once per request → todaySelection (rankingPool with member.visibility, selection.ts:316) and dealCardsByIds re-filter on every read; free member gets earlyAccessBanner from earlyAccessCountAcross | OK |
| Stored lists (today_selections / profile_today_lists), several profiles | src/lib/today/selection.ts:92-96, 316, 435; src/lib/notify/daily-server.ts:83-89, 160 | yes, per MEMBER | every profile's list is chosen through the same member visibility; a stored list re-read later is re-filtered by dealVisible in dealCardsByIds / teasersFrom | OK (per member, not per profile) |
| Widen-and-see, re-choose, must-have count | src/lib/today/selection.ts:435; src/lib/tailoring/server.ts:288-292, 307 | yes | rankingPool with visibility | OK |
| Quiz: 'N deals match you' and sample matches | src/lib/profile/server.ts:376-380, 405-409 | yes | countDealsAcross / listDeals with dealVisibilityFor | OK |
| Daily email, digest run (08:10) | src/lib/notify/digest-run.ts:150-155, 184, 221, 299; src/lib/notify/message.ts:141-150 | yes | paidOf(payer) → PAID_VISIBILITY / freeVisibility; teasersFrom filters; visibleTeasers backstop drops and reports | OK |
| Daily email, sourcing/picks run | src/lib/listing/picks-run.ts:295, 454, 480, 515, 551, 907-909, 1317, 1484 | yes | paid from hasEverPaid(owner); pool deals inside the window and back-catalogue deals skipped in consider() before ranking, so alternates cannot reach them; same backstop at send | OK |
| The daily pick itself | src/lib/listing/picks-run.ts:1356, 1600 | n/a | a pick is charged and opened for the member (deal_opens verified_via 'pick'); deal_id only set when the listing was already a visible pool deal | OK by design |
| Teaser answer pages /p/d/<token>/<deal> | src/lib/tailoring/email-answers-server.ts:52-53, 69-70 | yes | dealVisibilityFor → dealCardsByIds; setDealReaction re-checks | OK |
| Picks-paused letter | src/lib/inactivity/letter.ts:18-30 | n/a | carries only rendered changes on tracked deals | OK |
| 'Your week' (Monday) | src/lib/notify/week-run.ts:216, 229; src/lib/notify/week.ts:86-92, 120-124, 210 | yes | free = delay hours unless paidOf; wasVisibleToFree lists only deals that were live for the whole window before going; the rest are counted as 'in early access' | OK |
| Deal alerts (email) | src/lib/notify/alerts-collect.ts:59-61 via src/lib/notify/tracked-read.ts:38 → src/lib/listing/tracked-server.ts:186, 230 | yes (inherited) | built only from loadTrackedDeals, which drops unopened invisible deals | OK (revived-deal edge: finding) |
| SMS alerts | src/lib/sms/alerts-run.ts:25, 87 | yes (inherited) | pendingChanges = the same settled alerts | OK |
| Share page /d/<token> (paid → free) | src/app/d/[token]/page.tsx:37-38; src/lib/marketplace/share-view.ts:37-41; src/lib/marketplace/share.ts:34 | yes | judged on publicDealVisibility for every viewer; creating the share is gated on the sharer's visibility too | OK for free recipients; paid signed-in recipient hits a dead end (finding) |
| Analyser deal sheet /deal/<token> and /api/deal-pdf | src/app/deal/[token]/page.tsx:26-42; src/app/api/deal-pdf/route.tsx:13-14; src/lib/listing/share.ts:11-25 | no | checked_listings row by token: address + portal link, no marketplace rule | Low finding (policy gap vs /d) |
| Report share /r/<token> | src/app/r/[token]/page.tsx | n/a | reports only, no marketplace read | OK |
| Deal page by URL /deals/[id] | src/app/deals/[id]/page.tsx:106-108; src/lib/marketplace/open.ts:255-262 | yes | dealSheet returns null → 404 unless the account already opened it | OK |
| Open / Keep / Pass / stage / share actions | src/app/deals/actions.ts:48-50, 107-109, 135-136; src/lib/marketplace/open.ts:87; src/lib/marketplace/reactions-server.ts:53; src/lib/listing/stage-server.ts:142-143 | yes | dealVisible before any charge or write; a reacted deal stays reachable | OK |
| Full analysis (/api/deals/[id]/analysis) | src/lib/analysis/deal-analysis.ts:284-286 | yes | unless already open or admin | OK |
| Project route (/api/deals/[id]/project) and Project deals | src/app/api/deals/[id]/project/route.ts:52; src/lib/marketplace/queries.ts:83-96 (withProject) | yes | dealSheet / same pool query | OK |
| Browse grid, Best for you | src/app/deals/page.tsx:70, 90-99; src/lib/marketplace/queries.ts:94-96; src/lib/tailoring/browse-server.ts:75-78, 101 | yes | dealsQuery `lte('live_since', cutoff)` (null excluded); Best-for-you order cached per tier, cards re-filtered by dealCardsByIds; free banner from earlyAccessCount | OK |
| Area counts, teaser, sitemap, marketing area pages | src/lib/marketplace/queries.ts:406, 429-431, 500, 539; src/app/sitemap.ts:14; src/app/(marketing)/short-let-deals/page.tsx:27, [slug]/page.tsx:46 | yes | hourCutoffIso (floored to the hour, so 48–49 h) as cache key; public pages use publicDealVisibility | OK, documented |
| Explorer /markets/[area] | src/app/markets/[area]/page.tsx:57, 65-67 | yes | dealVisibilityFor (anon → free); bestForYouInArea and marketDealsForArea take it | OK |
| My deals | src/app/my-deals/page.tsx:91, 106; src/lib/listing/tracked-server.ts:186, 230 | yes | unopened invisible deals left out; buttons removed on a kept one inside the window | OK (comment + revived edge: findings) |
| Extension /api/ext/*, /api/v1/* | src/app/api/ext/{check,disconnect,me}, src/app/api/v1/* | n/a | no marketplace_deals read anywhere under either tree | OK |
| Photo route | src/app/api/deals/photo/route.ts:26-29 | indirect | signed, expiring URL issued only for cards already filtered; share page issues none in members_only | OK |
| Low-entry stream | src/lib/deal-quality/streams.ts:26-33; src/lib/marketplace/queries.ts:83-96 | yes | a stream is a column on the same pool; every reader goes through dealsQuery / dealCardsByIds | OK |
| 'Act fast · new today' (Batch 14) | src/lib/tailoring/about-prompts.ts:72-76; src/lib/tailoring/config.ts:66 | n/a | keyed on first_seen_at ≤ 24 h; first_seen_at ≤ live_since and 24 h < 48 h, so it can never appear on a delayed deal | OK |
| Deal recheck / expiry | src/lib/marketplace/cadence.ts:34-36, 71-78 | n/a | 90 d listed / 21 d unconfirmed; a deal that goes within 48 h is simply counted as 'in early access' in Your week | OK |
| Revived (back-on-market) deals | supabase/schema.sql:2536-2540 | yes, window restarts | trigger re-stamps live_since | OK (edge: finding) |

#### Privacy surfaces: address / postcode / listing link, before or after an open

_C · addresses, postcodes, links_

| surface | file:line | address | postcode | listing link | before open? | verdict |
|---|---|---|---|---|---|---|
| Deal card (grid, Today, My deals, /d) | src/app/deals/_components/DealCard.tsx:69,147; src/lib/marketplace/grid.ts:201-225 | no | outcode only | no | yes | OK: PUBLIC_DEAL_COLUMNS; photo via signed route by id |
| Grid / Today / share queries | src/lib/marketplace/queries.ts:85,176-178,380-387; src/lib/marketplace/share.ts:78-86 | no | outcode | no | yes | OK: CARD_COLUMNS + photo, photo stripped to has_photo server-side |
| Deal page, unopened | src/app/deals/[id]/page.tsx:122,357-358,397-407 | no (town · area · outcode) | outcode | no | yes | OK: DealRow (canonical_url, photo, photos) stays server-side; client children get ids/prices only (369,384,413) |
| Deal page, opened | src/app/deals/[id]/page.tsx:319,357-358,390,541 | yes | yes | yes (View on portal) | no (priv only) | OK: dealSheet gates on deal_opens or admin (open.ts:257-262) |
| Full-analysis blocker text | src/app/deals/[id]/page.tsx:168-174; src/lib/analysis/deal-input.ts:26,51-54,71 | no | no | no | yes | OK: private listing read only to decide; messages are generic |
| Public share /d/<token> | src/app/d/[token]/page.tsx:40,56-57,147; src/lib/marketplace/share-view.ts:37-40 | no | outcode (area only in early access) | no | public | OK: CARD_COLUMNS only; og:image = signed proxy |
| Teaser answer /p/d/<token>/<deal> | src/app/p/d/[token]/[deal]/page.tsx:40,50-52; src/lib/tailoring/email-answers-server.ts:53 | no | no | no | public | OK: teaserItem lines only |
| Daily pick page /p/<token> | src/app/p/[token]/page.tsx:106,109,142 | yes | via address | yes + portal photo URL | public token; the pick is a paid open (picks-run.ts:1598) | OK (paid), token is the credential |
| Checked-listing share /deal/<token> | src/app/deal/[token]/page.tsx:39-42; src/lib/listing/share.ts:14-18 | yes | yes | yes | public, no open or marketplace check | LEAK for opened marketplace deals (finding 1) |
| Deal sheet PDF /api/deal-pdf?token= | src/app/api/deal-pdf/route.tsx:19-22 | yes | yes | yes | public | LEAK (finding 1) |
| Today's 5 teaser (email) | src/lib/notify/message.ts:95-98,120-134 | no | no (town or area name, never outcode) | no (links /today) | yes | OK |
| Changes lines (email) | src/lib/notify/message.ts:225-228; src/lib/notify/alerts.ts:85,306 | only when opened | no | no (links My deals) | n/a | OK: opened re-checked on write and read |
| Your week | src/lib/notify/tracked-read.ts:89-96; src/lib/notify/week-run.ts:298 | only when opened | no | no | n/a | OK |
| Picks-paused letter | src/lib/listing/picks-paused.ts:23,41-50,166 | no | no | no | n/a | OK |
| Low-credit email | src/lib/credit/low-credit.ts (no address/listing tokens) | no | no | no | n/a | OK |
| Pick email | src/lib/listing/picks.ts:611-612,631; src/lib/listing/picks-run.ts:1516,1558 | yes | via address | yes + portal photo | sent before the debit | OK (paid) but ordering (finding 2) |
| Admin feedback email | src/lib/email/feedback.ts:67-86,110; src/lib/feedback/storage.ts:8-14 | member text + page URL | — | — | admin only | OK: screenshots private bucket, signed for admin only |
| Feedback status emails | src/lib/email/feedback.ts:146-186 | quote of member's own text | no | no | n/a | OK |
| Receipts / billing emails | src/lib/email/billing.ts (no 'address') | no | no | no | n/a | OK |
| SMS alerts | src/lib/sms/render.ts:22-25 (address never read) | no | no | no (own /m link) | n/a | OK |
| Meta pixel | src/lib/tracking/config.ts:118-132; src/lib/tracking/surfaces.ts:111-118 | — | — | — | /deals, /d/, /deal/, /p/ banner-only, no PageView sent; query strings block sends | OK |
| Meta CAPI | src/lib/meta/conversions.ts:218,284; src/lib/meta/events.ts:52-56,121-124 | no | no | no | event_source_url = site root; custom_data value/currency only | OK |
| Monday funnel row (Batch 20) | src/lib/crm/monday-funnel/values.ts:43-72; facts.ts:84-101 | no | no | no | — | OK: no notes column; Ad source words pass cleanExtras |
| Monday sign-up row + report PDF | src/lib/apis/monday.ts:120-124; src/app/api/analyse/route.ts:291-297 | report PDF (member's own address) to CRM file column | — | — | — | OK by design (admin CRM) |
| Activity log extras | src/lib/activity/event.ts:67-83,181-182 | refused | refused (POSTCODE/OUTCODE) | refused (WEB); listing_url used for lookup only | — | OK |
| Server logs | src/lib/profile/server.ts:315; src/lib/listing/server.ts:75; src/app/api/twilio/inbound/route.ts:53-64 | — | home postcode logged (finding 3) | pasted listing URL logged (finding 4) | — | Low leaks; phone masked |
| Photo route | src/app/api/deals/photo/route.ts:25-41 | no | no | no (upstream URL never returned; redirects not followed) | signed by deal id | OK |
| Public area teaser /short-let-deals/<slug> | src/app/(marketing)/short-let-deals/[slug]/page.tsx:46,69-86 | no | outcode | no | public, delayed set | OK; photo only CSS-blurred (finding 5) |
| Explorer 'deals here' + map | src/lib/marketplace/grid.ts:404-430; src/app/deals/_components/DealsMap.tsx:14-17 | no | outcode | no | yes | OK: no pins, areaDealView only |
| Explorer own listings drawer | src/app/markets/_lib/loadExplorerUser.ts:26-30 | own rows | own | own | — | OK (eq user_id) |
| Welcome sample deals | src/lib/profile/server.ts:399-410; src/app/welcome/_components/SampleDeals.tsx:17-19 | no | outcode | no | yes | OK |
| My deals | src/lib/listing/tracked.ts:22-26,167-171,216; src/lib/listing/tracked-server.ts:233,241-248 | only when opened | no | only when opened | n/a | OK |
| deal_alerts payload | src/lib/notify/alerts.ts:30-34,85,306; src/lib/notify/alerts-collect.ts:64-73 | only when opened | no | no | n/a | OK |
| JSON APIs /api/deals/[id]/* | analysis/route.ts:35; project/route.ts:52-53; reminder/route.ts:27-30 | no | no | no | ids and prices only; project gated on priv | OK |
| /api/ext/check, /api/v1/reports, MCP | src/app/api/ext/check/route.ts:44,54; src/app/api/v1/reports/route.ts:14,30; src/lib/api/mcp-tools.ts | member's own tab / own reports | — | — | key-scoped | OK: no marketplace tools |
| Project deals | src/lib/project/headline.ts:78-98; src/app/deals/[id]/page.tsx:220-223 | no | no | no | card numbers only; working only when priv | OK |
| RLS | scratchpad/pg/policies.txt | — | — | — | marketplace_deals, sourced_listings, listing_snapshots, deal_opens, deal_shares: no policy (service role only); checked_listings/saved_searches owner (+team) | OK |
| Ledger descriptions | src/lib/marketplace/open.ts:189; src/lib/listing/picks-run.ts:1560 | open: town + area; pick: address (paid) | — | — | member's own ledger | OK |

#### Area C — every entry point that takes an id, token or slug: owner check and verdict

_C · cross-member access_

| entry point | file:line | id from | owner check | verdict |
|---|---|---|---|---|
| GET /reports/[id] | src/app/reports/[id]/page.tsx:27 | URL id | user-session client → RLS `Users can manage own searches` / `Team can read team searches` (active_team_owner requires suspended_at null); proxy forces login | OK |
| deleteReportAction | src/app/reports/actions.ts:24 | form id | service role, `.or(user_id.eq.me, owner_id.eq.me)` | OK (owner may delete team reports; author may delete own) |
| POST /api/reports/[id]/pmi | src/app/api/reports/[id]/pmi/route.ts:28 → src/lib/analysis/pmi-addon.ts:71 | URL id | session client read of saved_searches (RLS) | OK |
| GET /api/v1/reports, /[id], /[id]/pdf | src/lib/api/reports-query.ts:74,96 | URL id + API key | `.eq('owner_id', auth.userId)` | OK |
| POST /api/v1/analyse (saves report) | src/app/api/v1/analyse/route.ts:61 | API key | saveApiReport(auth.userId) | OK |
| POST /api/analyse (saves report) | src/app/api/analyse/route.ts:91,221 | session | session client insert, user_id = session, owner_id derived by trigger | OK |
| POST /api/generate-pdf | src/app/api/generate-pdf/route.tsx:33-50 | ?r= lead token / ?f= funnel token / session | token or session only; body is arbitrary | Low finding (spoof with lead's email) |
| GET /api/deal-pdf?token= | src/app/api/deal-pdf/route.tsx:13 → src/lib/listing/share.ts:17 | share token (24 random bytes) | `.eq('share_token')`; notes/status/report id excluded | OK |
| GET /deal/[token] | src/app/deal/[token]/page.tsx:28 | share token | sharedListingByToken; house figures only | OK |
| GET /d/[token] | src/app/d/[token]/page.tsx:34 → src/lib/marketplace/share.ts:75 | deal share token | token → card + sharer's referral code only; judged at public visibility | OK (referral code by design) |
| GET /deals/[id] | src/app/deals/[id]/page.tsx:104-108 → src/lib/marketplace/open.ts:252 | URL id | payerId's deal_opens unlock; no suspended check | Medium finding (paused seat) |
| openDealAction | src/app/deals/actions.ts:44-50 | form id | session; payer.suspended refused; visibility gate | OK |
| savePipelineAction | src/app/deals/actions.ts:76 → open.ts:286-292 | form id | needs the account's open; writes own checked_listings | OK |
| setDealReactionAction / savePassReasonsAction | src/app/deals/actions.ts:109,119 → reactions-server.ts:40,85 | arg dealId | `.eq('user_id', me)` | OK |
| shareDealAction | src/app/deals/actions.ts:136 | arg dealId | own row upsert keyed user_id | OK |
| saveProjectWorkingAction / unlockProjectWorkingAction | src/app/deals/project-actions.ts:36-37,55,70 → member-figures-server.ts:58-84 | arg dealId | dealSheet(payerId) must be open; project_member_figures `.eq('user_id', me)` | OK (same paused-seat gap as page) |
| setDealStageAction | src/app/my-deals/actions.ts:30 → src/lib/listing/stage-server.ts:65,124 | item key | checked_listings `.eq('user_id')`; d- keys need own row or team open | OK |
| moveFromNextStepAction / setChecklistItemAction / trackStepAction | src/app/my-deals/next-step-actions.ts:40,51 → src/lib/pipeline/server.ts:166-184 | item key | setStageForMember / ownsItem(user) | OK |
| updateListingStatus/Notes/remove/share/unshareListingAction | src/app/markets/actions.ts:118-156 | arg id | session client + `.eq('user_id', ctx.userId)` (RLS too) | OK |
| POST /api/deals/[id]/analysis | src/app/api/deals/[id]/analysis/route.ts:34 → deal-analysis.ts:248 | URL id | session; payer.suspended refused | OK |
| POST /api/deals/[id]/analysis/run | src/app/api/deals/[id]/analysis/run/route.ts:41 → deal-analysis.ts:419 | body purchaseId | `row.buyer_id !== userId → missing` | OK |
| POST /api/deals/[id]/project | src/app/api/deals/[id]/project/route.ts:52-53 | URL id | dealSheet(payerId) for non-view events | OK |
| POST /api/deals/[id]/reminder | src/app/api/deals/[id]/reminder/route.ts:29 | URL id | session only; activity log only | OK (no data read) |
| GET /api/deals/photo | src/app/api/deals/photo/route.ts:25 | signed id+exp+sig | HMAC verify | OK |
| /profiles actions (switch/edit/create/rename/pause/delete) | src/app/profiles/actions.ts:48-105 → src/lib/profiles/server.ts:264,292,312,329,352 | form id / copy_from | own(view,id) or `.eq('user_id')`; RPC select_search_profile filters user_id (schema.sql:3950) | OK |
| GET /profiles/switch?to= | src/app/profiles/switch/route.ts:26 | query id | switchProfile(user.id, to) | Low finding (state change on GET) |
| /profile, /welcome, /today actions | src/app/profile/actions.ts:53; src/app/welcome/actions.ts:18-25; src/app/today/*actions.ts | none | session user id only | OK |
| /account actions (billing pause/resume/cancel) | src/app/account/actions.ts:74,83,135 | none | session user id | OK |
| setNotificationAction | src/app/account/notifications/actions.ts:18-23 | none | session | OK |
| SMS request/verify/enable | src/app/account/notifications/sms-actions.ts:33-67 → schema.sql:2671 sms_verification_attempt(p_id,p_user) | form verificationId | RPC `v.user_id = p_user` | OK |
| /api/billing/*, /api/credit/* | currentMember() src/lib/credit/auth.ts:15 | none | session | OK |
| GET /p/[token] | src/app/p/[token]/page.tsx:38 → picks-server.ts:107 | pick token | token → own pick only; address shown (as in email) | OK |
| submitPickFeedback / unsubscribePicks / applyRelaxation | src/app/p/[token]/actions.ts:12-46 → picks-server.ts:230,309 | pick token | token only; no expiry / enabled check | Low finding (replay after unsubscribe) |
| GET/POST /api/picks/unsubscribe/[token] | src/app/api/picks/unsubscribe/[token]/route.ts:17 | pick token | token | OK |
| GET /p/d/[token]/[deal] + answerTeaserAction | src/app/p/d/[token]/[deal]/page.tsx:36; actions.ts:17 → email-answers-server.ts:41-47 | send token + deal id | token status 'sent' and deal in that send's summary | OK (no expiry: Low finding) |
| GET/POST /api/notify/unsubscribe/[token] | src/app/api/notify/unsubscribe/[token]/route.ts:41,53 | send token | sendByToken; GET shows confirm only | OK |
| GET /m | src/app/m/route.ts:8 | none | redirect only | OK |
| GET /r/[token], /r/[token]/pdf, markReportOpenedAction | src/app/r/[token]/page.tsx:43; pdf/route.ts:22; actions.ts:12 → src/lib/leads/report.ts:43 | report token (24 bytes) | token → result, prospect email, brand only; no owner id / verdict | OK |
| POST /api/feedback, /api/feedback/open | src/app/api/feedback/route.ts:40,80; open/route.ts:21 | session | user from session; client_key unique per (user_id, client_key) schema.sql:4605; feedback_submit dedupes within own user | OK |
| /account/feedback | src/app/account/feedback/page.tsx:50 → src/lib/feedback/server.ts:272 | ?report= highlight | reportsFor `.eq('user_id')` | OK |
| Screenshots | src/lib/feedback/storage.ts:47; config.ts:113; schema.sql:4869 | admin page only | private bucket, 300 s signed URLs, no member route | OK |
| POST /api/announcements | src/app/api/announcements/route.ts:30-32 | body ids | recordBannerEvent(user.id) | OK |
| /api/ext/check, /me, /disconnect | src/app/api/ext/*/route.ts; src/lib/extension/tokens.ts:48,64; cors.ts:21 | Bearer ext token | SHA-256 hash lookup, revoke `.eq('user_id')`, CORS only EXTENSION_IDS | OK |
| mint/revokeExtensionTokenAction | src/app/extension/connect/actions.ts:14-28 | arg tokenId | getMarketAccess user + `.eq('user_id')` | OK |
| /api/v1/leads, /[id], /[id]/push, /[id]/stage, /export, /stats | src/lib/api/leads-query.ts:198,296; leads-write.ts:27,47 | URL id + API key | `.eq('user_id', auth.userId)` | OK |
| /api/v1/funnels, /[id]/rules | src/lib/funnels/index.ts:88,103,173 | URL id + API key | `.eq('user_id')` | OK |
| /api/v1/me, /api/mcp | src/app/api/v1/me/route.ts:13; src/app/api/mcp/route.ts:41 | API key | apiAccess | OK |
| /leads, /leads/[id], /leads/[id]/pdf, /leads/export | src/app/leads/[id]/page.tsx:75-88; pdf/route.ts:34; export/route.ts:30 | URL id | leadScope (SeatPausedError for paused seat) + `.eq('user_id', scope.ownerId)` | OK |
| /leads/funnels/[id] + funnel actions | src/app/leads/funnels/[id]/page.tsx:27-30; src/app/leads/actions.ts:114-250 | URL/form id | ownerIdOrNull + getFunnel(user.id,id) | OK |
| lead-actions (archive/restore/stage/opened) | src/app/leads/lead-actions.ts:69,106,132 | form ids | `.eq('user_id', s.ownerId)` | OK |
| API key mint/revoke | src/app/leads/api/actions.ts:50,64 → src/lib/api/keys.ts:90 | form id | ownerIdOrNull + `.eq('user_id')` | OK |
| Monday/webhook connection actions, loadMondayBoards/Groups/Fields | src/app/leads/integrations/actions.ts:144-170 → src/lib/crm/connections.ts:105-106 | arg connectionId | resolveConnection(id, who.id) `.eq('user_id')` | OK |
| GET /f/[token], POST /api/f/[token]/analyse | src/app/f/[token]/page.tsx:80; src/app/api/f/[token]/analyse/route.ts:70 | funnel public token | token; Turnstile + caps before owner's credit is spent | OK (spend design, Area B) |
| team invite/revoke/remove/leave | src/app/account/team/actions.ts:35,46,59,72 → invites.ts:112, remove.ts:24-50 | form ids | owner-only, `.eq('owner_id')`; removal hands reports to owner and deletes invite-created login | OK |
| /team/join + acceptInviteAction | src/app/team/join/page.tsx:41,55; src/lib/team/rules.ts:84 | invite token (32 bytes, hashed) | email must match invite; expiry/used checks | OK (page shows invitee email + team name to token holder) |
| POST /api/presence | src/app/api/presence/route.ts:27-29 | body | user id from session only | OK |
| POST /api/consent | src/app/api/consent/route.ts:27,49 | cookie visitor id | same-origin JSON; visitor from httpOnly cookie, user from session | OK |
| POST /api/tracking/claim, /me, /touch | src/app/api/tracking/*/route.ts:20,33,18 | body key/touch | same-origin JSON + session (claim/me) or device cookie (touch) | OK |
| POST /api/track | src/app/api/track/route.ts:7 | body | none; no-op | Low finding (dead endpoint) |
| POST /api/twilio/inbound, /status | src/app/api/twilio/*/route.ts:32,21 → src/lib/sms/webhook.ts:32 | ?m= message id | X-Twilio-Signature verified; sid must match row | OK |
| POST /api/stripe/webhook | src/app/api/stripe/webhook/route.ts:28-32 | body | signature verified | OK |
| /auth/callback, /auth/confirm | src/app/auth/callback/route.ts:17,37; confirm/route.ts:24 | ?next= | safeInternalPath | OK |
| /admin/* pages, actions, exports | every file under src/app/admin (e.g. page.tsx:64-68, feedback/[id]/page.tsx:40-41, churn/export/route.ts:23) | URL ids | getUser + isAdminEmail; notFound/404 otherwise | OK |
| /api/internal/* (31 routes) | src/lib/internal-auth.ts:22; src/lib/lifecycle/route-auth.ts:17 | secret header | authoriseInternal (or admin session + same-origin for backfills); provider-spike admin-only | OK (Low: non-constant-time compare) |
| POST /api/get-report | src/app/api/get-report/route.ts:8-13 | body email | none | High finding |
| 'use server' files: exported non-action helpers | all 38 files listed by grep '^use server' | — | every exported async function resolves the session (member()/signedIn()/currentMember()/requireAdmin()) or is token-keyed; helpers member/signedIn/scope/access are not exported | OK |

#### Funnel surfaces: Stayful string / pixel / data mix

_C · funnel pages (white label)_

| surface | file:line | Stayful string / pixel / data mix | verdict |
|---|---|---|---|
| /f page title, description | src/app/f/[token]/page.tsx:110-113 | brandName(funnel.brand) / neutral fallback | clean |
| /r page title, description | src/app/r/[token]/page.tsx:32-35 | brandName / neutral | clean |
| meta generator | src/app/layout.tsx:11 (inherited; shallow merge) | `generator: "Stayful"` | LEAK (Low) |
| favicon | src/app/f/[token]/page.tsx:117 + src/app/favicon.ico; next resolve-metadata.js:660-667 | app/favicon.ico unshifted ahead of customer icon | LEAK (Medium) |
| robots noindex | src/app/f/[token]/page.tsx:114, r:36 | — | clean |
| Header/loading/footer wordmark | src/app/estimate/page.tsx:380-413 (BrandMark) | customer logo or name; Stayful only when !funnel | clean |
| Form hero copy | src/app/estimate/page.tsx:3346-3350 | "Short-Term Rental Property Analyser" | clean |
| Consent text + privacy link | src/lib/funnels/brand.ts:205-208; page.tsx:3728-3746 | names the customer; customer's privacyUrl | clean |
| Turnstile widget | src/components/TurnstileWidget.tsx:32 | Cloudflare script, no Stayful branding | clean |
| Form footer | src/app/estimate/page.tsx:3779-3792 | "© {company}. Data sourced from Airbtics, PropertyData, Google Places, Ticketmaster" | clean |
| Report footer | src/app/estimate/page.tsx:3316-3325 | © {company} | clean |
| Cookie banner | src/lib/tracking/surfaces.ts:29-43 NEVER '/f/','/r/'; consent.ts:136 | not rendered on funnels | clean |
| Cookie settings link | not imported in estimate page (grep) | — | clean |
| Meta pixel load/PageView | src/lib/tracking/runtime.ts:306; pixel.ts:121-128 | surface 'none' → navigate returns; isCleanForSend false | clean |
| /api/consent, /api/tracking/me, /api/tracking/touch | runtime.ts:306 (never reached on /f) | no consent_records/member_consent rows for prospects | clean |
| /api/track time_on_site (email) beacon | src/app/estimate/page.tsx:462-467 | gated by isFunnelRef | clean |
| /api/track session beacon (address, behaviour) | page.tsx:706-711; src/lib/tracker.ts:71-75,126 | NOT gated; localStorage 'stayful_sessions' | LEAK (Medium, data) |
| Data-quality disclaimer | page.tsx:2052-2061; airbtics.ts:331,1162,1535,1639,1802,1805; run.ts:370 | "Book a web meeting with Stayful" | LEAK (High) |
| Calendly links | page.tsx:2062-2063, 2455-2478 | gated !funnel | clean |
| Presentation view buttons | page.tsx:1441-1445, 1977-1984 → /presentation (PresentationDeck.tsx:194) | Stayful logo, tokens, case studies | LEAK (High) |
| SecondOpinionCard | page.tsx:2026; SecondOpinionCard.tsx:19 | "Stayful estimate" (enhanced funnels) | LEAK (Medium) |
| CompetitorsPanel tracked line | CompetitorsPanel.tsx:63 "a recent Stayful report" | needs a pasted Airbnb link; ListingLinkBox is !funnel (page.tsx:3421) | unreachable, clean |
| FAQ / management pitch section | page.tsx:3183-3188 | !funnel | clean |
| Direct-booking tip, advisor line | page.tsx:3067-3070, 3168-3170 | funnel branch neutral | clean |
| AnalyserNarrator, ReportOptions, ListingLinkBox | page.tsx:3331, 3767, 3421 | !funnel | clean |
| Address autocomplete billing | src/app/api/address-autocomplete/route.ts:119-153 | owner billed, IP+spend-capped; preview = house | clean |
| PDF header/footer/wordmark | src/lib/pdf/design/Chrome.tsx:99-108,175 | brand.logoDataUri / companyName / contactLine | clean |
| PDF document properties | src/lib/pdf/StayfulReport.tsx:49-52 | title/author = company | clean |
| PDF Stayful logo fallback | StayfulReport.tsx:26-30 | only when no brand | clean |
| PDF booking QR/button | src/lib/pdf/render.tsx:75-79; Page6Plan.tsx:59-65 | bookingUrl unset for funnels | clean |
| PDF page six pitch | Page6Plan.tsx:14-34,84-85,137,152-156; StayfulReport.tsx:65 | Stayful service copy attributed to customer | LEAK (Medium, content) |
| PDF filename | render.tsx:84-86 | company | clean |
| /api/generate-pdf ?f= / ?r= | src/app/api/generate-pdf/route.tsx:58-70 | pdfBrandForFunnel; no activity log for prospects | clean |
| /r/[token]/pdf | src/app/r/[token]/pdf/route.ts:25-29 | brand | clean |
| /leads/[id]/pdf (customer copy) | src/app/leads/[id]/pdf/route.ts:44-46 | brand | clean |
| Lead report email From | src/lib/email/lead-report.ts:38-39; from.ts:66-76 | "Company" <EMAIL_FROM address> (stayful.co.uk) | LEAK (Low, acknowledged) |
| Lead report email body/footer/reply-to | lead-report.ts:55-77 | "Sent by {company}", reply-to customer | clean |
| Report link domain | src/lib/leads/store.ts:235 siteUrl('/r/…') | stayful.co.uk URL | inherent (hosted on our domain) |
| 404 / error pages | no not-found.tsx/error.tsx; layout.tsx:8 | Stayful title + icons | LEAK (Low) |
| Fonts | src/lib/fonts.ts:24-79 (next/font/local) | same-origin /_next/static | clean |
| Asset URLs | page.tsx:3341 /grid.svg; customer logo | same-origin / customer's host | clean |
| RSC payload (FunnelMode) | src/lib/funnels/mode.ts:12-31; f/page.tsx:164-169 | token, brand, depth, preview only | clean |
| RSC payload (TrackingRoot pixelId) | src/app/layout.tsx:32 | Meta dataset id on every page | LEAK (Low) |
| Preview demo data | src/lib/demo-data.ts (grep Stayful: none) | — | clean |
| Owner alert emails | src/lib/funnels/alerts.ts:78-80 | Stayful-branded, to the owner only | correct |
| Customer CRM (Monday provider) | src/lib/crm/providers/monday.ts:1-16,75-99 | customer's token, board, columns | clean |
| Customer CRM (webhook) | providers/webhook.ts:92-105 | User-Agent 'Stayful-Intelligence-Webhook/1' to customer's own endpoint | clean |
| Members' board 18413002067 | src/lib/apis/monday.ts; callers estimate/layout.tsx:60, (auth)/actions.ts:129, sign-in-hooks.ts:69, /api/analyse:288 | member flows only; funnel route never calls it | clean |
| Monday funnel sync (Batch 20) | src/lib/crm/monday-funnel/* (grep leads: none) | no reads of `leads` | clean |
| activity_events | /api/f route, /r page, generate-pdf:122 (userId only) | no logActivity for prospects | clean |
| meta_conversions | /api/analyse:280 (FirstReport, member only); conversions.ts:270 (CompleteRegistration skipped when profile.lead_source) | funnel run records nothing | clean |
| Weekly-active / demand-sourcing base | src/lib/activity/metrics.ts, week.ts (pure); sourcing-demand/server.ts:59,88 (profiles) | leads table not consulted | clean |
| leads vs profiles | schema.sql:1139-1179 (no FK to prospect); retention purge deletes leads only | separate rows; owner's credit paid | clean |
| LEAD_ACTIVATION_WEBHOOK_URL | src/lib/auth/sign-in-hooks.ts:38-59 | profiles.lead_source (Meta lead forms), not funnel leads | clean |
| Owner's credit, once per lead | store.ts:117-161 (retry + state fallback) | holds on success path; failure path re-runs (see finding) | LEAK (High, money) |
| Queued lead re-run inputs | funnel-queue/route.ts:83-89; input.ts:140-143 | defaults flat/no bathrooms/no parking | wrong numbers (High) |
| funnel-queue dry run | funnel-queue/route.ts:50,106,110-113 | 'would_run', no alert | clean |
| crm-deliveries dry run | crm-deliveries/route.ts:28-30 | none | LEAK (Low, admin) |
| lead-retention dry run | lead-retention/route.ts:78,108,144-146,185,213-219 | counts only | clean |
| Retention deleting a lead who became a member | lead-retention/route.ts:221-226; schema (no link) | deletes the customer's lead row only | clean |
| Preview open on live funnels | f/[token]/page.tsx:82-86 | owner-facing banner to anyone with ?preview | Low |
| Owner's own paused-link visit | f/[token]/page.tsx:87-94,150-154 | alerts owner about themselves | Low |

#### Crons

_D · crons_

| route | schedules (UTC) | secret | dry=1 (real) | twice-safe (how) | time budget | external calls per run | collides with | verdict |
|---|---|---|---|---|---|---|---|---|
| /api/internal/alerts | Mon 08:00 | authoriseInternal first, 404 if unconfigured, GET only | yes: record() and the upsert are behind !dry; claims/sends nothing | weekly slot claim (notification_sends unique user/day/slot/channel) + Resend Idempotency-Key; saved_areas upsert idempotent; non-Monday real run returns skipped | 50 s (per member, mapLimit 4) | Resend per member with content; getAreaCards may kick a snapshot build (PropertyData, house) | picks-paused Mon 08:00 (different slot; no shared rows) | OK |
| /api/internal/listing-recheck | 06:00 | same | yes: returns before any write (line 178) | none: overlapping runs fetch and stamp the same URLs; deal_alerts dedupes downstream; first watcher would be metered twice | 50 s, 1 s sleep per fetch, cap 40 URLs (env), Airbnb slice 8 s / 10 rows | Rightmove/OTM page fetch ≤40 (metered to first watcher), Airbnb broker refresh ≤10 (charged to payer) | marketplace-sweep 06:00 pass (same portal breaker), funnel-queue 06:00 | Low (member metered without balance check) |
| /api/internal/deal-alerts | 06:55; :40 07-19 | same | yes: upsert only when !dry | upsert ignoreDuplicates on (user_id, alert_type, deal_key, event_at) | 40 s, batches of 40 members, daily-hash rotation | none (DB only) | sourcing 07:40 pass (reads pendingChanges while this writes; late alerts ride the next email/text) | OK |
| /api/internal/sms-alerts | */15 07-19 | same | yes: sendSms dryRun logs; no claim/record; price backfill skipped | claimSlot channel 'sms' + sms_messages row with alert_ids + contact re-read before Twilio; 'unknown' counts as sent | 45 s; window re-checked per text | Twilio ≤1 per member, ≤25 price lookups | sourcing 07:00, marketplace-recheck :30, funnel-queue :00/:30 | OK |
| /api/internal/market-warm | 04:45 | same | yes: cacheOnly reads only | idempotent via broker/unstable_cache; overlap double-buys region key stats | none | PropertyData: mortgage rates 1, region key stats ≤4 (30 credits each), snapshot build (area rents) | none | Low (no budget; cold build can exceed 60 s) |
| /api/internal/sourcing | 07:00, 07:20, 07:40 | same | yes: todayPlans create:false; no inserts; (reads Stripe via lowCreditNoticesFor) | sentToday (sourcing_sent any status) + (user_id, canonical_url) PK + claimSlot before insert + daily_deal_charges/profile_daily_charges guard before debit | 50 s total; queries 30 s; verify 40 s; plans 44 s | PMI/OTM per uncovered query (house), PropertyData cohorts ≤12, page fetch per candidate, Resend per member, Stripe cardSummary for low-credit due | sms-alerts 07:00, funnel-queue 07:00, deal-alerts 07:40 | Medium (send window ~6-10 s per pass) |
| /api/internal/picks-paused | 08:00 | same | yes: retire/supersede/stamps and away letters behind !dry | claimSlot (goes without a claim only when the RPC errors, still under the Resend key); emailed_at + picks_paused_email_at stamps; away letter stamped | 50 s incl. away letters | Resend per letter; starterPackStateFor reads | alerts Mon 08:00 | OK |
| /api/internal/daily-digest | 08:10 | same | yes: todayPlans create:false; sendLowCreditAlone/markLowCreditTold/charges behind !dry (reads Stripe) | slotsInUse pre-read + claimSlot per member; charge guard rows; 503 if notification_sends unreadable | 50 s in the loop only; prep (todaySelection × seats /6, Stripe) unbounded; fixed id order | Resend per member; Stripe cardSummary for low-credit due; todaySelection per seat | none | High (deterministic starvation past ~80-120 members) |
| /api/internal/credit-sweep | 03:00 | same | NO dry. Would need: count credit_grants due (expires_at<=now, remaining>0), list pro_annual subscribers whose slot source_ref is absent, list UNIT_COST_SEED rows missing; skip credit_expire_due, grantPlanCycle, syncUnitCosts | expire: SQL for update skip locked; annual: source_ref unique but expire-then-insert not atomic; seed: upsert ignoreDuplicates | none (loops annual subscribers; fine at 4 plans) | Resend planRenewedEmail per annual slot; queueFunnelSync | low-entry-search 03:00, funnel-queue 03:00 | High/low-confidence (annual grant race) |
| /api/internal/planning-signals | 04:00 | same | yes: no PlanIt call, no upsert, no revalidateTag | upsert on postcode_area | 50 s, ≤9 areas, concurrency 2 | PlanIt 2 per area (≤18) | deal-checks 04:00, funnel-queue 04:00 | OK |
| /api/internal/funnel-queue | */30 | same | yes: raiseFunnelAlert and reserveSpend behind dry | NONE: reads status='queued', no claim; overlap runs and charges each lead twice | none: ≤5 full analyses (can exceed 60 s; settleSpend then skipped) | full analysis per lead (PropertyData ~15, Airbtics, geocode…), Resend owner alert | 03:00 (credit-sweep, low-entry), 04:00 (planning, deal-checks), 05:00-06:30 (sweep/recheck/listing-recheck), 07:00 (sourcing, sms) | Critical/low-confidence (double charge) + Medium (no budget) |
| /api/internal/crm-deliveries | */10 | same | NO dry. Would need: list pending rows with next_attempt_at<=now (id, lead_id, connection_id, attempts) and skip runDelivery | NONE: no status transition before pushLead; 'send now' + cron can overlap | none: ≤10, each Monday delivery renders a PDF | customer CRM push (Monday/webhook) ≤10; PDF render | monday-funnel every 10 min (different tokens); every :x0 job | Medium (duplicate CRM items) |
| /api/internal/monday-funnel | */10 | same | yes: no lease, no queue attempts, no runs row, inactivity apply=false (SQL reads only); reads Monday | monday_funnel_lease (120 s > 60 s maxDuration, released in finally, expires after a crash); queue attempts ≤5 then dropped; nightly resumes by day row | 50 s + 4 s link grace; inactivity step 20 s | Monday: readItems, findItemsByEmail, writePlan per row; readBoard nightly | crm-deliveries; nightly (from 06:00 UK = 05:00 UTC in BST) overlaps sweep/funnel-queue 05:00 | OK |
| /api/internal/lead-retention | 02:15 | same | yes: counts only | conditional updates make marks idempotent; emails go before the mark (dupes on overlap) | none (500 rows/step; 0 leads today) | Resend per owner per step | none | Low |
| /api/internal/team-seats | :25 hourly | same | yes: counts only | renew: team_seat_charges unique (member, period_start=seat_paid_until) OK; reinstate: period_start=now, no claim (double £10) | none (≤200 rows × debit + afterDebit + 2 emails) | Resend ×2 per change; Stripe via afterDebit auto top-up | project-checks 04:25/05:25, demand-sourcing 05:25/06:25 | Critical (reinstate double charge) |
| /api/internal/marketplace-sweep | */10 05-06 | same | yes: pmiAccount read only; no recordRun | none; passes coordinate via marketplace_runs history read at start; overlap re-asks (broker daily cache) and re-absorbs (upserts) | 44 s queries / 50 s total | PMI/OTM per pending query, PropertyData cohorts ≤4 | listing-recheck 06:00, marketplace-recheck 05:30/06:30, funnel-queue :00/:30, monday-funnel | OK |
| /api/internal/demand-sourcing | 5,15,25,35,45,55 05-06 | same | yes: planView only | demand_search_reserve (advisory lock + partial unique day/area/kind); stale claims closed after 10 min; settled per action_id | 44 s, ≤8 searches, stops after 2 failures | PMI/OTM ≤8; provider_calls scan per settle (no action_id index) | project-checks every minute of hour 05 (exact), team-seats :25, deal-alerts 06:55 | Low (collision, index) |
| /api/internal/low-entry-search | 03:00, 03:10, 03:20 | same | yes: pmiAccount read only | none; weekly cap and doneKeys via marketplace_runs history; overlap double-searches | 44 s, ≤50 | PMI/OTM per area | credit-sweep 03:00, funnel-queue 03:00 | OK |
| /api/internal/deal-checks | 03:40, 03:50, 04:00, 04:10, 04:20 | same | yes: expiry update and checks behind dry | none per deal; day cap read from finished runs only (overlap doubles the cap) | 45 s, 3 workers, ≤200 | Airbtics ≤maxCallsPerCheck per deal (5p each), geocode | planning-signals 04:00, funnel-queue 04:00 | Low (cap on overlap) |
| /api/internal/project-checks | 25,35,45,55 04; 5,15,…,55 05 | same | yes: openRun and every write after the dry return | project_claim_check (advisory lock, one per listing per UK day, allowance + cap); run row opened first so concurrent runs see in-progress spend | 55 s; Anthropic timeout derived from the deadline | Anthropic ≤1 photo check, PropertyData sold prices/planning per prep, portal page read per prep | demand-sourcing hour 05 (exact), team-seats :25 | Low (collision) |
| /api/internal/marketplace-recheck | :30 hourly | same | yes: stale retire and fetches behind dry; no recordRun | none; retire/applyLiveResult idempotent; per-portal caps | 50 s, 1 s gap, candidates ≤3000 | Rightmove/OTM page per due deal (capped per portal, house) | sweep 05:30/06:30, funnel-queue :30, sms-alerts 07:30-19:30 | OK |
| /api/internal/activity-retention | 02:35 | same | yes: SQL apply=false counts only | delete idempotent, ≤50k per table per night; SQL refuses cutoff < 12 months | SQL limit only | none | none (inactivity sync reads from an id watermark; 24-month deletes never intersect) | OK |
| /api/internal/feedback-retention | 02:45 | same | yes: due counts only | admin emails keyed at Resend and stamped; rows stamped only after the bucket confirms | 40 s, batches of 100, stop after 3 email failures | Resend ≤due, Supabase storage removes | none | OK |

#### Messages

_D · the one-message-a-day cap_

| message | file:line | channel | trigger | capped? (slot name) | outside cap because | verdict |
|---|---|---|---|---|---|---|
| Today's 5 (charged pick, rest of Today, changes, £5 notice at top, profile nudge) | src/lib/listing/picks-run.ts:1309, 1516 | email | cron /api/internal/sourcing 07:00, 07:20, 07:40 UTC | yes: daily (todays_5), key email/daily/<day>/<user> | — | OK; a 4xx burns the slot (F2) |
| Admin test send of Today's 5 | src/lib/listing/picks-run.ts:1309, 1522 | email | /admin/picks button (ignoreToday) | no (testSendKey) | admin's own test, marks nothing | OK |
| Daily digest: Today's 5 without a pick | src/lib/notify/digest-run.ts:358, 369 | email | cron daily-digest 08:10 UTC | yes: daily (todays_5) | — | OK; 4 in parallel, 429 burns slot (F1) |
| Daily digest: Changes on your deals | src/lib/notify/digest-run.ts:358 | email | cron 08:10 UTC, only with changes | yes: daily (deal_changes) | — | OK |
| £5 low-credit decision at the top of a daily email | src/lib/listing/picks-run.ts:1488, 1539; src/lib/notify/digest-run.ts:303, 379 | email (section) | rides the daily email; stamped after send | rides the daily slot | — | OK |
| £5 low-credit decision alone (digest, nothing else to say) | src/lib/notify/digest-run.ts:324 → src/lib/credit/low-credit-server.ts:151, 163 | email | cron 08:10 UTC | yes: daily (low_credit) | — | OK |
| £5 low-credit decision alone (after a debit) | src/lib/credit/after-debit.ts:94-97 → low-credit-server.ts:151 | email | any debit after 08:30 UTC, no plan, ≤ £5, once per 30 days | yes: daily (low_credit) | — | Deferred forever for picks-off members (F4) |
| Picks paused: the out-of-credit letter (with changes, pack offer) | src/lib/listing/picks-paused-run.ts:264, 279 | email | cron picks-paused 08:00 UTC; first day, then every 7 days | yes: daily (picks_paused) | — | OK |
| While you're away (inactivity pause) letter | src/lib/listing/picks-paused-run.ts:390, 404 | email | cron 08:00 UTC after the nightly sets picks_paused_inactive_at | yes: daily (picks_paused) | — | OK; one per pause |
| Your week (missed deals, recap, area alerts) | src/lib/notify/week-run.ts:346, 357 | email | cron /api/internal/alerts Monday 08:00 UTC | yes: weekly (your_week), the only weekly sender | — | OK; 4 in parallel (F1) |
| Deal alerts inside the daily email / letters | src/lib/notify/message.ts changesSection via picks-run.ts:1483, digest-run.ts:288, picks-paused-run.ts:240, 371 | email (section) | ride whichever daily email goes | daily slot; closed by finish_notification_send | — | OK |
| SMS deal alert (one text, several changes) | src/lib/sms/alerts-run.ts:148, 186 | sms | cron sms-alerts */15 07-19 UTC, gated 08:00–20:00 Europe/London | yes: daily, channel sms (deal_changes); plus monthly cap | — | OK; withdrawn text burns slot (F8) |
| SMS verification code | src/lib/sms/verify-server.ts:96 | sms | member verifies a number | no | security; own resend limits (resendVerdict) | OK |
| STOP / START / HELP confirmations | src/app/api/twilio/inbound/route.ts:27-29, 79 | sms (TwiML reply) | inbound keyword | no | carrier-required confirmation; none when Twilio already replied | OK |
| 'Your Stayful picks are now daily' one-off notice | src/lib/listing/daily-notice-run.ts:65, 79 | email | admin press on /admin/picks | yes: daily (notice) | — | Takes the slot, no unsubscribe (F6) |
| Pricing notice (Batch 10 prices, terms, privacy) | src/lib/credit/pricing-notice-run.ts:146 | email | admin press on /admin/billing, ≥ 14 days before the date | no; key pricing-notice:<user>:<date>; stamped pricing_notice_sent_at | service notice (Q15a); can land the same morning as the daily email | OK (deliberate, one-off) |
| You're running low on credit (80%, on a plan) | src/lib/email/billing.ts:32 ← src/lib/credit/after-debit.ts:102 | email | any debit, once per cycle, credit_alerts on | no; no key | billing warning | Stacks with Today's 5 from the pick debit (F3) |
| You're out of credit (£0, pack offer for new members) | src/lib/email/billing.ts:55 ← after-debit.ts:72 | email | any debit to £0, once per cycle, credit_alerts on | no; no key | billing warning | Marketing-like, uncapped, same minute as Today's 5 (F3) |
| Heads up: a top-up is coming | src/lib/email/billing.ts:48 ← after-debit.ts:128 | email | debit into the band above the auto-top-up trigger, once per cycle | no; no key | precedes a card charge | Uncapped (F3) |
| Top-up receipt | src/lib/email/billing.ts:67 ← src/lib/stripe/grants.ts:92 | email | Stripe webhook / auto top-up grant | no | receipt | OK |
| Plan credit ready (renewal) | src/lib/email/billing.ts:74 ← src/lib/stripe/grants.ts:44 | email | Stripe webhook | no | receipt | OK |
| Payment failed | src/lib/email/billing.ts:81 ← src/lib/stripe/webhook.ts:672 | email | invoice.payment_failed | no | billing | OK |
| Saved card needs updating | src/lib/email/billing.ts:88 ← src/lib/stripe/auto-topup.ts:62, src/app/api/billing/topup/route.ts:86 | email | declined off-session charge | no | billing | OK |
| Subscription transition | src/lib/email/billing.ts:95 | email | no caller | no | — | Dead code (F7) |
| Starter pack receipt (+ CCR confirmation) | src/lib/email/billing.ts:109 ← src/lib/starter-pack/grant-server.ts:220 | email | pack paid and granted (first grant only) | no | receipt | OK |
| Pause booked | src/lib/email/billing-emails.ts:33 ← src/app/account/actions.ts:244, 433 | email | member pauses plan | no | confirmation | OK |
| Cancel scheduled | src/lib/email/billing-emails.ts:66 ← src/app/account/actions.ts:354 | email | member cancels | no | confirmation | OK |
| Feedback report to admin (zac@) | src/lib/feedback/server.ts:214 | email | member sends feedback; retried by feedback-retention | no; key feedback-admin:<id> | to admin, not a member | OK |
| Feedback status (planned / fixed / built / not doing) | src/lib/feedback/admin-server.ts:354 | email | admin sets status | no; key feedback-status:<id>:<status>, feedback_status_claim; 409 = sent | reply to the member's own report | OK |
| Team invite | src/lib/team/invites.ts:102 | email | owner invites | no | transactional | OK |
| Member joined (to owner) | src/lib/team/invites.ts:209 | email | invite accepted | no | transactional | OK |
| Join blocked by credit (to owner) | src/lib/team/invites.ts:189 | email | seat charge failed | no | transactional | OK |
| Seat suspended (owner + member) | src/lib/team/seats.ts:130-131 | email | cron team-seats hourly | no | transactional | OK |
| Seat restored (owner + member) | src/lib/team/seats.ts:189-190 | email | top-up reinstates | no | transactional | OK |
| Member removed (owner + member) | src/lib/team/remove.ts:66 | email | removal | no | transactional | OK |
| Funnel alerts (to funnel owner) | src/lib/funnels/alerts.ts:80 | email | funnel events, once a day per kind via funnel_alerts claim, claim released on failure | no | account alert to a funnel owner | OK |
| Lead report link (to prospect, white-label from) | src/lib/email/lead-report.ts:79 | email | funnel submission | no | prospect, not a member | OK |
| Lead archive warning / archived (to funnel owner) | src/app/api/internal/lead-retention/route.ts:113, 190 | email | cron lead-retention 02:15 UTC | no | retention notice | OK |
| Provisioned-lead welcome + magic link | src/app/api/internal/leads/provision/route.ts:56, 175 | email | internal provision of a lead as a member | no | first sign-in link | OK |
| Supabase auth emails (sign-up confirm, magic link, password reset) | src/app/(auth)/actions.ts:82, 188, 211 | email (Supabase) | auth | no | out of scope: Supabase sends them | — |
| Referral, announcements (banner), share, extension, welcome-credit-withheld, auto top-up 'receipt' beyond the top-up receipt | — | — | no email or SMS exists (grep) | — | — | none |

#### Senders and switches

_D · unsubscribe, settings and Monday Email OK / SMS OK_

| Sender | file:line | Switch read | Unsubscribe honoured | Verdict |
|---|---|---|---|---|
| Today's 5 with a pick (07:00, 07:20, 07:40 UTC) | src/lib/listing/picks-run.ts:303 (audience), :1108 (changes), :1181 (£5 notice) | `sourcing_alerts` = true and `welcome_checked_at` set; `alert_tracked` for the changes section (trackedAlertsOn); `alert_credit` for the £5 notice (low-credit-server.ts:102); paused subs and inactivity-paused skipped (:407, :417) | Pick token: GET /p/<token>?a=unsubscribe (confirm page) + POST /api/picks/unsubscribe/<token> one-click; List-Unsubscribe + List-Unsubscribe-Post (picks.ts:531-541) → daily_picks only | OK. Dry run reads the same switches (picks-run.ts:523-529) |
| Daily digest 08:10: Today's 5 without a pick / Changes on your deals | src/lib/notify/digest-run.ts:100 (picks), :140 + :288 (changes), :253 (£5 notice) | `sourcing_alerts` (teasers, via wantsTeasers :169), `alert_tracked` (changes), `alert_credit` (£5 notice) | Send token: GET confirm + POST one-click /api/notify/unsubscribe/<token>, List-Unsubscribe headers (render-email.ts:149); turns off daily_picks or deal_changes by what the email turned out to be (digest-run.ts:312, cap.ts:44-51) | OK. Dry run uses the same reads and builder up to :335 |
| £5 low-credit decision alone (from the digest) | src/lib/notify/digest-run.ts:324 → src/lib/credit/low-credit-server.ts:148-167 | `alert_credit` (low-credit-server.ts:102), but only members already in the digest's `open` list | Send token → credit_alerts; List-Unsubscribe (:162-163) | Finding: never reaches a member with picks off and no alerts waiting |
| £5 low-credit decision alone (after a debit, ≥ 08:30 UTC) | src/lib/credit/after-debit.ts:53, :91, :94, :97 | `alert_credit` (email is null when off) | Send token → credit_alerts | OK |
| Picks paused / out-of-credit letter 08:00 | src/lib/listing/picks-paused-run.ts:184-191, :238 | `sourcing_alerts` (retire 'picks_off'), `alert_credit` (retire 'switched_off'); `alert_tracked` for the changes it carries; team members skipped | Send token → credit_alerts; List-Unsubscribe (:284) when the slot row exists; Manage link only when the cap table is unreadable (:271-272) | OK |
| While you're away letter (Batch 20 Part C) | src/lib/listing/picks-paused-run.ts:351-358, :369 | `sourcing_alerts` !== true → skip; `alert_credit` === false → skip; `alert_tracked` for changes | Send token → credit_alerts; List-Unsubscribe (:404) | OK |
| Your week (Mondays 08:00) | src/lib/notify/week-run.ts:230 (missed), :249 (areas), :254 (recap) | `alert_missed`, `alert_weekly`, `alert_tracked` (recap only rides along) | Send token → weekly_missed + weekly_alerts (:312-327, cap.ts:48) | OK. Dry run same path |
| 'Picks are now daily' notice (admin one-off, /admin/picks) | src/lib/listing/daily-notice-run.ts:43, :72, :79 | `sourcing_alerts` = true, `welcome_checked_at` set, not yet sent | None: token null, no header, no link; Manage button only (email/daily-notice.ts:39) | Finding (Low) |
| Pricing / terms notice (admin one-off, /admin/billing) | src/lib/credit/pricing-notice-run.ts:81-88, :146 | none (every signed-in account, team members included) | None; Manage link (email/pricing-notice.ts:135); outside the cap by design | Service notice: defensible |
| Out of credit (£0) | src/lib/credit/after-debit.ts:53, :68-72 → src/lib/email/billing.ts:55-65 | `alert_credit` | Manage link only (billing.ts:20-22); no link, no header | Switch honoured; finding (Low) on the missing unsubscribe |
| Running low (80%, on a plan) | src/lib/credit/after-debit.ts:100-103 → billing.ts:32-37 | `alert_credit` | Manage link only | Same |
| Top-up coming (pre-charge warning) | src/lib/credit/after-debit.ts:115-133 → billing.ts:48-53 | none (deliberate: precedes a card charge, :51-52) | Manage link | Transactional: defensible |
| Receipts, plan renewed, payment failed, card needs updating, starter-pack receipt | src/lib/stripe/grants.ts:8, src/lib/stripe/deps.ts:9, src/lib/stripe/auto-topup.ts:7, src/app/api/billing/topup/route.ts:11, src/lib/starter-pack/grant-server.ts:10 → billing.ts:67-115 | none | Manage link | Transactional: defensible (registry.ts:141 ALWAYS_SENT_NOTE) |
| Pause booked / cancellation scheduled | src/app/account/actions.ts:244, :354, :426-438 | none | — | Transactional |
| Feedback status reply | src/lib/feedback/admin-server.ts:354 | none (a reply to the member's own report) | — | Defensible |
| Team invite / joined / blocked / removed / seat charge | src/lib/team/invites.ts:102, :189, :209; src/lib/team/remove.ts:66; src/lib/team/seats.ts:68 | none | — | Transactional |
| Funnel alerts, lead archive warnings, provisioned-lead welcome, lead report | src/lib/funnels/alerts.ts:80; src/app/api/internal/lead-retention/route.ts:113, :190; src/app/api/internal/leads/provision/route.ts:175; src/lib/email/lead-report.ts:79 | none | — | Customer / lead account mail, not member notifications: defensible |
| Feedback report to admin | src/lib/feedback/server.ts:214 | n/a (goes to the admin) | — | Not a member email |
| Deal-alert text (every 15 min, 07–19 UTC cron; 08:00–20:00 UK window) | src/lib/sms/alerts-run.ts:62 (SMS_ALERTS_ENABLED), :77 (receivingContacts: verified, enabled, not stopped, UK mobile), :86 (`sms_price_drop` / `sms_back_on_market` / `sms_nearly_gone` / `sms_gone` per change, choose.ts:111), :143 and :179 (re-read STOP, on/off and switches before Twilio) | as listed; one text a day (claim channel 'sms'), monthly cap | STOP (`sms_contacts.stopped_at`) and Texts on/off honoured; every text ends with the opt-out line (send.ts:47) | OK. Dry run runs the same planMemberText and skips only claim/record/send |
| Verification code text | src/lib/sms/verify-server.ts:44, :57, :96 | none (the member asked); Twilio config only, not SMS_ALERTS_ENABLED; not on another account; resend limits | STOP honoured: numberStopped before sending (:57-59); a STOP after the code wins at checkCode (:139-145); Twilio 21610 re-stops (:105-107) | Transactional: defensible |
| STOP / START / HELP replies (TwiML) | src/app/api/twilio/inbound/route.ts:57-79 | Twilio signature (webhook.ts:17-37) | STOP stops every account on the number (store.ts:107-119); START restores, switches still apply (:122-134) | OK |

#### Monday Email OK / SMS OK contract

_D · unsubscribe, settings and Monday Email OK / SMS OK_

| Column | Set from | True when | False when | Updated when |
|---|---|---|---|---|
| Email OK (boolean_mm7mek5x) | facts.ts:74-76 `emailOkFor(profiles.email, sourcing_alerts, alert_missed)`; written as `{checked:'true'}` or cleared to null (values.ts:61, :147) | The profile has an email containing '@' AND (`sourcing_alerts` = true OR `alert_missed` = true). Both default true (schema.sql:1040, :2534), so every new sign-up is true from the moment the auth user exists, confirmed or not, signed in or not. A member who turned off Daily picks but kept 'Weekly: deals I missed' (or the reverse) is true. | No email; or Daily picks AND Weekly: deals I missed both off. One-click from Today's 5 / a changes email turns off daily_picks (or deal_changes, which does not affect it); one-click from Your week turns off weekly_missed + weekly_alerts; the picks-paused / low-credit emails turn off credit_alerts (no effect). 'Changes on deals I'm tracking', 'Weekly area alerts' and 'Picks paused / out of credit' never affect it. There is no marketing switch. | Every member: the nightly pass from 06:00 UK (/api/internal/monday-funnel every 10 min; sync-server.ts:41, :309; carries on across runs until finished). Sooner (≤ ~10 min) only when the member is queued for another reason: signup, starter_pack, topup, plan, payment_failed, refund, hit_zero, low_credit, next_deal, came_back. A settings change, an unsubscribe click, STOP, START or a verification does NOT queue (finding). |
| SMS OK (boolean_mm7m4tvb) | facts-server.ts:107, :118 `contactCanReceive(sms_contacts row)` (choose.ts:49-51) | An `sms_contacts` row with `verified_at` set, `enabled` = true, `stopped_at` null and `phone_e164` a UK mobile (+447…). A number can be verified on one account only (schema.sql:2637 unique index). | No row (never verified: the sign-up mobile in `profiles.mobile` does not count); `enabled` false (Texts off on Account → Notifications); `stopped_at` set (STOP by reply, Twilio 21610 on a send, or admin); a non-UK number; or `sms_contacts` unreadable that night (degrades to false, facts-server.ts:116-118). NOT considered: the four per-kind switches (sms_price_drop etc.), so a member with texts on but every kind off is true. | Same as Email OK: nightly, or when otherwise queued. STOP, START, verify and Texts on/off do NOT queue (finding). |
| Re-engage since (date_mm7mzn1p) | `profiles.reengage_since` (values.ts:63), set by the nightly's inactivity step (inactivity/server.ts:169), cleared by the step (:170) or at once by cameBack (came-back.ts:26) | Eligible (no live / trialling / paused plan unless its cancellation is booked; not an admin or @stayful.co.uk; has an email; team member follows the owner's plan), `billing_settings.inactivity_from` set, and whole UK days quiet ≥ inactive_reengage_days (14) counted from the latest of inactivity_from, sign-up and the last active or engaged UK day (rules.ts:86-107). Confirmation / first sign-in is not required. | Cleared (null) when they engage again: any in-app qualifying action, or an email/text engagement (click through to the site while signed in, a form answer, a setting changed from an email) that is not an unsubscribe (`extras.on` false). Never set while inactivity_from is empty. | Set by the nightly's step 1 (database only, before any Monday call) and written to the board in the same pass; cleared in the DB at once on engagement and queued ('came_back') so Monday follows within ~10 min. |
| Group 'Re-engage (14+ days inactive)' (group_mm7mdnsg) | precedence.ts:58-70 row 6: `reengageSince` set, after Payment issues, Paused and a live uncancelled plan | As Re-engage since | Rows 1–5 win (past due/unpaid, paused, live plan, manual no-tier untouched); once cleared it falls through to Cancelled / Low credit / Pay as you go / £10 starter pack / Free sign-up | Moved in the same aliased mutation as the column values (mutations.ts:16-28): when a row enters Re-engage, its Email OK / SMS OK were read in the same pass (fresh to within ~50 s). Rows in Excluded are never moved; a member whose only rows are another member's (shared number) gets no row and no writes (plan.ts:72-85). |
| Email Address (text_mm3a8s7c), Name (text_mm3ad9y7), Mobile Number (text_mm3ah0bk), Signed up (date_mm3cny59), First payment (date_mm3cp4k3) | Set-once (config.ts:122): the sign-up row writes Name/Email/Mobile/Signed up at sign-up (apis/monday.ts:120-129, UTC date+time); the funnel writes them only while empty | — | — | Never rewritten once present (so a wrong Signed up stands: finding). Mobile Number is `profiles.mobile` as typed at sign-up, not the verified texting number. |
| Email Verified (boolean_mm3a1wy9) | Nobody: no writer in src (grep) | — | — | Never. n8n cannot use it; see the Email OK finding. |
| Status (color_mm3a4gp9), Site Visits (text_mm3aapza), Reports (file_mm3aevrs), the two formulas | NEVER_WRITTEN by the funnel (config.ts:92); Reports written only by the PDF upload (apis/monday.ts:174-212) | — | — | The old sign-up row and the funnel never write the same column with different values: the old row's four columns are all SET_ONCE in the funnel, and neither writes Email Verified or Status. |
| Last active, Active days, Active weeks | lifecycle_member_stats over member_active_days (in-app qualifying kinds only; email/text engagement is excluded by design) | — | — | Nightly |

What the n8n workflow can rely on: trigger on a row moving into 'Re-engage (14+ days inactive)'; on that same item read, Email OK / SMS OK were computed in the same pass. Re-read both immediately before every later send in a sequence, and treat them as at most one nightly stale (a member who unsubscribed or texted STOP after 06:00 UK still shows OK until the next morning). Use Email Address for email and Mobile Number for SMS only when SMS OK is ticked (it is the sign-up number; the verified texting number is not on the board). Never touch rows in 'Excluded – duplicate & internal accounts'.

#### Member actions

_E · member actions inventory_

| action | batch | where performed (file:line) | logged via | kind | counts? | once? | verdict |
|---|---|---|---|---|---|---|---|
| Sign up / sign in / password reset / sign out | B1 | src/app/(auth)/actions.ts:55,34,203,225,149 | none (no kind) | — | — | — | not logged; visit starts on first members page (by design) |
| Land on /welcome (quiz opened first time) | B12 | src/app/welcome/page.tsx:66 → src/lib/profile/server.ts:432 | logActivity (page render) | profile_started | yes | once ever (dedupe) | page view counts as active: finding (sign-up) |
| Quiz reopened (unfinished) | B12 | src/lib/profile/server.ts:439 | logActivity | profile_resumed | yes | once per Today-day | OK (policy: view counts) |
| Quiz answer (incl. bedrooms, deal types) | B12/B17 | src/app/welcome/actions.ts:25 → src/lib/profile/server.ts:275 | logActivity | profile_answered / profile_not_sure | yes | once | OK |
| Quiz answer edited (?q=) | B12 | src/lib/profile/server.ts:274 | logActivity | profile_edited | yes | once | OK |
| Three mandatory answers done | B12 | src/lib/profile/server.ts:276 | logActivity | welcome_completed | yes | once ever | OK |
| Profile completed | B12 | src/lib/profile/server.ts:278 | logActivity | profile_completed | yes | once ever | OK |
| Finish later | B12 | src/app/welcome/actions.ts:43 → src/lib/profile/server.ts:424 | logActivity | profile_finish_later | yes | once | OK |
| Pack shown on welcome / modal | B20 | src/components/starter-pack/actions.ts:25 → src/lib/starter-pack/server.ts:125 | logActivity | starter_pack_shown | no | once per surface per day | OK |
| Pack shown on Today / deal page / billing | B20 | src/app/today/page.tsx:89, src/app/deals/[id]/page.tsx:142, src/app/account/billing/page.tsx:49 → server.ts:125 | logActivity (render) | starter_pack_shown | no | once/surface/day | OK |
| Pack 'Not now' (welcome, modal) | B20 | src/components/starter-pack/actions.ts:31 | logActivity | starter_pack_not_now | no | once | OK |
| Pack snooze (Today card 'Not now') | B20 | src/lib/starter-pack/server.ts:118 | logActivity | starter_pack_not_now | no | once | OK |
| Buy the pack, saved card | B20 | src/app/api/billing/starter-pack/route.ts:135 (+ webhook src/lib/stripe/webhook.ts:326) | logActivity + recordActivity | starter_pack | yes | once (dedupe starter_pack:pi) | OK |
| Buy the pack via Checkout | B20 | src/lib/stripe/webhook.ts:326 | recordActivity (deps) | starter_pack (or topup if blocked) | yes | once | OK |
| £5 decision → Starter plan | B20 | src/app/api/billing/subscribe/route.ts:53 | logActivity | low_credit_starter | yes | once per day | OK |
| £5 decision → top-up | B20 | src/app/api/billing/topup/route.ts:43 (+ topup) | logActivity | low_credit_topup | yes | once per day | OK |
| Cookie choice (signed in) | B19 | src/app/api/consent/route.ts:54 → src/lib/tracking/consent-server.ts:135 | logActivity | cookie_choice | no | once | OK |
| View Today (on screen) | B9 | src/components/activity/VisitHeartbeat.tsx:161,166 → src/app/api/presence/route.ts:29 → src/lib/activity/presence.ts:54 | recordActivity (after) | today_view | yes | once per UK day + once after 07:00 change | OK |
| Heartbeat load/page/beat/resume/hide | B9 | src/lib/activity/presence.ts:38 | activity_visit_touch RPC (visit only) | — | visit | 20 s beat drop | OK |
| Arrive from email (?via=email) | B9 | presence.ts:50 | recordActivity | email_click | no (engaged) | once per visit | source column unset: finding |
| Arrive from text (/m → /my-deals?via=sms) | B9 | src/app/m/route.ts:8 → presence.ts:50 | recordActivity | sms_click | no (engaged) | once per visit | OK |
| Profile check on Today shown | B14 | src/app/today/page.tsx:124 | logActivity (render) | tailoring_prompt_shown | no | once/question/day | OK |
| Profile check accepted / dismissed | B14 | src/app/today/tailoring-actions.ts:50,63 | logActivity | tailoring_prompt | yes | once | OK |
| Widen offered | B14 | src/app/today/page.tsx:143 | logActivity (render) | tailoring_widen_shown | no | once/day | OK |
| Widen applied | B14 | src/app/today/tailoring-actions.ts:99 | logActivity | tailoring_widen | yes | once | OK |
| Leads card tapped | B14 | src/app/today/tailoring-actions.ts:70 | logActivity | leads_upsell_clicked | yes | once | OK |
| Profile reminder shown / tapped / hidden | B12 | src/app/today/_components/ProfileProgressCard.tsx:20; src/app/today/profile-actions.ts:20; src/lib/profile/server.ts:448 | logActivity | profile_reminder_shown (no) / _tapped / _collapsed (yes) | see kind | shown once/day | OK |
| First-week checklist step | B11 | src/lib/today/checklist-server.ts:71 (page + src/app/today/actions.ts:153) | logActivity | checklist_step | no | once per step | OK |
| Keep | B5/B9 | src/app/deals/actions.ts:110 | logActivity | keep | yes | once | OK |
| Pass | B5/B9 | src/app/deals/actions.ts:110 | logActivity | pass | yes | once | OK |
| Undo Keep/Pass | B9 | src/app/deals/actions.ts:110 | logActivity | reaction_clear | yes | once | OK |
| Pass reasons | B9 | src/app/deals/actions.ts:120 | logActivity | pass_reasons | yes | once (2nd event after pass, by design) | OK |
| View a deal page (on screen) | B9 | src/lib/activity/heartbeat.ts:39 → presence.ts:56 | recordActivity | deal_view | yes | once/deal/day | OK (path /deals/[id] matches) |
| Open a deal (paid open / Quick look) | B5/B10 | src/app/deals/actions.ts:60 | logActivity | deal_open | yes | once per deal ever (deal_open:<id>) | OK |
| Open with stage (My deals 'Open to contact') | B7 | src/app/deals/actions.ts:63 | logActivity | stage_move (via open) | yes | once | OK |
| Save opened deal to My deals | B5 | src/app/deals/actions.ts:71 | none | — | — | — | missing: finding |
| Share a deal (/d link) | B9 | src/app/deals/actions.ts:138 | logActivity | deal_share | yes | once (60 s window) | OK |
| Full analysis start (opens deal if needed) | B10 | src/app/api/deals/[id]/analysis/route.ts:34 → src/lib/analysis/deal-analysis.ts:369 | logActivity | deal_open (via full_analysis) | yes | shares deal_open:<id> | OK |
| Reminder acted (analysis from reminder) | B10 | src/lib/analysis/deal-analysis.ts:398 | logActivity | reminder_acted | yes | once/place/deal/stage | OK |
| Reminder shown | B10 | src/app/api/deals/[id]/reminder/route.ts:29 | logActivity | reminder_shown | no | once/place/deal/stage | OK |
| Full analysis complete (+ PMI ticked) | B10 | src/app/api/deals/[id]/analysis/run/route.ts:60 → src/lib/analysis/deal-analysis.ts:630 | recordActivity (in after) | full_analysis (extras pmi) | yes | once per purchase | OK |
| PMI second opinion add-on | B10 | src/app/api/reports/[id]/pmi/route.ts:28 → src/lib/analysis/pmi-addon.ts:217 | logActivity | pmi_addon | yes | once per report | OK |
| Address report (/estimate, /str-report → /api/analyse) | B9 | src/app/api/analyse/route.ts:278 | recordActivity (stream) | report_run | yes | once per action id, only when saved | OK |
| Report via API /api/v1/analyse or MCP | API | src/app/api/v1/analyse/route.ts:61 & src/lib/api/mcp-tools.ts:412 → src/lib/api/reports-write.ts:52 | logActivity | api_report | no | once (dedupe) | OK |
| Report via extension | Ext | src/app/api/ext/check/route.ts:53 | logActivity | extension_check | no | once | OK |
| Extension connect / revoke token | Ext | src/app/extension/connect/actions.ts:13,25 | none | — | — | — | missing (Low finding) |
| Open a saved report (/reports/[id] on screen) | B9 | src/lib/activity/heartbeat.ts:41 → presence.ts:58 | recordActivity | report_view | yes | once/report/day | OK |
| Delete a report | B9 | src/app/reports/actions.ts:26 | logActivity | report_deleted | yes | once | OK |
| Download report PDF | B9 | src/app/api/generate-pdf/route.tsx:122 | logActivity | pdf_download (report) | yes | once | OK |
| Download area PDF | B9 | src/app/api/market-pdf/route.tsx:30 | logActivity | pdf_download (area) | yes | once | OK |
| Download PDF via API | API | src/app/api/v1/reports/[id]/pdf/route.ts:14 | none | — | — | — | missing (Low finding) |
| Shared deal-sheet PDF (/api/deal-pdf) | B5 | src/app/api/deal-pdf/route.tsx:12 | none (public, token) | — | — | — | OK (not a member action) |
| Move stage in My deals (dropdown, each stage) | B5/B7 | src/app/my-deals/actions.ts:31 | logActivity | stage_move (from,to) | yes | once | OK |
| Next-step advance button | B7 | src/app/my-deals/next-step-actions.ts:42 → src/lib/pipeline/events.ts:23 | logActivity | stage_move (via next_step) | yes | once | OK |
| Checklist tick / untick | B7 | next-step-actions.ts:60 → events.ts:23 | logActivity | next_step (tick/untick) | yes | once | OK |
| Copy / open-in-email message (incl. offer message) | B7 | next-step-actions.ts:69 → events.ts:23 | logActivity | next_step (copy/email) | yes | once | OK |
| Secured 'Talk to us' enquiry | B7 | next-step-actions.ts:84 → events.ts:23 (markets/actions.ts:97 skipped) | logActivity | next_step (enquiry) | yes | once | OK |
| Offer range (view/typed amount) | B7 | src/app/my-deals/_components/NextStepSlot.tsx (client) | none (display only; copy logged above) | — | — | — | OK |
| Explorer stage change on listing | B5 | src/app/markets/actions.ts:119 | logActivity | stage_move (via explorer) | yes | once | OK |
| Listing notes | B5 | src/app/markets/actions.ts:128 | logActivity | listing_notes | yes | once | OK |
| Remove listing | B5 | src/app/markets/actions.ts:136 | logActivity | listing_removed | yes | once | OK |
| Share / unshare listing | B5 | src/app/markets/actions.ts:146,157 | logActivity | listing_share (on/off) | yes | once | OK |
| Listing check (paste link, recheck refresh=true) | B5 | src/app/api/listing/resolve/route.ts:43 | logActivity | listing_check | yes | once | OK |
| Quick estimate | B5 | src/app/api/listing/quick-estimate/route.ts:72 | logActivity | quick_estimate | yes | once | OK |
| Explorer star / unstar area | B9 | src/app/markets/actions.ts:37,32 | logActivity | area_saved / area_removed | yes | once | OK |
| Explorer market search / area page, Browse grid, My deals, Picks, Reports list views | B9 | src/app/markets/*, src/app/deals/page.tsx, src/app/my-deals/page.tsx | none (visit only; heartbeat.ts:35 viewFor) | — | — | — | missing: finding |
| Management enquiry (Explorer) | B9 | src/app/markets/actions.ts:97 | logActivity | management_enquiry | yes | once | OK |
| Saved profile create | B13 | src/app/profiles/actions.ts:69 → src/lib/profiles/server.ts:286 (+ :301) | logActivity | saved_profile_created + saved_profile_switched | yes | twice for 2nd+ profile | finding |
| Saved profile switch (menu / page / email link) | B13 | src/app/profiles/actions.ts:48; src/app/profiles/switch/route.ts:26 → server.ts:301 | logActivity | saved_profile_switched | yes | once | email path counts as in-app: finding |
| Saved profile rename | B13 | src/lib/profiles/server.ts:318 | logActivity | saved_profile_renamed | yes | once | OK |
| Saved profile pause / resume | B13 | src/lib/profiles/server.ts:334 | logActivity | saved_profile_paused / _resumed | yes | once | OK |
| Saved profile delete | B13 | src/lib/profiles/server.ts:362 | logActivity | saved_profile_deleted | yes | once | OK |
| Profile page viewed | B12 | src/app/profile/page.tsx:66 | logActivity (render; no loading.tsx so no prefetch) | profile_viewed | yes | once/60 s | OK |
| Profile opened from daily email | B12 | src/app/profile/page.tsx:67 (+ heartbeat email_click) | logActivity | profile_email_click | no (engaged) | once/day | two records per click: finding |
| Advanced answers saved | B12 | src/app/profile/actions.ts:58 | logActivity | profile_edited (advanced) | yes | once | OK |
| Must-have / nice-to-have switch | B14 | src/app/profile/actions.ts:84 | logActivity | tailoring_mode | yes | once | OK |
| 'Yes more like this' / 'Not for me' from the email (/p/d) | B14 | src/app/p/d/[token]/[deal]/actions.ts:19 → src/lib/tailoring/email-answers-server.ts:74 | logActivity | email_feedback (teaser) | no (engaged) | once (GET writes nothing) | OK (keep/pass written, logged as email answer by policy) |
| Pick email link ?a=yes/no (/p/[token] GET) | B6/B9 | src/app/p/[token]/page.tsx:45 | logActivity on GET | email_feedback (via link) | no (engaged) | once per pick/answer | scanner engages: finding |
| Pick reasons form (/p/[token]) | B6/B9 | src/app/p/[token]/actions.ts:17 | logActivityForPick | email_feedback (via form) | no (engaged) | once | OK |
| Pick form adds a deal type (Q25) | B17 | src/app/p/[token]/actions.ts:20 | logActivity | profile_edited (source email_link) | yes | once | qualifying from email: finding |
| Pick unsubscribe (page form / one-click) | B6 | src/app/p/[token]/actions.ts:29; src/app/api/picks/unsubscribe/[token]/route.ts:20 | logActivity | email_settings (on:false) | no, not engaged | once | OK |
| Pick relaxation applied | B6 | src/app/p/[token]/actions.ts:44 | logActivityForPick | email_settings (pick_search) | no (engaged) | once | OK |
| Pick answer on /picks page | B6/B9 | src/app/picks/actions.ts:64 (+ :67 profile_edited if type added) | logActivity | pick_feedback | yes | once | OK |
| Save pick to My deals | B6 | src/app/picks/actions.ts:53 | logActivity | pick_saved | yes | once | OK |
| Notification switch | B6 | src/app/account/notifications/actions.ts:24 | logActivity | notification_settings | yes | once | OK |
| SMS on/off switch | B8 | src/app/account/notifications/sms-actions.ts:68 | logActivity | notification_settings (sms) | yes | once | OK |
| Mobile verification | B8 | src/app/account/notifications/sms-actions.ts:58 | logActivity | sms_verified | yes | once | OK |
| Unsubscribe digest/week email (page or one-click) | B6 | src/app/api/notify/unsubscribe/[token]/route.ts:58 | logActivity | email_settings (on:false) | no, not engaged | once | OK |
| SMS STOP / START reply | B8 | src/app/api/twilio/inbound/route.ts:57-65 | none | — | — | — | missing: finding |
| Top-up, saved card | B9 | src/app/api/billing/topup/route.ts:73 (+ webhook.ts:250) | logActivity + recordActivity | topup | yes | once (topup:pi) | OK |
| Top-up via Checkout | B9 | src/lib/stripe/webhook.ts:250 | recordActivity (deps) | topup | yes | once | OK |
| Auto top-up (system) | B9 | src/lib/stripe/auto-topup.ts:57 (+ webhook.ts:250) | recordActivity | auto_topup | no | once | OK |
| Auto top-up setting | B9 | src/app/api/billing/auto-topup/route.ts:43 | logActivity | auto_topup_settings | yes | once | OK |
| Subscribe (plan start, Checkout or saved card) | B9/B20 | src/lib/stripe/webhook.ts:240 (plan_start:<subId>) | recordActivity (deps) | plan_start | yes | once | OK |
| Plan change (portal) | B9 | src/lib/stripe/webhook.ts:656 → :240 | recordActivity | plan_change | yes | once per event | admin dashboard changes also count: Low finding |
| Pause plan | B9 | src/app/account/actions.ts:157 (+ webhook.ts:638) | logActivity | plan_pause | yes | once; twice on race | finding |
| Resume plan / cancel pause | B9 | src/app/account/actions.ts:157 (webhook 'resumed' → null) | logActivity | plan_resume | yes | once | OK |
| Cancel plan | B9 | src/app/account/actions.ts:157 (+ webhook.ts:645) | logActivity | plan_cancel | yes | once; twice on race | finding |
| Keep plan (undo cancel) | B9 | src/app/account/actions.ts:157 (+ webhook.ts:653) | logActivity | plan_cancel_undone | yes | once; twice on race | finding |
| Redeem code (incl. typed referral code) | B9 | src/app/api/billing/redeem/route.ts:33 | logActivity | credit_code_redeemed | yes | once | OK |
| Referral code at sign-up | B9 | src/lib/credit/referral.ts (grant) | none (system) | — | — | — | OK by design |
| Team invite | B9 | src/app/account/team/actions.ts:38 | logActivity | team_invite | yes | once | OK |
| Team accept invite | B9 | src/app/team/join/actions.ts:21 | logActivity | team_join | yes | once | OK |
| Team leave / remove member / revoke invite | B9 | src/app/account/team/actions.ts:65,51,43 | none | — | — | — | missing (Low finding) |
| Feedback form opened | B18 | src/app/api/feedback/open/route.ts:24 | logActivity | feedback_opened | yes | once | OK |
| Feedback sent | B18 | src/app/api/feedback/route.ts:98 | logActivity | feedback_sent | yes | once (dedupe) | OK |
| Feedback status page from email | B18 | src/app/account/feedback/page.tsx:56 (+ heartbeat email_click) | logActivity | feedback_email_click | no (engaged) | once | two records per click: finding |
| Announcement shown / dismissed / 'Take a look' | B18 | src/app/api/announcements/route.ts:32 → src/lib/feedback/announcements-server.ts:124,138,146 | logActivity | announcement_shown (no) / _dismissed / _clicked (yes) | see kind | shown/clicked once per id | OK |
| Project deal view / working / line edit / line add | B17 | src/app/api/deals/[id]/project/route.ts:57 | logActivity | project_view / _working / _line_edit / _line_add | yes | once/deal(/line)/day | OK |
| Project figures lock / unlock | B17 | src/app/deals/project-actions.ts:57,71 | logActivity | project_lock / project_unlock | yes | once per version | OK |
| Leads: funnel create/brand/rules/toggle, lead archive/restore/stage, API key mint/revoke, integrations, push | Leads | src/app/leads/actions.ts, lead-actions.ts:121, api/actions.ts:38, integrations/actions.ts | none | — | — | — | missing: finding |
| goals_saved / goals_cleared / welcome_skipped / topup_unknown kinds | B9 | no live caller (backfill only: schema.sql:3282 topup_unknown) | activity_backfill SQL | — | — | — | OK (history) |
| Reads of activity_events outside the log | B10/B14/B17 | src/lib/analysis/take-up-server.ts:31, src/lib/tailoring/server.ts:116, src/lib/project/admin-server.ts:140 | .select only | — | — | — | OK (no writes outside activity_log/backfill) |

#### Non-actions

_E · what must not count_

| thing | file:line | recorded? | kind | counts? | verdict |
|---|---|---|---|---|---|
| Email open (tracking pixel) | none: grep for open.gif / 1x1 / open tracking finds nothing in src/lib/notify or src/app/api | no | — | no | clean |
| /api/track POST (marketing session tracker) | src/app/api/track/route.ts:7-35; src/lib/apis/monday.ts:218-220 | console + in-memory only; syncTimeOnSiteToMonday is a no-op | — | no | clean (unauthenticated but writes nothing) |
| /api/tracking/touch, /me, /claim (Batch 19) | src/app/api/tracking/*/route.ts | attribution cookie, consent, Meta claims only | — | no | clean |
| Every cron (alerts, listing-recheck, deal-alerts, sms-alerts, sourcing, picks-paused, daily-digest, credit-sweep, deal-checks, project-checks, marketplace-*, demand-sourcing, low-entry-search, planning-signals, funnel-queue, crm-deliveries, monday-funnel, lead/activity/feedback retention, team-seats) | src/app/api/internal/*; libs they call (lib/notify, lib/listing/picks-run.ts, lib/credit, lib/crm) | no logActivity/recordActivity in any of them (grep of all 100 call sites) | — | no | clean |
| Daily deal charge / credit sweep | src/lib/credit/*, /api/internal/credit-sweep | nothing recorded | — | no | clean |
| Auto top-up | src/lib/stripe/auto-topup.ts:57; src/lib/stripe/webhook.ts:250 | yes | auto_topup, source 'system' | no (recordOnly) | clean |
| Stripe webhook: card top-up / starter pack the member bought | src/lib/stripe/webhook.ts:250, 325-326 | yes, keyed topup:pi / starter_pack:pi | topup / starter_pack | yes | acceptable: the member's purchase, deduped with the app's own key |
| Stripe webhook: subscription state changes | src/lib/stripe/webhook.ts:234-241, 636-656 | yes | plan_start / plan_pause / plan_cancel / plan_cancel_undone / plan_change | yes | finding: logged whoever made the change (admin in Stripe, Stripe itself) |
| Monday funnel sync, queue drain, backfill | src/lib/crm/monday-funnel/sync-server.ts | board + profiles.monday_item_id only | — | no | clean |
| Activity backfill | src/lib/activity/admin-server.ts:99 → activity_backfill (schema.sql:3220) | yes, backfilled = true | historic kinds | yes (history, by design) | clean |
| Activity retention delete | src/lib/activity/admin-server.ts:135; schema.sql:3379 | deletes only | — | no | clean |
| Admin 'Send me a test pick' | src/app/admin/picks/actions.ts:35; src/lib/listing/picks-run.ts:406, 1180, 1308 | admin's own account, marks no slot, pauses nobody | — | no (admin excluded) | clean |
| Admin 'Run a pass now' (demand) | src/app/admin/demand/page.tsx:33; src/lib/sourcing-demand/run.ts | nothing recorded | — | no | clean |
| Admin viewing a member's page / impersonation | none exists (grep impersonat/view as/actAs) | — | — | no | clean |
| Cookie choice (Batch 19) | src/lib/tracking/consent-server.ts:135 | yes | cookie_choice | no (recordOnly) | clean |
| Pack offer shown / 'Not now' (Batch 20) | src/lib/starter-pack/server.ts:118, 125; src/components/starter-pack/actions.ts:31 | yes | starter_pack_shown / starter_pack_not_now | no | clean |
| Reminder shown (Batch 10) | src/app/api/deals/[id]/reminder/route.ts:29 | yes | reminder_shown | no | clean |
| Announcement shown | src/lib/feedback/announcements-server.ts:124 | yes | announcement_shown | no | clean |
| Profile reminder / tailoring prompt / widen shown | src/app/today/_components/ProfileProgressCard.tsx:20; src/app/today/page.tsx:124, 143 | yes | profile_reminder_shown / tailoring_prompt_shown / tailoring_widen_shown | no | clean |
| First-week checklist step (from AppShell after()) | src/lib/today/checklist-server.ts:71; src/components/AppShell.tsx:57 | yes | checklist_step | no | clean |
| Heartbeat 'beat' / 'resume' / 'hide' | src/lib/activity/presence.ts:38-45; schema.sql:2956 | visit row only | — | no | clean: a tab left open logs nothing after the load |
| Heartbeat 'load' / 'page' with Today, a deal or a report on screen | src/lib/activity/presence.ts:53-58 | yes (once per day / per id per day) | today_view / deal_view / report_view | yes (qualifying and counted) | finding: a page view is an action; email CTAs land here |
| Email link click (?via=email) | src/lib/activity/presence.ts:49-51; src/lib/notify/render-email.ts:126-132 | yes, once per visit | email_click | no | clean in itself (see the view row) |
| SMS click (/m → /my-deals?via=sms) | src/lib/activity/presence.ts:49-51 | yes | sms_click | no | clean (/my-deals is not a heartbeat view) |
| Unsubscribe: one-click, page, pick unsubscribe | src/app/api/notify/unsubscribe/[token]/route.ts:58; src/app/api/picks/unsubscribe/[token]/route.ts:20; src/app/p/[token]/actions.ts:29 | yes | email_settings extras.on=false | no; not engagement (rules.ts:49-53; schema.sql:5483) | clean |
| Pick answer from the email link or the /p form | src/app/p/[token]/page.tsx:45; src/app/p/[token]/actions.ts:17 | yes | email_feedback | no | clean |
| Pick 'Not for me' that adds a deal type (public /p page) | src/app/p/[token]/actions.ts:20 | yes | profile_edited | YES | finding: qualifying with no sign-in |
| Filter relaxation accepted from the pick page | src/app/p/[token]/actions.ts:44 | yes | email_settings | no | clean |
| Teaser answers from the digest | src/lib/tailoring/email-answers-server.ts:74 | yes | email_feedback | no | clean |
| /profile?via=email | src/app/profile/page.tsx:66-67 | yes | profile_email_click (no) + profile_viewed (yes) | mixed | same as the view finding: the render logs profile_viewed |
| /account/feedback from a status email | src/app/account/feedback/page.tsx:56 | yes | feedback_email_click | no | clean |
| Browser extension check / API report | src/app/api/ext/check/route.ts:53; src/lib/api/reports-write.ts:52 | yes | extension_check / api_report | no | clean |
| Welcome skipped, topup before tracking | src/lib/activity/kinds.ts:156-157 | kinds exist | welcome_skipped / topup_unknown | no | clean |
| 60-second identical-event guard | supabase/schema.sql:2894-2905 | — | — | — | finding: drops bare second actions; checks only the latest event |
| dedupeKey uniqueness | supabase/schema.sql:2788, 2927-2930 | unique (user_id, dedupe_key), ON CONFLICT DO NOTHING | — | — | clean |

#### Exclusions applied

_E · what must not count_

| figure | file | ADMIN_EMAILS | @stayful | switch (activity_excluded_accounts) | team members |
|---|---|---|---|---|---|
| Weekly active figures and drill-down (/admin/weekly-active, /admin headline) | src/lib/activity/metrics.ts:159-170, 216-222; admin-server.ts:43-54; src/app/admin/page.tsx:100 | yes | yes | yes (excluded list from activity_weekly_facts) | counted as their own active member; billing group from the owner (metrics.ts:239-242) |
| Sign-ups by source (/admin/signups) | src/lib/tracking/report-server.ts:62-70; report.ts:176-192 | yes | yes | yes, but only when activity_weekly_facts read succeeds (finding) | invitees (member_attribution.team_invite) left out and counted in a note |
| Sign-ups weeks 2–4 active columns | src/lib/tracking/report.ts:118-122 (computeWeeklyActive) | yes | yes | yes | own activity |
| Monday funnel nightly / queue / backfill (groups, Last active, Active days/weeks) | src/lib/crm/monday-funnel/facts-server.ts:89 | yes | yes (isStaffEmail) | NO (finding) | no row (left as team_member) |
| Monday sign-up row (ensureEnquiry at sign-up/sign-in/estimate) | src/lib/apis/monday.ts:104-107, 160 | yes | yes | no | no row (isTeamBound) |
| Monday 'Excluded – duplicate & internal accounts' group | src/lib/crm/monday-funnel/plan.ts:61-63, 72-76; match.ts:139-140; precedence.ts:6 | — | — | rows there are never moved, written or left; the profile is only linked to the row | — |
| Inactivity: Re-engage, picks paused, 'inactive' queue to Monday | src/lib/inactivity/rules.ts:65-66; server.ts:140 | yes | yes | NO (finding) | judged on the owner's plan, own activity |
| cameBack (leave Re-engage on an engaging action) | src/lib/activity/log.ts:55; src/lib/inactivity/came-back.ts:22-37 | n/a (guarded update only where marked) | n/a | n/a | own |
| Demand sourcing member count (/admin/demand) | src/lib/sourcing-demand/demand.ts:84-88; server.ts:74-81, 128-147 | yes | yes | yes | each member counted; 'paying' from the payer; suspended seats skipped |
| /admin/lifecycle: pack counts | src/app/admin/lifecycle/page.tsx:61 (starter_pack_purchases counts) | no | no | no | n/a |
| /admin/lifecycle: nightly / backfill summaries | src/app/admin/lifecycle/Panels.tsx:278, 296 (facts.left) | yes | yes | no | left out (team_member) |
| /admin/profiles | src/lib/admin/profile-server.ts:37-40 | yes | yes | yes (silently skipped if the table cannot be read: finding) | counted as own |
| /admin/tailoring | src/lib/tailoring/admin-server.ts:54-57 | yes | yes | yes (same caveat) | counted as own |
| Meta conversions (pixel/CAPI) | src/lib/meta/conversions.ts:77-88 | yes | yes | yes | excluded ('team') |
| Daily digest / picks / alerts recipients | src/lib/notify/digest-run.ts:152, 215; src/lib/listing/picks-run.ts:454; src/lib/notify/alerts-collect.ts:122 | admin treated as paid / never charged, still sent | no | no | seats follow the owner |
| /admin/activity high-intent list | src/lib/admin/activity.ts; src/app/admin/activity/page.tsx:54-66 | no | no | no | owner's spend includes members |

#### Definitions of active

_E · one definition & inactivity_

| figure | file | which events | time zone | base / exclusions | team members | email clicks | sign-up day |
|---|---|---|---|---|---|---|---|
| /admin/weekly-active "Weekly active" (also the /admin headline, /admin/profiles split) | src/lib/activity/metrics.ts:256-288; supabase/schema.sql activity_weekly_facts 'qdays' (3086-3095); kinds passed from src/lib/activity/admin-server.ts:47-49 | ≥1 activity_events row in the Mon–Sun week whose kind is `qualifying` in kinds.ts (every `inApp` kind; recordOnly kinds never) | Europe/London: UK date of occurred_at; week = date_trunc('week', at time zone 'Europe/London'), named by its Monday (week.ts:24-37) | every profiles row from the week created_at falls in (unconfirmed sign-ups included); less ADMIN_EMAILS, @stayful.co.uk, activity_excluded_accounts (metrics.ts:159-170) | counted as their own member on their own actions; billing group is the owner's (metrics.ts:239-242) | no: email_click, sms_click, email_feedback, email_settings, profile_email_click, feedback_email_click are recordOnly | not an action; the day counts only if a qualifying event was logged (today_view, welcome_completed, starter_pack…) |
| /admin/weekly-active "Active paying" | metrics.ts:289-292, 152 | paying (billing.ts, judged at week end or now) and paidRecently (90 days) and a qualifying action in the 30 UK days ending at the week's end | UK | paying members only | owner's billing | no | no |
| /admin/weekly-active drill-down "last action" | schema.sql 'last' (3187-3196); metrics.ts:360 | latest event whose kind is counted or qualifying (the same inApp set) | instant | included members | own | no | no |
| /admin/signups "signed in" (who counts as a sign-up) | schema.sql signup_source_facts 5137; src/lib/tracking/report.ts:181-184 | auth.users.last_sign_in_at is not null — ever signed in, not activity | n/a | accounts created in range with a member_attribution row or lead_source; drops never-signed-in, team invites, non-production, and the weekly-active exclusions (report-server.ts:66-69) | left out (a.team) | n/a | n/a |
| /admin/signups "weekly active weeks 2–4" | src/lib/tracking/report.ts:112-123; report-server.ts:55-62 | computeWeeklyActive drill-down (same rule as row 1), read for each member | UK | as the row above | left out | no | week 1 = the calendar week (Mon–Sun) the sign-up falls in, not shown; weeks 2–4 = the next three calendar weeks, counted only once over. A Sunday sign-up's 'week 2' starts the next day |
| Monday "Last active", "Active days", "Active weeks" | schema.sql lifecycle_member_stats 5522; lifecycle_active_days_sync 5446-5508; src/lib/crm/monday-funnel/facts-server.ts:162-164; values.ts:57-59 | member_active_days: one row per member per UK day with an event in QUALIFYING_KINDS, filled nightly from activity_events past an id watermark; weeks = distinct date_trunc('week') (ISO Monday) | Europe/London | every profile with an email, less ADMIN_EMAILS, @stayful.co.uk, team members (facts-server.ts:88-92); NOT activity_excluded_accounts; the board's Excluded group is never entered or left | no row | no (member_engaged_days is kept apart and not written to the board) | not counted; Active days/weeks only from events (backfill floor, 24-month log; member_active_days persists after retention) |
| Monday "Engagement %" (board formula) | monday-board.txt; config.ts:92 NEVER_WRITTEN | Active weeks ÷ ROUNDUP(DAYS(TODAY(), Signed up) / 7, 0) | Monday account's TODAY() | — | — | — | divisor 0 on the sign-up day; seven-day blocks vs ISO weeks (finding 1) |
| Inactivity: Re-engage / picks paused | src/lib/inactivity/rules.ts:86-107; server.ts:121-152; schema.sql 5560 last_engaged | quiet days = UK today − latest of (last member_active_days day, last member_engaged_days day, created_at UK day, inactivity_from UK day); engaged = QUALIFYING_KINDS + email_click, sms_click, email_feedback, email_settings, profile_email_click, feedback_email_click unless extras.on = false | Europe/London | eligible only: not ADMIN_EMAILS, not @stayful.co.uk, and the plan holder is not paid/subscription_trial/paused unless cancellation booked (rules.ts:65-69); NOT activity_excluded_accounts; unconfirmed accounts included | marked on their own activity, judged by the owner's plan (server.ts:137) | yes (a click through, an answer, a setting changed from an email; an unsubscribe no) | not an active day; created_at is the anchor quiet days count from |
| Demand sourcing "seen in the last demand_active_days (30) days" | src/lib/sourcing-demand/server.ts:60-61, 126-127; demand.ts:84-90; billing_settings demand_active_days (schema.sql 4173) | profiles.last_seen_at within 30×24h: stamped by AppShell on any members-only page render at most hourly (AppShell.tsx:48), the estimate layout, and /api/analyse | UTC instants | less ADMIN_EMAILS, @stayful.co.uk, activity_excluded_accounts (exclusionFor) | a team counts once, as the paying account (server.ts:143) | yes, if the click lands on an AppShell page | first page load counts |
| /admin/activity "Last active" | src/lib/admin/activity.ts:97; app/admin/activity/page.tsx:38 | latest of last_seen_at, deal open, report run, credit debit in the window | instants | profiles listed (LIMIT) | own | via last_seen_at | first page load |
| /admin home "Last seen"; /admin/deals "members seen in the window" | src/app/admin/page.tsx:262,282; src/app/admin/deals/page.tsx:158 | profiles.last_seen_at | instants | all profiles | own | via last_seen_at | first page load |
| /admin/profiles (weekly active by one vs many profiles); /admin/tailoring (who counts) | src/lib/profiles/admin-server.ts:28 (loadWeeklyActive); src/lib/tailoring/admin-server.ts:51-57 (exclusionFor) | same as row 1 | UK | same exclusions as row 1 | same | no | same |

**Where they differ and whether intended:** kinds — rows 1, 5, 6, 12 share QUALIFYING_KINDS (intended, one list); inactivity adds the six email/text kinds (intended, README §16.6) but not extension_check/api_report or grid page views (finding 3); demand, /admin/activity, /admin home and /admin/deals use last_seen_at, any page load (intended for demand's 'seen', but the shared label 'Last active' is not: finding 4). Time zone — everything action-based is Europe/London; last_seen_at figures are raw instants (harmless). Team members — weekly active counts them singly under the owner's billing; Monday has no row; inactivity marks them on their own actions under the owner's plan; signups leaves them out; demand counts a team once (all documented, intended). Exclusions — the 'Exclude from metrics' switch is honoured by weekly active, signups, profiles, tailoring and demand but not by inactivity or Monday (finding 5); never-signed-in accounts are in the weekly-active base but not the signups base (finding 2). Sign-up itself — never an action anywhere (consistent); inactivity anchors on created_at (intended). Email clicks — never weekly active or Monday Last active; engaging for inactivity unless an unsubscribe (intended, tested in rules.test.ts:56-67).

#### Inactivity precedence

_E · one definition & inactivity_

| state | condition | beats | file:line |
|---|---|---|---|
| **Monday funnel group (precedence.ts funnelGroup, checked in this order)** | | | |
| Excluded (board group) | the member's row is in the board's Excluded group; never entered or left; the member is planned no further | everything | src/lib/crm/monday-funnel/plan.ts:61-63, 72-76 |
| untouched (row stays put) | plan 'pro', plan_source 'manual', no plan_code; or a live plan whose code has no tier (planTier null) | every group below | precedence.ts:59, 63, 29-34 |
| Payment issues | stripe_subscription_status past_due or unpaid | Paused, plan groups, Re-engage, Cancelled, Low credit, PAYG, Pack, Free | precedence.ts:61 |
| Paused plan | inside a pause window (isPaused) or accountStatus 'paused' | plan groups, Re-engage and below | precedence.ts:62 |
| 5. Starter / 6. Pro (incl. annual) / 7. Scale | accountStatus paid or subscription_trial and no subscription_cancel_at | Re-engage, Cancelled, Low credit, PAYG, Pack, Free | precedence.ts:36-39, 63 |
| Re-engage (14+ days inactive) | profiles.reengage_since not null | Cancelled, Low credit, PAYG, Pack, Free | precedence.ts:64 |
| Cancelled | live plan with cancellation booked; or plan lapsed/ended with no payment since | Low credit, PAYG, Pack, Free | precedence.ts:41-46, 65 |
| 3. Low credit – decision | no plan (free/lapsed), balance ≤ low_credit_pence (£5), and paid ever or account older than the pack cutover | PAYG, Pack, Free | precedence.ts:52-55, 66 |
| 4. Pay as you go | no plan and topups > 0 | Pack, Free | precedence.ts:67 |
| 2. £10 starter pack | starter pack granted | Free | precedence.ts:68 |
| 1. Free sign-up | everyone else | — | precedence.ts:69 |
| **Inactivity marks (rules.ts + server.ts, nightly from 06:00 UK)** | | | |
| Rules off | billing_settings.inactivity_from null → daysQuiet null → reengage false, picksPaused false; every stored mark is cleared | all marks | rules.ts:86-88, 101-103; server.ts:170, 173 |
| Not eligible (never quiet) | ADMIN_EMAILS, @stayful.co.uk, or the plan holder (team owner for a member) has accountStatus paid / subscription_trial / paused with no booked cancellation (a manual plan is never cancel-booked). past_due counts as paid | any quiet count; stored marks cleared | rules.ts:57-69; server.ts:137-140; access.ts:68-72, 160-184 |
| Quiet days | UK today − max(last member_active_days day, last member_engaged_days day, created_at UK day, inactivity_from UK day), floored at 0 | — | rules.ts:71-92; schema.sql 5560 |
| Re-engage set | eligible and days ≥ inactive_reengage_days (14, min 1) and reengage_since null; written only when the sync was complete, only-if-null | Cancelled/Low credit/PAYG/Pack/Free on the board | rules.ts:104-106, 117-124; server.ts:169 |
| Picks paused set | eligible and days ≥ picks_pause_inactive_days (25, min 1) and picks_paused_inactive_at null; also resets picks_paused_inactive_email_at | the daily picks run and Today's 5 in the digest | rules.ts:105-106; server.ts:172 |
| Cleared by the nightly | target false: came back (a synced day ≥ today−13/−24), no longer eligible (bought a plan, made admin), or rules off | both marks | server.ts:170, 173 |
| Cleared at once (came back) | any engaging action inserted as a new row (not a dedupe_key or 60-second repeat): QUALIFYING_KINDS or the email/text kinds with extras.on ≠ false; incl. topup, plan_start, starter_pack, credit_code_redeemed from webhooks/routes | both marks and the email stamp; Monday queued 'came_back' | rules.ts:49-53; src/lib/activity/log.ts:55; came-back.ts:22-38; stripe/webhook.ts:240, 250, 326 |
| Not cleared | auto_topup (system), extension_check, api_report, an unsubscribe (extras.on false), a redelivered webhook (dedupe → null), grid page views | — | kinds.ts:154-159; rules.ts:51-52; log.ts:52-55 |
| Picks run skips | picks_paused_inactive_at not null (never for the admin's test send); checked before plan pause / already-today; nothing charged | — | src/lib/listing/picks-run.ts:407-416 |
| Digest drops Today's 5 | same set; excluded before the per-day charge; tracked-deal changes still sent | — | src/lib/notify/digest-run.ts:166-169, 228 |
| Away letter | picks_paused_inactive_at set and picks_paused_inactive_email_at null; sourcing_alerts true; alert_credit ≠ false; seat not suspended; day's daily slot free (one non-billing email a day); stamped only after a successful send → one per pause | — | src/lib/listing/picks-paused-run.ts:322, 350-364, 412; src/lib/notify/cap.ts SLOT_FOR |
| Nightly gate | from 06:00 UK, once per UK day (monday_funnel_runs.inactivity_at), retried every 10 minutes until ok and complete; /admin/lifecycle can only force a dry run | — | sync-server.ts:41, 211-224, 309; app/admin/lifecycle/actions.ts:82 |
| Incomplete sync | more than 50 000 new events in the 20 s budget → no new marks, clears still written, runs again next tick | — | server.ts:94-97, 169, 172, 175-178 |

**Answers:** a paying subscriber (live plan, no cancellation booked; past_due, trial, paused and manual Pro included) can never be marked Re-engage or paused (rules.ts:65-69) and sits in its plan group ahead of Re-engage (precedence.ts:63-64); only one who booked cancellation can (finding 8). 'Picks paused' stops the daily picks email and Today's 5 for a cancelling subscriber but not the subscription. A member who acts today is not paused tonight: cameBack clears at once and the nightly runs once a day in the morning on days synced in the same step, so yesterday's action is 1 quiet day; the only exception is the seconds-wide race in finding 6. Nobody is paused twice in a day (once-per-day gate; the admin page forces only a dry run). picks_paused_inactive_at is cleared by an action (came-back.ts:24-29) and by the nightly. The pause stops the daily charge (skipped before any charge in both runs). A card top-up, plan purchase, starter pack or credit code clears the pause at once via their qualifying kinds; a manual admin grant clears it at the next nightly (not eligible); only auto_topup leaves it. The member is told once per pause, in the daily slot, only while 'Daily picks' and 'Picks paused / out of credit' are on. inactivity_from empty = rules off and every mark cleared nightly.

#### Routes

_F · orphans and dead links_

| Route | Inbound links (count; examples) | Status |
|---|---|---|
| `/` (marketing) | many; Nav.tsx:25, Footer.tsx:11, report/page.tsx:160, sitemap:16, next.config `/home`→`/` | live |
| `/features` | 6; Nav.tsx:13, Footer.tsx:28, sitemap:21 | live |
| `/pricing` | 9; Nav.tsx:15, Footer.tsx:30, terms:112, pricing-notice email, sitemap:18 | live (renders `<Pricing />` signed-out for everyone: see finding) |
| `/methodology` | 8; Nav.tsx:11, Footer.tsx:36, ProvenanceStrip:27, AccuracyLedger:151, next.config `/about`→ | live |
| `/income-calculator` | 5; Nav.tsx:14, Footer.tsx:29, sitemap:19 | live |
| `/short-term-vs-long-term-letting` | 5; Nav.tsx:12, Footer.tsx:37, sitemap:20 | live |
| `/demo` | 6; Nav.tsx:46/77, Footer.tsx:31, sitemap:23 | live |
| `/extension` | 4; extension/connect/page.tsx:44, sitemap:24 | live |
| `/extension/privacy` | 5; (marketing)/extension/page.tsx:62, connect/page.tsx:44, sitemap:25 | live |
| `/privacy` (+#cookies, #other-people) | 12; Footer:53, signup-form:92, welcome:100, profile:242, profiles:190, COOKIE_POLICY_HREF, pricing-notice email | live |
| `/terms` | 10; Footer:52, signup-form:91, StarterConfirm:105, privacy:108, pricing-notice email | live |
| `/short-let-deals` | 2; sitemap:28, [slug]/page.tsx:52 (no nav/footer/home link) | live (SEO landing only) |
| `/short-let-deals/[slug]` | 2; short-let-deals/page.tsx:41, sitemap:29 | live (SEO only) |
| `/upgrade` (?redirect=) | 37; 8 layouts (`/upgrade?redirect=/today` …), CreditBanner:68, OutOfCreditModal:100, ReportOptions, CostHint, week email:211, extension content.ts:171, access.ts:268 | live; `redirect` only feeds ← Back and the login bounce |
| `/login` (?redirect=, ?error=, ?email=) | 75; proxy.ts:34, every layout, Nav/Footer, team/join:47, callback/confirm loginUrl, profiles/switch:24 | live |
| `/signup` (?next=, ?ref=, ?plan=) | 31; Nav/Footer, login:70 (no next), SubscribeButton:18 (?plan unread), joinPath (?ref), referral.ts:39, SampleArea:14, [slug]:49/51, team/join:44 | live |
| `/signup/check-email` (?email&next) | 1; (auth)/actions.ts:145 redirect | live |
| `/forgot-password` | 2; login-form.tsx:34, reset-password:27 | live |
| `/reset-password` | 1; actions.ts:212 (`/auth/callback?next=/reset-password`) | live |
| `/auth/callback` | 3; (auth)/actions.ts:31, google-button.tsx:28, actions.ts:212 | live |
| `/auth/confirm` | 1; lib/auth/magic-link.ts:7 (welcome/WhatsApp link) | live |
| `/welcome` (?next=, ?q=) | 17; AppShell gate (requireProfileStart/quizPathFor), profile/page.tsx:74-75, PROFILE_QUIZ_HREF | live |
| `/today` (?offer=pack, ?pack=1, ?check=, #today-list) | 71; NAV_TARGETS, HOME_PATH, every email (`/today`, `?offer=pack`), Stripe return `?pack=1`, checklist TODAY_LIST_HREF | live |
| `/my-deals` (?show=passed, ?focus=, ?tab=reports&q=, ?profile=, ?via=sms) | 44; NAV_TARGETS, `/m`, changeLink/trackedLink emails, MY_DEALS_PASSED_HREF, extension popup.ts:21, /reports redirect | live |
| `/deals` (?type&areas&beds, ?view=kept/passed→redirect, ?msg=) | 36; deals layout, picks email:516, provision welcome:62, [slug]:97 (`?areas=`), GoalsStrip | live; `?view=` redirects to My deals (tested) |
| `/deals/[id]` (?analysis=1, ?msg=, ?from=) | 14+; DealCard:72, picks:210/213, message.ts:247 email, MarketDealsHere:45, opened:83, DealRow:87 | live |
| `/deals/opened` | 1; deals/page.tsx:136 | live |
| `/estimate` (?listing=, ?back=, ?demo=) | 32; DealRow:172, PasteLinkBox:27, ListingDrawer:169, picks email:525, billing email:78, extension content.ts:132, admin:162 | live |
| `/reports` (?q=) | 3; reports/layout.tsx:14/17, README:666 (no UI link) | redirect → `/my-deals?tab=reports` (Batch 5) works |
| `/reports/[id]` (?back=) | 10; DealCard:194, DealRow:163, ReportsList:95/124, AnalysisPanel:73/93/123, my-deals:134, ListingDrawer:208 | live |
| `/markets` (?goals=1→/profile, ?check=, ?pane=listings&listing=, ?q&sort&region&level) | 33; Nav.tsx:10, HomePulse:24, ACCOUNT_MORE, week email:286, DealRow:99, extension content.ts:133, sitemap | live; `?goals=1` redirect works |
| `/markets/[area]` (?sort&district&tab) | 8; AreaCard:35, CompareBar:59/131, FindShell:169/170, deal page:558, week email:285 (`/markets/<code>`, accepted) | live |
| `/markets/map` | 1; lib/tracking/config.ts:92 only | orphan-reachable; redirects → /markets |
| `/picks` (?tab=, ?save=, ?msg=, ?pick=) | 20; ACCOUNT_MORE, today:300, p/[token]:95/249, picks email:524/528, daily-notice email:18 | live (a page, not redirected) |
| `/p/[token]` (?a=yes/no/unsubscribe/relaxed) | 3; picks.ts:522-531 (email), api/picks/unsubscribe GET:27 | live (email only; public) |
| `/p/d/[token]/[deal]` (?a=) | 1; tailoring/email-answers.ts:37 (daily email) | live (email only; public) |
| `/profile` (?via, ?saved, ?new, ?mode, #advanced) | ~45; GOALS_EDITOR_HREF (Today, Account, Picks, Explorer, pill, privacy), profile nudge email, picks email `filter`, `/markets?goals=1` | live |
| `/profiles` (#new-profile) | 6; today:195, ProfilePill:78/81, profile:87, usage:139 | live |
| `/profiles/switch` (?to&next) | 1; lib/profiles/rules.ts:192 (daily/week/picks emails) | live (email only; self-redirects to login with full path) |
| `/m` | 1; lib/sms/render.ts:43 (alert texts) | live → `/my-deals?via=sms` (proxy keeps query) |
| `/d/[token]` | 1; deals/actions.ts:147 (share) | live (public) |
| `/deal/[token]` | 2; ListingDrawer:92/151 | live (public) |
| `/r/[token]` | 3; leads/store.ts:235 (lead email), crm/payload.ts:75, leads/[id]:96 | live (public) |
| `/r/[token]/pdf` | 2; crm/payload.ts:119, integrations guide:60 | live |
| `/f/[token]` (?preview=) | 4; leads/funnels:72, funnels/[id]:86, api/v1/funnels:24, mcp-tools:278 | live (public) |
| `/team/join` (?token=) | 2; lib/team/invites.ts:29 (invite email), signup/login next | live (public) |
| `/extension/connect` | 10; ACCOUNT_MORE, (marketing)/extension:35/56, popup.ts:29, content.ts:169 | live |
| `/account` (?resume=) | 21; NAV_TARGETS, billing-emails ACCOUNT_URL, upgrade:91, pricing-notice email | live |
| `/account/billing` (?topup=1, ?subscribed=1, #topup, ?redirect= unread) | 43; billing emails, UsageChip:23, ManagePlan:151, deal page:289, extension:171, Stripe returns | live |
| `/account/billing/choose` (?pick=) | 1; lib/credit/low-credit.ts:85 (email) | live (email only) |
| `/account/notifications` (?msg=) | 12; manageNotificationsUrl (every email footer), AccountSections:57, picks:93, p/[token]:90 | live |
| `/account/usage` | 4; UsageChip:33/41, account:217, pricing-notice email | live |
| `/account/team` | 9; ACCOUNT_MORE, team emails:56/99/123, billing:30, upgrade:47, choose:37 | live |
| `/account/feedback` (?via&report&status, #report-<ref>) | 2; ACCOUNT_MORE (nav.ts:122), feedback status email:146 | live |
| `/leads` (?tab=archived, filters) | 29; LEADS_NAV, LeadsNav:19, team email:105, lead-retention:79/100 | live |
| `/leads/[id]` | 1; LeadList:105 | live |
| `/leads/[id]/pdf` (route) | 1; LeadDetailActions:77 | live |
| `/leads/export` (route) | 1; leads/page.tsx:305 | live |
| `/leads/funnels` | 13; LeadsNav:20, leads:130/165, integrations:44, tailoring-actions:71 | live |
| `/leads/funnels/[id]` | 5; funnels:83, WallBanner:22, f/[token]:192, funnel-alerts email:97 | live |
| `/leads/integrations` | 8; LeadsNav:21, api page:110, guide:114 | live |
| `/leads/integrations/guide` | 2; integrations:64, WebhookPanel:44 | live |
| `/leads/api` | 3; LeadsNav:22 | live |
| `/report` | 0 member links (surfaces.ts:38 NEVER list, robots `/report/`) | orphan-reachable by old link; public, not noindexed |
| `/str-report` | 0 (README:372 mention; presentation back link:48) | orphan-reachable; noindex |
| `/str-report/presentation` (?postcode&beds&type&mortgage&name) | 1; VerdictChapter.tsx:15 | reachable only from /str-report |
| `/demo-report` (?demo=) | 1; deals/[id]/page.tsx:75 → AnalysisPanel sampleHref | live (public sample) |
| `/presentation` (?demo=) | 1; estimate/page.tsx:1040 window.open | live |
| `/admin` | AppSwitcher:54 (admins) | admin |
| `/admin/activity` | 2 | admin |
| `/admin/announcements`, `/admin/announcements/[id]` (`/new` handled) | 6; announcements/page.tsx:62 | admin |
| `/admin/billing` | 15 | admin |
| `/admin/churn`, `/admin/churn/export` (route) | 2; churn/page.tsx:229 | admin |
| `/admin/deals`, `/admin/deals/projects` | 30 / 4 | admin |
| `/admin/demand` | 10 | admin |
| `/admin/feedback`, `/admin/feedback/[id]` | 10; feedback email adminUrl:77 | admin |
| `/admin/lifecycle` | 7 | admin |
| `/admin/next-steps` | 4 | admin |
| `/admin/picks`, `/admin/picks/responses`, `/admin/picks/responses/export` (route) | 5 / 3 | admin |
| `/admin/profile`, `/admin/profiles` | 1 / 5 | admin |
| `/admin/signups` | 8 | admin |
| `/admin/tailoring` | 2 | admin |
| `/admin/weekly-active` | 11 | admin |
| `/api/address-autocomplete` | 2; AddressAutocomplete.tsx:36 | live |
| `/api/analyse` | 6; estimate page/layout | live |
| `/api/announcements` | 1; AnnouncementBanner:47 | live |
| `/api/billing/auto-topup` `card` `portal` `redeem` `referral` | 1 each; BillingClient.tsx:178/60/224/264, StarterConfirm:34 | live |
| `/api/billing/starter-pack` | 2; StarterPackOffer:49, starter-pack/actions.ts:11 | live |
| `/api/billing/subscribe` | 2; StarterConfirm:52, SubscribeButton:28 | live |
| `/api/billing/topup` | 2; TopupButtons:23, LowCreditChoice:35 | live |
| `/api/consent` | 2; tracking/browser.ts:10/132 | live |
| `/api/credit/balance` `estimate` `usage` | 1/1/2; CreditProvider:67, credit/client.ts:71, BillingClient:313 | live |
| `/api/deal-pdf` (?token=) | 2; deal/[token]:85, ListingDrawer:222 | live |
| `/api/deals/[id]/analysis`, `/analysis/run`, `/project`, `/reminder` | AnalysisPanel:65/85, ProjectViewPing:12/19, reminder-seen.ts:23 | live |
| `/api/deals/photo` | 1; marketplace/queries.ts:466 | live |
| `/api/ext/check` `disconnect` `me` | extension background.ts:48/68/34 | live |
| `/api/f/[token]/analyse` | 1; funnels/mode.ts:42 | live |
| `/api/feedback`, `/api/feedback/open` | FeedbackDialog:186/89 | live |
| `/api/generate-pdf` (?r=) | 4; funnels/index.ts:227, mode.ts:35 | live |
| `/api/get-report` | 1; report/page.tsx:25 only | orphan with /report |
| `/api/internal/*` (33 routes) | vercel.json crons (see crons.txt) + admin buttons + README dry runs; `/api/internal/project-backfill` README:456 only, `/api/internal/provider-spike` admin:221, `/api/internal/screen-report` admin/picks:486, `/api/internal/leads/provision` auth/confirm:12 | live (cron/admin) |
| `/api/listing/quick-estimate` | 0 | orphan (no caller) |
| `/api/listing/resolve` | 7; ListingLinkBox:14/32, estimate:656 | live |
| `/api/market-pdf` (?area=) | 1; MarketHeader:84 | live |
| `/api/mcp` | 1; leads/api/page.tsx:53 | live |
| `/api/notify/unsubscribe/[token]` | 5; low-credit-server:155, picks-paused-run:272/397, digest-run:290, week-run:312 | live (email) |
| `/api/picks/unsubscribe/[token]` | 1; picks.ts:532 (List-Unsubscribe) | live (email) |
| `/api/presence` | 4; VisitHeartbeat:29 | live |
| `/api/reports/[id]/pmi` | 3; PmiAddonCard:23 | live |
| `/api/speak`, `/api/summarise` | AnalyserNarrator:76/141, estimate:3329 | live |
| `/api/stripe/webhook` | Stripe (README:53) | live (webhook) |
| `/api/track` | 4; estimate:469, apis/monday.ts:215 | live |
| `/api/tracking/claim` `me` `touch` | tracking/runtime.ts:180/11/57 | live |
| `/api/twilio/inbound`, `/status` | Twilio (README:113), sms/send.ts:54 | live (webhook) |
| `/api/v1/analyse`, `/funnels`, `/funnels/[id]/rules`, `/leads`, `/leads/[id]`, `/leads/[id]/push`, `/leads/[id]/stage`, `/leads/export`, `/leads/stats`, `/markets/[area]`, `/me`, `/reports`, `/reports/[id]`, `/reports/[id]/pdf` | external API; every path in lib/api/openapi.ts has a route | live (API keys) |
| `/api/v1/openapi.json` | 1; leads/api/page.tsx:66 | live |
| `/sitemap.xml`, `/robots.txt` | robots.ts:37 | live |

#### Dead links

_F · orphans and dead links_

| From file:line | href | Why dead / not as promised |
|---|---|---|
| src/app/deals/[id]/page.tsx:289 | `/account/billing?redirect=/deals/<id>#topup` | copy says "you'll come straight back here"; billing page reads only `topup`/`subscribed` (page.tsx:22); top-up success_url fixed to `/account/billing?topup=1` (api/billing/topup/route.ts:100) |
| src/app/deals/[id]/page.tsx:275, :290 | `/upgrade?redirect=/deals/<id>` | `redirect` only drives ← Back (upgrade/page.tsx:111); subscribe success_url is `/account/billing?subscribed=1&plan=` (subscribe/route.ts:121) |
| src/components/credit/SubscribeButton.tsx:18 | `/signup?plan=<code>` | `plan` read nowhere in signup/actions/callback/landing; signed-in member on /pricing is bounced to /today by proxy.ts:39-44 |
| src/app/(auth)/login/page.tsx:70 | `/signup` | drops `?redirect=` (signup→login keeps it, signup/page.tsx:55) |
| src/proxy.ts:5, src/app/robots.ts:24 | `/dashboard` | no page or redirect exists → 404 after login |
| src/lib/listing/sourcing.ts:580, :592 | `/markets` ("Edit goals in the explorer") | dead builder (no callers); goals editor is `/profile` (nav.ts:80) since Batch 12 |
| src/app/markets/_components/product/MarketExplorerProductPage.tsx:14 | `/login?redirect=/markets` | shown for `/markets/<area>` too (area/page.tsx:54) → returns to Explorer home, not the area; `?via=email` lost |
| src/app/profile/page.tsx:45, src/app/profiles/page.tsx:40 | `/login?redirect=/profile` | in-page bounce (not proxied) drops `?via=email`, `?new=1`, `?mode=` |
| src/app/estimate/layout.tsx:35 | `/upgrade` | no `?redirect=/estimate`, so ← Back goes to Today, unlike every other layout |
| README.md:795 | "our own links in emails carry `?via=email`" | untrue for lib/email/billing.ts, inactivity/letter.ts, listing/picks-paused.ts, email/team.ts, funnel-alerts.ts, daily-notice.ts, pricing-notice.ts, billing-emails.ts, provision welcome (withVia used only in render-email.ts:127 and feedback.ts:147) |
| src/lib/tracking/config.ts:92 | `/markets/map` in PAGEVIEW_PATHS | page only redirects; harmless but misleading |
| src/app/demo-report/page.tsx:5-13 | (comment) "TEMPORARY … remove this folder" | now the deal page's sample-report target (deals/[id]/page.tsx:75) |
| src/app/report/page.tsx:25 | `/api/get-report` | both orphaned: no inbound link, queries landlord Monday board 5891626711; `/report` crawlable (robots disallows only `/report/`) |
| src/app/str-report/_components/chapters/VerdictChapter.tsx:15 | `/str-report/presentation?…` | only reachable from the orphan `/str-report` |

#### Duplicates

_F · duplicates_

| thing | live version (file) | other version (file) | dead or live | can disagree? | verdict |
|---|---|---|---|---|---|
| Deal card (marketplace deal) | `DealCard` src/app/deals/_components/DealCard.tsx, fed by `cardView` (src/lib/marketplace/card-view.ts); used by /today, /deals, /deals/[id], the marketing deal page; My deals' `DealRow` (src/app/my-deals/_components/DealRow.tsx) draws the same `cardView` | `PickCard` inline in src/app/picks/page.tsx (own profitRange call, raw finance); `areaDealView` src/lib/marketplace/grid.ts (Explorer area cards, quiz sample matches, house finance); email teaser `teaserItem` src/lib/notify/message.ts + `rangeLineFor` | all live (/picks is linked from Account > More) | yes: PickCard and the quiz sample ignore the cash-buyer rule (finding 3); the email teaser uses memberFinance and agrees | one range helper (profitRange), four callers; fix the two raw-finance callers |
| Kept list | `trackedDeals` src/lib/listing/tracked.ts via `loadTrackedDeals` (My deals, the Your-week recap, alerts) | first-week checklist `evidenceFor` src/lib/today/checklist-server.ts:178 (deal_reactions keeps only); `keptDealIds` src/lib/marketplace/reactions-server.ts:116; `reactionFilter('kept')` src/lib/marketplace/reactions.ts:45 | checklist live; keptDealIds dead (no importers); 'kept' filter unreachable (dealsViewRedirect) | yes: checklist vs My deals count (finding 1) | make the checklist read tracked items; delete the two dead readers |
| Today 'kept' count | Today has none since Batch 11; `TodayCards` tallies the day's answers only (src/app/today/_components/TodayCards.tsx) | — | — | no | clean |
| Pipeline stage definitions | `PIPELINE_STATUSES` / `KEPT_STATUS` src/lib/listing/pipeline.ts (My deals, StageSelect, tracked.ts, Explorer, stage-server) | `CONTENT_STAGE` map src/lib/pipeline/types.ts (a keyed rename, derived); `ACTIVE_STAGES` src/lib/sms/choose.ts:53 (hand-typed); Monday funnel has no stage column (`nextDeal` is the quiz's timing answer, not a stage) | all live | sms set omits 'secured' (finding 10); the rest cannot | one list; derive the SMS set |
| Mortgage payment | `mortgagePayment` / `monthlyMortgage` / `interestOnlyMortgage` src/lib/listing/deal.ts; imported by project/finance.ts, most-you-can-pay.ts, profit-range.ts, the extension (extension/src/content.ts imports mostYouCanPayForDeal), pdf/derive.ts, verdict.ts | none: mortgage-backfill.ts calls both formulas deliberately (a comparison) | live | no | clean (Batch 16b holds) |
| Net / profit maths | three documented models: `screen.ts` (0.44 + fixed costs by bedroom → annual_profit, uplift_pct, ladder price), `deal.ts` (0.52 − £250pcm bills − mortgage → profit range, PDF, analyser, extension), `src/lib/analysis.ts` (0.52, no bills → report FinancialSummary, Explorer verdict) | — | all live | yes, by design; the Explorer's caption claims bills (finding 2); the deal sheet shows the screening uplift tag beside the deal.ts range | keep three, fix the label |
| Credit balance | `getBalance` src/lib/credit/ledger.ts → `credit_available` (header, Account); Monday `lifecycle_balances` (schema.sql:5585) → the same `credit_available` | Account ledger view src/lib/credit/history.ts lists transactions, computes no balance | live | no | clean |
| Weekly active | `QUALIFYING_KINDS` src/lib/activity/kinds.ts passed into `activity_weekly_facts` (admin), `signup_source_facts` report (tracking/report-server.ts:55), `lifecycle_active_days_sync` (inactivity/server.ts:73) → `member_active_days` → Monday `lifecycle_member_stats`; all group weeks by Europe/London Monday | — | live | no | clean |
| Free / paid rule | `hasEverPaid` (deal tier: marketplace/tier.ts, visibility, week-run, digest, picks-run, Monday paidEver) and `accountStatus`/`isSubscriber`/`isPaid` (plan state: summary.ts noPlan, low-credit, starter-pack, inactivity, Monday planStatus) | `isPro`, `isLapsedSubscriber`, `hasLiveSubscription` src/lib/access.ts | two live by design; three dead | the two live rules answer different questions on purpose; pack buyers agree (grant-server stamps last_topup_at) | delete the dead three (finding 6) |
| Daily email builders | `buildDaily` src/lib/notify/message.ts + `renderEmail` + `teasersFrom` (src/lib/notify/daily-server.ts), called by picks-run.ts:1476 (07:00–07:40 sourcing) and digest-run.ts (08:10) | — | live, one builder two callers | no (same stored Today list) | clean |
| Monday integrations | sign-up row `ensureEnquiry` src/lib/apis/monday.ts (creates in GROUPS.free, PDF upload) and Batch 20 funnel src/lib/crm/monday-funnel/* (every other column, groups; creates only after CREATE_MIN_AGE_MS) | `syncTimeOnSiteToMonday` src/lib/apis/monday.ts:218 (no-op) still called by src/app/api/track/route.ts:31 | both live, share config.ts ids | no | complementary; remove the stub (finding 7) |
| Consent / tracking | cookie `sf_consent` src/lib/tracking/config.ts + consent.ts / consent-server.ts; lib/meta reads `memberConsentFor` and `TRACKING` from it | src/lib/analysis.ts is the old financial calculator, not consent; attribution is src/lib/tracking/attribution-server.ts | live | no | clean |
| Quick look price ladder | `openPricePence` src/lib/marketplace/ladder.ts on billing_settings.deal_open_ladder; input `annual_profit` in card-view.ts, deals/[id], DealRow, stage-server, open.ts, deal-analysis.ts | picks-run.ts:1028 feeds `cand.screening.surplus` from a fresh re-screen | live | yes, when the rent table moved since the deal's recheck (finding 4) | one ladder; align the input |
| 48-hour rule | `freeDealDelayHours` (billing_settings.free_deal_delay_hours, default 48) src/lib/credit/unit-costs.ts:150, read by visibility.ts, tier.ts, early-access.ts, deals/today pages, picks-run, digest-run, week-run | `SHOWN_UNCHECKED_MS = 48h` src/lib/marketplace/cadence.ts:41 is a different rule (unchecked deals) | live | no | clean |
| Town / area from postcode | `postcodeAreaOf` src/lib/listing/normalise.ts (re-exported by propertydata-parse.ts; every caller passes a postcode); `outcodeOf` propertydata-parse.ts:101; `areaMetaForCode` market/areas.ts | `postcodeAreaOf` src/lib/market/managed-areas.ts:20 (address regex, private to the Monday Properties badge); `normalisePostcode` twice: propertydata-parse.ts:96 (cache key) vs market/goals.ts:324 (validated, spaced) | all live | no member-facing disagreement | tidy: rename the managed-areas one |
| Listing URL parsers | `detectListingUrl` src/lib/listing/detect.ts (+ lib/listing/parsers); extension imports it (extension/src/content.ts:9) | none (sourcing.ts builds URLs, does not parse) | live | no | clean |
| UK-time helpers | `londonDay`/`londonParts` src/lib/sms/uk-time.ts; `ukDay`/`ukWeekStart` src/lib/activity/week.ts wrap it | `ukDayStart` src/lib/deal-quality/checks.ts:124, `londonDayStart` src/lib/leads/search.ts:63, `ukMonthStart` src/lib/credit/usage-server.ts:23, `toUkDate` propertydata-parse.ts:92: same Intl arithmetic, separately written; `todayKey` src/lib/today/day.ts:23 is a fixed-UTC rollover by design | all live | no | tidy-up only |
| Internal secret check | `authoriseInternal` src/lib/internal-auth.ts (every cron route) | `authoriseAdminOrInternal` src/lib/lifecycle/route-auth.ts wraps it and adds an admin session (mobile/monday backfills); provider-spike is admin-session only | live, layered | no | clean |
| Email rendering | `renderEmail` src/lib/notify/render-email.ts (daily, weekly, picks, low-credit decision) | inline shells in src/lib/email/billing.ts:15 (credit/receipts) and src/lib/email/lead-report.ts:55 | all live | different look for the same topic (finding 9) | one shell |
| billing_settings readers | `getBillingSettings` src/lib/credit/unit-costs.ts (60 s cache; parseLifecycle, parseDealChecks, parseLowEntry shared) | deal-quality/settings-server.ts (deal_checks, low_entry: same parsers, no cache); lifecycle/settings-server.ts `readStarterPackCutover` (starter_pack_from, same parseDateSetting, fail-closed on purpose); SQL `credit_setting_num('welcome_grant_pence', 2000)` / `('referral_pence', 1000)` match unit-costs.ts:78,89; feedback, meta, pipeline rules, profiles, project, sms, sourcing-demand each read their own keys only | all live | only within the 60 s cache window after an admin change | clean |
| Finance defaults | `DEFAULT_FINANCE` src/lib/listing/deal.ts:47 | literal copies in src/lib/profile/questions.ts:937,943 and src/app/welcome/Quiz.tsx:333 | live | yes if the house figures change (finding 8) | import the constant |
| Low-credit emails | Batch 20 decision (no plan): src/lib/credit/low-credit-server.ts; plan holders: `lowBalanceEmail` src/lib/email/billing.ts | — | both live, split on `summary.noPlan` in after-debit.ts | no | clean |

#### RLS per table

_A · RLS & grants_

Clients: **session** = createSupabaseServerClient (anon key + member cookie, RLS applies); **admin** = createAdminClient (service role, bypasses RLS); **rpc** = SQL function called with the admin client (every one is revoked from anon/authenticated). RLS is on for all 90 public tables (pg_dump: 90 ENABLE lines + storage.objects shim). "none" = RLS on, no policy: anon/authenticated get nothing.

| table | RLS | policies (who can do what) | client the code uses | member data? | verdict |
|---|---|---|---|---|---|
| profiles | on | select own; **insert own** (with check id=uid); update own (using+with check) with column grants only: full_name, mobile, monday_item_id, last_seen_at, market_goals(+_updated_at), alert_weekly, sourcing_alerts, sourcing_last_sent_at, sourcing_opted_out_at, updated_at, onboarding_skips, about_you(+_updated_at) | session for own-row reads and the granted columns (AppShell:48, estimate/layout:44,71, profile/actions:53, today/tailoring-actions:39,89, lib/profile/server:242,249, sign-in-hooks:32,70); admin for every billing/credit/lifecycle column | yes | Finding 1 (insert policy), Finding 2 (monday_item_id grant); update revoke at 431 is effective |
| saved_searches | on | own ALL (uid=user_id); team SELECT to authenticated (owner_id = uid or private.active_team_owner()); triggers force owner_id and strip deal_id/analysed_at from anon/authenticated writes | session: api/analyse insert+prune, my-deals, reports/[id], card-state, pmi-addon read; admin: deal-analysis, reports/actions delete, api/reports, team/remove | yes | OK |
| saved_areas | on | own ALL | session (markets/actions, lib/profile/server); admin (picks, digest, provision) | yes | OK |
| checked_listings | on | own ALL | session (markets/actions, listing/server browser path, api/analyse); admin (extension, picks, alerts, recheck cron) | yes | OK; Finding 4 (cap resettable) |
| extension_tokens | on | select own | admin only (lib/extension/tokens.ts) | yes (hashes) | OK |
| api_keys | on | select own | admin only (lib/api/keys.ts) | yes (hashes) | OK |
| funnels | on | select own | admin only | yes (public_token) | OK |
| leads | on | select own | session (app/leads/funnels/page.tsx:26); admin elsewhere | yes (lead PII) | OK |
| credit_grants | on | select own | admin only | yes | OK (policy unused by code) |
| credit_transactions | on | select own | admin only (ledger via src/lib/credit/db.ts) | yes | OK |
| credit_allocations | on | select own (via credit_transactions.user_id) | SQL only | yes | OK |
| credit_reservations | on | select own | SQL only | yes | OK |
| credit_code_redemptions | on | select own | SQL only | yes | OK |
| credit_codes | on | none | admin (referral.ts, admin/billing) | owner_user_id | OK |
| billing_plans | on | select to authenticated | admin (lib/credit/plans.ts:31) | no | OK |
| provider_calls | on | none | admin (meter.ts, broker/store.ts, deal-analysis) | user_id, billed_user_id | OK |
| subscription_events | on | none (+revoke all) | admin (recordSubscriptionEvent always given createAdminClient) | yes | OK |
| deal_opens | on | none (+revoke) | admin (open.ts, card-state, pipeline, picks, alerts) | yes | OK |
| deal_reactions | on | none (+revoke) | admin | yes | OK |
| deal_shares | on | none (+revoke) | admin (share.ts) | yes | OK |
| today_selections / profile_today_lists | on | none | admin (today/selection.ts, daily-server) | yes | OK |
| checklist_steps | on | none (+revoke) | admin (checklist-server.ts) | yes | OK |
| team_members / team_invites / team_seat_charges | on | none (+revoke); private.active_team_owner() reads team_members for the saved_searches policy | admin (lib/team/*, account/team/page.tsx:69-73) | yes | OK |
| sourcing_sent / sourcing_missed | on | none | admin (picks-run, picks-server, tracked-server) | yes | OK |
| analyser_reports / analyser_reports_removed | on | none | admin (broker/providers/internal, deal-quality, provider-spike) | lead_email | OK |
| bulk_jobs / bulk_job_rows | on | none (+revoke) | admin + claim_bulk_rows rpc (service_role only) | yes (bulk lead PII) | OK |
| notification_sends / deal_alerts | on | none (+revoke) | admin (+ claim_notification_slot / finish_notification_send rpc) | yes | OK |
| pipeline_checklist_ticks / pipeline_step_events | on | none (+revoke) | admin (TICKS_TABLE pipeline/server.ts:66, EVENTS_TABLE pipeline/events.ts:26) | yes | OK |
| sms_contacts / sms_verifications / sms_messages | on | none (+revoke) | admin (sms/store.ts, verify-server + sms_verification_attempt rpc) | yes (phone, code hashes) | OK |
| activity_events / activity_visits / activity_excluded_accounts / activity_meta | on | none (+revoke) | admin + activity_* rpc (service_role only) | yes | OK |
| deal_analyses | on | none (+revoke) | admin (deal-analysis.ts, pmi-addon.ts) | shared, no user id | OK |
| analysis_purchases | on | none (+revoke) | admin (deal-analysis.ts, pmi-addon.ts, project/admin-server) | yes | OK |
| daily_deal_charges / profile_daily_charges | on | none (+revoke) | admin (daily-deals-server.ts:69) | yes | OK |
| profile_quiz | on | none (+revoke) | admin (lib/profile/server.ts, backfill, tailoring) | yes | OK |
| search_profiles | on | none (+revoke) | admin (lib/profiles/server.ts) + create_/select_search_profile rpc | yes | OK |
| tailoring_prompts | on | none (+revoke) | admin (tailoring/server.ts) | yes | OK |
| project_member_figures | on | none (+revoke) | admin (member-figures-server.ts) | yes | OK |
| feedback_reports / feedback_screenshots / feedback_status_emails | on | none (+revoke) | admin (feedback/server.ts, admin-server.ts, retention.ts) + feedback_submit / feedback_status_claim rpc | yes | OK |
| storage bucket feedback-screenshots | private; no storage.objects policy in the dump | admin only: upload, createSignedUrls (5 min, admin pages), remove (feedback/storage.ts:30,47,69) | yes | OK |
| storage bucket (funnel brand logos, BRAND_BUCKET) | created by hand; public read by design | admin writes (funnels/storage.ts:69,92); getPublicUrl | no (logos) | OK |
| announcement_views | on | none (+revoke) | admin (announcements-server.ts) + announcement_stats rpc | yes | OK |
| consent_records / member_consent | on | none (+revoke) | admin (tracking/consent-server.ts) + member_consent_set rpc | yes | OK |
| member_attribution / meta_conversions | on | none (+revoke) | admin (attribution-server, meta/conversions, report-server) | yes | OK |
| starter_pack_purchases | on | none (+revoke) | admin (starter-pack/*) + starter_pack_claim/clawback rpc (user id from Stripe metadata) | yes (card fingerprint, email/mobile keys) | OK |
| member_payments / member_refunds | on | none (+revoke) | admin (payments/server.ts) + member_refund_set rpc | yes | OK |
| member_active_days / member_engaged_days / member_active_days_state | on | none (+revoke) | SQL only via lifecycle_active_days_sync / lifecycle_member_stats rpc (service_role) | yes | OK |
| monday_funnel_queue / monday_funnel_runs / monday_funnel_lock | on | none (+revoke) | admin (queue-server, sync-server, status-server) + monday_funnel_enqueue/lease rpc | user ids | OK |
| crm_connections / crm_deliveries | on | none | admin (crm/connections.ts, deliver.ts) | yes (encrypted creds) | OK |
| funnel_hits / funnel_alerts | on | none | admin via funnel_* rpc | no (counters) | Finding 3 (functions not revoked) |
| admin_users / admin_password_resets | on | none (+revoke) | no .from() in src (schema-only) | admin credentials | OK |
| listing_snapshots / sourced_listings / marketplace_deals / marketplace_cohorts / broker_cache / area_planning_signals / unit_costs / billing_settings / stripe_events / tailoring settings | on | none | admin | no | OK |

#### Duplicate definitions in schema.sql

_A · idempotency & duplicates_

| object | first line | second line | same or different |
|---|---|---|---|
| profiles.full_name | 20 (create table) | 51 (add column if not exists) | same |
| profiles.mobile | 21 | 52 | same |
| profiles.monday_item_id | 38 | 53 | same |
| profiles.reports_run | 43 | 54 | same |
| profiles.last_seen_at | 45 | 55 | same |
| profiles.updated_at | 47 | 60 | same |
| profiles.reports_total | 44 | 61 | same |
| profiles.plan_source | 32 | 62 | same |
| profiles.subscription_started_at | 33 | 63 | same |
| profiles.subscription_ended_at | 34 | 64 | same |
| profiles.trial_started_at | 25 | 65 | same |
| constraint profiles_plan_check | 22 (inline check) | 110-115 (guarded add) | same |
| policy "Users can update own profile" | 133-135 (using only) | 448-452 (using + with check) | different; last wins and is the one the code needs |
| billing_plans.perks | 475 | 479 | same |
| profiles.sourcing_alerts default | 336 (default false) | 1040 (set default true) | different; last wins, deliberate ("Daily picks" section) |
| profiles.auto_topup_threshold_pence default | 657 (default 500) | 666 (set default 2000) | different; last wins, deliberate |
| spend_rates topup/adjustment | 528 seed (1.5) | 3465-3476 once-only move to 1.3; 699 credit_spend_rate() fallback 1.5 | different; net 1.3 on a fresh install (verified), SQL fallback stale vs code 1.3 |
| plan credit per month | 480-484 billing_plans.monthly_credit_pence (1900/5000/14000/5000) | 3453 plan_credit_pence (1900/3999/9900/3000) | different by design (Batch 10 applies from new_pricing_from); /account label reads the old one |
| billing_plans perks.sourcingCadence | 481-484 seed 'daily' | 492-494 update forcing 'daily' | same |
| grant update (columns) on profiles to authenticated | 432-444 (11 columns) | 2027 (onboarding_skips); 3637 (about_you, about_you_updated_at) | different columns, additive; 431 revoke runs first so the net set is stable |
| welcome credit amount | 521 seed welcome_grant_pence 2000 | 1007 credit_setting_num default 2000; code getBillingSettings | same |
| first search profile 'My deals' | 3794-3802 SQL insert for members without one | src/lib/profiles/server.ts:92-109 ensureFirstProfile via create_search_profile | same name and shape; code tolerates 23505, no collision |
| checklist_steps.step list | 2112 inline check ('goals','keep3','open','report','share') | src/lib/today/checklist.ts STEP_KEYS (test line 11) | same |
| member_active_days_state row | 5433 insert on conflict do nothing | 5462 inside lifecycle_active_days_sync | same |
| monday_funnel_lock row | 5687 | 5701 inside monday_funnel_lease | same |
| notify pgrst, 'reload schema' | 2074 | 3422, 3680, 3987, 4033, 4177, 4350, 4879, 5172, 5716 | same, harmless |
| functions (create or replace) | – | – | none defined twice (55 unique names, grep) |
| triggers | – | – | each of the 11 dropped and created exactly once |
| indexes / tables | – | – | no name used twice; git history shows no index or add-column line ever changed under the same name |

#### Settings a re-run would overwrite

_A · idempotency & duplicates_

| what | line | what a re-run does | guarded? |
|---|---|---|---|
| billing_plans starter / pro / scale / pro_annual: name, price_pence, interval, monthly_credit_pence, perks, sort | 480-487 | reset to the seeded values every run (`on conflict do update`); `active` is not touched | no |
| billing_plans.perks.sourcingCadence on any row | 492-494 | forced to 'daily' | only by `<> 'daily'` |
| storage.buckets 'feedback-screenshots': public, file_size_limit, allowed_mime_types | 4869-4874 | reset to private / 20 MB / jpeg,png,webp (deliberate per comment) | no |
| profiles column default sourcing_alerts | 1040 | default → true (rows untouched) | n/a |
| profiles column default auto_topup_threshold_pence | 666 | default → 2000 (rows untouched) | n/a |
| profiles.sourcing_alerts rows | 1041-1045 | false → true where sourcing_opted_out_at is null and no pick ever sent; the notifications writer stamps sourcing_opted_out_at on every off (registry.test.ts:23), inactivity uses picks_paused_inactive_at, so no live path is undone | yes |
| profiles.plan / plan_source / subscription_ended_at | 91-105 | plan → 'pro' where Stripe status active/trialing/past_due; plan_source → 'manual' for pro rows with no Stripe ids | by where clause |
| profiles.reports_total | 81-83 | raised to reports_run where lower | yes |
| profiles.welcome_checked_at + £20 welcome grant | 1003-1010 | any profile created before 13 Sep 2026 with no welcome-kind grant is granted (withheld / team seats not excluded) | date only |
| billing_settings (all 57 live keys, incl. welcome_grant_pence, low_balance_ratio, base_markup, funnel_markup, spend_rates, topup_presets_pence, referral_pence, deal_open_ladder, free_deal_delay_hours, sms_monthly_cap, full_analysis_pence, pmi_addon_pence, todays_5_daily_pence, analysis_reuse_days, plan_credit_pence, new_pricing_from, profit_range_pct, pricing_notice_date, profile_complete_pence, profile_credit_min_real_pct, saved_profiles_max, demand_*, r2r_qualified_profit, auction_model, area_rent_daily_attempts, low_entry, deal_comps, deal_confidence, deal_checks, project_*, today_mix, feedback_*, announcement_max_age_days, meta_tracking_since, starter_pack_*, low_credit_pence, inactive_reengage_days, picks_pause_inactive_days, inactivity_from) | 520, 1745, 1964, 2731, 3448, 3618, 3675, 3984, 4168, 4192, 4202, 4226, 4301, 4538, 4848, 5114, 5194 | NONE overwritten: every seed is `on conflict (key) do nothing`; the only update (spend_rates, 3468) runs once behind batch10_rates_applied_at | yes |
| credit_grants.spend_rate 1.5 → 1.3 | 3471-3473 | once only | yes (marker) |
| saved_searches.owner_id, marketplace_deals.live_since, marketplace_deals.stream, sourcing_sent/deal_reactions/checked_listings/deal_opens/sourcing_missed.profile_id, profile_today_lists copy, search_profiles first profile | 1876, 1961, 4317-4323, 3808-3823, 3824-3828, 3794-3802 | fill-ins only where null / absent / before the first profile's creation | yes |

#### Columns used by code but missing from schema.sql

_A · code vs schema columns_

Method: every `.from('<table>')` builder chain in src/ (943 chains across 1,344 files, tests included) was walked call by call; every column named in `.select()` (literal, `*_COLUMNS` constant or template), `.insert/.upsert/.update({...})` literal keys and `onConflict`, `.eq/.neq/.gt/.gte/.lt/.lte/.in/.is/.like/.ilike/.not/.filter/.order/.contains/.overlaps/.match`, `.or('...')` conditions, and relation embeds was checked against the pg_dump of schema.sql run on a fresh Postgres 16 (scratchpad/pg/schema1.sql). The 105 non-literal payloads (`.update(patch)`, `.insert(row)`, spreads) on the money and gate tables were read by hand (list in 'clean'). 27 `p jsonb` RPC calls had their passed keys compared with the keys each SQL body reads.

| table.column | where in src | what the schema has |
|---|---|---|
| bulk_jobs.report_id | src/lib/deal-quality/backfill-run.ts:181 `admin.from('bulk_jobs').select('report_id').in('report_id', ids)` | bulk_jobs: id, created_at, updated_at, created_by, filename, status, total_rows, runnable_rows, header_map, paused_reason, confirmed_at, finished_at. report_id exists on bulk_job_rows (uuid, FK → analyser_reports(id) ON DELETE SET NULL, schema1.sql:6194). |

No other column, table, RPC function or RPC argument name used by src/ is missing from schema.sql. Every relation embed (`funnels(...)` from leads at app/leads/[id]/page.tsx:81, app/leads/[id]/pdf/route.ts:33, lib/leads/report.ts:42; `deal_reactions()` / `deal_reactions!inner()` from marketplace_deals at lib/marketplace/reactions.ts:44-45) has its FK (leads_funnel_id_fkey 6482, deal_reactions_deal_id_fkey 6370).

#### Env vars

_G · env vars & secrets_

| var | read where | in .env.example | comment ok | public? | fail-open? | verdict |
|---|---|---|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | src/lib/supabase/{browser,server,admin}.ts, src/proxy.ts:18, scripts | yes (L7) | header only, no what-breaks | public (by design) | admin client throws / hasServiceRole false | ok |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | src/lib/supabase/browser.ts:8, proxy.ts:19, f/[token]/page.tsx:51 | yes (L8) | header only | public (RLS-scoped, by design) | app cannot start auth | ok |
| SUPABASE_SERVICE_ROLE_KEY | src/lib/supabase/admin.ts:16 (`server-only`), scripts | yes (L9) | header only | no | throws; every admin path checks hasServiceRole | ok |
| STRIPE_SECRET_KEY | src/lib/stripe/client.ts, api/stripe/webhook/route.ts:16, scripts | yes (L63) | yes | no | webhook 500; billing 'unavailable' | ok |
| STRIPE_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET2 | src/lib/billing/webhook-secrets.ts:15 (by name) | yes (L64,66) | yes | no | closed: 500 with none, 400 on mismatch | ok |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | nowhere | yes (L67) | n/a | public | n/a | unused: delete (finding) |
| CREDIT_ENFORCE | src/lib/credit/http.ts:23 | yes (L74) | yes | no | off unless 'true' (documented shadow mode) | ok |
| STRIPE_PRICE_STARTER / PRO / SCALE / PRO_ANNUAL / TOPUP_1000 / 2500 / 5000 | src/lib/stripe/prices.ts:6-16 (env[name]) | yes (L78-84) | yes | no | plan/top-up not offered | ok |
| STRIPE_PRICE_STARTER_PACK | src/lib/stripe/prices.ts:20-26 | yes (L87) | yes (Batch 20) | no | pack refuses to sell; /admin/lifecycle warns | ok |
| STRIPE_PORTAL_CONFIG_ID | api/billing/subscribe:66, portal:22, scripts/stripe-setup:107 | yes (L88) | none | no | default portal config | comment missing |
| STRIPE_TAX | api/billing/{subscribe,starter-pack,topup} | comment only (L90) | yes | no | off unless 'true' | ok |
| STRIPE_TERMS_CONSENT | src/lib/stripe/checkout.ts:14 | comment only (L91) | yes | no | on unless 'false' | ok |
| NEXT_PUBLIC_SITE_URL | src/lib/url.ts:2, (auth)/actions.ts:19, google-button.tsx:16, crm/deliver.ts:108, scripts | yes (L95) | none | public | three different fallbacks | finding (Low) |
| VERCEL_GIT_COMMIT_SHA / NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA | src/lib/feedback/server.ts:112, client.ts:34 | comment (L96-101) | yes | public | 'unknown' | ok |
| VERCEL_ENV | src/lib/meta/env.ts:36, activity/log.ts:34, feedback/server.ts:113 | comment (L458-460) | yes | no | treated as development → pixel/CAPI off | ok |
| VERCEL_PROJECT_PRODUCTION_URL | src/lib/crm/deliver.ts:109 | no | – | no | no report link | undocumented (finding) |
| RESEND_API_KEY / EMAIL_FROM | src/lib/email/send.ts:44-45, scripts | yes (L110-111) | yes | no | sends logged and skipped | ok |
| ANTHROPIC_API_KEY | api/summarise/route.ts:77, src/lib/project/photo-check-server.ts:152,162 | yes (L115) | stale (narrator only) | no | 503 / photo check skipped | finding (Low) |
| ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID | api/speak/route.ts:18,25 | yes (L120-121) | yes | no | 503 / default voice | ok |
| AIRBTICS_API_KEY | src/lib/apis/airbtics.ts:326,2133,2472; broker/config.ts:88 | yes (L124) | header only | no (x-api-key header; DEBUG URL logs carry no key) | market estimates used | comment thin |
| AIRBTICS_BASE_URL | src/lib/apis/airbtics.ts:189 | yes (L125) | none | no | hardcoded AWS default | comment missing |
| PROPERTYDATA_API_KEY | broker/providers/propertydata.ts:110, apis/propertydata-sourced.ts:79, scripts | yes (L148) | yes | no (key in query string; meter/cache key and logs use pdCallKey without it) | questions return null | ok |
| PROPERTYDATA_SOURCED_ENABLED / PROPERTYDATA_COHORTS / PROPERTYDATA_LIST_<COHORT> | apis/propertydata-sourced.ts:79,63,49 | yes (L168-181) | yes | no | off unless 'true' | ok |
| GOOGLE_PLACES_API_KEY | apis/geocode.ts:21,68; google-places.ts:162; api/address-autocomplete:90 | yes (L182) | none | no (key in query; errors never echo the URL) | every full report fails as 'check your postcode' | finding (Medium) |
| TICKETMASTER_API_KEY | apis/ticketmaster.ts:13 | yes (L183) | none | no | events empty (allSettled) | comment missing |
| CALIBRATION_BYPASS_SECRET | api/analyse/route.ts:65, scripts/calibrate.mjs, outlier-sweep.mjs | yes (L187) | yes | no | bypass off; also NODE_ENV !== production guard | ok |
| CALIBRATION_API_URL | scripts/calibrate.mjs:29 | no | – | n/a | localhost default | undocumented (scripts only) |
| ADMIN_EMAILS | src/lib/admin.ts:17 | yes (L194) | yes | no | default zac@stayful.co.uk (documented) | ok |
| INTERNAL_API_SECRET | src/lib/internal-auth.ts:16,25,33; crypto/sign.ts:48 (photo/SMS HMAC fallback) | yes (L221) | yes | no | closed | ok |
| N8N_SHARED_SECRET | src/lib/internal-auth.ts:16,25,33 | yes (L228) | yes | no | closed; outbound falls back to INTERNAL_API_SECRET | finding (Low) |
| CRON_SECRET | src/lib/internal-auth.ts:16,20 | comment only (L219, 'the weekly cron') | stale | no | closed: all 33 crons refused | finding (Low) |
| MARKET_SAMPLE_AREA | src/lib/market/explorer.ts:314 | comment (L199) | yes | no | best-backed area | ok |
| MONDAY_PROPERTIES_BOARD_ID / MONDAY_MANAGEMENT_LEADS_BOARD_ID / MONDAY_MANAGEMENT_LEADS_EMAIL_COL | market/managed-areas.ts:14; app/markets/actions.ts:43-44 | comment (L202-207) | yes | no | defaults | ok |
| CRM_ENCRYPTION_KEY | src/lib/crypto/secrets.ts:53 | yes (L239) | yes | no | saving a CRM connection fails loudly | ok |
| AGENT_HASH_KEY | src/lib/crypto/agent.ts:75 | yes (L256) | yes | no | signal dropped | ok |
| TURNSTILE_SECRET_KEY | src/lib/turnstile/verify.ts:20,32 | yes (L266) | yes | no | no-op when either half missing (documented); fails open on Cloudflare outage (verdict.ts) | ok |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY | turnstile/verify.ts:20; app/estimate/page.tsx:3752 ('use client') | yes (L267) | yes | public (site key) | widget not rendered | ok |
| MONDAY_API_KEY (MONDAY_API_TOKEN fallback) | apis/monday.ts:44, crm/monday-funnel/board.ts:23 (both with fallback); api/get-report/route.ts:3 (no fallback, module scope, `!`) | yes (L274) | partly stale (names /api/track, whose sync is a no-op) | no | sign-up row skipped; get-report sends 'undefined' | finding (Critical, get-report) |
| MONDAY_FUNNEL_ENABLED | crm/monday-funnel/config.ts:150 (env.X) | yes (L282) | yes | no | off unless 'true' | ok |
| PMI_API_KEY | broker/providers/pmi.ts:61,231 | comment (L285) | yes | no (Bearer header) | PMI rungs removed | ok |
| PMI_API_BASE | broker/providers/pmi.ts:12 | no | – | no | default host | undocumented (finding) |
| PMI_SECOND_OPINION | analysis/run.ts:110; api/credit/estimate:32 | comment (L289) | yes | no | on unless 'false' | ok |
| PRICELABS_API_KEY / PRICELABS_AS_PRIMARY | apis/pricelabs.ts:66; analysis/run.ts:160; admin/billing/page.tsx:76, actions.ts:89; api/credit/estimate:33 | no | – | no (X-API-Key header; log URL redacted) | off unless 'true' | undocumented (finding) |
| AIRROI_API_KEY | broker/config.ts:96 | comment (L291) | yes ('reserved') | no | provider off | ok |
| LISTING_SERVER_FETCH / LISTING_SOURCES / LISTING_RESOLVES_PER_DAY | listing/fetch.ts:31,33; listing/server.ts:131; broker/config.ts:98 | comment (L292-295) | yes | no | on / all / 30 | ok |
| BROKER_BUDGET_<P> / BROKER_MEMBER_BUDGET_<P> | broker/config.ts:80-81 (env[name]) | comment (L296-299) | yes | no | defaults in config.ts | ok |
| LISTING_RECHECK_ENABLED / LISTING_RECHECK_MAX_PER_RUN | api/internal/listing-recheck/route.ts:102,62 | comment (L305-311) | yes | no | on / 40 | ok |
| SOURCING_ENABLED / SOURCING_MAX_QUERIES_PER_RUN | listing/picks-run.ts:236,169 | comment (L312-346) | yes | no | on / 150 | ok |
| DEAL_ALERTS_ENABLED / DAILY_DIGEST_ENABLED | api/internal/deal-alerts:31, daily-digest:28 | comment (L352-360) | yes | no | on | ok |
| MARKETPLACE_SWEEP_ENABLED / _AREAS / _MAX_QUERIES | marketplace/sweep-plan.ts:41,46,51 | comment (L363-370) | yes | no | on / 60 / 120 | ok |
| DEMAND_SOURCING_ENABLED | sourcing-demand/run.ts:44 | comment (L371) | yes | no | off unless 'true' | ok |
| LOW_ENTRY_SEARCH_ENABLED | deal-quality/low-entry-run.ts:52 | comment (L376) | yes | no | off unless 'true' | ok |
| DEAL_CHECKS_ENABLED | deal-quality/settings-server.ts:33 | comment (L381) | yes | no | off unless 'true' | ok |
| MARKET_WARM_ENABLED | api/internal/market-warm/route.ts:25 | comment (L138-140) | yes | no | on unless 'false' | ok |
| MARKETPLACE_RECHECK_ENABLED / _CAP_RIGHTMOVE / _CAP_OTM | marketplace/recheck-run.ts:28,33,34 | comment (L388-394) | yes | no | on / 30 / 60 | ok |
| DEALS_PHOTO_SECRET | crypto/sign.ts:48 (also SMS verify-code HMAC) | comment (L395-397, L461-463) | yes | no | falls back to INTERNAL_API_SECRET; 404 without either or <16 chars | ok |
| LEAD_ACTIVATION_WEBHOOK_URL | auth/sign-in-hooks.ts:48 | comment (L403-407) | yes | no | no post | ok |
| NEXT_PUBLIC_EXTENSION_ID / EXTENSION_IDS | extension/store.ts:12, cors.ts:10, app/extension/connect/page.tsx:26 | comment (L410-416) | yes | public / no | no CORS origin allowed (closed) | ok |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID / TWILIO_FROM_NUMBER | sms/config.ts:31-34,45 (env(name)) | yes (L447-450) | yes | no | sends skipped; both webhooks 503 without the token | ok |
| SMS_DRY_RUN / SMS_ALERTS_ENABLED | sms/config.ts:49,53 | comment (L440-445) | yes | no | off | ok |
| NEXT_PUBLIC_META_PIXEL_ID | meta/env.ts:42; components/tracking/CookieSettingsLink.tsx:9; root layout → TrackingRoot prop | yes (L489) | yes | public (dataset id) | no banner/pixel/CAPI | ok |
| META_CAPI_ACCESS_TOKEN | meta/env.ts:48 → capi.ts body field; notes scrubbed | yes (L490) | yes | no | no server events | ok |
| META_TEST_EVENT_CODE / META_DRY_RUN | meta/env.ts:53,58 | yes (L491) / comment (L481) | yes | no | off | ok |
| NODE_ENV | api/analyse:67, admin/{picks,deals}/actions.ts cookie secure flag, activity/log.ts:34; extension/build.mjs define | no (standard) | – | no | – | ok |
| UPDATE_GOLDEN, BROKER_*_AIRBTICS (tests) | *.test.ts only | no | – | n/a | – | test-only, ok |

#### Loose ends

_G · TODOs and failure modes_

| comment | file:line | waited on | done? | evidence |
|---|---|---|---|---|
| `TEMPORARY public preview route … Remove this folder when the design review is done` | src/app/demo-report/page.tsx:5,13 | design review | **Stale, keep the route**: it is now the sample report linked from every deal sheet | src/app/deals/[id]/page.tsx:75 `SAMPLE_REPORT = "/demo-report?demo=manchester"` (decided 27 Sep 2026) |
| `In Phase 2, replace with a real API call … For now, use deterministic seeded variation by postcode + beds` | src/app/str-report/_lib/market.ts:2-3 | "Phase 2" | **Open**: page still builds (○ /str-report) with invented figures; nothing links to it | build.log route list; grep finds only tracking/surfaces.ts:40 |
| `TEMPORARY (remove once a few weeks of reports have been compared)` | src/lib/apis/airbtics.ts:1454 | a few weeks of V4 reports | **Open**: still computes and logs on every report | airbtics.ts:1456-1462; live airbtics_report_cache 233 rows |
| `Fetching switched off for now (LISTING_SERVER_FETCH / LISTING_SOURCES): it waits` | src/lib/project/check-run.ts:348 | env flag | Open by design: held deals skip with 'fetching is switched off' | check-run.ts:349 |
| Buy to let `declared, coming soon (Batch 28)` / `Batch 28 switches it on` / `Coming soon` badge | src/lib/profile/deal-types.ts:10,42; src/lib/market/goals.ts:145,203,425; src/app/profiles/page.tsx:175; src/app/welcome/_components/Controls.tsx:26,63; src/lib/profile/questions.ts:224,745; README.md:392; deal-types-available.test.ts:13 | Batch 28 | **Open** (Batch 28 not started): option greyed out, 'All of them' skips it, 'X is coming soon. Tick one of the others for now.' on an only-BTL answer | goals.ts AVAILABLE_DEAL_TYPES excludes 'btl'; tests pass |
| `Batch 17's refinance and Batch 28's buy-to-let` share the deal maths | src/lib/listing/deal.ts:196; src/lib/listing/mortgage-backfill.ts:6 | Batch 28 | Open (design note) | same |
| `Leave MONDAY_FUNNEL_ENABLED unset for now` | README.md:610 | your go-ahead | **Open**: /api/internal/monday-funnel runs every 10 min (crons.txt) and, unset, does nothing; no n8n workflow for the board exists (n8n-note.txt); live monday_funnel_runs = 1 | crons.txt; external/n8n-note.txt; live-rowcounts.txt |
| `Credit is being tracked but not yet enforced while we calibrate prices` banner | src/app/account/billing/BillingClient.tsx:84 | CREDIT_ENFORCE=true in Production (README.md:607) | Conditional on `summary.enforcing` = `isEnforcing()` (summary.ts:146, http.ts:22-24); .env.example:74 defaults `CREDIT_ENFORCE=false`; cannot verify the Vercel value from the repo | README.md:606-608 warns the pack 'buys nothing' without it |
| `for now, the only one with data: every member holds a welcome grant, and nobody has yet paid` | src/lib/billing/conversion.ts:5-6 | first payment | Still true: live counts show no payments / starter_pack_purchases / stripe_events rows | external/live-rowcounts.txt |
| `Null when Batch 6 had no figure at that price` | src/lib/sms/render.ts:84 | Batch 6 | Done (historic reference) | render.ts:85-88 |
| `The held deals wait on the shortlist for Batch 16's expiry` | src/lib/project/live-backfill-run.ts:23 | Batch 16 | Done | project checks shipped (crons.txt project-checks) |
| `the radius is for Batch 14's ranking, not a filter` | src/lib/onboarding/deal-filters.ts:64 | Batch 14 | Done | today/page.tsx:149 `withTailoring(...)` |
| `Reads the activity log for Batch 10's figures on /admin/weekly-active` | src/lib/analysis/take-up-server.ts:4 | Batch 10 | Done | build.log ƒ /admin/weekly-active |
| `as decided for Batch 10: Twilio named for text messages and the referral cookie stated` | src/app/(marketing)/privacy/page.tsx:20 | Batch 10 | Done | privacy page text |
| `an unknown kind (an old row, a later batch's) reads as itself` | src/lib/activity/kinds.ts:184 | none | Design note, nothing pending | kindLabel() |
| `Checked in code, not here, so a later batch can add one without a schema change` | supabase/schema.sql:2759 | none | Design note | activity_events.kind |
| `runningProfilesFor for later batches` | README.md:671; src/lib/profiles/server.ts:159 | later batches | Done: used by the daily runs per rules.ts:13 (exported, referenced in profiles/rules.ts) | profiles/server.ts:17 |
| `Batch 17: the roles ticked, for a profile not yet on deal types` | src/lib/notify/week-run.ts:65; src/lib/sourcing-demand/demand.ts:60 | one-off deal-types backfill | Done in code: older answers are mapped (deal-types.ts:19, typesShown) | deal-types.ts:90 |
| Licensing text `not yet live as of July 2026` / `due to open in autumn 2026` | src/lib/data/str-licensing.ts:34-35,97,99 | data refresh | **Stale** (today 30 Sep 2026) | finding above |
| `Zoopla is never fetched: it goes live on the feed with a placeholder photo` | src/lib/marketplace/absorb.ts:209 | extension / none | By design (Zoopla blocks server fetch) | listing/fetch.ts SERVER_FETCHABLE |
| `.env.example:401 photo route 404s and cards show a placeholder` | .env.example:401 | DEALS_PHOTO_SECRET | Documented behaviour | api/deals/photo/route.ts:17-18 |
| `storage blocked: hide it for now` | src/components/pipeline/StageReminder.tsx:44 | none | By design (localStorage unavailable) | — |
| `bulk_jobs.report_id` selected but absent from schema | src/lib/deal-quality/backfill-run.ts:181 | schema | **Bug** (finding above) | schema-columns.txt:46 |
| Prose-only matches, no action: `not yet`/`temporarily`/`placeholder` in runtime copy or doc comments | AddressAutocomplete.tsx:111; picks/page.tsx:45; listing/server.ts:65,68; PricingNoticePanel.tsx:38,47; terms/page.tsx:71; markets ScoreRing labels (PerformanceCard.tsx:21, MarketCard.tsx:60, MapPane.tsx:283); ProductMocks.tsx:6; api/deals/photo/route.ts:15-43; PasswordField.tsx:14,21; SearchOrPaste.tsx:7,10; AnnouncementBanner.tsx:10; mortgage-backfill-run.ts:5; listing/pipeline.ts:32; picks.ts:91,453; activity/billing.ts:13; activity/event.ts:142; monday-funnel/responses.ts (isTemporary); alerts.test.ts:174; marketplace/share-view.ts:35; marketplace/open.ts:90; profile/credit.ts:33; questions.ts:220-221; sourcing-demand/table.ts:23, demand.ts:97; announcements-server.ts:200; pipeline/offer-amount.ts:9; credit/welcome.ts:114; pricing-notice-run.ts:9; disposable-domains.ts; tailoring/about-prompts.ts:48; calibrate-run.ts:8; billing/churn.ts:240; meta/events.test.ts:35; airbtics.ts:487; access.ts:139; email/feedback.ts:140; today/day.ts:36; today/checklist.ts:84; tracking/runtime.ts:64; inactivity/server.ts:65; pdf/render.tsx:43; schema.sql:2013,2019; .env.example:18 | — | Not loose ends | — |

#### Failure modes

_G · TODOs and failure modes_

| path | dependency | what the member sees | charge left? | verdict |
|---|---|---|---|---|
| Any members page | Supabase Auth unreachable | proxy's getUser() returns null → redirect to /login?redirect=… (proxy.ts:30-36); login then fails with Supabase's raw message | none | Expected; message needs mapping (finding) |
| Sign-up / sign-in form | Supabase Auth error | raw `error.message` under the form ((auth)/actions.ts:46,96) | none | Low finding |
| Sign-up / sign-in page render | Supabase DB down | page renders; billing_settings read falls back to defaults (unit-costs.ts:175-177), so the headline offer may flip to defaults | none | OK |
| Sign-up | Monday down | nothing: ensureEnquiry in after() with try/catch ((auth)/actions.ts:127-141); mondayRequest has AbortSignal.timeout (monday-client.ts:59) | none | OK |
| Sign-up | Turnstile unreachable | fails open (turnstile/verify.ts:56-60), 2s-class timeout at :45 | none | OK |
| Confirmation link /auth/callback | Supabase down | redirect to /login?error=<raw exchange message> (callback/route.ts:31) → 'Sign-in failed: …' | none | Low (same mapping) |
| /auth/callback hooks | Monday / n8n down | swallowed (sign-in-hooks.ts:24-25,91-93); Monday row via after() | none | OK |
| Welcome quiz page | Supabase read fails | profileSummaryFor → null → redirect(returnTo) (welcome/page.tsx:53-55): never trapped | none | OK |
| Welcome quiz save | Supabase write fails | inline 'Could not save your answer. Please try again.' (profile/server.ts:246-256) | none | OK |
| Welcome quiz save | credit_grant RPC / Meta log fails after the save | server action throws → no error boundary → default error page (Quiz.tsx:111; server.ts:270,280) | none | Medium finding |
| Welcome quiz postcode | Google geocode down / out of credit | answer saved; area falls back to the postcode area; warning only for out-of-credit (server.ts:229-236, placeHome) | failed call logged, never charged (meter.ts:142-144) | OK |
| Pack checkout | Stripe down | 'Couldn't start the payment. Please try again.' 502 (starter-pack/route.ts:80,170) | none (manual capture; nothing authorised) | OK; SDK 80s timeout (Low finding) |
| Pack checkout (saved card) | Supabase down after capture | `{ ok, pending }` — 'the webhook will grant it' (route.ts:141-144); never told it failed | paid; credit follows on webhook | OK |
| Pack / plan / top-up webhook | Supabase down | 500 'Webhook handler error.' → Stripe retries; event id claimed first (webhook/route.ts:41-64) | grants idempotent | OK |
| Webhook | Monday down | never called: queueFunnelSync only writes an RPC row and warns (queue-server.ts:38-46) | n/a | OK |
| Webhook | Meta CAPI / activity / payments bookkeeping fails | wrapped, never fails delivery (stripe/webhook.ts:239-303) | n/a | OK |
| Today | Supabase read fails | selection.ts:332 throws → default 'Application error' page; getUser null → blank page (today/page.tsx:69) | none | Medium + Low findings |
| Today | market snapshot slow | 2s wait then fallback figures (today/page.tsx:46,147 AREA_WAIT_MS) | none | OK |
| Deal page (Quick look / open) | listing site blocked, paused, gone | MESSAGES checking / just_gone / failed — 'Nothing was charged' (deals/[id]/page.tsx:80-86); refund if it went while opening (open.ts:205-213) | refunded / not debited | OK |
| Deal page | Supabase down | dealSheet throws → default error page; user null → blank (deals/[id]/page.tsx:100) | none | see findings |
| Full analysis | provider (Airbtics/PMI/PropertyData) fails | SSE error 'You haven't been charged for it' (analysis/run/route.ts:69); charged only after the report row is saved (deal-analysis.ts:592-621) | reservation released by failPurchase (deal-analysis.ts:171,230) | OK |
| Full analysis | Supabase down at the debit | report saved, debit failure logged, member not charged (deal-analysis.ts:601-607) | house absorbs | OK (by design) |
| Full analysis / /estimate | Airbtics, Google, Ticketmaster hang (no fetch timeout) | function killed at maxDuration 60; client 'Analysis stream ended unexpectedly' (estimate/page.tsx:886) | reservation held until TTL (ledger.ts:96, 10 min) | Medium finding |
| /estimate | Airbtics returns no comps | 'we couldn't get short-let figures … you haven't been charged' + spend refunded (analyse/route.ts:196-207) | refunded | OK |
| /estimate | Google geocode down | GeocodeError path, no report, nothing spent (analyse/route.ts:159-162 release) | released | OK |
| Narration | Anthropic slow | killed at 30s; reservation until TTL (summarise/route.ts:18,106,163) | TTL | Low finding |
| Credit meter | credit_debit RPC fails after a paid call | not charged, logged (meter.ts:201-203) | none | OK |
| Credit meter | credit_available RPC fails at preflight | throwRpc → action refused before the provider is called (meter.ts:127; ledger.ts:82) | none | OK |
| My deals | Supabase down | loadTrackedDeals throws → default error page; user null → blank (my-deals/page.tsx:52) | none | see findings |
| Account / billing | Stripe down | card summary null (customer.ts:67-73); top-up/subscribe/pack return 502 with a sentence (topup:107, subscribe:129) | none | OK |
| Account / billing | credit RPC down | getCreditSummary throws (billing/page.tsx:41) → default error page | none | Medium finding |
| PDFs (/api/generate-pdf, /r/[token]/pdf) | render throws | plain 500; /estimate download button catches (estimate/page.tsx:1552) | none (unmetered) | OK |
| Share pages /d /p /r | Supabase down | throw → default error page; unknown token → Next default 404 | none | Low |
| Extension /api/ext/check, /me | any failure | JSON with a sentence (ext/check/route.ts:55-58); action.finish() in finally (listing/server.ts:174) | released | OK |
| Daily digest / deal alerts crons | Resend down or hanging | no timeout on fetch (email/send.ts:65); per-member failure recorded (digest-run.ts:371-374); a hang can strand the run and the 'sending' slot | none | Medium finding |
| SMS crons | Twilio down | AbortSignal.timeout; outcome 'unknown'; house spend only (sms/send.ts:97-103,117) | none to member | OK |
| Monday funnel cron | Monday down / rate-limited | isTemporary → stop this run, retry next (responses.ts:37-61) | n/a | OK |
| Crons | Supabase down | 500/503 JSON with the error (e.g. digest-run.ts:104,143); all routes authoriseInternal + maxDuration 60 (crons.txt) | none | OK |
| Any route killed at maxDuration | — | `finally`/after() work lost; reservations expire by TTL; `sending` slots stay | TTL | Note |

_Not reproduced here (in the working files): Batch 21 placement notes (where section order matters); profiles columns and their users; Who pays; Other switches: default state and what flipping starts; Nav per page; Mechanical checks; npm audit: every high/critical advisory; ESLint warnings (67); Money paths and their tests; Test hygiene._
