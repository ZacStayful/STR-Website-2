# Review R2: Batch 21's fixes, Batch 22, Batch 23 and 22c–22f

**Reviewed at:** `5d0ac805722c9b20d49e4850805e4d7d4794b381` — origin/main, "Batch 22f: management companies — from ad to a live branded link (#129)", merged 2 Oct 2026 13:50 BST. Review R1 was at `91c76c2` (Batch 20); the scope is every commit on main after it. Full clone. Written 3 Oct 2026.

Read-only. Nothing in the repo, Supabase, Stripe, Monday, n8n, ElevenLabs or Twilio was changed by the review; the live database was read with `select` only. Every check is against the code on main; README.md, PR descriptions and comments were treated as claims. Finding ids are `R2-<n>` and are stable across this document, the fix plan and the PR.

Severity: **Critical** = money charged or granted wrongly, a data leak, a call or text to the wrong person, or the site down · **High** = wrong numbers or a broken feature · **Medium** = works but fragile or confusing · **Low** = tidy-up. "Journey" is the first step at which a brand-new member from an ad would hit it: sign-up → quiz → reveal → notification choices → pack → first report → intro call → first low-credit moment, then later / existing members / funnel owners / admin.

## 1. Summary

**199 raw findings from 14 readers and two second-round sweeps, 26 merged as duplicates, 173 verified, 171 stand: 0 Critical · 20 High · 40 Medium · 111 Low.** Every Critical and High was put to three independent refuters with different lenses (the code path; reproduce it from the entry point; the brief's rule and the severity scale) and survives only if two of three could not refute it; every Medium was re-read by a second reader; Lows are as reported. Two findings were refuted (appendix F). Four reported Highs were graded down (one to Medium by the refuters, three Mediums to Low by their second reader) and none up. 803 checks came back clean (appendix D).

### Critical

None.

### High, in the order a new member would meet them

| Step | Id | One line |
|---|---|---|
| sign-up | **R2-159** | `next.config.ts` still redirects `/home → /` (308), so 22e's Home page is unreachable and every login, sign-up confirmation and reveal "Continue" lands on the marketing homepage. |
| quiz | **R2-160** | The management-company stamp is a GET route reached by `<Link>`, so Next prefetches it: anyone whose "branded lead form" button scrolls into view (the quiz's manager role, Account's footer) is stamped management-only, for ever. |
| reveal | **R2-94** | The reveal prices analyses before it records the reveal: the welcome price never shows on first paint and the first tap fails with "The price has changed". |
| reveal | **R2-67** | "Change my budget" on a project-budget what-if opens the Short-let budget question, or nothing. |
| reveal | **R2-18** | A free member's own search finds never reach their Today list or stop the search: the member's visibility is read before the finds exist. Bites once `MEMBER_SEARCH_ENABLED` is on. |
| first report | **R2-1** | Adding PMI to a finished report is refused for every first-timer: the page labels £2, the server charges the £1 first-time price, `quoteMatches` fails forever. |
| first report | **R2-2** | A first Deep report whose PMI never answers still consumes the once-per-account first-time price. |
| intro call | **R2-13** 🗄️ | A call's `debitFace` ignores open reservations, so a call can take credit an in-flight analysis, deep search or funnel lead has reserved; that debit then overdrafts (or, for a deep search, is forfeited). |
| intro call | **R2-122** | A missed-call text Twilio timed out on or answered 5xx is charged 22p as if sent. |
| intro call | **R2-152** | The privacy policy says "Calls are not recorded as audio", but the ElevenLabs agent config never turns `record_voice` off, so the provider keeps every call's audio. |
| low credit | **R2-23** | A low-credit call blocked for a passing reason (first 3 days, intro day, daily limit, in flight, no credit) writes a row the once-per-landing index counts: that credit landing never gets its call. |
| low credit | **R2-24** | A queued low-credit call is never re-tested at dial time: a member who topped up over the weekend is rung on Monday, told their credit is low, and charged for it. |
| low credit | **R2-43** | Batch 20's £5 email and the low-credit call both go the same day; neither side checks the other once the triggering debit is over. |
| later | **R2-153** | Every inbound text's full body is stored for ever in `si_conversation_questions`, so the 90-day purge of turns deletes nothing the policy promises to delete. |
| existing member | **R2-106** | Deep search quotes, runs, refreshes and charges the PRIMARY profile, not the active profile the view is about. |
| existing member | **R2-107** | Start again (or an active blank profile) stops every OTHER saved profile's daily pick and sends its Today's 5 free. |
| funnel owner | **R2-82** 🗄️ | Batch 10's unguarded daily-picks backfill re-enrols every 22f management account on the next schema run. |
| funnel owner | **R2-147** | The management ad page advertises the £10 pack whenever the price settings exist, not when the pack is live: today it promises £30 of credit the setup never offers. |
| admin | **R2-68** | `signup_reveals.strong` is never written, so `/admin/intelligence`'s "Strong match" share is always 0%. |
| every page | **R2-196** | The Profile pill's switcher menu opens 63–111 px off the left edge of a 375 px phone; its labels are unreadable. |

### Must be fixed before a real member gets a call

In the order they would bite, with the fix branch in brackets (section 7):

1. **R2-13** a call takes reserved credit and the reserved debit overdrafts — the brief's "a call can never push the balance below zero" (r2a + r2g).
2. **R2-23**, **R2-24**, **R2-43**, **R2-45** the low-credit call: a passing block burns the landing; a stale call is dialled after a top-up; the £5 email and the call go the same day; a placed-then-failed call suppresses every notice for 30 days (r2g, r2h).
3. **R2-122** 22p charged for a text Twilio never accepted (r2g, r2h).
4. **R2-26**, **R2-28** any verified number that rings or texts the SI number is charged (65p a minute, 22p a reply) whether or not calls were ever switched on, with no price spoken; a reply to a Batch 8 deal-alert text is an auto-answered, charged text (r2h; question 3).
5. **R2-27** the whole inbound surface (greeting by name, charges, texts, handoff emails) is live from the moment the number is imported into ElevenLabs, days before `SI_CALLS_ENABLED` (r2h).
6. **R2-25** the initiation webhook accepts any POST with the one static secret, hands back the tool secret and opens a "live call" for any verified number, so a leaked header lets an outsider text and charge members (r2h).
7. **R2-34** an ElevenLabs timeout or 5xx after Twilio has already started the call leaves a `failed` row with no ids: never charged, never matched, no fallback (r2h).
8. **R2-152**, **R2-153**, **R2-154**, **R2-156** the legal statements: audio is recorded, text bodies are kept for ever, call records have no retention, and the Terms never mention call, text or email charges (r2h, r2e, r2a).
9. **R2-80** the contact card goes only if the LLM agent calls the tool; an answered intro with no text gets no card and no fallback (r2h).
10. **R2-183**, **R2-29** `SI_CALLS_DRY_RUN` does not cover the SMS auto-reply or inbound charges (r2h).
11. **R2-193** the phone agent's service guide is marked "DRAFT FOR ZAC'S APPROVAL" and Sync sends it live (r2h; read it before the first sync).
12. **R2-95** the £20 welcome credit is never a "credit landing", so no pre-pack member can get the low-credit call at all (r2g; question 4).

### What came up clean

- `supabase/schema.sql` ran twice on a fresh Postgres 16 behind the Supabase shim: 0 errors, 0 warnings; the schema and data dumps after run 1 and run 2 are byte-identical. `credit-smoke.sql` (12 named checks, including the call safety indexes and the funnel lead tiers) and `scan-days-smoke.sql` pass. 112 public tables, all RLS on; the 19 new since R1 are service-role only with no member policy, and every read of them in `src/` is a service-role read scoped in code. 59 functions, every one with a pinned `search_path`; eight of the nine new ones are `security definer` (the ninth, `reset_search_profile`, is invoker-only and granted only to `service_role`: inconsistent, not exploitable). Every `billing_settings` seed added since R1 matches the live value.
- Every section of `schema.sql` on main is now applied on live. The live database was missing the 22f section until 13:23 UTC on 2 Oct (22f's code had been deployed at 12:50); the gap was found during this review and you closed it by pasting the section. Nothing in that window could have charged a lead by tier (`funnel_lead_charge` did not exist, so the tier path threw and the legacy metered price applied) and no management stamp could be written (`profiles.signup_path` did not exist).
- `ACCESS_COLUMNS` is byte-identical to R1 and all nine columns exist on `profiles`.
- `npm test` 2,677 pass, 0 fail · `npm run typecheck` clean · `npm run build` clean (0 warnings, 221 routes) · `npm audit` 0 vulnerabilities · `npm run lint` 0 errors, 67 warnings (46 in files changed since R1; 37 of them `src/app/estimate/page.tsx`).
- Every `.from()` (760), `.rpc()` (42) and literal column (1,912) in the 572 source files changed since R1 exists in the schema; every `*_COLUMNS` constant resolves to its table. 0 misses.
- All 36 cron schedules have a route; every internal route authorises first and declares `maxDuration`; every scheduled route but `credit-sweep` and `screen-report` (both pre-R1) takes `?dry=1`.
- No address, postcode or listing link appears on any call, text or in the voice agent's variables or tools; the agent's tools return no balance or deal figure (one weak signal, R2-32); unknown callers are never charged; the post-call webhook is HMAC-checked with a 30-minute tolerance and a replay table. The 48-hour delay and the own-finds exception hold on every surface but the search slice itself (R2-18). The welcome-price rules (own reveal deals, 7 days, new members, once per deal, never PMI alone) all hold. The signup search spends house credit only, under its 50p raw cap. Unknown callers, missed calls and voicemails are free.
- 803 further checks by the readers, listed in appendix D.

## 2. How this was done

- **Pre-flight.** Full history fetched; every merge on main after R1's hash listed (appendix B); every PR description and README deploy note in scope read as claims; the live project read for section markers, settings, RLS state and functions.
- **Mechanical.** `schema.sql` twice on a throwaway Postgres 16 (`/usr/lib/postgresql/16/bin`, `supabase/tests/shim.sql`, CI's own recipe) with dumps diffed; the two smoke SQL files; `npm ci`, `test`, `lint`, `typecheck`, `build`, `audit`; scripts comparing `process.env` reads with `.env.example`, `vercel.json` with its routes, and every `.from`/`.rpc`/column in the changed files with the schema (appendix A).
- **Reading.** Fourteen readers in parallel, each with the brief's bullets for its area and the file list for it: one per area A–I, a second reader with a different question for B ("every way to charge twice"), C ("who can be called or texted, and when") and D ("the cap and every new message"), and two journey walks (a brand-new member on a phone; three existing accounts on desktop, one of them a management company and one doing Start again). Each returned findings with file, line, quoted code, example, severity, fix and journey step; what it checked and found clean; and its area's inventory.
- **Verification.** Duplicates merged by one reader (26). Every Critical and High then went to three refuters, each told to refute it from a different angle; a finding stands with two of three. Every Medium went to a second reader (confirmed / overstated / understated / refuted). Lows are as reported.
- **Completeness.** A critic listed every brief bullet with neither a finding nor a clean check; second-round finders covered those (11 bullets, 44 findings), then again (5 bullets, 22 findings), then the critic's list was exhausted. Their findings went through the same verification.
- **Not run.** No live request to ElevenLabs, Twilio, Stripe or a data provider; no Playwright against the live site (the 375 px header check in R2-196 and R2-198 was a Chromium render of the strip's markup with the site's fonts). Member searches and calls are off on live, so their behaviour is from the code only.

## 3. By journey step: what a brand-new member from an ad hits first

Critical, High and Medium only; Lows are in section 4.

**Sign-up and first sign-in**

- R2-159 · High · next.config.ts still redirects /home → / (308), so 22e's Home page is unreachable and every login/sign-up/reveal landing ends on the marketing homepage

**The quiz**

- R2-160 · High · The management-company stamp is a GET route handler reached by <Link>, so Next prefetches it and stamps accounts that merely saw the button

**The reveal and the Stayful Intelligence view**

- R2-18 · High · A free member's own search finds never reach their Today list or stop the search in the slice that found them: the member context's visibility (ownFinds) is read once before the finds are inserted
- R2-67 · High · "Change my budget" on a project-budget what-if opens the Short-let budget question (or nothing), never the project budget
- R2-94 · High · The reveal's first paint prices analyses at the list price, and the first tap fails with "price changed" — the welcome price never shows the one time most members look
- R2-0 · Medium · Full analysis is £4 on main (seed, live and code fallback all 400); the brief says £5, so every derived price (Deep £6 not £7, first Deep £5 not £6, welcome £2.17 not £2.50) is £1 under the brief
- R2-3 · Medium · At the £4 list price the welcome price is not half price: the raw-cost floor lifts it to £2.17 (ceil of the 216.835p worst-case raw cost at the seed unit costs), and the admin guard would allow at most 45% off
- R2-134 · Medium · Deep search plans and charges OnTheMarket and PMI pages for areas with no short-let figures, where nothing found can ever become a deal (the signup layer and demand sourcing both skip such areas)

**The notification choices screen**

- R2-54 · Medium · setSiCalls writes a consent row and a counting notification_settings event on every call, changed or not; the choices call box stays unticked after an inline verify, so a re-tick + Continue (or a double submit / stale tab on the Account switch) records calls-on twice
- R2-78 · Medium · Choices screen: after verifying the mobile for calls, the call box stays unticked while calls are already ON, and Continue can never switch them off
- R2-156 · Medium · Terms of service never mention calls, texts or the missed-call email as paid features, although they debit credit (65p a minute, 22p a text, 20p an email)

**The pack**

- R2-196 · High · The Profile pill's switcher menu opens 63–111px off the left edge of a 375px phone, so its labels are unreadable
- R2-99 · Medium · Pack era: buying the pack from the reveal's out-of-credit window sends the member to /today, losing the reveal, the choices screen and their resume intent

**The first report**

- R2-1 · High · Adding PMI to a finished report is always refused for a member who has never had a Deep report: the page labels the list price (£2) but the server charges the first-time price (£1), so quoteMatches fails with 'The price has changed' on every attempt
- R2-2 · High · A first Deep report whose PMI second opinion never arrives still consumes the once-per-account first-time price: the purchase completes with first_deep = true and second_opinion = false, and hadDeepReport then reads it as 'had one'

**The intro call**

- R2-13 · High · A call's debitFace ignores open reservations, so a call can take credit a running analysis, deep search or funnel lead has reserved; the reserved debit then overdrafts (or, for a deep search, is forfeited)
- R2-122 · High · A missed-call text Twilio timed out on or answered 5xx is charged 22p as if sent
- R2-152 · High · Privacy policy says "Calls are not recorded as audio", but the ElevenLabs agent config never turns ElevenLabs' own voice recording off (record_voice defaults to true), so every call's audio is recorded and kept by the provider
- R2-34 · Medium · A timed-out or 5xx ElevenLabs outbound-call request after Twilio already started the call leaves a 'failed' row with no ids: the post-call webhook can never match it (409 forever), the agent's tools see no live call, minutes are never charged and no missed-call fallback goes
- R2-35 · Medium · si-calls has no internal time budget: 20 placements × 15 s ElevenLabs timeout (or 20 reconciles × 8 s Twilio timeout) exceeds maxDuration 120, and a kill mid-placeCall leaves a 'ringing' row with no ids
- R2-48 · Medium · Call texts bypass Batch 8's one-text-a-day and sms_monthly_cap and are never written to sms_messages, while the Texts section still promises "at most one text a day … no more than 8 a month. Texts are free"
- R2-80 · Medium · The intro call's contact card is only sent if the LLM agent calls the tool; an answered intro with no text sent gets no card and no fallback
- R2-98 · Medium · The intro call is dialled the instant the code is verified, while the member is still mid-signup on the same phone

**The first low-credit moment**

- R2-23 · High · A low-credit call blocked for a passing reason (first 3 days, intro day, daily limit, in flight, no credit) writes a 'blocked' row that carries the landing's trigger_ref, and the one-per-landing index then stops that landing ever getting a call
- R2-24 · High · A queued low-credit call is never re-tested against the balance at dial time: a member who topped up over the weekend is rung Monday and told their credit is running low, and charged for it
- R2-43 · High · Batch 20's £5 email and the low-credit call both go the same day: neither side checks the other once the debit that triggered them is over
- R2-45 · Medium · "Neither": a low-credit call that is placed and then fails stamps the member as told, and no £5 notice goes by any channel for 30 days
- R2-95 · Medium · The £20 welcome credit is never a "credit landing", so the low-credit call can never fire for today's (pre-pack) members
- R2-133 · Medium · F10 regression: /upgrade was moved out of the marketing group but the promised AppShell layout was never added, so the plan chooser now renders with no header, nav, credit banner or footer at all
- R2-177 · Medium · B14 is not fixed: a Checkout top-up's two Stripe events (different event ids) both pass grantTopup's non-atomic replay check; the B1 guard only serialises redeliveries of the SAME event id

**Later**

- R2-153 · High · Every inbound text's full body (and, on calls, the member's verbatim last line when 'unhappy') is stored for ever in si_conversation_questions, so the 90-day purge of turns deletes nothing the policy promises to delete
- R2-25 · Medium · The initiation webhook answers any POST carrying the static x-si-secret with the tool secret and a live 'ringing' call row for whichever verified number is posted, so one leaked header value lets an outsider text and charge members through the tools
- R2-28 · Medium · Every non-keyword text to the number — including a member's reply to a Batch 8 deal alert or verification code — is auto-answered and the member is charged 22p, whether or not they ever agreed to calls or texts from Stayful Intelligence
- R2-69 · Medium · Browse's "deals picked for you" ranks purchases without 22c's return-on-cash lift: a second fit definition that disagrees with Today and the reveal
- R2-70 · Medium · Part F's what-ifs appear on the reveal for a low match or an empty day but on Today only for a near miss: two trigger rules
- R2-86 · Medium · The shared call queue is not type-agnostic: Batch 25's 'deal' call type would get the low-credit opener, no missed-call fallback and no cap slot (7 places hard-code intro | low_credit)
- R2-141 · Medium · "Cheap deals first" is not what the checks job actually runs: the plan is round-robined top60 → low_entry → r2r, so the 3/12/5 split only materialises if the whole day's plan completes, and the £1 cap stops it long before
- R2-154 · Medium · Policy says the questions and call records are kept "with your usage records" (up to 24 months), but si_conversation_questions, si_conversations and si_calls_log have no retention at all
- R2-168 · Medium · No 'once per trigger' guard for any call type but intro and low_credit: a Batch 25 deal call re-queues on every cron pass after the first one ends
- R2-183 · Medium · The SMS auto-reply ignores SI_CALLS_DRY_RUN: a real reply goes and 22p is debited while every other call and text is only logged

**Existing members**

- R2-106 · High · Deep search quotes, runs and refreshes the PRIMARY profile, not the active profile the view is about
- R2-107 · High · Start again (or an active blank profile) stops every OTHER saved profile's daily pick and sends its Today's 5 free: the quiz-drop-out rule is member-level and reads the live copies the reset cleared
- R2-19 · Medium · /for-management-companies/start stamps the signed-in account as a management company on a plain GET, is linked from every member's Account page, and the stamp later turns an investor who uses "Start again" into a management-only account (no quiz gate, lands on /leads, no calls)
- R2-26 · Medium · Callbacks are identified and charged by caller ID alone: a member who never switched calls on is charged 65p a minute for ringing the number that texts them, and a spoofed caller ID charges the real member
- R2-56 · Medium · Product direction: home_view counts towards weekly active, so logging in counts as active again — the opposite of R1's E1/Q15 decision and of the brief's rule that a view reached by redirect/header is record-only
- R2-79 · Medium · 'I'm searching your area' is promised from the global MEMBER_SEARCH_ENABLED flag, not from whether this member has a search running
- R2-108 · Medium · After Start again or Start blank the member cannot switch back to another profile until the three mandatory questions are answered; the profiles page says they can
- R2-110 · Medium · A paid deep search ends with no result notice: the member never learns what it found, or that it found nothing

**Funnel owners and management companies**

- R2-82 · High · Batch 10's daily-picks backfill in schema.sql re-enrols every 22f management account on the next schema run (their picks were written off without the opt-out stamp)
- R2-147 · High · The management-company ad page advertises the £10 starter pack whenever the price settings exist, not when the pack is live — on live today (starter_pack_from = null) it promises £30 of credit that the setup never offers
- R2-36 · Medium · A funnel lead that completed but was not charged or emailed (crash between completeLead and finishFunnelLead, or funnel_lead_charge erroring) is never reconciled: the owner gets the lead free and no new-lead email
- R2-150 · Medium · The new-lead email says "turn it off in the form's settings" and links to /leads/funnels/{id}, but that page has no such switch; the only "Email me each new lead" control is the setup's Step 3, which nothing links to and which edits only the newest funnel
- R2-174 · Medium · A management company (22f) sees the header eye, and tapping it sends them into the investor quiz that 22f says must stay out of their way
- R2-175 · Medium · A management company has no Leads item in the header (and none lit) until step 1 of the setup creates its first funnel row, so leaving the setup loses the way back

**Admin only**

- R2-68 · High · signup_reveals.strong is never written, so /admin/intelligence's "Strong match" share is always 0%
- R2-27 · Medium · SI_CALLS_ENABLED gates only outbound calls and SMS auto-replies: inbound calls are answered, matched to members, charged and can send texts as soon as the number is imported and the agent synced (README §19 steps 3-7), days before step 9 turns the flag on
- R2-55 · Medium · /admin/weekly-active's 'Home visits alone keep N out of the quiet / pause' line overstates: it ignores email, text, extension, API and funnel-lead engagement that the nightly counts
- R2-148 · Medium · "Median sign-up to live" and the Journeys "Live" column measure from profiles.created_at, not the management stamp, so an existing member who converts via Account/quiz/Start shows months, not minutes
- R2-149 · Medium · "Set a test month" finds the owner with .ilike('email', …), which the repo's own rule forbids: an underscore or a typo can renumber a different, real owner's month
- R2-161 · Medium · scripts/stripe-setup.mjs's webhook event list omits charge.dispute.closed, which the webhook handles and README §21 step 2 requires

## 4. Findings by area

Every Critical, High and Medium carries its verifier text (three refuters for Critical/High, a second reader for Medium); Lows are listed as reported, with the fix. Ids are `R2-<n>`. 🗄️ marks a finding whose fix needs the schema run.

### A. Database

3 standing: 0 Critical · 0 High · 0 Medium · 3 Low.

**Low (tidy-ups)**

- **R2-119** · `supabase/schema.sql:6033` · Later — analysis_purchases_offer_check uses the name-guarded pattern that Batch 21 (A15) removed everywhere else, so a changed offer list will never apply on re-run
  *Fix:* Replace the block at supabase/schema.sql:6031-6037 with `alter table public.analysis_purchases drop constraint if exists analysis_purchases_offer_check; alter table public.analysis_purchases add constraint analysis_purchases_offer_check check (...);` inside th …
- **R2-120** · `supabase/schema.sql:998` · Later — R1 A8 is still open: profiles.referred_by_code is written by credit_redeem_code and read by nothing (re-pointed 21a → 21f → 21h, then dropped)
  *Fix:* Add referred_by_code to the admin profile page's select (src/lib/admin/profile-server.ts) and show it, or drop the write at supabase/schema.sql:998 and the column at 685. Not a schema-run dependency.
- **R2-121** · `supabase/schema.sql:6640` · Admin only — The Batch 22e backfill recounts every day since the first listing on every run of the file and aborts the whole run if that span exceeds 4000 days
  *Fix:* Mark the backfill once (a billing_settings row, as 22c does) or clamp its start to greatest(v_first, now() − interval '4000 days'), and wrap the perform in `begin ... exception when others then raise notice ... end` so a count problem can never abort the file.


### B. Money and credit

14 standing: 0 Critical · 3 High · 2 Medium · 9 Low.

#### R2-1 · High · The first report · `src/app/reports/[id]/page.tsx:41`

**Adding PMI to a finished report is always refused for a member who has never had a Deep report: the page labels the list price (£2) but the server charges the first-time price (£1), so quoteMatches fails with 'The price has changed' on every attempt**

*What's wrong:* Batch 22 added the first_pmi offer to the server (pmi-addon.ts, commit 12da543) but the only page that renders PmiAddonCard (reports/[id]/page.tsx, last touched in Batch 17) still labels the add-on with quoter.pricing.pmiAddonPence (200). PmiAddonCard posts quotedBasePence = label.basePence = 200; offeredPmiAddonFor returns {pmiPence: 100, offer: 'first_pmi'} for any paying account with no completed second_opinion purchase and no first_deep claim (pmiAddonOffer: max(100, ceil(pmiRaw 75)) = 100 < 200); quoteMatches(200, {purchaseBasePence: 100}) is false → 409 price_changed. PmiAddonCard then reloads the page after 2.5 s (PmiAddonCard.tsx:41), which shows £2 again. The first-time price is never shown and the add-on can never be bought by a first-timer; it works only for members who already had a Deep report (offer null → list price matches).

*How a member or Zac hits it:* A new member runs a £4 Full analysis from the reveal, opens the report, taps 'Add a second opinion from PMI · £2' → 'The price has changed since this page loaded. Nothing was charged; check the new price and try again.' → the page reloads showing £2 → tap → same error, forever.

*Smallest fix:* In src/app/reports/[id]/page.tsx compute the label from the offer: `const o = await offeredPmiAddonFor(user.id); pmi = quoter.label(o.pmiPence)` (and pass offerLabel(o.offer) for the struck-through list price), mirroring deals/[id]/page.tsx:185-187. Add a test that a never-had-deep member's quoted price equals the server's price.

```
pmi = quoter.label(quoter.pricing.pmiAddonPence);   // reports/[id]/page.tsx:41 — list £2, no offer
// src/lib/analysis/pmi-addon.ts:92-95
const offered = input.adminUser ? null : await offeredPmiAddonFor(input.userId).catch(() => null);
const price = input.ad …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The code path is exactly as the reader described, and the mismatch is created by an in-scope change. Batch 22 (commit 12da543) rewrote the server charge in src/lib/analys …
- *reproduce:* stands — The finding stands and I reproduced the path end to end in the code on main. Entry point: a member who ran a Full analysis (no PMI) of a feed deal opens /reports/[id]. sr …
- *the rule:* stands — The finding stands and the severity is right. The report page labels the PMI card with the list price while the server (changed in Batch 22, commit 12da543) prices the sa …

<sub>Reader: B1 money: charge paths · confidence high</sub>

#### R2-2 · High · The first report · `src/lib/analysis/deal-analysis.ts:647`

**A first Deep report whose PMI second opinion never arrives still consumes the once-per-account first-time price: the purchase completes with first_deep = true and second_opinion = false, and hadDeepReport then reads it as 'had one'**

*What's wrong:* startDealAnalysis inserts first_deep: true for a first_deep or welcome_deep offer (deal-analysis.ts:354). When PMI does not answer (fetchSecondOpinion returns null: the daily budget, no comparables — a documented path that shows an enhancedNotice), runDealAnalysis completes the purchase without PMI and without charging the PMI line but never clears first_deep. hadDeepReport's second query (first_deep and status <> 'failed') now returns true, so analysisOffer and pmiAddonOffer give no first-time price again: the member pays list for the PMI they still have not had (first_pmi £1 → £2 on the report; a later Deep report £6 instead of £5). The unique index analysis_purchases_first_deep_uidx likewise stays claimed. The PMI-add-on path handles this correctly (pmi-addon.ts:174-177 marks the purchase failed, freeing the claim); the Full-analysis path does not.

*How a member or Zac hits it:* A member ticks PMI on their first Deep report (£5 shown as 'first-time price'). PMI's daily budget is spent, the report arrives with 'PMI couldn't give a second opinion… try again tomorrow' and £4 is charged. Tomorrow the report's PMI card says £2 (not £1) and any other Deep report is £6, because the account is recorded as having had its first Deep report.

*Smallest fix:* In runDealAnalysis, when purchase.with_pmi && !pmiDelivered include `first_deep: false` in the complete update at deal-analysis.ts:655 (and in settleIfAbandoned's complete branch at :230); add a test on hadDeepReport/analysisOffer that a completed first_deep purchase without second_opinion does not count.

```
const pmiDelivered = pmiWanted && Boolean(result.secondOpinion);
if (pmiDelivered) await charge(purchase.pmi_base_pence, {...});   // deal-analysis.ts:647-648 (PMI not charged)
... .update({ status: 'complete', report_id: reportId, analysis_id: analysisId, reu …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The code path is exactly as claimed. startDealAnalysis inserts first_deep: true whenever the offer is first_deep or welcome_deep (deal-analysis.ts:354, via offers.ts:107/ …
- *reproduce:* stands — The finding stands; the path is reachable and the state arises on live settings. Walk: member ticks PMI on a deal page → startDealAnalysis (deal-analysis.ts:316-317) pric …
- *the rule:* stands (severity should be Medium) — The finding stands on the code. startDealAnalysis inserts first_deep: true for any first_deep or welcome_deep offer (deal-analysis.ts:354, and analysisOffer sets firstDee …

<sub>Reader: B1 money: charge paths · confidence high</sub>

#### R2-13 · High · The intro call · `supabase/schema.sql:1844`

**A call's debitFace ignores open reservations, so a call can take credit a running analysis, deep search or funnel lead has reserved; the reserved debit then overdrafts (or, for a deep search, is forfeited)**

*What's wrong:* credit_available (schema.sql:715-740) defines spendable_base_pence as grants minus open credit_reservations, and every metered action reserves first (credit_reserve checks spendable). credit_debit_face, which Batch 23 uses for every call minute, text and fallback email, computes its own availability from credit_grants.remaining_pence alone (1844-1846) and never looks at credit_reservations. capToBalance (charge-server.ts:90) caps at totalPence (face grants), and the call eligibility rule (member-server.ts:157 → queue-server.ts:62 → eligibility.ts:194 'no_credit') also uses totalPence. So a call is placed to, and charged against, a member whose balance is already spoken for. When the reserved action then settles, credit_debit with p_reservation set skips the spendable check (schema.sql:785-787) and draws from grants; the shortfall becomes an 'overdraft:<user>' grant because the analysis debit passes allowNegative: true (deal-analysis.ts:625) and funnel_lead_charge passes true (SQL above). The deep search's final debit (member-search.ts:474) does not allow negative, so it throws, is caught at :480 ('deep charge failed'), the reservation is released and the member gets the search free. Net: the call itself never shows a negative balance, but it is the cause of the member (or funnel owner) ending the hour below zero, which the brief forbids ('a call can never push the balance below zero'), and R1's 21a/21b decision (overdrafts forgiven, never overdraw again) is undone by the next call.

*How a member or Zac hits it:* A member at £6.00 ticks a Deep report on a revealed deal at the welcome price (£3 reserved under the purchase) and, while it runs, answers Stayful Intelligence's intro call (they ticked calls on the choices screen a minute earlier; eligibility passes because totalPence £6 buys 9 minutes). A 5-minute call charges £3.25 (cap = £6, not the £3 spendable), leaving £2.75. The report finishes and debits £3 under its reservation: £2.75 from grants, 25p into 'Overdraft (repaid by the next credit)'. Account → Billing shows −£0.25. Same shape for a funnel owner: £5.00 spendable, a lead holds £5, a 2-minute callback charges £1.30, funnel_lead_charge then overdrafts £1.30. Same shape for a deep search quoted up to £12 on a £15 balance: a 5-minute callback takes £3.25, the search's £12 debit throws and the member is not charged at all.

*Smallest fix:* In credit_debit_face subtract open reservations before the check (base pence are never more than face, so this only ever lowers the cap): after line 1846 add `v_available := v_available - (select coalesce(sum(max_base_pence - settled_base_pence), 0) from credit_reservations where user_id = p_user and status = 'open' and expires_at > now());`. In charge-server.ts:90 cap at `Math.min(balance.totalPence, balance.spendableBasePence)` and in member-server.ts:157 use the same spendable figure for balancePence, so eligibility and the cap agree with the ledger. One SQL line (its own idempotent '-- Review R2' section) and two TS lines.

```
supabase/schema.sql:1844-1846 (credit_debit_face)
  select coalesce(sum(remaining_pence), 0) into v_available
  from credit_grants
  where user_id = p_user and remaining_pence > 0 and (expires_at is null or expires_at > now());

src/lib/voice/charge-server.ts: …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed code path is exactly what the code does, and I reproduced the outcome in the throwaway r2 database. credit_debit_face (schema.sql:1844-1849) computes availabi …
- *reproduce:* stands — The finding stands; I reproduced the path end to end on main (5d0ac80). (1) The ledger's notion of spendable subtracts open reservations: credit_available (schema.sql:715 …
- *the rule:* stands — The finding stands, with corrections to its framing. (1) Mechanism confirmed in code and empirically: credit_debit_face (schema.sql:1844-1850) checks only credit_grants.r …

*Also reported by:* B1 money: charge paths (“Call charges cap at the displayed total and credit_debit_face ignores open reservations, so a call can spend c …”)

<sub>Reader: B2 money: charge twice · confidence high</sub>

#### R2-0 · Medium · The reveal and the Stayful Intelligence view · `src/lib/credit/deal-pricing.ts:52`

**Full analysis is £4 on main (seed, live and code fallback all 400); the brief says £5, so every derived price (Deep £6 not £7, first Deep £5 not £6, welcome £2.17 not £2.50) is £1 under the brief**

*What's wrong:* Nothing in Batch 22 (or any batch since R1) moves full_analysis_pence to 500. The live row is 400 (live-markers), the schema seed is 400 (on conflict do nothing), the code fallback is 400, and every UI string is computed from it, so the site is self-consistent at £4: Deep report = 400 + pmi_addon_pence 200 = £6; first Deep = 400 + deep_first_run_extra_pence 100 = £5; welcome price = max(400 × 50%, raw floor) = £2.17. Of the four sources, only the brief says £5 / £7 / £6; seed, live and UI all say £4 / £6 / £5. No typed '£4' or '£5' exists in a member-facing string (only comments: deal-analysis.ts:5, starter-pack/rules.ts:11, README:184 '£4 on a plan').

*How a member or Zac hits it:* A new member on the reveal taps 'Run full analysis · £2.17 ~~£4~~ welcome price' and 'Deep report · £3 ~~£6~~'; after the week, 'Run full analysis · £4' and the answer chip says 'A full analysis is £4 … A deep report adds PMI's second opinion for £6 (£5 your first time)'. Zac expects £5 / £7 / £6.

*Smallest fix:* Business decision first (question for Zac). If £5 is intended: update the live billing_settings row to 500 via /admin/billing (the seed is on-conflict-do-nothing so the SQL file cannot change it), change the fallback at deal-pricing.ts:52 and the seed at schema.sql:3459, and update the README wording at line 184. If £4 is intended: correct the brief and the Batch 24–26 prompts.

```
fullAnalysisPence: 400,   // deal-pricing.ts:52
('full_analysis_pence', '400'::jsonb),   // supabase/schema.sql:3459 (Batch 10 seed, untouched by Batch 22)
const deep = formatPence(f.fullPence + f.pmiPence);   // src/lib/intelligence/answers.ts:95 → "£6"
```

**Verified by three refuters** (3 of 3 say it stands; reported High, graded Medium):
- *code path:* stands (severity should be Medium) — The code path is exactly as claimed. Every member-facing price is derived from billing_settings.full_analysis_pence, and all three sources of that value are 400: the code …
- *reproduce:* stands — The finding stands. Reached from the reveal (/welcome/reveal → Part H price buttons), /intelligence answer chip 'analysis', /pricing, /terms and every charge path: all re …
- *the rule:* stands (severity should be Medium) — The facts stand: nothing merged since R1 moves full_analysis_pence to 500. The fallback is 400 (src/lib/credit/deal-pricing.ts:52), the seed is 400 under `on conflict (ke …

*Also reported by:* A database (“full_analysis_pence is seeded, live and defaulted at 400 (£4) while the brief says the Full analysis is £5 — a …”)

<sub>Reader: B1 money: charge paths · confidence high</sub>

#### R2-3 · Medium · The reveal and the Stayful Intelligence view · `src/lib/analysis/offers.ts:100`

**At the £4 list price the welcome price is not half price: the raw-cost floor lifts it to £2.17 (ceil of the 216.835p worst-case raw cost at the seed unit costs), and the admin guard would allow at most 45% off**

*What's wrong:* fullAnalysisRawCeiling(seedTable()) = 216.835p (computed with node from src/lib/credit/estimate.ts and costs.ts; live base_markup is 5 and the live unit_costs were not visible, so this is the seed figure). 50% of 400 = 200 < 217, so welcomeApplies yields fullPence 217 and the reveal shows 'Run full analysis · £2.17 ~~£4~~ welcome price', and the answer chip says '£2.17 on your matches until <date>'. The brief, PR #121 and the offers test ('welcome: half price') all say half price. The welcome Deep report is unaffected (300 ≥ deepRaw 292 → £3). At a £5 list the same code gives a clean £2.50 (checked), so this is a consequence of finding 1. maxSafeDiscountPct exists to stop admin saving a discount under the floor but is dead code, and reveal_analysis_discount_pct has no admin field at all (grep: only src/lib/analysis/offers.ts), so the seeded 50% is already past the 45% the guard would permit.

*How a member or Zac hits it:* A new member sees 'Run full analysis · £2.17 ~~£4~~ welcome price' beside 'Deep report · £3 ~~£6~~ welcome price' and asks why 'half price' is £2.17.

*Smallest fix:* Resolve with finding 1 (at £5 the welcome price is exactly £2.50). If £4 stays: either accept £2.17 and change the wording to 'welcome price' only (drop 'half' from the PR/README/knowledge), or set reveal_analysis_discount_pct to 45 on live. Remove maxSafeDiscountPct or wire it into an admin field for reveal_analysis_discount_pct.

```
const full = Math.max(round2(list.fullPence * (1 - off)), floorTo(floors.fullRawPence));   // offers.ts:100 → max(200, 217) = 217
// offers.ts:140-144 (never called anywhere in src/)
export function maxSafeDiscountPct(list, floors) { ... return Math.max(0, Mat …
```

**Second reader:** confirmed — The arithmetic and the code path are right, and I reproduced them: with seedTable() from src/lib/credit/costs.ts, fullAnalysisRawCeiling() = 216.835 (291.835 with PMI; ma …

<sub>Reader: B1 money: charge paths · confidence medium</sub>

**Low (tidy-ups)**

- **R2-4** · `src/app/(marketing)/for-management-companies/page.tsx:41` · Funnel owners and management companies · *reported Medium, second reader: overstated* — /for-management-companies advertises the volume tiers (£5.00 / £4.00 / £3.25 / £2.50 from the code defaults) while every owner is still charged the legacy metered price, because the 22f section has not been applied on live (funnel_tiers_from is missing, so pricingFor returns 'legacy' for everyone)
  *Fix:* Run the Batch 22f section of supabase/schema.sql on live (it seeds funnel_tiers_from at that moment). As a code guard, have the marketing page read ownerPricing-style mode or at least getFunnelTierSettings().tiersFrom and show 'pay as you go' copy when tiersFr …
  *Also reported by:* Walk 2: existing members
- **R2-6** · `src/lib/funnels/charge-server.ts:71` · Funnel owners and management companies — The tier charge is made after the run's hold has been released, without the reservation funnel_lead_charge supports and with allow_negative = true, so two leads finishing together can take a funnel owner into overdraft (the funnel doors are designed never to overdraw)
  *Fix:* Pass the run's reservation id into funnel_lead_charge (keep the hold open until after the charge: call finishFunnelLead before prepared.finish(), or re-reserve the tier price inside the RPC), and call credit_debit with p_allow_negative = false so a short owner …
  *Also reported by:* A database
- **R2-9** · `src/lib/sourcing-demand/member-search.ts:76` · Later — A deep search's 'up to' hold lasts 60 minutes but the search runs in 38-second slices picked up by a 5-minute cron that shares a 50-second budget across up to 20 searches; a slow search outlives its hold and the final debit fails rather than charges, leaving the finds delivered and unpaid
  *Fix:* Extend the hold on every slice (re-reserve or bump expires_at in lease()) or raise DEEP_RESERVE_MINUTES well past the worst case, and on an insufficient-credit failure at finish debit with allowNegative: true (the member agreed the 'up to') or mark the search …
- **R2-10** · `src/lib/analysis/offers.ts:105` · The reveal and the Stayful Intelligence view — welcome_deep splits its total as 200 + 100 while a welcome Full analysis alone is floored to 217, so a welcome Deep report whose PMI never answers charges 200 for the analysis — under the raw floor and below what the same member pays for the same analysis without PMI
  *Fix:* In the welcome_deep branch floor the analysis line too: `const full = Math.max(round2(list.fullPence * (1 - off)), floorTo(floors.fullRawPence))` and derive pmi = total − full (clamped ≥ 0).
- **R2-11** · `src/lib/analysis/pmi-addon.ts:210` · The first report — The PMI ledger line never carries the offer suffix: a £1 first-time or welcome PMI is written as plain 'Second opinion from PMI' while the Full analysis line says '— welcome price' / '— first-time price'
  *Fix:* Apply offerSuffix to the PMI description in both places (`Second opinion from PMI — first-time price`) and pass `offer` in the pmi_addon debit meta as the full_analysis line does.
- **R2-12** · `src/lib/analysis/offers.ts:140` · Admin only — maxSafeDiscountPct is defined and tested but never called, and the three offer settings (reveal_analysis_discount_pct, deep_first_run_extra_pence, deep_search_first_discount_pct) have no admin field, contrary to settings.ts's 'the money ones are edited on /admin/billing'
  *Fix:* Either add the three fields to updateDealPricingAction (validating with maxSafeDiscountPct) or delete maxSafeDiscountPct and correct the settings.ts comment to 'edited by SQL'.
- **R2-15** · `src/lib/voice/charge-server.ts:139` · The intro call — A crash between a call charge's guard row and its debit forfeits the charge for good (minutes and SMS replies have no releaseCharge path)
  *Fix:* In settle(), wrap the pre-debit reads in try/catch and call releaseCharge(guardId) on failure so a retry can charge; or move the guard insert to immediately before debitFace. Add an admin query (or /admin/billing line) for si_call_charges where kind='minutes' …
- **R2-16** · `src/lib/listing/picks-run.ts:1516` · The first report — R1 C15 incomplete: a pick debited before the send is never refunded if the picks run dies between the debit and Resend (no sweep of 'pending' sourcing_sent rows)
  *Fix:* Add to the picks run (or the credit-sweep cron) a once-a-day sweep: for sourcing_sent rows with status 'pending', charged_base_pence > 0 and sent_at older than 15 minutes, refundAction/refund the debit under action_id = row.id and mark the row 'failed'. Ten li …
- **R2-17** · `src/lib/analysis/offers-server.ts:39` · Existing members — First-time Deep report price: the pre-check is per paying account but the unique index is per member, so a team seat is refused it when the owner had one and granted it when another seat had one
  *Fix:* Decide which it is and make both halves say it: for 'per paying account', query hadDeepReport on user_id = payerId and change the index to (user_id) where first_deep and status <> 'failed'; for 'per member', pass input.userId (the member) to hadDeepReport and …
  *Also reported by:* B1 money: charge paths, Walk 2: existing members


### C. Free vs paid, privacy and safety

14 standing: 0 Critical · 3 High · 5 Medium · 6 Low.

#### R2-18 · High · The reveal and the Stayful Intelligence view · `src/lib/sourcing-demand/member-search.ts:453`

**A free member's own search finds never reach their Today list or stop the search in the slice that found them: the member context's visibility (ownFinds) is read once before the finds are inserted**

*What's wrong:* runSearchSlice builds `who.member` once at the start of the slice (memberFor → dealVisibilityFor → ownFindsFor, line 284), BEFORE recordFinds (line 349) inserts this slice's finds into member_search_finds. finish() then hands that stale member to refreshTodayAfterSearch, whose chooseToday ranks over rankingPool(..., member.visibility): for a free member cutoffIso is set and ownFinds does not contain the new deals (live_since = now, inside the 48 h window), so dealsQuery drops them with .lte('live_since', cutoff). refreshList only adds finds that appear in `ranking` (refresh.ts:39), so nothing is added, refreshTodayAfterSearch returns [] and the reveal/Today never gain the finds (choice.finds stays 0, so "including N I found for you just now" never shows), although signup_reveals.layer is still written as 2 (line 465). The same stale visibility feeds strongNow (lines 300, 361 → previewToday → the same pool), so a find can never satisfy the stop-at-strong-match rule and the signup search runs on to its cap. A paying member (cutoffIso null) is unaffected; a brand-new member — the signup search's whole audience — is free. The finds do show on Browse and in tomorrow's 07:00 choice (fresh request, fresh ownFinds), so the exception leaks nothing, it simply fails to apply where it was built to.

*How a member or Zac hits it:* MEMBER_SEARCH_ENABLED=true. A new member finishes the quiz with no close match; the reveal says "I'm searching your area". Layer 2 finds and confirms two live deals in their area. finish() runs: chooseToday cannot see them, refreshList adds nothing, the reveal page still shows the near-miss cards and "Nothing near your criteria yet", while /deals (Browse) already lists both deals. Admin's /api/intelligence/status says found: 2. For a deep search the member paid up to £15 for, the same: the finds appear on Browse but not where the offer said they would.

*Smallest fix:* After confirmFinds (and after any step where added > 0), refresh the member's visibility before ranking: in runSearchSlice re-run `who = await memberFor(admin, row.user_id, now)` (or, smaller, when `who.member.visibility.cutoffIso` is set, splice the confirmed find ids into a copy: `member = { ...member, visibility: { ...member.visibility, ownFinds: [...(member.visibility.ownFinds ?? []), ...live] } }`) and pass that member to finish()/refreshTodayAfterSearch and to strongNow. Add a test: a free member's search whose find is inside the 48 h window ends with the find on the Today list.

```
async function finish(admin, row, member, s, stop, now) {
  const finds = await findRows(admin, row.id);
  ...
  await refreshTodayAfterSearch(member, live, reveal?.dealIds ?? [], now)   // member = who.member from memberFor() at line 284

// memberFor (115–12 …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The finding stands for the signup search. Traced code path: runSearchSlice builds `who` once at member-search.ts:284 via memberFor (115–124), which calls dealVisibilityFo …
- *reproduce:* stands — The finding stands; I reproduced the path end to end from the member's entry point and could not break it. Reachability: Quiz.tsx:154-156 POSTs /api/welcome/search the mo …
- *the rule:* stands — The finding stands and High is the right severity. The code path is exactly as described: runSearchSlice builds `who` once (member-search.ts:284) via memberFor → dealVisi …

<sub>Reader: C1 privacy: who sees what · confidence high</sub>

#### R2-23 · High · The first low-credit moment · `src/lib/voice/queue-server.ts:83`

**A low-credit call blocked for a passing reason (first 3 days, intro day, daily limit, in flight, no credit) writes a 'blocked' row that carries the landing's trigger_ref, and the one-per-landing index then stops that landing ever getting a call**

*What's wrong:* checkEligibility (eligibility.ts:69-79) returns first_days, intro_day, daily_limit, in_flight, no_number and no_credit as blocked (skip:false), so enqueueCall inserts a blocked row with trigger_ref = the credit landing's grant id. The unique index covers every status, and maybeQueueLowCreditCall's 'already handled' check (215-217) treats any prior row as final. So a rule meant to say 'not today' (the brief: no low-credit call in the first 3 days or on the intro day) becomes 'never for this credit'. The 7-day window keeps running; days 4-7 never get the call. The intro call's own charges (65p/min, 22p text → settle → afterDebit, charge-server.ts:360/368) are a very likely trigger on the intro's own day.

*How a member or Zac hits it:* A new member joins Monday, ticks calls, buys the £10 pack (one £30 landing), gets the intro at 10:00. By Monday evening they have run analyses and are at £4 with £26 (87%) spent → afterDebit → maybeQueueLowCreditCall → triggered → enqueueCall → first_days (joined 1 day ago) → blocked row (user, trigger_ref = pack grant). Thursday to Sunday, still inside the 7-day window and past 3 days, every debit finds the prior row and answers called:false; the only notice is Batch 20's £5 email. /admin/calls shows one blocked low-credit call and never a placed one. For a member past day 3 the same happens when the contact-card text's 22p charge runs afterDebit while the intro is still ringing (in_flight) or just after it (intro_day).

*Smallest fix:* In src/lib/voice/low-credit-server.ts after line 216: if prior.status === 'blocked' and its blocked_reason is one of first_days, intro_day, daily_limit, in_flight, no_credit, no_number, delete that row (admin.from('si_calls_log').delete().eq('id', …).eq('status','blocked')) and fall through to enqueueCall; alternatively write passing blocks with trigger_ref `${landing.id}:${reason}:${ukDay(now)}` so the index keeps 'one placed call per landing' but not 'one attempt'.

```
const r = await insertCall(admin, { ...base, status: 'blocked', blocked_reason: e.reason });   // base = { …, trigger_ref: o.triggerRef ?? null, … } (line 79)
// low-credit-server.ts:215-217
const { data: existing } = await admin.from('si_calls_log').select('s …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The finding stands. The code path is exactly as claimed: checkEligibility returns first_days / intro_day / daily_limit / in_flight / no_number / no_credit for a low_credi …
- *reproduce:* stands — The finding stands; every link in the chain is on main and reachable. (1) Entry: any charge runs afterDebit (src/lib/credit/after-debit.ts:72); in the 'low' state it call …
- *the rule:* stands — The finding stands; it is a real defect, not a documented decision. Code path, traced on main: (1) eligibility.ts:69-79 returns first_days, intro_day, daily_limit, in_fli …

*Also reported by:* I conflicts and contracts (“A low-credit call blocked by first_days / intro_day / daily_limit / in_flight writes a blocked row that the on …”); Walk 1: new member (“A low-credit call blocked by a temporary rule (first 3 days, no number, daily limit, in flight) uses up the on …”)

<sub>Reader: C2 safety: calls and texts · confidence high</sub>

#### R2-24 · High · The first low-credit moment · `src/lib/voice/queue-server.ts:137`

**A queued low-credit call is never re-tested against the balance at dial time: a member who topped up over the weekend is rung Monday and told their credit is running low, and charged for it**

*What's wrong:* placeCall re-checks the switch, number, owner, day, in-flight, hours and 'at least a minute of credit' but never the trigger itself (lowCreditTriggered / balance ≤ low_credit_pence / latest landing still the call's trigger_ref). A call queued outside hours (not_before = next opening, up to ~62 hours away over a weekend) is dialled whatever happened to the balance in between. Only auto top-up switching on is re-read (eligibility.ts:67). The agent then reads LOW_CREDIT_SCRIPT ('your credit's running low, so your daily picks could stop soon'), and a missed call sends the 'you're nearly out of credit' text and email (fallback-server.ts:42-68), all charged.

*How a member or Zac hits it:* Friday 19:30 UK a member is at £4.20 having spent £21 of a £25 top-up since Tuesday → the call is queued for Monday 09:00 and, because it is outside hours, called:false lets Batch 20's £5 email go that evening. Saturday they top up £25 from that email (or Monday 08:00 a plan cycle lands £39.99). Monday 09:00-09:05 the cron dials: 'Hi Sam, it's Stayful Intelligence… your credit's running low… Would you like me to switch on auto top-up?' at 65p a minute, with £29 on the account. If they don't answer: a 22p text and a 20p email saying they are nearly out of credit.

*Smallest fix:* In placeCall (queue-server.ts, after line 137), for type === 'low_credit': re-read settings.lifecycle.lowCreditPence and, if m.balancePence > lowCreditPence or latestLanding(...)?.id !== call.trigger_ref, `if (o.apply) await dropOrBlock(call, 'stale')` (or a new BlockedReason 'credit_recovered') and return blocked. Not a schema change.

```
const m = await memberFacts(call.user_id);
…
const e = await eligibilityFor(type, m, now, call.id);   // safety rules only
if (!e.ok) { … }
// eligibility.ts:79 — the only balance test
if (i.affordableSeconds < 60) return no('no_credit');
// low-credit-server. …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claim is true on main. placeCall (src/lib/voice/queue-server.ts:124-152) re-runs only eligibilityFor(), whose rule set (src/lib/voice/eligibility.ts:62-82) has no tes …
- *reproduce:* stands — The finding stands; the path is reachable and the state is ordinary. Entry point: any debit → src/lib/credit/after-debit.ts:54-55 calls maybeQueueLowCreditCall, which che …
- *the rule:* stands — The code supports the finding and it is not a documented decision. placeCall (queue-server.ts:124-152) re-runs only eligibilityFor → checkEligibility (eligibility.ts:62-8 …

*Also reported by:* D2 messages and the cap (“A queued low-credit call is still placed after the member has topped up: the trigger is never re-checked befor …”)

<sub>Reader: C2 safety: calls and texts · confidence high</sub>

#### R2-19 · Medium · Existing members · `src/app/(marketing)/for-management-companies/start/route.ts:28`

**/for-management-companies/start stamps the signed-in account as a management company on a plain GET, is linked from every member's Account page, and the stamp later turns an investor who uses "Start again" into a management-only account (no quiz gate, lands on /leads, no calls)**

*What's wrong:* The stamp is a one-way, permanent change to the account made by a GET with no confirmation or same-origin check (the Supabase auth cookie is SameSite=Lax, so it rides on any top-level link, from an email, a tweet or another site). Any curious investor who taps the new Account link gets signup_path='management' for good (nothing ever clears it), an mc_signup activity row and a Meta mc_signup conversion. The stamp then interacts with Batch 22d: `managementOnly` is simply stamped && !mandatoryDone, so when that investor later presses Start again (reset_search_profile clears market_goals, so mandatoryDone becomes false) and leaves the quiz unfinished, AppShell drops the quiz and reveal gates (AppShell.tsx:78,81), proxy.ts:49 lands every sign-in on /leads, and voice/eligibility.ts:66 skips the low-credit call with 'management_no_deals' — for a member who never ran a lead form. For a member who has not yet finished the quiz, one visit to the link also writes sourcing_alerts=false (no daily email) with nothing on screen saying so.

*How a member or Zac hits it:* Existing investor Zoe opens Account, taps "Get leads with your own branded form" to see what it is, and backs out. Weeks later she uses Profile → Start again and closes the quiz on screen one. From then on she lands on /leads after every sign-in, Today no longer sends her to the questions, and when her credit runs low the call is skipped as management_no_deals. Separately, a link to /for-management-companies/start posted anywhere stamps every signed-in member who clicks it (R1 C21 judged the /profiles/switch GET deliberate, but that one is reversible and changes nothing permanent).

*Smallest fix:* Make the stamp a POST (a one-button confirm form on the marketing page and on Account, as the unsubscribe routes do) instead of a GET side effect; and make `managementOnly` require that the account never completed the questions — e.g. read `profile_restarts` (none) or stamp only when `signup_path_via` is 'first_touch' | 'start' | 'quiz' AND no profile_quiz answers existed at stamping — or clear signup_path when deal-finding switches on. Keep ownerIdOrNull as is.

```
export async function GET(request: Request) {
  ...
  if (!(await ownerIdOrNull(user))) return NextResponse.redirect(new URL('/leads', url.origin));
  await stampManagement(user.id, via === 'account' ? 'account' : via === 'quiz' ? 'quiz' : 'start');
  return N …
```

**Second reader:** confirmed — Every link in the chain is real on main at 5d0ac80. The stamp is a GET side effect with no same-origin check and the auth cookie is SameSite=Lax by library default; nothi …

*Also reported by:* Walk 2: existing members (“An investor stamped as a management company who later presses Start again becomes “management-only”: no quiz g …”)

<sub>Reader: C1 privacy: who sees what · confidence high</sub>

#### R2-25 · Medium · Later · `src/lib/voice/inbound-server.ts:300`

**The initiation webhook answers any POST carrying the static x-si-secret with the tool secret and a live 'ringing' call row for whichever verified number is posted, so one leaked header value lets an outsider text and charge members through the tools**

*What's wrong:* Nothing in the initiation path proves a call exists: no Twilio call SID format check, no HMAC, no timestamp, no replay guard. The response includes ELEVENLABS_TOOL_SECRET (so the initiate secret is worth both secrets), and each POST inserts a status 'ringing' inbound row for the posted number's member with whatever conversation_id/call_sid the caller chose. tools-server.ts liveCall (56-62) accepts any ringing row younger than max_call_seconds + 5 min, so the forged row unlocks lookup_caller (first name, auto top-up state), send_template_text (two texts to the member, 22p each, charged via settleText) and handoff_to_team (an email to Zac) per forged call; a new conversation_id makes a new row each time. Rows are only turned to 'failed' by the 30-minute reconcile. The initiate secret is a plain header value in the ElevenLabs dashboard, shared with whoever administers it.

*How a member or Zac hits it:* Someone with access to the ElevenLabs workspace (or a copy of the webhook settings) scripts: POST /api/voice/elevenlabs/initiate {caller_id:'+447700900123', conversation_id:'x1'} → gets {first_name:'Sam', context:'member', minutes_available, secret__tool_token}; then POST /api/voice/tools/send_template_text {conversation_id:'x1', template:'auto_topup_link'} with x-si-tool-token → Sam's phone gets the auto top-up text and 22p leaves Sam's balance; repeat for every verified number they can guess. Admin sees 'You rang me' rows Sam never made.

*Smallest fix:* In src/lib/voice/agent/tools.ts send the tool header as an ElevenLabs workspace secret (their tool config takes a secret-typed header) and drop secret__tool_token from inbound-server.ts (lines 301, 317) and queue-server.ts:199; in answerInitiation insert the inbound row only when req.call_sid matches /^CA[0-9a-f]{32}$/ (the same test twilio-voice.ts uses), and have liveCall require twilio_call_sid not null for inbound rows.

```
const secret = toolSecret();
const withSecret = (vars) => ({ ...vars, ...(secret ? { secret__tool_token: secret } : {}) });
…
const phone = ukMobile(req.caller_id ?? null);
const userId = phone ? await memberByNumber(phone) : null;
…
await insertCall(admin, { …
```

**Second reader:** confirmed — The code does what the finding says. The initiation route authenticates only by constant-time compare of the static x-si-secret header (src/app/api/voice/elevenlabs/initi …

<sub>Reader: C2 safety: calls and texts · confidence high</sub>

#### R2-26 · Medium · Existing members · `src/lib/voice/inbound-server.ts:335`

**Callbacks are identified and charged by caller ID alone: a member who never switched calls on is charged 65p a minute for ringing the number that texts them, and a spoofed caller ID charges the real member**

*What's wrong:* memberByNumber (member-server.ts:68-76) matches any verified, non-stopped number; answerInitiation never looks at profiles.si_calls, and finishCall charges every answered call with a user_id. The price (callPriceLine / callBoxNote, intelligence/choices.ts) is shown only inside the call box and the Calls section, which a member with calls off never read. Batch 8's alert and verification texts come from the same number (TWILIO_FROM_NUMBER), so ringing it back is the natural thing to do. Caller ID is not authenticated (the persona itself says 'caller ID can be faked', service-guide.ts:131), yet the charge is keyed on it with no cap other than the balance and the 10-minute maximum.

*How a member or Zac hits it:* (1) A member who left the call box unticked gets 'Price drop on … Reply STOP to opt out' and rings the number to ask about it; the agent says 'Hi Sam, how can I help?' and the member pays 65p a minute, seeing 'You rang me · Answered · £3.25' later on /account/calls with no price ever shown to them. (2) Someone spoofs a member's mobile and talks to the agent for 10 minutes: the member is debited £6.50 (capped at their balance) and may get two texts they did not ask for.

*Smallest fix:* In answerInitiation (inbound-server.ts:335-364) when !m.callsOn treat the caller as a member for the greeting but insert the row with context 'member' and a flag the charge path honours — simplest: in finishCall only call chargeCallMinutes when (await memberFacts(call.user_id))?.callsOn is true for inbound calls; add the per-minute price to CALLBACK_MEMBER_OPENER / CALLBACK_UNKNOWN_OPENER (scripts.ts:69-72); and cap inbound charging at a few minutes or require a short PIN before anything billable.

```
const m = await memberFacts(userId);      // m.callsOn is read but never used
const payer = await payerFor(userId);
…
const seconds = payer.suspended ? 60 : affordableSeconds(balance?.totalPence ?? 0, perMin, settings.voice.maxCallSeconds, …);
…
await insertCa …
```

**Second reader:** confirmed — The code mechanics are as claimed: a callback is identified by caller ID alone and every answered call with a user_id is charged, with no check of profiles.si_calls on th …

<sub>Reader: C2 safety: calls and texts · confidence high</sub>

#### R2-27 · Medium · Admin only · `src/lib/voice/inbound-server.ts:297`

**SI_CALLS_ENABLED gates only outbound calls and SMS auto-replies: inbound calls are answered, matched to members, charged and can send texts as soon as the number is imported and the agent synced (README §19 steps 3-7), days before step 9 turns the flag on**

*What's wrong:* callsEnabled() is checked in enqueueCall (queue-server.ts:73), maybeQueueLowCreditCall (198), run.ts and replyToText (sms-replies-server.ts:193) only. The initiation route, the tool route and the post-call webhook run regardless, so the whole inbound surface — recognised-member greeting, per-minute charges, two texts a call, handoff emails, conversation logging — is live from the moment ElevenLabs owns the number, which the deploy notes do on purpose before the flag is set. There is no 'answer as unknown and charge nothing until enabled' mode.

*How a member or Zac hits it:* Zac imports the 07 number into ElevenLabs (step 3) on Tuesday, syncs the agent (step 7) and plans to set SI_CALLS_ENABLED on Friday after testing with his own phone. Wednesday a member rings the number back after a Batch 8 alert text: the agent answers as Stayful Intelligence, calls lookup_caller, chats for four minutes (£2.60 debited), texts the auto top-up link (22p) — before Zac has decided calls are live.

*Smallest fix:* In answerInitiation return the 'unknown' variables (and no secret__tool_token, no user_id on the row) when !callsEnabled(); in runTool return { ok:false, say: "I can't do that right now." } when !callsEnabled(); in finishCall skip chargeCallMinutes for inbound calls when the call row has no user_id (already the case) — the first two make that true while disabled.

```
export async function answerInitiation(req: InitiationRequest, now: Date = new Date()): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const secret = toolSecret();          // no callsEn …
```

**Second reader:** confirmed — Confirmed, with one correction: the cited line is wrong. src/lib/voice/inbound-server.ts is 116 lines; answerInitiation is at line 47, not 297. The substance holds. calls …

<sub>Reader: C2 safety: calls and texts · confidence high</sub>

#### R2-28 · Medium · Later · `src/lib/voice/sms-replies-server.ts:222`

**Every non-keyword text to the number — including a member's reply to a Batch 8 deal alert or verification code — is auto-answered and the member is charged 22p, whether or not they ever agreed to calls or texts from Stayful Intelligence**

*What's wrong:* The inbound route hands every text that is not STOP/START/HELP to replyToText. Batch 8's deal alerts and the verification code come from the same number, and their copy never says replies are answered by an AI or cost anything. The member is identified by the verified number only (lines 198-202) — profiles.si_calls is not consulted — and charged 22p for a canned 'Thanks, I've passed that on' (or the 'who is this' line), up to si_sms_auto_replies_per_number_day (3) a day. The text itself is also emailed to the handoff address and kept 90 days (Batch 8's route comment still says 'never what the member wrote'). The brief's 'texts 22p' is about texts the member asked for during a call.

*How a member or Zac hits it:* A member with calls off receives 'Price drop on 12 … Reply STOP to opt out' and replies 'Is this one still available?' → 22p debited, reply 'Thanks, I've passed that on. You can also ring me on this number. – Stayful Intelligence', and the question lands in Zac's inbox. Replying 'ok' to the verification code costs another 22p. Three replies in a day: 66p for nothing they wanted.

*Smallest fix:* In replyToText (sms-replies-server.ts:222-227) drop the charge for automatic replies, or charge only when (await memberFacts(userId))?.callsOn is true; either way say so in the Batch 8 alert copy if replies are to be answered. Business question for Zac: default — auto-replies are free.

```
let reply: string | null = canReply ? (kind === 'who' ? SMS_REPLY_WHO : SMS_REPLY_OTHER) : null;
// A recognised member pays for the reply; the guard makes it once per message.
if (reply && userId) {
  const key = `sms:${o.messageSid}`;
  const guard = await c …
```

**Second reader:** confirmed — Confirmed as a real Medium defect, with two corrections to the finding's detail. (1) The line numbers are wrong: the charge is at src/lib/voice/sms-replies-server.ts:65-7 …

<sub>Reader: C2 safety: calls and texts · confidence high</sub>

**Low (tidy-ups)**

- **R2-20** · `src/app/intelligence/page.tsx:191` · Funnel owners and management companies — The header eye on a management-only account's Leads pages opens /intelligence, which gates on requireProfileStart without the 22f bypass and sends the account into the investor quiz AppShell deliberately spares it
  *Fix:* In src/app/intelligence/page.tsx mirror AppShell: `const signupPath = await signupPathOf(user.id); isManagement(signupPath) ? await profileSummaryFor(user.id) : await requireProfileStart(user.id, '/intelligence')` (loadIntelligence already copes with a null pr …
  *Also reported by:* Walk 2: existing members
- **R2-21** · `src/app/api/deep-search/route.ts:37` · The reveal and the Stayful Intelligence view — /api/deep-search (reserves up to the quoted £ from the member's credit and starts a paid search) and /api/welcome/search accept cross-site POSTs with none of the same-origin check the other JSON routes use
  *Fix:* Add `if (!isSameOriginJson(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 });` (src/lib/tracking/request.ts) at the top of both POST handlers, as /api/mc/view does.
- **R2-22** · `src/app/d/[token]/page.tsx:44` · The reveal and the Stayful Intelligence view — A free member's own search find shows as "members only" on their own share link: /d/[token] judges the card with dealVisible (cutoff only) and ignores ownFinds
  *Fix:* In src/app/d/[token]/page.tsx pass the whole visibility and let shareState use dealVisibleTo({ id: card.id, live_since: card.live_since }, visibility) when a member is signed in (keep dealVisible with the public cutoff for strangers and link previews).
- **R2-29** · `src/lib/voice/sms-replies-server.ts:193` · Admin only — SI_CALLS_DRY_RUN does not cover the SMS auto-reply or inbound-call charges: on a deployment with both flags set, texts still go out and members are still debited
  *Fix:* In replyToText return null (after logging the conversation) when callsDryRun(); in finishCall skip chargeCallMinutes when callsDryRun() and record charged 0 with error 'dry run'.
- **R2-32** · `src/lib/voice/queue-server.ts:165` · The intro call — minutes_available is computed from the balance and told to the agent, so the agent can say how little credit a caller has even though it 'never reads balances'
  *Fix:* Pass minutes_available rounded up to a coarse bucket (e.g. 2, 5 or 10) or always the max-call figure, and let capToBalance keep the money safe; add 'never mention how long the call can last' to callTask.
- **R2-33** · `src/lib/voice/queue-server.ts:130` · The intro call — An intro that waits for credit or a number keeps its original queued_at, is dropped as stale after 4 days and re-queued by the next cron pass, forever
  *Fix:* In run.ts step 1 join the owed list to a cheap balance test (or skip members with no positive credit_grants) before enqueueCall; in placeCall refresh queued_at when deferring an INTRO_WAITS call so it is not dropped as stale.


### D. Scheduled jobs and messages

22 standing: 0 Critical · 1 High · 6 Medium · 15 Low.

#### R2-43 · High · The first low-credit moment · `src/lib/voice/low-credit-server.ts:47`

**Batch 20's £5 email and the low-credit call both go the same day: neither side checks the other once the debit that triggered them is over**

*What's wrong:* The only ordering between the call and the £5 notice is inside one afterDebit run (src/lib/credit/after-debit.ts:130 `if (await lowCreditCalled(userId)) { await toldByCall(...); return; }`). maybeQueueLowCreditCall never reads profiles.last_low_balance_email_at, so an email that already told the member does not stop a call for the same landing; and when the call is queued outside outbound hours it returns called:false, after-debit lets the £5 notice go (line 146–149: carried by the morning email, or sendLowCreditAlone after 08:30 UTC), and the cron (src/lib/voice/run.ts:112 placeCall) later dials the queued call with no check that the email went (src/lib/voice/queue-server.ts:137 re-runs checkEligibility only). The morning senders (src/lib/listing/picks-run.ts:1221/1629, src/lib/notify/digest-run.ts:286/417) read lowCreditDue and stamp told with no knowledge of calls. The brief's rule "never both the same day" has no guard in either direction.

*How a member or Zac hits it:* Pack member (£30 landed Friday, 85% spent) runs a Quick look Tuesday 20:00 UK: £5.30 → £4.80. afterDebit → call queued for Wed 09:00 (outside hours) → called:false → notice due; sendLowCreditAlone finds today's slot used (Today's 5 went at 07:00) → 'slot_used', so Wednesday's email carries it. Wed 07:00 UTC: the picks email arrives with "You have £4.80 of credit left" and the Starter / £10 buttons (told stamped). Wed 09:00 UK: the cron dials "Quick one: your credit's running low, so your daily picks could stop soon", 65p/min from a balance under £5. If they miss it: a 22p text and a 20p email about the same thing — four messages in two hours. In-hours variant: told by the 07:00 email, any debit at 11:00 places the call at once (toldByCall then finds it not due and simply returns).

*Smallest fix:* In maybeQueueLowCreditCall, read profiles.last_low_balance_email_at with si_calls (line 34) and return { called: false } without enqueueing when it is at/after landing.landedAt (the email was this landing's notice); in placeCall (queue-server.ts:137) for type === 'low_credit', re-read that stamp and dropOrBlock the call when it is later than call.queued_at (the email went while the call waited). Business question: on mornings the email always wins (07:00 picks before 09:00 calls); if Zac wants the call to be the notice, the morning senders must skip the notice for members with calls on and a triggerable landing.

```
const { data: existing } = await admin.from('si_calls_log').select('status').eq('user_id', userId).eq('call_type', 'low_credit').eq('trigger_ref', landing.id).limit(1);
…
const r = await enqueueCall({ userId, type: 'low_credit', triggerRef: landing.id, now }); …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed behaviour is exactly what the code on main does, in both directions, and no guard exists anywhere between the call queue and the £5 email stamp.

Email-first- …
- *reproduce:* stands — The finding stands and is reachable by the most ordinary path: the 07:00 UTC picks run itself. (1) The run builds the £5 notices before sending (src/lib/listing/picks-run …
- *the rule:* stands — The finding stands and is a genuine violation of the brief's rule, not a documented decision. The brief (scratchpad r2/brief.md:39) says verbatim: "the low-credit call an …

*Also reported by:* D2 messages and the cap (“Two debits inside the queued→ringing window send the £5 email alone and place the call: 'queued' is read as 'n …”); I conflicts and contracts (“A low-credit call queued for later the same UK day lets Batch 20's £5 email go too: both arrive on one day (wi …”)

<sub>Reader: D2 messages and the cap · confidence high</sub>

#### R2-34 · Medium · The intro call · `src/lib/voice/queue-server.ts:202`

**A timed-out or 5xx ElevenLabs outbound-call request after Twilio already started the call leaves a 'failed' row with no ids: the post-call webhook can never match it (409 forever), the agent's tools see no live call, minutes are never charged and no missed-call fallback goes**

*What's wrong:* placeOutboundCall aborts after 15 s or returns ok:false on any non-2xx (elevenlabs-server.ts:9-26; elevenlabs.ts:88-93). ElevenLabs may already have created the Twilio call by then (the request creates the call and returns its ids). The row is then set to 'failed' unconditionally and the ids are never stored. Every later event for that call — post_call_transcription, call_initiation_failure, answering_machine_detection — is looked up by el_conversation_id / twilio_call_sid only (store-server.ts:62-74), finds nothing, throws RetryLater and answers 409 (webhook-server.ts:74-86), so ElevenLabs redelivers it until it gives up. During the call every server tool (lookup_caller, send_template_text, log_question, handoff) resolves the call the same way and answers "no_live_call" (tools-server.ts:56-62,73-75), so the contact card cannot be texted. The 30-minute reconcile never sees the row either (status is 'failed', not 'ringing'; run.ts:121). Answered minutes are never charged (the house pays), the transcript is never logged, the si_conversations row started at queue-server.ts:192 stays open with no turns and no ended_at, and the intro is consumed (si_calls_log_intro_uidx counts the failed row; run.ts:73 treats any intro row as done). The same end state arises when the function is killed between the ringing claim (line 176) and the ids update (line 207) — see the next finding — except the row then stays 'ringing' with no SID and the reconcile fails it at 30 minutes (run.ts:131: no SID → 'failed') with no fallback text or email even when the member missed the call.

*How a member or Zac hits it:* Monday 09:00 UK, ElevenLabs is slow: the cron places Zac's test intro, the POST takes 16 s, AbortSignal fires, the row is marked failed. His phone rings a second later, he answers, asks for the contact card; the agent's send_template_text gets "I can't do that right now". After the call /admin/calls shows the intro as failed, /account/calls shows nothing answered, no minutes are charged, and the ElevenLabs webhook log shows the post_call_transcription delivery rejected 409 again and again. He will never get another intro (one intro ever).

*Smallest fix:* Carry our own id on the call and match on it: add call_id (and user id is not needed) to the dynamic variables in callVariables (src/lib/voice/agent/variables.ts) — parseWebhook already reads conversation_initiation_client_data.dynamic_variables (elevenlabs.ts:138) — and let callByConversation / liveCall fall back to `.eq('id', dyn.call_id)` when the conversation id and SID are unknown. On a 'network' or 5xx result leave the row 'ringing' (not 'failed') so the reconcile step reads Twilio for it; and in the reconcile, a ringing row with no SID should look for a Twilio call to the member's number since placed_at before being failed.

```
const res = await placeOutboundCall(config.apiKey, { … });
if (!res.ok) {
  // No redial (Q10): the call is failed, shown on admin, the day's call used.
  await updateCall(admin, call.id, { status: 'failed', error: (res.message ?? 'refused').slice(0, 300), end …
```

**Verified by three refuters** (3 of 3 say it stands; reported High, graded Medium):
- *code path:* stands (severity should be Medium) — The code path is exactly as described; nothing on main mitigates it. placeOutboundCall returns ok:false on a 15 s abort ('network', with no ids at all) or on any non-2xx …
- *reproduce:* stands (severity should be Medium) — The code path is exactly as reported and the state is reachable, but only through a narrow timing window, so the finding stands at Medium rather than High.

Reproduction …
- *the rule:* stands — The finding stands on the code and is not a documented decision. Every link in the chain traces: (1) placeOutboundCall aborts at 15 s or returns ok:false on any non-2xx a …

*Also reported by:* G code health (“ElevenLabs 5xx or a 15 s timeout at placement uses up the once-ever intro: the member never gets an intro call …”)

<sub>Reader: D1 crons and queues · confidence medium</sub>

#### R2-35 · Medium · The intro call · `src/lib/voice/run.ts:106`

**si-calls has no internal time budget: 20 placements × 15 s ElevenLabs timeout (or 20 reconciles × 8 s Twilio timeout) exceeds maxDuration 120, and a kill mid-placeCall leaves a 'ringing' row with no ids**

*What's wrong:* runCalls checks the clock only for the 7pm rule, never for its own budget. Step 2 places up to PLACE_PER_RUN=20 calls sequentially, each with ~8 Supabase round trips plus a 15 s-timeout ElevenLabs POST (elevenlabs-server.ts:9); step 3 reconciles up to 20 stale rows each with an 8 s-timeout Twilio GET (twilio-voice.ts:12); step 1 pages every si_calls=true profile with three queries per 100; step 4 runs up to ten purge loops. Worst case is far beyond maxDuration 120 (si-calls/route.ts:21). Every other budgeted cron in the repo stops starting work at a deadline (crm-deliveries 40 s, member-searches 50 s, funnel-queue 15 s, market-warm 50 s); this one does not. When Vercel kills it inside placeCall between the queued→ringing claim (queue-server.ts:176-181) and the ids update (line 207), the row is 'ringing' with placed_at and uk_day set but no el_conversation_id / twilio_call_sid — the state described in the previous finding; a kill inside step 3 skips the day's transcript purge (step 4 never runs) and reports no error.

*How a member or Zac hits it:* The morning after SI_CALLS_ENABLED is switched on, every member who said yes overnight has an intro queued with not_before = 09:00 UK (nextOpening); the 09:00 run finds 20 due. ElevenLabs answers in 7 s each that morning: the run is killed at 120 s on about the 14th call, that member's phone rings with no ids on the row, and the five calls behind it wait for the 09:05 run. Or: Twilio's API is down for an hour — every 5-minute run spends 160 s on 20 unreadable rows, is killed, and the retention purge never runs that day.

*Smallest fix:* A deadline in runCalls (e.g. 90 s from start, or a budgetMs option): check `Date.now() > deadline` before each placeCall and each fetchCall, record `ranOutOfTime: true` in the result, and run the retention step before the reconcile (or give it its own guard) so a slow Twilio cannot starve it. Lower PLACE_PER_RUN/RECONCILE_PER_RUN to what the budget allows (the cron runs every 5 minutes; a smaller batch costs nothing).

```
for (const call of due) {
  if (!out.enabled && o.apply) { … continue; }
  // Each call checks the clock as it dials (a slow pass must not dial after 7pm).
  const r = await placeCall(call, { apply: o.apply, now: o.now ?? new Date() });
  …
}
…
for (const call …
```

**Second reader:** confirmed — Confirmed as Medium. runCalls (src/lib/voice/run.ts) has no deadline of any kind: there is no Date.now()/budget check anywhere in the file, the four steps run strictly se …

*Also reported by:* G code health (“The calls cron has no per-pass time budget: 20 placements × 15 s (or 20 reconciles × 8 s) outruns its 120 s ma …”)

<sub>Reader: D1 crons and queues · confidence high</sub>

#### R2-36 · Medium · Funnel owners and management companies · `src/app/api/internal/funnel-queue/route.ts:179`

**A funnel lead that completed but was not charged or emailed (crash between completeLead and finishFunnelLead, or funnel_lead_charge erroring) is never reconciled: the owner gets the lead free and no new-lead email**

*Depends on the schema having been run.*

*What's wrong:* In tier mode the report runs as a fixed-price action with no per-call debits (charge-server.ts:52-53) and the one charge is made only after completeLead has moved the lead off 'queued' (route.ts:179-192; the live door does the same, api/f/[token]/analyse/route.ts:247-265). The drain selects status = 'queued' only (route.ts:78-88), so a lead whose process died between those two awaits (a Vercel kill at 60 s on a slow report, a Supabase hiccup in the RPC, credit_debit raising) is complete and delivered to the prospect, numbered nowhere in funnel_lead_months, debited nothing, and its owner never gets the new-lead email (notifyOwnerOfLead runs inside finishFunnelLead). chargeFunnelLead logs and returns null; nothing looks for completed leads without a funnel_lead_charges row. The guard row makes a retry safe, but there is no retry.

*How a member or Zac hits it:* A management company's 35th lead this month finishes at 58 s into a funnel-queue run; the function is killed as finishFunnelLead starts. The prospect has the report, /leads shows the lead with its verdict, the owner's ledger shows no £4.00 line, their Monday/webhook delivery still goes (crm-deliveries reads completed leads), and they never get the "new lead" email. Nothing on /admin/management shows a lead without a charge.

*Smallest fix:* Add a reconcile pass to the drain: tier-mode leads with result not null, created within MAX_AGE_DAYS, whose id has no funnel_lead_charges row (left join or `not in`), re-run finishFunnelLead for them (funnel_lead_charge is idempotent on lead_id; notifyOwnerOfLead is claimed on owner_notified_at). Report them as `charged_late` in the summary and on /admin/management.

```
const attached = await completeLead({ leadId: lead.id, result, rules: funnel.leadRules, unqualifiedPolicy: funnel.unqualifiedPolicy });
const charged = await finishFunnelLead({ funnel, leadId: lead.id, quote, actionId: prepared.ctx.actionId, secondOpinionDeliv …
```

**Second reader:** confirmed — Confirmed as a real, unreconciled gap; Medium is right. In tier mode nothing is debited during the run (meter.ts:119 `billable = ... && !ctx?.fixedPrice`) and the hold is …

<sub>Reader: D1 crons and queues · confidence medium</sub>

#### R2-45 · Medium · The first low-credit moment · `src/lib/credit/after-debit.ts:130`

**"Neither": a low-credit call that is placed and then fails stamps the member as told, and no £5 notice goes by any channel for 30 days**

*What's wrong:* toldByCall writes last_low_balance_email_at as soon as placeCall returns 'placed' (status 'ringing'). If ElevenLabs then reports call_initiation_failure with a reason other than busy/no-answer/cancel, src/lib/voice/webhook-server.ts:79–80 sets status 'failed' and sends no fallback (`if (updated && status === 'missed') await sendMissedCallFallback(updated)`); src/lib/voice/elevenlabs.ts:179 maps everything else to 'failed'; the cron's reconcile (src/lib/voice/run.ts:131–141) likewise sends the fallback only for missed/voicemail. On the next debit low-credit-server.ts:48–49 returns called: PLACED.has('failed') = false, after-debit.ts:138 lowCreditDue sees lastToldAt within LOW_CREDIT_CYCLE_MS (src/lib/credit/low-credit.ts:27, 30 days) and returns; the morning emails use the same lowCreditDue. Nothing is sent until the member hits £0 (the out-of-credit email has its own stamp).

*How a member or Zac hits it:* A member's low-credit call is placed at 10:00; Twilio rejects it within seconds (carrier/number error, or the agent's phone number mis-set) → call_initiation_failure reason "call_failed" → 'failed'. No text, no email, and the £5 decision is suppressed in every daily email for the next 30 days; they first hear of it from "You're out of Stayful credit" after the daily charges drain the last £4.

*Smallest fix:* Do not stamp on 'ringing': drop toldByCall from after-debit.ts:131 and let the settled call stamp it (an answered call's minutes charge and a missed call's fallback charge already run afterDebit → lowCreditCalled → PLACED → toldByCall); or, smallest, in the two 'failed' branches (webhook-server.ts:79, run.ts:139) for an outbound low_credit call clear profiles.last_low_balance_email_at when it is ≥ placed_at, so the next debit or morning email carries the notice.

```
if (await lowCreditCalled(userId)) {
  await toldByCall(admin, userId, summary, p, now);
  return;
}
```

**Second reader:** confirmed — Traced end to end on main; the defect is real and Medium is the right band. The stamp is written on 'ringing' (after-debit.ts:130–131 → toldByCall → markLowCreditTold, lo …

*Also reported by:* G code health (“A placed call that ends 'failed' sends no text or email, and the low-credit member was already stamped 'told', …”)

<sub>Reader: D2 messages and the cap · confidence high</sub>

#### R2-48 · Medium · The intro call · `src/lib/voice/fallback-server.ts:46`

**Call texts bypass Batch 8's one-text-a-day and sms_monthly_cap and are never written to sms_messages, while the Texts section still promises "at most one text a day … no more than 8 a month. Texts are free"**

*What's wrong:* Batch 8's caps are enforced in src/lib/sms/alerts-run.ts:85–96 from notification_sends channel 'sms' (src/lib/sms/store.ts:323–340 textsThisMonth; slotsInUse 'sms') and every text is meant to be in sms_messages (store.ts:143–181), which the Twilio price backfill reads (store.ts:254 unpricedMessages). The missed-call text (here), the agent's template texts (src/lib/voice/tools-server.ts:141 sendSms) and the auto-replies (TwiML in src/lib/voice/sms-replies-server.ts:65) call sendSms directly: no 'sms' slot claim, no monthly count, no sms_messages row (only si_call_charges and the house-spend provider_calls row from meter()). src/app/account/notifications/SmsSection.tsx:35 still reads `At most one text a day, between 8am and 8pm, and no more than ${monthlyCap} a month. Texts are free.` Also, a call text's real Twilio price is never backfilled.

*How a member or Zac hits it:* A member with calls on gets on one Tuesday: a deal-alert text at 08:15 (free), two template texts on a 10:00 call (22p each), the next day a missed-call text (22p) and three auto-replies (66p) — six charged texts in two days against a page that says one a day, free. /admin billing reconciliation never sees their Twilio prices.

*Smallest fix:* Business question first (suggested default: call texts stay outside the alert caps — they are consented per call and limited to 2 per call + 1 fallback — but count towards sms_monthly_cap?). Either way: (a) reword SmsSection.tsx:35 to "deal-alert texts … Texts about your deals are free; texts from calls are 22p"; (b) insert an sms_messages row (kind 'call', the si charge key as send_id) from fallback-server.ts and tools-server.ts so the price backfill and admin views see them.

```
const r = await sendSms({ to: m.phone, body: missedCallText(type, ctx), purpose: 'si_missed_call', dryRun: callsDryRun() });
```

**Second reader:** confirmed — Confirmed as Medium. The three call-text paths do bypass Batch 8's record and caps, and the Texts section's promise is now false for a member with calls on. Corrections t …

*Also reported by:* C2 safety: calls and texts (“Call texts bypass sms_messages: no row, no StatusCallback, so Twilio's 21610 (opted out at Twilio's end) never …”)

<sub>Reader: D2 messages and the cap · confidence high</sub>

#### R2-183 · Medium · Later · `src/lib/voice/sms-replies-server.ts:38`

**The SMS auto-reply ignores SI_CALLS_DRY_RUN: a real reply goes and 22p is debited while every other call and text is only logged**

*What's wrong:* replyToText is gated on callsEnabled() only. callsDryRun() is honoured by every other Batch 23 send (queue-server.ts:170 for the call, tools-server.ts:141 and fallback-server.ts:46 pass dryRun to sendSms, fallback-server.ts:60 skips the email) but never here: the reply is returned as a live TwiML <Message> (src/app/api/twilio/inbound/route.ts:102, which does not go through sendSms and so is not stopped by SMS_DRY_RUN either) and settleText debits si_text_pence (22p) from a recognised member. .env.example:533 says "SI_CALLS_DRY_RUN=true  Log every call and text instead of placing or sending it" and README §19 step 6 tells Zac to set it on Preview; neither is true of this text.

*How a member or Zac hits it:* Zac sets SI_CALLS_ENABLED=true with SI_CALLS_DRY_RUN=true on Production to soak the cron's logs for a day before go-live (Preview never sees this path: the Messaging Service's incoming-message webhook points at the one production /api/twilio/inbound, README §4 step 4 and §19 step 2). A member texts "who is this?" to the number: a real reply is sent and 22p leaves their balance, in a mode the env file says sends nothing.

*Smallest fix:* In replyToText, after `reply` is decided and before the charge block: `if (reply && callsDryRun()) { console.log(`[sms] dry run (si_reply) → ${maskPhone(o.phone)}: ${reply}`); reply = null; }` (import callsDryRun from ./config; keep the conversation log and the admin forward as they are).

```
if (!text || !o.messageSid || !callsEnabled()) return null;
…
let reply: string | null = canReply ? (kind === 'who' ? SMS_REPLY_WHO : SMS_REPLY_OTHER) : null;
if (reply && userId) {
  const key = `sms:${o.messageSid}`;
  const guard = await claimCharge(key, nu …
```

**Second reader:** confirmed — Confirmed as described, and Medium is the right level. The code path is exactly as claimed: replyToText gates only on callsEnabled() (sms-replies-server.ts:38), never imp …

<sub>Reader: round2:D · confidence high</sub>

**Low (tidy-ups)**

- **R2-37** · `src/lib/voice/run.ts:153` · Later — A transcript purge that throws or is killed is not retried for the rest of that UK day: claimEvent answers 'retry' and run.ts only acts on 'new'
  *Fix:* Treat 'retry' as runnable: `const claim = await claimEvent(…); if (claim === 'new' || claim === 'retry') { … }` and call `finishEvent(admin, 'cron', key, message)` in the catch so the row carries the error.
- **R2-38** · `src/lib/deal-quality/restream-run.ts:77` · Admin only — restream-backfill and cheap-rescreen ?dry=1 insert a marketplace_runs row although the route comments and README §20 say a dry run "writes nothing"
  *Fix:* Return before recordRun when opts.dry (as the sweep does), or change the two route comments and README §20 to say the dry run is recorded in marketplace_runs with dry = true.
- **R2-39** · `src/lib/sourcing-demand/member-search.ts:567` · The reveal and the Stayful Intelligence view — member-searches ?dry=1 returns only a count; README §18 and the route header say it lists the searches it would continue or settle
  *Fix:* Select `id, user_id, purpose, status, lease_until, created_at` and return them under `due` on a dry run (no email or address; ids only, as crm-deliveries does), or change README §18 to "counts".
- **R2-40** · `src/lib/sourcing-demand/member-search.ts:473` · Later — A deep search killed after its debit but before its row is saved leaves charged_base_pence = 0, which frees the member's one-time first-search discount for a second deep search
  *Fix:* When actionAlreadyCharged(row.id) is true, read the existing transaction (credit_transactions where meta->>'action_id' = row.id) and set charged_base_pence / transaction_id from it; or move the charge before the Today refresh and persist it immediately with it …
- **R2-41** · `src/lib/voice/fallback-server.ts:28` · The intro call — The missed-call fallback stamps fallback_sent_at before sending and takes the day's email slot even when neither the text nor the email went
  *Fix:* Stamp fallback_sent_at only after at least one of the two went (claim with a short-lived `fallback_claimed_at` instead, or set the stamp at the end and rely on the two charge-key guards for once-only), and call claimCallSlot only when `out.text || out.email`.
- **R2-42** · `README.md:457` · Admin only — README and .env.example cron figures are stale: project-checks hour 05 minutes and the cron count
  *Fix:* README line 457: "04:25–04:55 and 05:02–05:52 UTC"; .env.example line 255: "all 36 schedules, 25 routes" (or drop the numbers).
  *Also reported by:* G code health
- **R2-46** · `src/lib/voice/cap-server.ts:17` · The intro call · *reported Medium, second reader: overstated* — In BST the first cron pass after 9am UK (08:00 UTC) places calls ten minutes before the 08:10 digest; the call takes the day's slot and the member's daily email is lost, not moved
  *Fix:* Only claim the slot once the morning emails have gone: in claimCallSlot return early when `!lowCreditMayGoAlone(now)` (src/lib/credit/low-credit.ts:76, 08:30 UTC) so an early call "goes anyway" and the digest still sends; or make placeCall defer outbound diall …
- **R2-49** · `src/lib/voice/sms-replies-server.ts:43` · Later — The text auto-reply goes to a number that texted STOP but has no sms_contacts row
  *Fix:* After line 46: `if (!stopped && rows.length === 0) stopped = (await numberStopped(admin, o.phone)) !== false;` (unreadable counts as stopped, as Batch 8 does).
- **R2-50** · `src/lib/voice/sms-replies-server.ts:79` · Admin only — Every non-'who is this' inbound text emails the team with no per-number cap, although the auto-reply is capped at 3 a day
  *Fix:* Forward only when `canReply` is true (so the same 3-a-day claim covers both), or claim a separate `twilio_sms_forward:${hash}:${day}:${n}` with a small cap.
- **R2-51** · `src/lib/email/si-calls.ts:29` · The intro call — The missed-call email carries no one-click unsubscribe although cap.ts declares SWITCHES_BEHIND.si_call; the call-slot row is written with a null token so the unsubscribe route can never reach it
  *Fix:* In sendMissedCallFallback generate newSendToken(), pass it to the slot claim (claimCallSlot would need to accept and store it) and send the email with listUnsubscribeHeaders(url) as digest-run does; the existing SWITCHES_BEHIND.si_call then switches calls off …
- **R2-52** · `src/lib/voice/fallback-server.ts:36` · The intro call — The missed-call text and email still go after the member switched calls off between the dial and the webhook, and the email then says calls are on
  *Fix:* After memberFacts in sendMissedCallFallback: `if (!m.callsOn) return out;` (the fallback_sent_at stamp is already written, so it stays once-only).
- **R2-53** · `src/lib/notify/cap.test.ts:9` · Admin only — No test covers the cap override, the call-vs-£5-email ordering or the once-per-call fallback
  *Fix:* Add si_call to the daily list in cap.test.ts, and a deps-injected test for maybeQueueLowCreditCall/afterDebit covering: told-by-email → no call; queued-outside-hours → no email; placed-then-failed → notice still due.
- **R2-140** · `src/lib/deal-quality/cheap-rescreen-run.ts:150` · Admin only — cheap-rescreen's real run has no time budget around its per-area absorb loop; every sibling run checks elapsed(), and a kill at maxDuration 60 loses the run record, the revalidation and the admin result
  *Fix:* In src/lib/deal-quality/cheap-rescreen-run.ts add `const TIME_BUDGET_MS = 45_000;` and in the loop at line 150 `if (Date.now() - startedAt.getTime() > TIME_BUDGET_MS) { ranOutOfTime = true; break; }`, then include `ranOutOfTime` in `done` (line 157) so the run …
- **R2-184** · `src/lib/voice/charge-server.ts:115` · Admin only — The auto-reply's Twilio segment is never metered: provider_calls has no twilio:sms row for it, so /admin/billing's Twilio house spend is short one segment per reply
  *Fix:* In replyToText, when a reply is returned, record the segment as sendSms does: `await meter({ provider: 'twilio', unit: 'sms', quantityFrom: () => 1, failed: () => false, description: 'Text (si_reply)', question: 'sms.si_reply', key: o.messageSid, skipPreflight …
- **R2-185** · `src/lib/voice/store-server.ts:184` · Admin only — si_webhook_events is never purged: one row per ElevenLabs event, per inbound text, per reply slot per number per day and per in-call text slot, kept forever
  *Fix:* Extend the daily retention step in run.ts: after purgeTranscripts, `admin.from('si_webhook_events').delete().lt('received_at', new Date(now.getTime() - 30 * 86_400_000).toISOString())` (apply only; report the count in out.retention).


### E. Weekly active tracking

13 standing: 0 Critical · 0 High · 3 Medium · 10 Low.

#### R2-54 · Medium · The notification choices screen · `src/lib/intelligence/consent.ts:38`

**setSiCalls writes a consent row and a counting notification_settings event on every call, changed or not; the choices call box stays unticked after an inline verify, so a re-tick + Continue (or a double submit / stale tab on the Account switch) records calls-on twice**

*What's wrong:* setSiCalls has no 'unchanged' branch: the profiles update carries no .neq('si_calls', on) guard, the si_call_consents insert and the logActivity run unconditionally. On the choices screen, verifying inline from the call box (VerifyNumber purpose='calls') already calls setSiCalls(true,'welcome') from verifySmsCodeAction (sms-actions.ts:65). CallBox.tsx:13 keeps `ticked` in useState(on) and its onChange returns early without setTicked when !verified, so after the verify the box is enabled but still unticked while the notice says calls are on. If the member ticks it and presses Continue, finishChoicesAction (welcome/choices/actions.ts:40) calls setSiCalls(true,'welcome') again: a second consent row, a second counting notification_settings event (the 60-second guard only drops it if it is the member's latest event and within 60 s), and the intro trigger fires again (idempotent, so no second call). The Account switch (notifications/page.tsx:124-127 posts the opposite of the rendered state) has the same shape on a double submit or a tab rendered before the state changed elsewhere.

*How a member or Zac hits it:* A new member on the choices screen ticks the call box, verifies her mobile, sees 'Your number is verified and calls are on' but the box unticked, ticks it to be sure, presses Continue. si_call_consents now has two 'on' rows 90 seconds apart and /admin/weekly-active's drill-down shows two 'Changed a notification setting' actions for one decision.

*Smallest fix:* In setSiCalls, add .neq('si_calls', on).select('id') to the update and return { ok: true, on } without a consent row or a log when no row changed (a true no-op); in CallBox.tsx set ticked to true when `verified` flips to true (or key the component on `on`).

```
const { error } = await admin.from('profiles').update({ si_calls: on, si_calls_changed_at: now.toISOString() }).eq('id', userId);
...
const { error: recErr } = await admin.from('si_call_consents').insert({ user_id: userId, choice: on ? 'on' : 'off', source, ve …
```

**Second reader:** confirmed — Confirmed as a real defect at Medium. Every claim traced in the code on main: setSiCalls (src/lib/intelligence/consent.ts:34-56) has no unchanged branch — the profiles up …

*Also reported by:* I conflicts and contracts (“/welcome/choices records the same 'calls on' consent twice when the mobile is verified from the call box and t …”)

<sub>Reader: E weekly active · confidence medium</sub>

#### R2-55 · Medium · Admin only · `src/lib/activity/admin-server.ts:98`

**/admin/weekly-active's 'Home visits alone keep N out of the quiet / pause' line overstates: it ignores email, text, extension, API and funnel-lead engagement that the nightly counts**

*What's wrong:* loadHomeOnly builds lastOther from QUALIFYING_KINDS only, then homeKeepsActive compares inactivityState with and without Home. The nightly (src/lib/inactivity/server.ts:135, lastDay = last_engaged ?? last_day) treats EMAIL_ENGAGEMENT_KINDS (an email/text click, extras.on !== false) and ENGAGED_EXTRA_KINDS (extension_check, api_report, funnel_lead_charged) as keeping a member from being quiet (rules.ts isEngagement; lifecycle_active_days_sync `engaged`). Those rows are never fetched here, so a member whose only non-Home engagement in 14/25 days was opening the daily email is counted as 'kept out of quiet only by Home' although the email click alone keeps them out.

*How a member or Zac hits it:* Zac opens /admin/weekly-active to decide whether Home should count. 40 members opened yesterday's daily email and landed on Home; none did anything else. The line says Home visits alone keep 40 out of the 14-day quiet; the nightly would keep all 40 out anyway on the email click, so the true number is 0.

*Smallest fix:* Fetch ENGAGED_KINDS (src/lib/inactivity/rules.ts) instead of QUALIFYING_KINDS and only set lastOther when isEngagement(r.kind, r.extras) (add extras to the select); keep home_view separate as now.

```
const { data: rows, error: e } = await admin.from('activity_events').select('user_id, kind, occurred_at').in('user_id', ids.slice(i, i + 200)).in('kind', QUALIFYING_KINDS).gte('occurred_at', since)...
for (const r of ...) (r.kind === 'home_view' ? lastHome : l …
```

**Second reader:** confirmed — Traced and confirmed. loadHomeOnly (src/lib/activity/admin-server.ts:98-100) fetches only QUALIFYING_KINDS from activity_events and splits them into lastHome (home_view) …

<sub>Reader: E weekly active · confidence high</sub>

#### R2-56 · Medium · Existing members · `src/lib/activity/kinds.ts:36`

**Product direction: home_view counts towards weekly active, so logging in counts as active again — the opposite of R1's E1/Q15 decision and of the brief's rule that a view reached by redirect/header is record-only**

*What's wrong:* 21f made profile_started record-only because every sign-in was sent to /welcome and a redirect is not the member doing something (E1, Q15 default approved). 22e then made every password login, reset, callback and 'Continue' land on /home (HOME_PATH) and made home_view a qualifying kind, logged by the heartbeat on the load ping (VisitHeartbeat.tsx:161 → presence.ts:57). The brief's E rule for the Stayful Intelligence view is the same logic (si_view record-only; the page it opens logs its own view) and 22e applied it to home_tile_tap / home_feed_tap but not to the Home view itself. 22e says so openly ('Logging in now counts as active') and added the 'Home only' row to measure it; no test pins the choice either way beyond home-only.test.ts asserting the current marks. This is a decision for Zac, not a code defect: the weekly-active figure the ads are judged on now includes anyone who signs in and leaves.

*How a member or Zac hits it:* A week after the first campaign, 60 members log in from a 'your deals are ready' email, glance at Home and close the tab. /admin/weekly-active counts all 60 as active; without home_view it would count only those who opened Today, a deal, Browse or the Explorer. The 'Home only' row shows the gap, but the headline number is the inflated one.

*Smallest fix:* If the E1 reasoning stands: home_view: recordOnly(...) (keep the heartbeat row and the Home-only section for one more review); the tiles' target pages already log today_view / my_deals_view / explorer_view / deal_view. If Zac wants Home to count, record the decision next to Q15 in the README and drop the Home-only row once it has answered its question.

```
// Batch 22e: Home on screen, once a UK day. Login lands there, so logging in now counts as active.
home_view: inApp('Looked at Home'),
```

**Second reader:** confirmed — Confirmed as a Medium "Questions before I fix" item. The code does exactly what the finding says: home_view is a qualifying kind, every sign-in with no ?next lands on /ho …

<sub>Reader: E weekly active · confidence high</sub>

**Low (tidy-ups)**

- **R2-57** · `src/app/leads/setup/page.tsx:35` · Funnel owners and management companies — funnel_setup_step:0 dedupe key is shared by 'not now' and 'bought', so an owner who skipped the pack and later buys it never gets the 'bought' row; the 'bought' write also runs on every /leads/setup render
  *Fix:* Use distinct keys ('funnel_setup_step:0:not_now', 'funnel_setup_step:0:bought', or key the bought one on the pack's payment intent) and write the bought row only on the ?pack=1 return (logActivity, not an awaited recordActivity in the render).
- **R2-58** · `src/app/deals/page.tsx:137` · Later — browse_filter's `search` extra never records: filtersToSearch returns '?kind=…&type=…', which cleanExtras refuses ('?', '=', '&' are not token characters)
  *Fix:* Drop the `search` extra, or store a token summary such as { keys: ['kind','type','areas'] } (the filter keys set, not their values).
- **R2-59** · `src/app/my-deals/cleared/actions.ts:16` · Later — 'Bring back' on Cleared deals (22d) is a new member action with no activity event
  *Fix:* Add an inApp kind (e.g. cleared_deal_restored: inApp('Brought back a cleared deal')) and log it in restoreClearedDealAction when ok, extras { item: key } (the My deals key 'd-<uuid>' / 'l-<id>' is a valid token; pass dealId via dealIdOfItemKey).
- **R2-60** · `src/components/intelligence/what-if-actions.ts:37` · The reveal and the Stayful Intelligence view — 'Use this' logs si_view with step 'show_me' and surface hard-coded 'reveal' from any surface; Undo is indistinguishable from a plain profile edit
  *Fix:* Add 'use_this' and 'undo' to STEPS, pass the surface from the component into applyWhatIfAction/undoWhatIfAction, and log { surface, step: 'use_this' | 'undo', use: key }.
  *Also reported by:* F product direction, H gap check
- **R2-61** · `src/app/deals/actions.ts:115` · The reveal and the Stayful Intelligence view — The first Keep after the reveal is labelled extras.from='reveal' wherever it was made — a Keep on Today days later reads as a reveal Keep
  *Fix:* Name the extra for what it is ({ first_keep: true, ms }) and, for a real reveal Keep, have the reveal card pass a from:'reveal' marker (as saveAllAction does) independent of timing.
- **R2-62** · `src/app/welcome/reveal/actions.ts:35` · The reveal and the Stayful Intelligence view — 'Save all 3' double-submitted logs every Keep again: setDealReaction upserts and returns ok for an unchanged Keep, and the 60-second guard only compares with the member's latest event
  *Fix:* Give the Save-all keeps a dedupeKey (`keep:reveal:${dealId}`), or skip the log when the stored reaction was already 'keep' (return an `alreadySet` flag from setDealReaction).
- **R2-63** · `src/app/leads/setup/actions.ts:31` · Funnel owners and management companies — 22f awaits recordActivity inside server actions, a route handler and a page render, against log.ts's rule (logActivity in a page/action; recordActivity only after the response)
  *Fix:* Use logActivity in the actions, the page and stampManagement's in-request callers (keep recordActivity only where stampManagement runs inside after()).
- **R2-64** · `src/lib/stripe/webhook.ts:275` · The first low-credit moment — Product note: a top-up made from the low-credit call's text link logs auto_topup_settings (a qualifying kind) with source sms_link, and activity_weekly_facts ignores source, so paying from a text makes the member weekly active
  *Fix:* Decide and record it: keep as is (paying is the member's act), or log the link top-up as a recordOnly kind (e.g. auto_topup_link) and leave 'topup' as the counting row only when source is undefined/web.
- **R2-65** · `src/components/intelligence/DeepSearchOffer.tsx:19` · The reveal and the Stayful Intelligence view — DeepSearchOffer logs si_view 'deep_line' on every mount with no dedupe, unlike every other 'shown' kind
  *Fix:* Pass a dedupeKey from the server (e.g. `si_view:deep_line:${surface}:${todayKey}`) through recordSiViewAction, or log it from the page that renders the offer with that key.
- **R2-66** · `src/lib/activity/heartbeat.ts:36` · Later — R1 E6 still incomplete on Browse: /deals on screen logs nothing unless a filter is changed, while the Explorer and My deals count once a UK day
  *Fix:* Add { type: 'browse' } for '/deals' in viewFor/parsePing, a browse_view inApp kind, and `browse_view:${day}` in presence.ts, as explorer_view is done.


### F. Product direction and consistency

17 standing: 0 Critical · 3 High · 4 Medium · 10 Low.

#### R2-67 · High · The reveal and the Stayful Intelligence view · `src/components/intelligence/WhatIfSuggestions.tsx:99`

**"Change my budget" on a project-budget what-if opens the Short-let budget question (or nothing), never the project budget**

*What's wrong:* what-if.ts offers two band what-ifs with save:'budget': 'budget' (Short-let) and 'brrr_budget' ("raise your project budget to …", what-if.ts:86-88). The page passes ONE changeHref, /welcome?q=budget, for every item. The quiz question 'budget' applies only when the profile wants buy_str (questions.ts:250-261, applies: wants('buy_str')); the project budget is its own question 'brrr_budget' (questions.ts:263-273, applies: wants('brrr')). welcome/page.tsx:62 sets editing = null when ?q names a question that does not apply, then either redirects to /profile (complete profile, :63) or resumes the quiz at the next unanswered question. So for a BRRR-only or BRRR+Rent-to-rent profile the button never reaches the project budget; for a Short-let+BRRR profile it opens the Short-let budget, which is not the answer the what-if was about.

*How a member or Zac hits it:* A new member picks BRRR and Rent-to-rent (no Short-let), project budget Under £100k, and gets no match. The reveal says "If you raise your project budget to £100k–£200k, I'd have 4 matches" with a "Change my budget" button. Tapping it lands on "How many deals have you done?" (the next unanswered question) or, if the profile is complete, on /profile. The project budget is never offered. Same button on Today and in the header view.

*Smallest fix:* Carry the question per item: in what-if-server.ts add `changeQuestionId: r.key === 'brrr_budget' ? 'brrr_budget' : 'budget'` to each item (what-if.ts already knows the key), make WhatIfSuggestions take a `changeBase` (`/welcome?next=…`) and build `${changeBase}&q=${it.changeQuestionId}` per item; drop the shared changeHref from the three pages. One test in what-if.test.ts that the brrr_budget variant names 'brrr_budget'.

```
<Link href={changeHref} className={btn}>
  Change my budget
</Link>
// every caller passes one href for all items:
// src/app/welcome/reveal/page.tsx:96   changeHref={`/welcome?q=budget&next=…`}
// src/app/intelligence/page.tsx:59     changeHref={`/welcome?q=b …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claim is true on main. what-if.ts offers two band what-ifs with save:'budget': 'budget' (buy_str, line 84) and 'brrr_budget' ("raise your project budget to …", line 8 …
- *reproduce:* stands — Reproduced end to end in code and with a scratch test (outside the repo). Entry point: a member whose profile chooses BRRR without Short-let (deal_types = ['brrr','r2r'] …
- *the rule:* stands — The finding stands on the code at 5d0ac80. what-if.ts offers two band what-ifs with save:'budget' — 'budget' (Short-let, only when types include buy_str) and 'brrr_budget …

<sub>Reader: F product direction · confidence high</sub>

#### R2-68 · High · Admin only · `src/lib/intelligence/reveal-server.ts:100`

**signup_reveals.strong is never written, so /admin/intelligence's "Strong match" share is always 0%**

*What's wrong:* A strong match is defined once (settings.ts strong_match_pct / strong_match_min_checked, isStrongMatch) and used by the signup search to stop (member-search.ts:127-139 strongNow), but no code path writes signup_reveals.strong: recordReveal's upsert has no strong field, member-search.ts:465 updates only search_id and layer, and `grep -rn strong src` finds no other write. The column keeps its default false, so the admin figure the README (§18.4) tells Zac to watch, "strong-match share", reads 0% for every cohort while "No match" and "by layer" are real.

*How a member or Zac hits it:* Ten new members sign up on launch day, six of whom get a 95% match with 8 checks. /admin/intelligence shows Strong match 0.0% beside No match 20%; Zac reads the reveal as failing and tunes the thresholds for nothing.

*Smallest fix:* On the reveal, compute the flag with the same rule the search uses: in reveal/page.tsx pass `strong: isStrongMatch({ matchPct: topPct, checks: <judgement.checked of card #1>, missedMustHave: data.nearMiss || tone !== 'match' }, settings.intelligence)` into recordReveal and include `strong` in the upsert (and have member-search's finish() set it true when it stops on strong_layer1). A test on intelligenceStats with a strong row already exists; add one on recordReveal's payload.

```
{ user_id: input.userId, profile_id: input.profileId, day: input.day, deal_ids: input.dealIds, offer_deal_ids: input.dealIds, shown_ids: input.dealIds, checked: input.checked, no_match: input.noMatch, level: input.level },
// schema.sql:5936  strong boolean no …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The finding stands. signup_reveals.strong is declared (supabase/schema.sql:5936, `strong boolean not null default false`) and read by the admin page (src/app/admin/intell …
- *reproduce:* stands — The finding stands. Reproduced from the entry points: (1) a new member (created after live reveal_from = 2026-10-01T19:59:59Z, live-markers.md:5) reaches /welcome/reveal; …
- *the rule:* stands — The finding stands. The only writer of signup_reveals rows that could set `strong` is recordReveal (src/lib/intelligence/reveal-server.ts:94-102), and its upsert payload …

<sub>Reader: F product direction · confidence high</sub>

#### R2-196 · High · The pack · `src/components/ProfilePill.tsx:51`

**The Profile pill's switcher menu opens 63–111px off the left edge of a 375px phone, so its labels are unreadable**

*What's wrong:* The menu is anchored to the pill's RIGHT edge (right: 0 inside the position: relative <details>) and is at least 220px wide, so it extends 220px leftwards from wherever the pill ends. Batch 21h (F4/F27) moved the pill into a centred chip group (AppSwitcher.tsx:67) that wraps onto its own row on a phone, and Batch 22e's eight items push that group to the third row, where the pill is the FIRST chip. At 375px the pill's right edge sits at x=130–157px (Chromium render of the strip's markup with the site's fonts), so the 220px menu starts at x=−63 (one profile, 'Profile 60% ▾'), −90 (two profiles, 'Client: JS ▾'), −91 (funnel owner, 'Profile ▾') or −111 (admin). Content left of x=0 cannot be scrolled to, so the member sees the right 110–160px of each row: 'r profile / ofile / profiles' for a new member, and 'FILE / (blank) / o / ile / files' for a member with two profiles — the switch list is unreadable. At 91c76c2 (R1) the pill was the last item on the first row (right edge x=332–351), so the same menu was fully on screen; this is a regression of the in-scope layout change. Clipping persists up to ~500px wide (430px: 36–64px cut); from 640px the group shares a wider row and the menu is on screen.

*How a member or Zac hits it:* A member with two saved profiles opens Today on an iPhone (375px) and taps 'Client: JS ▾' to switch to 'Own portfolio': the menu shows 'FILE', 'o', 'ile', 'files'. A brand-new member tapping 'Profile 60% ▾' on Home sees 'r profile', 'ofile', 'profiles'. Rendered in Chromium 1134 from a verbatim replica of AppSwitcher/ProfilePill/UsageChip/FeedbackTrigger markup (scratchpad/r2/pw/out/*-375-menu-open.png); fontkit arithmetic gives the same numbers within 2px.

*Smallest fix:* In src/components/ProfilePill.tsx:51 change `right: 0` to `left: 0`. The pill is always the first chip in the group and the usage chip and Feedback (≥190px) always follow it, so a left-anchored 220px menu stays on screen at every rendered width (pill left edge is 17–60px at 320–375px; 709px at 1024px). Optionally add `maxWidth: 'calc(100vw - 24px)'`.

```
<div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, minWidth: 220, ...
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed behaviour is exactly what the code on main does. src/components/ProfilePill.tsx:46-51 renders the switcher as a `<details style={{ position: "relative" }}>` w …
- *reproduce:* stands — The finding stands and is reproducible from the code on main. Entry point: any signed-in non-team member on any AppShell page (Home, Today, Browse, …) on a ~375px phone, …
- *the rule:* stands — The finding stands. The pill's switcher menu is anchored to the pill's right edge (right: 0 inside a position: relative <details>) with minWidth 220, so it always extends …

<sub>Reader: round2:F (second-round finder: the 375px header bullet) · confidence high</sub>

#### R2-69 · Medium · Later · `src/lib/tailoring/browse.ts:105`

**Browse's "deals picked for you" ranks purchases without 22c's return-on-cash lift: a second fit definition that disagrees with Today and the reveal**

*What's wrong:* 22c put the return-on-cash lift (+1.5 fit per point over 6%, cap +15) inside rankForMember (rank.ts:72-78, :126), which Today (choose.ts:106, tailoring/today.ts:281), the reveal (same stored list), Part F (admissible, today.ts:200) and the picks email (picks-run.ts:1032) all go through. Browse's default order, which 22e turned into "deals picked for you" (deals/page.tsx:103 forYouPage → bestForYouOrder), re-derives the fit itself from blendFit plus the motivation lift and feeds it to the same orderKey; it never calls rankForMember or returnOnCashLift, so its order is the pre-22c one. The PR for 22c says "Today, the reveal and the picks email lift a purchase's fit" and is silent on Browse.

*How a member or Zac hits it:* A member's Today puts a £120k house making 12% on cash (+9 fit) above a £450k house making 7% (+1). They tap Browse ("deals picked for you", same profile, both deals in the list) and the £450k house sits above the £120k one. The 'How do you pick my deals?' chip then says the same rule applies everywhere.

*Smallest fix:* In bestForYouOrder add the lift from the row's own figures, the way rank.ts does: `fit: Math.min(100, base + lift + returnOnCashLift({ deal: <row deal with kind 'purchase' and cashRequired>, screening: { kind: 'purchase', surplus: profit } }))` (import returnOnCashLift from listing/rank.ts; BrowseRow carries annual_profit and the deal's cashRequired through leanDeal). One test in browse.test.ts: two purchases in the same band, the higher return on cash first.

```
const lift = mode === 'off' ? 0 : Math.round((MOTIVATION_LIFT * (motivation?.score ?? 0)) / 100);
const c = { precheck, screening: { band: isBand(row.band) ? row.band : 'qualified' as const }, fit: Math.min(100, base + lift) };
// rank.ts:126  withReturnOnCash …
```

**Second reader:** confirmed — Traced and real. Browse's default order (22e's "deals picked for you") builds the fit itself and never applies 22c's return-on-cash lift, while every other member-facing …

<sub>Reader: F product direction · confidence high</sub>

#### R2-70 · Medium · Later · `src/app/today/page.tsx:134`

**Part F's what-ifs appear on the reveal for a low match or an empty day but on Today only for a near miss: two trigger rules**

*What's wrong:* The reveal and /intelligence compute the what-ifs whenever revealTone is not 'match': a near miss, OR a tailored #1 under reveal_low_match_pct (70%), OR no cards at all (reveal.ts:22-27). Today computes them only when the stored list is a near miss; a 60%-match day or an empty day shows the old header/empty-day box with no what-ifs. The two surfaces show the same member different advice an hour apart, and the "no match at signup" cohort the admin page tracks loses its suggestions the moment they leave the reveal.

*How a member or Zac hits it:* A tailored member's best deal is a 55% match (not a near miss). The reveal says "This is the closest I have today" and offers "If you add Nottingham, I'd have 6 matches" with Use this. They press Continue; Today shows the same five cards with no suggestion and no way to apply the change except the quiz. Likewise a member with no cards at all: the reveal offers what-ifs, Today shows the EmptyDay box.

*Smallest fix:* Give Today the same rule: compute `tone` with revealTone (nearMiss, top card's match % via views, cards.length) and show WhatIfSuggestions when tone !== 'match', including the empty-day branch (today/page.tsx:274 EmptyDay) — or move the rule into one helper (`whatIfsWanted(selection, views, settings)`) in intelligence/reveal.ts that both pages call.

```
const whatIfs = selection?.nearMiss && !paused ? await whatIfViewFor({ … }, now) : null;
// view-server.ts:158  const tone = revealTone({ cards: cards.length, nearMiss, topMatchPct: tailored ? topPct : null, lowMatchPct: settings.intelligence.revealLowMatchPct …
```

**Second reader:** confirmed — Confirmed: two trigger rules exist on main and no PR, README or code comment documents the difference. view-server.ts:158 computes `tone` with revealTone (cards===0 → 'no …

<sub>Reader: F product direction · confidence high</sub>

#### R2-174 · Medium · Funnel owners and management companies · `src/app/intelligence/page.tsx:38`

**A management company (22f) sees the header eye, and tapping it sends them into the investor quiz that 22f says must stay out of their way**

*Depends on the schema having been run.*

*What's wrong:* AppShell draws the eye for every profile: AppShell.tsx:77-78 reads a management account's profile with profileSummaryFor (no gate), :123 `const eyeLevel = await eyeLevelFor(profile)` always returns a number (eye-server.ts:10-17; level 0 while mandatoryDone is false, levels.ts:66), and AppSwitcher.tsx:63 renders the eye whenever `eyeLevel !== null`. The view page, which sits outside AppShell, calls the raw `requireProfileStart` (profile/server.ts:159-163): not a team member and mandatory not done → `redirect(quizPathFor('/intelligence'))` = /welcome?next=%2Fintelligence. welcome/page.tsx has no management bypass; it only hides the "Set up your branded lead form instead" exit for them (`leadFormOffer={!summary.teamMember && !(await isManagementAccount(user.id))}`, :114). stamp.ts:12-15 and shellGate (:71-76) define the rule the shell follows — "no quiz and no signup reveal in front of app pages" — but /intelligence and Home's eye link (HomeView.tsx:23) bypass the shell. Answering the three questions there switches deal-finding on (stamp.ts:52-55), which 22f says the member does from the Profile pill, by choice.

*How a member or Zac hits it:* A letting agent from the management-companies ad is on /leads/setup/company (inside the Leads shell, so the strip shows the eye). They tap "Talk to Stayful Intelligence" to ask about leads and land on the investor quiz ("What are you looking for?") with ?next=/intelligence; the branded-form exit is hidden for them, so the only ways out are the browser Back, Sign out, or answering investor questions that turn deal-finding (picks, Today, call eligibility) on.

*Smallest fix:* Smallest: in src/components/AppShell.tsx:127 pass `eyeLevel={managementOnly({ signupPath, mandatoryDone: Boolean(profile?.progress.mandatoryDone) }) ? null : eyeLevel}` (AppSwitcher already skips the eye for null) and guard Home's eye link the same way; and in src/app/intelligence/page.tsx mirror the shell: `const signupPath = await signupPathOf(user.id); if (managementOnly({ signupPath, mandatoryDone: Boolean((await profileSummaryFor(user.id))?.progress.mandatoryDone) })) redirect(MANAGEMENT_HOME_PATH); await requireProfileStart(...)`.

```
if (!user) redirect("/login?redirect=/intelligence");
  await requireProfileStart(user.id, "/intelligence");
```

**Second reader:** confirmed — Every link in the chain is on main as claimed. AppShell draws the eye for a management-only account: it bypasses the quiz gate (`isManagement(signupPath) ? profileSummary …

<sub>Reader: round1:F (second-round finder: nav bullet) · confidence high</sub>

#### R2-175 · Medium · Funnel owners and management companies · `src/components/AppShell.tsx:97`

**A management company has no Leads item in the header (and none lit) until step 1 of the setup creates its first funnel row, so leaving the setup loses the way back**

*Depends on the schema having been run.*

*What's wrong:* The Leads rule is unchanged since R1: a `funnels` row must exist (ownership.ts:12 counts rows where user_id = owner). 22f creates a class of member who lives on Leads before any funnel exists: a stamped account lands on /leads (landing.ts:44, proxy.ts:48-50), leads/page.tsx:102 sends an owner with `funnels.length === 0` to SETUP_PATH, and the setup only creates the funnel on step 1 (setup.ts:3-5, context.ts:64 `hasFunnel: Boolean(funnel)`). The setup pages render under leads/layout.tsx → AppShell active="leads" with leads=false, so the strip is eye · Home · Today · My deals · Browse · Market Explorer · Analyser · Account with nothing highlighted (activeNavFor('leads') = 'leads', an item that is not drawn). Account › More hides Leads by the same rule (nav.ts:177 `if (p.teamOwnsFunnel) keys.push('leads')`); the only door back is the small "Get leads with your own branded form" link at the foot of Account (account/page.tsx:233) or typing /leads.

*How a member or Zac hits it:* A management company on step 0 (the starter pack) taps Home to look around first. Home is the investor Home (properties scanned, Today's 5). There is no Leads in the header, Today/My deals/Browse are investor pages, and Account › More has no Leads either; they find the setup again only through the sentence at the foot of Account or by typing /leads.

*Smallest fix:* In src/components/AppShell.tsx:95-100 set `leads = (await ownsAnyFunnel(ownerId)) || isManagement(signupPath)` (signupPath is already read at :77), and in src/app/account/page.tsx pass the same OR into accountMoreLinks's teamOwnsFunnel. One rule, stated once: Leads shows for a team that owns a funnel or an account stamped as a management company.

```
leads = await ownsAnyFunnel((await teamOf(user.id)).ownerId);
```

**Second reader:** confirmed — The defect is real and Medium is right ("works but fragile or confusing"). The header's Leads rule is still "a funnels row exists" (AppShell.tsx:97 → ownership.ts:12 coun …

<sub>Reader: round1:F (second-round finder: nav bullet) · confidence high</sub>

**Low (tidy-ups)**

- **R2-71** · `src/lib/intelligence/what-if.ts:190` · The reveal and the Stayful Intelligence view — A what-if's "the best is 88%" deal is ranked by rankForMember alone, not Today's tailored order or mix, so it need not be #1 after "Use this"
  *Fix:* In whatIfResults order `added` with tailoredOrder(ranked, judged, bonus) for the variant's profile before taking [0] (judgeRow and bonusOf are already imported), or word the line "one of them is 88%" instead of "the best".
- **R2-72** · `src/components/intelligence/what-if-actions.ts:29` · The reveal and the Stayful Intelligence view — The reveal's what-ifs are built from the primary profile but "Use this" and Undo change the active profile
  *Fix:* Pass the surface to applyWhatIfAction and use intelligenceMember(user, surface === 'reveal' ? 'reveal' : 'header'); or make the reveal read the active profile too (new members have one; primary is then only the signup search's and Batch 25's definition).
- **R2-74** · `src/lib/intelligence/view-server.ts:163` · Existing members — A team seat's eye is full in the header but "Waking up" in the view it opens, with a "Keep going" link to the quiz
  *Fix:* In loadIntelligence use the shared helper: `const level = await eyeLevelFor(summary)` and set nextLevel/levelName null/'Stayful Intelligence' when summary?.teamMember.
- **R2-75** · `src/lib/listing/sourcing.ts:113` · Admin only — Budget band codes are enumerated in five places and the kind↔deal-type map in four, instead of one list
  *Fix:* Put a `BUDGET_BOUNDS: Record<Exclude<Budget,'any'>, {min,max}>` next to BUDGET_CHOICES in market/filters.ts and derive budgetBounds, inBudget, isBudget, budgetFrom's code check, BRACKETS and nextBand from it; derive the three kind↔type literals from kindsFor / …
- **R2-76** · `src/lib/intelligence/view-server.ts:160` · Later — "I checked N live deals" (reveal, view, chip) and Today's "I found N deals that match" are two counts; Home's "Properties scanned" is a third
  *Fix:* Decide one wording per figure and say what each counts: keep (1) for "checked today" everywhere a day is described (Today's untailored header could read the stored choice too, which selection.ts already returns for a re-chosen list), and keep Home's figure as …
- **R2-77** · `src/lib/intelligence/answers.ts:89` · The reveal and the Stayful Intelligence view — The "How do you pick my deals?" answer describes the order without the deal-type mix or 22c's return-on-cash lift; WHAT_IF_BUDGET_STEPS' comment is stale
  *Fix:* Reword the tailored answer: "…must-haves first, then nice-to-haves, the short-let check, your fit (a purchase's return on cash lifts it) and profit — mixed across the deal types you chose"; fix the comment in config.ts to say rent.
- **R2-173** · `src/lib/nav.ts:38` · Existing members — Brief bullet is stale: the nav on main is eye · Home · Today · My deals · Browse · Market Explorer · Analyser · (Leads) · Account, by Zac's decision in PR #128 — not a code defect, a report note
  *Fix:* No code change. In the report, replace the bullet's wording with the list on main and cite PR #128 Part A '(decided)' and nav.ts:2; note that Batch 22 (#121) widened the strip first as a 'header fix' before that decision was recorded. If Zac did NOT intend Bro …
- **R2-176** · `src/proxy.ts:9` · Existing members — /intelligence is not in the proxy's protected list, so a signed-out hit on the view's own Stripe return (?topup=1&resume=<id>) drops the resume id at the page's login redirect
  *Fix:* Add '/intelligence' to PROTECTED_PREFIXES in src/proxy.ts:9 and to the disallow list in src/app/robots.ts (add '/home' there too; both pages already carry robots noindex metadata).
- **R2-197** · `src/components/AppSwitcher.tsx:59` · Later — The header strip changes typeface between Market Explorer (DM Sans) and every other members' page (Inter)
  *Fix:* Pick one: delete `var(--font-dmsans), ` from AppSwitcher.tsx:59 so the strip is Inter everywhere (matching every other members' surface), or add `dmSansVariable` to the body class in src/app/layout.tsx:28 so it is DM Sans everywhere. Then correct the comment a …
- **R2-198** · `src/components/AppSwitcher.tsx:26` · Admin only — 'Three rows at 375px' holds for members but not for the admin (four rows) or a profile name longer than ~22 characters
  *Fix:* In src/components/credit/UsageChip.tsx:24 wrap ' · unlimited' in `<span className="hidden sm:inline">` (group becomes ~340px, three rows) and note the long-name case in the comment at AppSwitcher.tsx:26-28; or simply correct the comment and PR claim.


### G. Code health

9 standing: 0 Critical · 1 High · 0 Medium · 8 Low.

#### R2-122 · High · The intro call · `src/lib/voice/fallback-server.ts:47`

**A missed-call text Twilio timed out on or answered 5xx is charged 22p as if sent**

*What's wrong:* sendSms maps both a 10 s timeout and any Twilio 5xx to reason 'unknown' ("Twilio may or may not have the text"). fallback-server.ts:47 treats 'unknown' exactly like sent and settles the 22p charge through settleText → settle() → debitFace (charge-server.ts:79-112). A Twilio 503 means the Messages API did not accept the text, so during a Twilio outage every missed intro / low-credit call charges the member 22p for a text that never went, and nothing reconciles it (no messageId/statusCallback is passed, so /api/twilio/status cannot correct it). tools-server.ts:142 has the same rule for the agent's send_template_text (the agent is told "Sent. Tell them it is on its way."). By the brief's rubric this is money charged for a service not delivered; graded High rather than Critical because it is 22p, capped at the balance, and the code's own comment shows it was a deliberate ambiguity choice.

*How a member or Zac hits it:* Twilio's API is returning 503 for twenty minutes. The 11:00 intro call to a new member goes to voicemail; the post-call webhook runs sendMissedCallFallback; the text POST gets 503 → reason 'unknown' → settleText debits 22p and texts_sent becomes 1. The member's ledger shows "Text from Stayful Intelligence 22p"; no text ever arrives. The email half still goes (and is charged 20p only because it was sent).

*Smallest fix:* In fallback-server.ts (and tools-server.ts:142) separate the three outcomes: `if (r.sent) { settleText… } else if (r.reason === 'unknown') { /* keep the guard row so it is never resent, charge nothing: the house absorbs the ambiguity */ } else { await releaseCharge(guard); }`. Optionally pass a messageId/statusCallback so /api/twilio/status can settle 'unknown' sends later.

```
fallback-server.ts:46-48  const r = await sendSms({ to: m.phone, body: missedCallText(type, ctx), purpose: 'si_missed_call', dryRun: callsDryRun() });
      if (r.sent || r.reason === 'unknown') {
        await settleText(guard, key, call.id, m.userId);

sms/s …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The code path is exactly as claimed. sendSms (src/lib/sms/send.ts:98-111) returns { sent:false, reason:'unknown' } for both a fetch timeout/abort (AbortSignal.timeout(10_ …
- *reproduce:* stands — Reproduced end to end. Entry: an ElevenLabs post_call_transcription / call_initiation_failure / answering_machine_detection webhook for an outbound intro or low_credit ca …
- *the rule:* stands — The finding stands. Code path confirmed: sendSms returns reason 'unknown' for both a 10 s timeout (send.ts:99-103) and any Twilio 5xx (send.ts:108-111); fallback-server.t …

<sub>Reader: G code health · confidence high</sub>

**Low (tidy-ups)**

- **R2-127** · `src/components/intelligence/SearchProgress.tsx:32` · The reveal and the Stayful Intelligence view — "I'm still checking your areas" polls every 4 s with no end: a stuck search keeps it on screen for as long as the tab is open
  *Fix:* Cap the poll (e.g. 90 ticks ≈ 6 minutes, then setOn(false) with a quieter line such as "I'll add anything I find to Today"), and in searchStatusFor treat a search older than, say, 2 hours — or any search while memberSearchEnabled() is false — as not running.
- **R2-129** · `src/app/deals/_components/AnalysisPanel.tsx:79` · Later — The four no-location-assign-relative-destination lint warnings 21i left "for 21b / 21g" are still on main
  *Fix:* Replace the three `window.location.assign(<relative path>)` calls in AnalysisPanel.tsx and the one in estimate/page.tsx:758 with `useRouter().push(path)` (or `window.location.assign(new URL(path, window.location.origin).href)` where a full reload is wanted); w …
- **R2-130** · `.github/workflows/ci.yml:71` · Admin only — CI's schema job asserts 22e, 22f and 23 but nothing for 22c's settings move or 22d's reset function, and CI still never runs the build
  *Fix:* Add a block to credit-smoke.sql (or a 22d file) that calls reset_search_profile on a profile with credit_grant_id set and asserts it is unchanged, and one that asserts billing_settings' 22c keys hold the moved values once; add `- name: Build  run: npm run buil …
- **R2-131** · `src/lib/auth/sign-in-hooks.ts:60` · Sign-up and first sign-in — The lead-activation POST to n8n has no timeout inside after(): a hung n8n holds the auth callback's invocation to its maxDuration
  *Fix:* Add `signal: AbortSignal.timeout(10_000)` to the fetch at sign-in-hooks.ts:60.
- **R2-132** · `src/app/api/deep-search/route.ts:28` · The pack — If the first deep-search slice throws, the member is told "That didn't start" although the search is queued, its credit reserved and the cron will run and charge it
  *Fix:* Wrap the slice: `let status = 'running'; try { status = (await runSearchSlice(r.id, { deadlineMs: SEARCH_SLICE_MS }))?.status ?? 'running'; } catch (err) { console.error('[deep-search] first slice failed:', err); } return Response.json({ ok: true, id: r.id, st …
- **R2-193** · `src/lib/voice/agent/service-guide.ts:4` · The intro call · *reported Medium, second reader: overstated* — The phone agent's service guide is marked "DRAFT FOR ZAC'S APPROVAL" yet Sync to ElevenLabs sends it live, and nothing (admin panel, README §19, PR #124) says it is a draft
  *Fix:* Smallest: one sentence on the agent panel (src/app/admin/calls/Forms.tsx:74) and README §19 step 7: "The service guide in src/lib/voice/agent/service-guide.ts is a draft; read and approve it before the first Sync." Once approved, delete the DRAFT marker. (A he …
- **R2-194** · `src/lib/intelligence/answers.ts:8` · Later — answers.ts says "the calls batch reuse these" but Batch 23 on main does not import it: the phone agent answers the same questions from a second source
  *Fix:* Correct the comment: "Batch 26's typed chat reuses these; the calls batch (23) builds its own from faqs-data.ts and service-guide.ts" — or, when Batch 24's knowledge base lands, make service-guide.ts read the chip answers so there is one source.
- **R2-195** · `src/lib/home/types.ts:4` · Later — Four Home comments defer work to "Batch 23b" (a briefing, a nightly snapshot), a batch that exists in no plan
  *Fix:* Replace "Batch 23b" in the four comments with the batch that will build the briefing/snapshot (or "a later batch") and add that item to the plan for Batches 24–26, or delete the sentences if no briefing is planned.


### H. Gap check

21 standing: 0 Critical · 2 High · 7 Medium · 12 Low.

#### R2-152 · High · The intro call · `src/lib/voice/agent/agent-config.ts:45`

**Privacy policy says "Calls are not recorded as audio", but the ElevenLabs agent config never turns ElevenLabs' own voice recording off (record_voice defaults to true), so every call's audio is recorded and kept by the provider**

*What's wrong:* Two things can record a call: Twilio and ElevenLabs. The code switches Twilio's off for outbound calls only (src/lib/voice/elevenlabs.ts:72 `call_recording_enabled: false`, and telephony_call_config's twilio_call_recording_enabled defaults to false). It never sets ElevenLabs' `platform_settings.privacy.record_voice`, whose documented default is true ("Whether to record the conversation"); nor `delete_audio`. The agent PATCH in sync-server.ts:87-88 sends only `retention_days`. README step 5's "(no audio)" refers to which webhook events to subscribe to, and step 4 never says to turn recording off in the dashboard. So ElevenLabs keeps an audio recording of every inbound and outbound conversation for retention_days (90 after a sync; -1, i.e. for ever, before the first sync), while /privacy line 54 tells members "Calls are not recorded as audio" and the sharing bullet (line 86) lists only "what is said on the call".

*How a member or Zac hits it:* A member switches calls on at /welcome/choices, gets the intro call, later rings the number back. Both conversations' audio sit in ElevenLabs' conversation history (Agents → Conversations has a play button) for 90 days. If she sends a subject-access request citing the policy's "not recorded as audio", the statement is wrong and the audio must be disclosed.

*Smallest fix:* In agentConfig() send `privacy: { retention_days: i.retentionDays, record_voice: false, delete_audio: true }` (and have sync-server's dry run diff it, see the Low finding below); or, if Zac wants audio kept, change the privacy sentence on page.tsx:54 to say calls are recorded by the voice provider and deleted after the retention period. Also add "audio recording off" to README step 4/5 for the dashboard-created agent.

```
privacy: { retention_days: i.retentionDays },
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The finding stands on every code claim. (1) agent-config.ts:45 sends only `privacy: { retention_days: i.retentionDays }`; nothing in src/ sets `record_voice` or `delete_a …
- *reproduce:* stands — The finding stands on the code. Walking the path: a member ticks calls on at /welcome/choices → the si-calls cron places the intro call with outboundCallBody() (src/lib/v …
- *the rule:* stands — The finding stands on the code and on ElevenLabs' documented defaults. (1) The agent config the repo pushes sends only `privacy: { retention_days: i.retentionDays }` (src …

<sub>Reader: round1:H (Batch 23) / I — second-round finder: the privacy and terms pages' legal statements about calls, texts, transcripts and retention, checked against the code on main · confidence high</sub>

#### R2-153 · High · Later · `src/lib/voice/sms-replies-server.ts:76`

**Every inbound text's full body (and, on calls, the member's verbatim last line when 'unhappy') is stored for ever in si_conversation_questions, so the 90-day purge of turns deletes nothing the policy promises to delete**

*What's wrong:* The privacy policy (page.tsx:54, 98) says texts to the number and transcripts are "deleted after 90 days; after that we keep only the questions asked and whether they were answered". purgeTranscripts (retention-server.ts:24) deletes si_conversation_turns only; si_conversation_questions is kept with no retention anywhere (no delete in code, no SQL job — grep confirms). For SMS the "question" row IS the whole message: `text` is the untrimmed inbound body cut at 500 characters (log-server.ts:53), i.e. longer than any single SMS, and it is written for every non-keyword text whatever it says (a 'who is this', a complaint, a message with an address or a new phone number). The same happens on calls: webhook-server.ts:112-113 stores the member's last verbatim transcript line as the question when ElevenLabs flags member_unhappy. So the purge is cosmetic for texts: the identical text survives in another table for ever, against the policy's words.

*How a member or Zac hits it:* A member texts the SI number "It's Priya, I've moved to 14 Elm Road Leeds and my new number is 07700 900123, can you update it?". It is forwarded to Zac, logged as a turn (deleted after 90 days) and logged verbatim as a 'question' with outcome handed_off (kept for ever, shown on /admin/conversations). Day 91: the policy says the message is gone; the row still holds the address and the number.

*Smallest fix:* Smallest: in sms-replies-server.ts record the question only for kind === 'who' (a fixed string such as 'who is this?'), not the raw body; in webhook-server.ts:112 store a fixed 'Unhappy with an answer' instead of lastQ; and give si_conversation_questions a retention (delete rows whose conversation started_at is older than the usage-records period, see the next finding). Alternatively reword the policy to say the text of each question is kept.

```
await recordQuestion(conversationId, { question: text, outcome: kind === 'who' ? 'answered' : 'handed_off', source: 'sms' });
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed behaviour is exactly what the code on main does. (1) For every non-STOP/START/HELP text, src/lib/voice/sms-replies-server.ts:76 calls recordQuestion with the …
- *reproduce:* stands — The finding stands; the path is reachable and the state arises on every non-keyword text once calls are switched on. Entry point: Twilio posts every inbound text to /api/ …
- *the rule:* stands (severity should be Medium) — The code path is exactly as described and nothing documents it as a decision. src/lib/voice/sms-replies-server.ts:76 writes the whole trimmed inbound body as the "questio …

<sub>Reader: round1:H (Batch 23) / I — second-round finder: the privacy and terms pages' legal statements about calls, texts, transcripts and retention, checked against the code on main · confidence high</sub>

#### R2-78 · Medium · The notification choices screen · `src/app/welcome/choices/CallBox.tsx:13`

**Choices screen: after verifying the mobile for calls, the call box stays unticked while calls are already ON, and Continue can never switch them off**

*What's wrong:* Ticking the box with no verified mobile opens VerifyNumber(purpose="calls"); verifySmsCodeAction (sms-actions.ts:59-64) then calls setSiCalls(user.id, true, 'welcome') and revalidates /welcome/choices. The RSC refresh gives CallBox on=true / verified=true, but useState(on) only reads its initial value, so the checkbox renders unticked beside the notice 'Your number is verified and calls are on.' finishChoicesAction only ever switches calls ON (calls=1 ticked); an unticked box 'saves nothing', so the member cannot turn calls back off from this screen, and a second tick + Continue writes a second 'on' consent row.

*How a member or Zac hits it:* A new member ticks 'Call me…', types the code, sees 'calls are on', then notices the box is unticked, assumes calls are off, and taps Continue. profiles.si_calls is true, the intro call is queued (onCallsSwitchedOn) and placed within minutes; the only way off is Account → Notifications.

*Smallest fix:* In CallBox derive the tick from props after a verification (useEffect(() => setTicked(on), [on]) or key the box on `on`), and in finishChoicesAction call setSiCalls(user.id, false, 'welcome') when the box is unticked and siCallsOn(user.id) is true.

```
const [ticked, setTicked] = useState(on);  // CallBox.tsx:13
...
if (next && !verified) { setVerifying(true); return; }  // the tick is never set when the code check opens
...
if (formData.get('calls') === '1' && (await hasVerifiedMobile(user.id)).verified) aw …
```

**Second reader:** confirmed — Confirmed, Medium is right. The mechanism traces exactly as claimed, with one correction that makes the UX slightly worse than the finding describes: after the inline cod …

*Also reported by:* Walk 1: new member (“After verifying the mobile from the call box, calls are already on but the box renders unticked, so the member …”)

<sub>Reader: H gap check · confidence medium</sub>

#### R2-79 · Medium · Existing members · `src/lib/intelligence/what-if-server.ts:20`

**'I'm searching your area' is promised from the global MEMBER_SEARCH_ENABLED flag, not from whether this member has a search running**

*What's wrong:* whatIfViewFor picks the 'Nothing near your criteria yet — I'm searching your area and I'll tell you when one comes up' line whenever the env flag is on. A signup search is queued only for reveal accounts (queueSignupSearch: isRevealAccount) and finishes within minutes; existing members, members whose search is already done, and members over the monthly cap get the same promise on Today (today/page.tsx:134,252) and in the view. view-server.ts already loads searchStatusFor(user.id).running but does not pass it here; the flag is also re-read here instead of through memberSearchEnabled() (member-search.ts).

*How a member or Zac hits it:* Once Zac sets MEMBER_SEARCH_ENABLED=true, a 6-month-old member with a near-miss Today sees 'I'm searching your area' every morning, though no search exists for them and nothing will come of it.

*Smallest fix:* Give whatIfViewFor a `searching: boolean` argument (view-server passes status.running; Today passes searchStatusFor(user.id).running) and drop the env read; fall back to NO_WHAT_IF_LINE_NO_SEARCH otherwise.

```
const searching = process.env.MEMBER_SEARCH_ENABLED === 'true';
return { items: …, none: searching ? NO_WHAT_IF_LINE : NO_WHAT_IF_LINE_NO_SEARCH };
```

**Second reader:** confirmed — Confirmed as a real Medium defect. The "none" line is chosen from the process-wide flag, not from this member's search state, and the per-member state is already in hand …

<sub>Reader: H gap check · confidence high</sub>

#### R2-80 · Medium · The intro call · `src/lib/voice/agent/prompt.ts:20`

**The intro call's contact card is only sent if the LLM agent calls the tool; an answered intro with no text sent gets no card and no fallback**

*What's wrong:* placeCall (queue-server.ts) never sends the card itself; the card link reaches the member only when the agent chooses send_template_text('contact_card') mid-call, or when the call is missed (fallback-server.ts sends the text + email). finishCall checks status only: an answered intro whose agent skipped the tool (tool timeout, rate limit, number_mismatch, model not following the prompt) ends with texts_sent 0 and nothing sends the card afterwards; the intro is once ever (si_calls_log_intro_uidx), so it is never offered again except on a callback (missed_intro context only applies after a missed call).

*How a member or Zac hits it:* Zac's first test member answers the intro, hears 'I've just texted you my contact card', the tool call never fires (10 s response_timeout, or the agent ends the call first); no text arrives, and the member has no number saved for the next call.

*Smallest fix:* In finishCall, after an answered intro with `!(await contactCardSent(admin, call.user_id))`, send the contact_card text through the same claimCharge/settleText path (one more text within si_texts_per_call_max), or at least include the card link in a post-call email.

```
- context "intro" (I rang them): say this, close to word for word: "${INTRO_SCRIPT}" Just before the sentence about the contact card, call send_template_text with template "contact_card". Then end the call.
...
if (updated && status !== 'answered' && call.dire …
```

**Second reader:** confirmed — Traced on main: the contact card for an answered intro is sent by exactly one path, the agent choosing send_template_text('contact_card') mid-call. placeCall (queue-serve …

<sub>Reader: H gap check · confidence medium</sub>

#### R2-133 · Medium · The first low-credit moment · `src/app/upgrade/page.tsx:29`

**F10 regression: /upgrade was moved out of the marketing group but the promised AppShell layout was never added, so the plan chooser now renders with no header, nav, credit banner or footer at all**

*What's wrong:* Batch 21h's commit message says "F10: /upgrade moves out of the (marketing) group into the members' shell (src/app/upgrade/layout.tsx: AppShell active="account")" and the page comment says the same, but `git ls-files src/app/upgrade` lists only page.tsx: no layout.tsx exists on main and page.tsx never imports AppShell. Every other members' page gets its shell from a sibling layout.tsx (today/layout.tsx:20, account/layout.tsx, deals/layout.tsx …); the root src/app/layout.tsx renders bare `{children}`. So /upgrade lost the marketing Nav/Footer it had at R1 and gained nothing: no Today · My deals · Account strip, no usage chip, no CreditBanner, no Feedback button, and it is not behind AppShell's quiz gate either (the PR also claimed "behind the quiz gate"). 22 links send members here (CreditBanner.tsx:71 "Upgrade plan", EarlyAccessBanner.tsx:25, deals/[id]/page.tsx, account ManagePlan, the extension and markets gates).

*How a member or Zac hits it:* A member at £0 taps the red strip's "Upgrade plan". The page that loads is a white page with the Stayful marketing-styled plan grid and nothing else: no header, no way to Today, My deals or Account; the only exit is the small "← Back" link at the foot, which only renders once the credit summary loaded. On a phone it looks like the site broke mid-flow.

*Smallest fix:* Add src/app/upgrade/layout.tsx: `import { AppShell } from "@/components/AppShell"; export default function UpgradeLayout({ children }) { return <AppShell active="account" redirectTo="/upgrade">{children}</AppShell>; }` (the page already wraps itself in .sf-page-v3, as the comment says). Then click through /upgrade from the red banner on a 375px phone.

```
 * Inside the members' shell (layout.tsx); the marketing grid's styles are
 * scoped under `.sf-page-v3`, so the page wraps itself in it.
 …
  return (
    <div className={`sf-page-v3 ${marketingFontClasses}`}>
      <section className="upgrade section">
```

**Second reader:** confirmed — Confirmed as a real defect at Medium. Batch 21h (d683e70) moved src/app/(marketing)/upgrade/page.tsx to src/app/upgrade/page.tsx (the commit's --stat shows that single re …

<sub>Reader: round1:H (second round): Batch 21's approved fixes on main with their tests, the business-decision answers Q2/Q4/Q5/Q8/Q10/Q12/Q13/Q16, PMI comparables on screen (second-opinion.ts / SecondOpinionCard), and the member-search layers (member-search-plan.ts / member-search.ts) · confidence high</sub>

#### R2-134 · Medium · The reveal and the Stayful Intelligence view · `src/lib/sourcing-demand/member-search.ts:310`

**Deep search plans and charges OnTheMarket and PMI pages for areas with no short-let figures, where nothing found can ever become a deal (the signup layer and demand sourcing both skip such areas)**

*What's wrong:* The signup layer filters its areas through `areaStock(...).screenable` (member-search.ts:307 → planSignupSearch's `.filter((s) => s.screenable)`, member-search-plan.ts:58) and Batch 16's demand sourcing does the same (demand.ts:333 `skip('no_data')`). The deep plan does not: `own` comes straight from profileAreas and `nearby` from nearestAreas (today/candidates.ts:207-215), which is any AREA_META code with a centroid. A listing found in an area whose card has no revenue figure goes through absorbListings (absorb.ts:178,184) → screenSourced with `card` null → figuresFor(null) = null (record.ts:55-56) → screen() band 'insufficient-data' (listing/screen.ts:277) → qualifiesForMarketplace false (record.ts:189-190) → `continue`. The step was still claimed before it ran (line 330: 0.2p OTM, 2p PMI per config.ts:45) and trued up into raw_pence (348), which chargeDeep (468-474) debits at ×deep_search_markup (5) less the first-time discount, and deepQuoteFor (513-518) prices the same steps into the "about" figure. The same applies to a member's own saved area with no figures.

*How a member or Zac hits it:* A member whose home is placed near the edge of the catalogue runs a deep search wanting sale and rent deals. Of the three nearest areas, one has no short-let figures on its card. The search spends 2 kinds × (0.2p + 2p) = 4.4p raw on that area and the member is charged 22p (11p on the half-price first search) for pages that cannot produce a deal; the quote they accepted counted them too. Every member whose own areas or nearest neighbours lack figures pays this on every deep search.

*Smallest fix:* Filter both lists by screenability where the plan is built and where it is quoted: in runSearchSlice's deep branch `const data = areaDataFrom(ctx.cards); const ok = (a: string) => data.get(a)?.screenable === true;` then `deepAreas(own.filter(ok), nearestAreas(ref, new Set(own), settings.deepSearchNearbyAreas * 2).filter(ok), settings.deepSearchNearbyAreas)`; do the same in deepQuoteFor (it needs the cards: loadScreenContext or a lighter read of the area cards) so "about" and "up to" match what will run. Add a test to member-search.test.ts that an unscreenable nearby area is not planned.

```
const ref = referencePoint(who.member.goals, own);
const nearby = nearestAreas(ref, new Set(own), settings.deepSearchNearbyAreas);
const otm = planDeepSearch(deepAreas(own, nearby, settings.deepSearchNearbyAreas), kinds);
steps = [...otm, ...otm.map((s) => ({ …
```

**Second reader:** confirmed — Confirmed as traced. The deep plan is built from profileAreas (no screenability input: member-search.ts:184 passes `[]` as unitAreas and profileAreas at demand.ts:119-130 …

<sub>Reader: round1:H (second round): Batch 21's approved fixes on main with their tests, the business-decision answers Q2/Q4/Q5/Q8/Q10/Q12/Q13/Q16, PMI comparables on screen (second-opinion.ts / SecondOpinionCard), and the member-search layers (member-search-plan.ts / member-search.ts) · confidence medium</sub>

#### R2-154 · Medium · Later · `src/app/(marketing)/privacy/page.tsx:98`

**Policy says the questions and call records are kept "with your usage records" (up to 24 months), but si_conversation_questions, si_conversations and si_calls_log have no retention at all**

*What's wrong:* "Usage and activity records: up to 24 months" (line 97) is implemented only by activity_retention (schema.sql:3389, deletes activity_events/visits). Nothing deletes si_conversation_questions, the si_conversations header rows (channel, member, started/ended, persona) or si_calls_log (when, how long, cost — the "record of each call" on line 54). retention-server.ts touches turns only; the only deletes on si_* tables in code are a queued call being dropped (queue-server.ts:116) and an unused charge guard (charge-server.ts:74). On account deletion the FKs are `on delete set null` (schema.sql:6153, 6209), so the rows outlive the account as well. The promise of 24 months is therefore not kept by any code path.

*How a member or Zac hits it:* Zac reads the policy's 24 months and assumes a 2024 member's call history is gone by 2026; it is still on /admin/calls and /admin/conversations, and in si_conversation_questions, indefinitely.

*Smallest fix:* Add a once-a-day step to purgeTranscripts (or activity_retention) that deletes si_conversations (cascading questions and turns) and si_calls_log rows older than the 24-month usage period, keeping only aggregate counts if Batch 24 needs them; or change line 98 to say how long the questions and call records are really kept.

```
<li>Call transcripts and texts to the Stayful Intelligence number: {DEFAULT_VOICE.transcriptRetentionDays} days (the questions asked, and whether they were answered, are kept with your usage records).</li>
```

**Second reader:** confirmed — Confirmed as a real defect at Medium. The policy promises a bounded retention (24 months, via "kept with your usage records") for the questions log and the per-call recor …

<sub>Reader: round1:H (Batch 23) / I — second-round finder: the privacy and terms pages' legal statements about calls, texts, transcripts and retention, checked against the code on main · confidence high</sub>

#### R2-177 · Medium · The first low-credit moment · `src/lib/stripe/grants.ts:128`

**B14 is not fixed: a Checkout top-up's two Stripe events (different event ids) both pass grantTopup's non-atomic replay check; the B1 guard only serialises redeliveries of the SAME event id**

*What's wrong:* #114 says B14 is 'covered by the B1 route guard'. That guard (route.ts:46-66) claims rows in stripe_events keyed on event.id, so it refuses a second delivery of the same event while the first runs. A Checkout top-up produces two DIFFERENT events for one PaymentIntent: checkout.session.completed (webhook.ts:456 → deps.grantTopup) and payment_intent.succeeded (webhook.ts:496 → deps.grantTopup); the top-up route stamps kind:'topup' on both the session and the PI (topup/route.ts:123-124), so both handlers reach grantTopup with the same `pi:<id>` source_ref. Both can pass the pre-read at :128 before either inserts. credit_grant itself returns the existing id on a source_ref match (schema.sql:903-906), so the £ is granted once — but everything after the grant in grantTopup runs twice: the last_topup_at/hit_zero_at update, forgetTodayLists, reinstateSeats, topupReceiptEmail (no idempotency key) and queueFunnelSync.

*How a member or Zac hits it:* A member on the low-credit call taps the £25 auto-top-up link and pays through Checkout. Stripe emits checkout.session.completed and payment_intent.succeeded in the same second; Vercel runs them as two lambdas. Both read 'no grant yet' at grants.ts:128, both continue, and the member receives two 'Top-up receipt' emails for one £25 payment and writes to Zac asking whether they were charged twice. The ledger shows one grant.

*Smallest fix:* Smallest: give the receipt send an idempotency key derived from sourceRef (src/lib/email/send.ts already takes `idempotencyKey`; picks-run.ts:1609 shows the pattern) so a double run cannot send two receipts. The real fix for B14 as R1 wrote it: a credit_grant variant (or a `p_once` flag) that returns null when source_ref already existed, and `grantTopup` returning false on null — the check then sits under the profiles row lock the function already takes.

```
const { data: existing } = await admin.from('credit_grants').select('id').eq('source_ref', sourceRef).maybeSingle();
if (existing) return false;
await grant(userId, 'topup', amountPence, { sourceRef, description: 'Top-up' });
…
void topupReceiptEmail(opts.emai …
```

**Second reader:** confirmed — Confirmed as written; Medium is right. The B1 guard in src/app/api/stripe/webhook/route.ts:47-51 claims `stripe_events` on `event.id` only, so it serialises redeliveries …

<sub>Reader: round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no reader had covered · confidence medium</sub>

**Low (tidy-ups)**

- **R2-135** · `src/app/markets/actions.ts:37` · Later — E21 only half done: area_saved and listing_check are still logged with no identifying extras, so the 60-second identical-event guard drops a genuine second action
  *Fix:* Pass extras at the two sites: `logActivity(user.id, 'area_saved', { extras: { area } })` in src/app/markets/actions.ts and `logActivity(access.user.id, 'listing_check', { extras: { listing: <url hash already computed for the log> } })` in src/app/api/listing/r …
- **R2-136** · `src/lib/credit/referral.ts:41` · Later — B34 built lazily: a referral code's amount only follows referral_pence when its OWNER next opens their referral panel, so the redeemer and the owner can still be paid different amounts
  *Fix:* In supabase/schema.sql credit_redeem_code use `case when c.kind = 'referral' then credit_setting_num('referral_pence', c.amount_pence) else c.amount_pence end` for the redeemer's grant (idempotent `create or replace`), and return that amount; the lazy update i …
- **R2-137** · `src/lib/crm/deliver.ts:113` · Funnel owners and management companies — G13 half done: CRM deliveries still build the prospect's report link from their own env fallback instead of siteUrl(), so one deploy can email two different hosts
  *Fix:* Replace baseUrl() in src/lib/crm/deliver.ts with siteUrl('') from src/lib/url.ts (and if the Vercel fallback is wanted, put it inside siteUrl() once).
- **R2-138** · `src/app/api/track/route.ts:5` · Later — F15 half done: the tracker and its beacon were deleted but /api/track is still a live route kept 'so the beacon never 404s'
  *Fix:* Delete src/app/api/track/route.ts (and any mention in src/lib/tracking/surfaces.ts or the README's route list).
- **R2-139** · `src/lib/sourcing-demand/member-search-plan.ts:10` · The reveal and the Stayful Intelligence view — Deep search is documented as 'paged until done or the cap' but paging was never wired: nextPage() is dead code and every deep step reads page 1 only
  *Fix:* Either delete nextPage (and its test) and correct the header comment to 'one page per area and source', or wire it into the search loop behind a pageSize the OnTheMarket/PMI adapters actually honour. Make README §18 say the same.
- **R2-155** · `src/app/(marketing)/privacy/page.tsx:54` · Admin only · *reported Medium, second reader: overstated* — The privacy page hard-codes DEFAULT_VOICE (90 days) and "weekdays between 9am and 7pm" into a prerendered page, while the purge and the dialler read the editable billing_settings values — an admin edit on /admin/calls silently makes the policy wrong
  *Fix:* Make PrivacyPage async, call `getBillingSettings()` (and `connection()` or `export const dynamic = 'force-dynamic'` as terms does), and render `settings.voice.transcriptRetentionDays`, the hours and weekday names from settings; delete the DEFAULT_VOICE import.
- **R2-157** · `src/lib/voice/agent/sync-server.ts:70` · Admin only — The agent sync's dry run never reports a change to the ElevenLabs-side retention (or any privacy setting), so a retention edit on /admin/calls reaches ElevenLabs only if Zac syncs anyway, and existing conversations keep the old rule
  *Fix:* Read `platform_settings.privacy` from the GET on line 66 and push a `retention N → M` change when it differs; send `apply_to_existing_conversations: true` with the privacy block.
- **R2-178** · `src/lib/email/billing.ts:31` · The first low-credit moment — D20 still open: the out-of-credit and running-low emails are switchable but carry no unsubscribe link or List-Unsubscribe header, only 'Manage notifications'
  *Fix:* In src/lib/email/billing.ts take an optional `token` and pass `headers: listUnsubscribeHeaders(token)` plus a 'Stop these emails' link for the two switchable kinds; mint the token in after-debit.ts with markSending as the capped senders do (add a `credit_alert …
- **R2-179** · `src/lib/activity/metrics.ts:168` · Admin only — E10 not done anywhere: a disposable-email sign-up still counts in weekly active, sign-ups by source and gets a Monday row — #117 reads as if 21a did it, but no branch did
  *Fix:* If they should not count (R1 Q-style decision): in exclusionFor add `if (key && isDisposableEmail(key)) return 'disposable'` (extend AccountExclusion) and in neverARow / facts-server.ts:101 return true / 'disposable' for the same test. If they should count, cl …
- **R2-180** · `src/lib/tracking/report-server.ts:57` · Admin only — E25 half-fixed: sign-ups by source now reads activity_excluded_accounts itself, but a failed read still silently drops the Exclude switch (E26 chose to fail the page in the same situation)
  *Fix:* Return `{ status: 'failed', message: exErr.message, weeklyMissing: true, report: EMPTY(now) }` on exErr, as the signup_source_facts read does at report-server.ts:44.
- **R2-181** · `src/lib/nav.ts:55` · Later — F7 half-done: the back link follows ?back=, but a deal sheet lights Browse whatever the member came from (NAV_FOR_SECTION maps deals → browse)
  *Fix:* Either accept it (document on the Section type that a sheet always lights Browse) or let the sheet pick its own section: pass `active` from the page (`back === '/my-deals' ? 'reports' : 'deals'`) by rendering AppShell in src/app/deals/[id]/page.tsx instead of …
- **R2-182** · `src/lib/stripe/webhook.ts:421` · Admin only — A14 not done (acknowledged in #114): nine audit columns are still written and never read — stripe_price_id, cancel_reason_at, sms_messages.status_at, meta_conversions.server_sent_at among them
  *Fix:* Either select stripe_price_id and cancel_reason_at in src/lib/admin/profile-server.ts and show them on /admin/profiles, or stop writing the nine columns and drop them in a '-- Review R2' schema section. Tidy-up only.


### I. Conflicts between batches

16 standing: 0 Critical · 1 High · 3 Medium · 12 Low.

#### R2-82 · High · Funnel owners and management companies · `supabase/schema.sql:1056`

**Batch 10's daily-picks backfill in schema.sql re-enrols every 22f management account on the next schema run (their picks were written off without the opt-out stamp)**

*Depends on the schema having been run.*

*What's wrong:* 22f's stampManagement (src/lib/management/stamp-server.ts:47-51) writes `sourcing_alerts: false` directly on profiles and deliberately does NOT write `sourcing_opted_out_at` ("not an opt-out"). The Batch 10 backfill above is not marker-guarded: it runs every time schema.sql is run (README asks Zac to run the file on every batch). A management account has never been sent a pick (sourcing_last_sent_at null) and has no stamp, so the backfill flips its daily picks back ON. The digest (src/lib/notify/digest-run.ts:117/189: sourcing_alerts = true and welcome_checked_at set) then emails it Today's 5 teasers every morning with the 'profile N% done' line (uncharged while mandatory answers are missing, B49); when the company later answers the three questions, /welcome/choices shows the daily email already ON ("✓ I'll email your 5 best matches") instead of offered unticked, and the 33p/day pick starts. Nothing in the code tells the backfill (or leads/provision/route.ts:129, which has the same `!sourcing_opted_out_at` test) that this false means 'written off', which is exactly the question the brief asked.

*How a member or Zac hits it:* A management company signs up from /for-management-companies on Monday (stamped, sourcing_alerts=false). Zac runs schema.sql for Batch 24 on Tuesday. Wednesday 08:10 the company gets a 'Today's 5' investor-deals email; a week later it answers the three profile questions from the Profile pill, sees the choices screen with the daily email on, taps Continue, and is charged 33p a morning for picks it never ticked.

*Smallest fix:* Make the backfill skip stamped accounts: add `and signup_path is null` to the WHERE at schema.sql:1058-1060 (and the same guard at src/app/api/internal/leads/provision/route.ts:129). Alternatively have stampManagement write the picks switch through setNotification('daily_picks', false) so the stamp is set, and have the choices screen offer picks unticked for a management account regardless of the stamp.

```
alter table public.profiles alter column sourcing_alerts set default true;
update public.profiles
   set sourcing_alerts = true
 where sourcing_alerts = false
   and sourcing_opted_out_at is null
   and sourcing_last_sent_at is null;
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed code path is real and every link holds. (1) supabase/schema.sql:1055-1060 is the Batch 10 backfill exactly as quoted; it sits in the body of the file with no …
- *reproduce:* stands — The finding stands; the state it needs is reachable and the path is complete. (1) The write-off: src/lib/management/stamp-server.ts:47-51 sets only `sourcing_alerts: fals …
- *the rule:* stands — The finding stands; it is a genuine conflict between a pre-R1 backfill and 22f's new write, not a documented decision. (1) supabase/schema.sql:1055-1060 is unguarded by a …

<sub>Reader: I conflicts and contracts · confidence high</sub>

#### R2-86 · Medium · Later · `src/lib/voice/queue-server.ts:158`

**The shared call queue is not type-agnostic: Batch 25's 'deal' call type would get the low-credit opener, no missed-call fallback and no cap slot (7 places hard-code intro | low_credit)**

*What's wrong:* queue-server.ts:4-6 and eligibility.ts:4 say Batch 25's deal calls 'reuse it unchanged', and config.ts:10-11 says only CALL_TYPES and the SQL check change. In fact: (1) placeCall derives the agent context by a two-way ternary (line 158), so a 'deal' call would be told context 'low_credit' and read the low-credit script (prompt.ts:21); (2) inbound-server.ts:160 does the same for a callback that matches an outbound row; (3) fallback-server.ts:235 returns early unless call_type is intro or low_credit, so a missed deal call sends no text/email AND never calls claimCallSlot, so that day's capped emails are not moved; (4) templates.ts missedCallText/missedCallTemplate are typed to the two; (5) prompt.ts callTask has no 'deal' context; (6) variables.ts CallContext union and openerFor switch; (7) schema.sql rebuilds si_calls_log_call_type_check with the literal list, and si_calls_log.context is free text with its values only in TS. CALL_TYPE_LABEL and OUTBOUND_CALL_TYPES are Records/arrays a new type is easily missed from (OUTBOUND_CALL_TYPES is not even read by run.ts, which queries status/direction only).

*How a member or Zac hits it:* Batch 24-25 adds 'deal' to CALL_TYPES and the SQL check as the comments say, enqueues one, and the member hears 'Quick one: your credit's running low…' on a deal call; if they miss it, nothing is texted and the morning deals email still goes.

*Smallest fix:* Make context an explicit parameter of enqueueCall/placeCall (stored on the row, read back in placeCall and inbound-server), key fallback-server and templates on OUTBOUND_CALL_TYPES with a per-type template map, and derive the SQL check from CALL_TYPES in the 'Batch 25' schema section. Document this in the Batch 25 prompt (contracts below).

```
const context: CallContext = type === 'intro' ? 'intro' : 'low_credit';
```

**Second reader:** confirmed — Confirmed as a contract mismatch of exactly the kind brief §I asks to be listed ("anything a later batch is told to reuse that doesn't exist in the shape its prompt expec …

<sub>Reader: I conflicts and contracts · confidence high</sub>

#### R2-156 · Medium · The notification choices screen · `src/app/(marketing)/terms/page.tsx:61`

**Terms of service never mention calls, texts or the missed-call email as paid features, although they debit credit (65p a minute, 22p a text, 20p an email)**

*What's wrong:* Batch 23 charges answered minutes (webhook-server.ts:129-131, chargeCallMinutes), texts sent on a call (tools-server.ts:146 settleText), text replies to a recognised member (sms-replies-server.ts:69-70) and the missed-call email, all from the member's credit; a member who merely rings the number is charged per minute without ever having switched calls on (inbound-server.ts:98, 110). The terms' list of paid features and section 2's prices do not include any of these, and the terms were not touched by Batch 23 (the PR claims only the privacy policy was updated). The only disclosure is the switch's price line (choices.ts:10,15), which a member who rings the number from the contact card never sees.

*How a member or Zac hits it:* A member rings the SI number back for four minutes and sees a £2.60 debit on /account/calls and the ledger; the terms they accepted list no such charge and give no price for it.

*Smallest fix:* Add "calls with and texts from Stayful Intelligence" to the paid-features list and a short bullet in section 2 reading the live figures (`callPencePerMinute()`, settings.intelligence.siTextPence / siEmailPence, as the notifications page does), plus a line that calls you make to the number are charged per minute; bump LAST_UPDATED.

```
<li><strong>How credit works.</strong> Paid features (Quick looks and Full analyses of deals, daily deals, reports on an address you enter, the optional PMI second opinion, listing checks, AI narration, address and market lookups) use credit. Each shows its pr …
```

**Second reader:** confirmed — Confirmed as a real gap, Medium is right. The terms' paid-features list (src/app/(marketing)/terms/page.tsx:61) and the whole of section 2 (lines 59-90) say nothing about …

<sub>Reader: round1:H (Batch 23) / I — second-round finder: the privacy and terms pages' legal statements about calls, texts, transcripts and retention, checked against the code on main · confidence high</sub>

#### R2-168 · Medium · Later · `supabase/schema.sql:6247`

**No 'once per trigger' guard for any call type but intro and low_credit: a Batch 25 deal call re-queues on every cron pass after the first one ends**

*What's wrong:* The queue's 'this call already exists' answer (src/lib/voice/queue-server.ts:90-96: a 23505 that is not the in_flight index returns {outcome:'exists'}) comes only from these two type-specific partial indexes. The one-a-day index is on uk_day (set at dial time) and the in_flight index only while a row is queued/ringing. config.ts:10 tells Batch 25 to 'append deal and rebuild the call_type check' — nothing tells it to add a (user_id, trigger_ref) where call_type='deal' index, so enqueueCall({type:'deal', triggerRef: dealId}) is accepted again once the first call has finished (answered, missed, failed or blocked). Also, for a non-intro type a no_credit/no_number answer writes a blocked row (queue-server.ts:80-87) rather than skipping, so a per-deal trigger for a £0 member would write a blocked row every pass.

*How a member or Zac hits it:* Batch 25 fires a deal call for deal D on Monday (placed, missed). Tuesday's cron evaluates the same still-live deal, enqueues {type:'deal', triggerRef:D} again — no index refuses it — and the member is rung about the same deal two days running (within the one-a-day rule, so nothing else stops it).

*Smallest fix:* In Batch 25's prompt and the config.ts:10 comment: add `create unique index if not exists si_calls_log_deal_uidx on public.si_calls_log (user_id, trigger_ref) where call_type = 'deal';` beside the two above, keep triggerRef = the deal id, and give the deal trigger an intro-style skip (no row) for no_credit / no_number. Nothing to change on main today.

```
create unique index if not exists si_calls_log_intro_uidx on public.si_calls_log (user_id) where call_type = 'intro';
create unique index if not exists si_calls_log_low_credit_uidx on public.si_calls_log (user_id, trigger_ref) where call_type = 'low_credit';
```

**Second reader:** confirmed — Confirmed as traced. The only type-specific "once per trigger" guards are the two partial indexes at supabase/schema.sql:6247-6248 (intro, low_credit). enqueueCall's 'exi …

<sub>Reader: round1:I — conflicts between batches (second-round finder: "anything a later batch is told to reuse that doesn't exist in the shape its prompt expects") · confidence high</sub>

**Low (tidy-ups)**

- **R2-84** · `src/lib/voice/member-server.ts:56` · The intro call · *reported Medium, second reader: overstated* — Batch 23's texts ignore Batch 8's 'Texts: Off' switch (sms_contacts.enabled): a member who turned texts off still gets, and pays 22p for, the contact card and missed-call texts
  *Fix:* In memberFacts add `contact?.enabled !== false` to numberOk (or reuse contactCanReceive from src/lib/sms/choose.ts), and decide with Zac whether the call box note should say 'texts from calls follow your Texts switch'. One test in a new member-server test or i …
  *Also reported by:* C2 safety: calls and texts
- **R2-87** · `supabase/schema.sql:6192` · Later — The conversation log's questions table has no 'chat' source although its conversations table already allows channel 'chat' for Batch 26
  *Fix:* Add 'chat' to the check constraint (rebuild it in the Batch 26 schema section as the call_type check is rebuilt) and to recordQuestion's source union; note it in the Batch 26 prompt.
- **R2-89** · `src/lib/notify/cap.ts:80` · Later — si_calls is a registry NotificationKey, so setNotification can switch calls off without a consent record (reachable through the unsubscribe route's SWITCHES_BEHIND.si_call)
  *Fix:* In setNotification/setNotifications refuse key 'si_calls' (throw or route to setSiCalls(…,'settings')), and drop si_call from SWITCHES_BEHIND until a call-specific unsubscribe exists.
- **R2-90** · `src/lib/voice/run.ts:65` · The intro call — An intro that is waiting (no credit, no number, management-only) writes no row, so it is invisible on /admin/calls and is re-evaluated by the cron every 5 minutes for ever
  *Fix:* In enqueueCall, for an intro with reason no_credit/no_number insert a 'queued' row with not_before = nextDayOpening (as placeCall does) instead of skipping, and show it on /admin/calls as 'waiting: no credit'; filter management-only accounts out of the owed qu …
  *Also reported by:* Walk 1: new member, Walk 2: existing members
- **R2-91** · `src/lib/home/server.ts:141` · Existing members — Home's Today's 5 tile reads the stored list without Today's live/visible filter and never chooses, so it can disagree with /today ('2 waiting' vs 1; 'on their way at 7am' when /today would pick now)
  *Fix:* Call loadTodayView(member, now) from todayFor (todaySelection chooses but never debits; the 48-hour visibility and displayOrder then match /today), or at least word the not-ready state as 'Open Today to see them'.
- **R2-92** · `src/lib/intelligence/reveal-server.ts:209` · Later — Two 'shown' columns with two readers, and addRevealShown is dead code: the schema's claim that signup_reveals.shown_ids holds replaced cards is false
  *Fix:* Delete addRevealShown and correct the schema comment, or call it from refreshTodayAfterSearch so both columns agree; document which column each reader uses (contracts below).
- **R2-93** · `src/lib/billing/resume-rules.ts:80` · The reveal and the Stayful Intelligence view — resumeReturnPath still falls back to /today while every other post-action landing moved to Home in 22e
  *Fix:* Default to HOME_PATH from src/lib/auth/landing.ts (and update resume-rules.test.ts).
- **R2-158** · `src/app/(marketing)/terms/page.tsx:20` · The pack — Terms page content changed in Batch 22 (early-access sentence in the starter-pack clause) but LAST_UPDATED still reads 28 September 2026
  *Fix:* Set LAST_UPDATED to the merge date of the early-access sentence (or of the calls clause once added).
- **R2-169** · `src/lib/funnels/tiers.ts:25` · The intro call — The 22f comment tells Batches 23/25 to spare a management company 'unless daily picks are on'; the code's rule (reused by eligibility) is 'unless the three mandatory questions are answered'
  *Fix:* Reword the comment to the real rule ('until the three mandatory profile questions are answered; picks are a separate switch') so Batch 25 reuses checkEligibility's managementOnly unchanged — or, if Zac wants the picks rule, add `picksOn` to EligibilityInput on …
- **R2-170** · `src/lib/home/scan-days.ts:32` · Later — Four Home comments hand 'the briefing' and 'the nightly snapshot' to a 'Batch 23b' that is not in the plan
  *Fix:* Replace 'Batch 23b' with the batch that will build the briefing (ask Zac which), or 'a later batch', in the four comments; list memberScanTotal / home/config rates / home/types in that batch's prompt.
- **R2-171** · `src/lib/voice/config.ts:17` · Later — Two definitions of 'outbound call types': OUTBOUND_CALL_TYPES is exported and unused while the queue derives its own
  *Fix:* Delete OUTBOUND_CALL_TYPES, or make it the source: `export type OutboundCallType = Exclude<CallType,'callback'>; export const OUTBOUND_CALL_TYPES = CALL_TYPES.filter(t => t !== 'callback')` and import it in queue-server.ts / eligibility.ts.
- **R2-172** · `src/lib/voice/agent/service-guide.ts:36` · The intro call — The phone agent's guide types the calling hours ('weekdays between 9am and 7pm') instead of reading si_outbound_* settings
  *Fix:* Add `outboundStartHour, outboundEndHour, outboundWeekdays` to GuideFigures, fill them from settings.voice where the guide is rendered, and word the sentence from them (resync the agent after).


### J. The two journey walks

15 standing: 0 Critical · 3 High · 5 Medium · 7 Low.

#### R2-94 · High · The reveal and the Stayful Intelligence view · `src/app/welcome/reveal/page.tsx:55`

**The reveal's first paint prices analyses at the list price, and the first tap fails with "price changed" — the welcome price never shows the one time most members look**

*What's wrong:* On a member's first visit `row` is null (signup_reveals has no row yet). `loadIntelligence` prices each card BEFORE `recordReveal` runs: inside it `offerPricingFor` → `offerMemberFor` (src/lib/analysis/offers-server.ts:195-218) reads signup_reveals, finds nothing, and returns offerDealIds [] and revealViewedAt null, so `welcomeApplies` (offers.ts:78-84) is false and `analyses.get(id).full` is the list price with no "welcome price" note; the "What's in a full analysis" chip also omits the welcome price (view-server.ts:184-187). Only afterwards does the page insert offer_deal_ids and stamp viewed_at (in after()). When the member taps "Run full analysis" seconds later, `startDealAnalysis` re-prices with the row now present (deal-analysis.ts:316), the welcome price applies, `quoteMatches` (line 322) fails and the route answers 409 price_changed; RevealAnalyses shows "The price has changed since this page loaded…" and does not re-price (RevealAnalyses.tsx:72). The welcome price appears only after a manual reload or the Save-all redirect. offers.test.ts:24 pins `revealViewedAt: null → no offer`, which is exactly the first-paint state.

*How a member or Zac hits it:* A member finishes the quiz on their phone, lands on the reveal, sees "Run full analysis · £4.25" (no strike-through, no welcome note), taps it and gets "The price has changed since this page loaded. Nothing was charged; check the new price and confirm again." with the same £4.25 still on the button. If they tap "Analyse all 3" the same happens for each report. Nothing is charged, but the headline offer of Batch 22 is invisible and the first action on the reveal errors.

*Smallest fix:* Record the reveal (with viewed_at set in the same upsert, not in after()) BEFORE pricing: choose the cards first (loadTodayView / revealDeals), call recordReveal + an awaited markRevealViewed, then build offers/analyses and chip facts. Smallest change: in reveal/page.tsx move recordReveal above loadIntelligence by computing the card ids from a first `loadTodayView(intelligenceMember(...))`, await markRevealViewed, then call loadIntelligence; or have loadIntelligence accept the recorded row and price from it.

```
const data = await loadIntelligence({ user, supabase, mode: "reveal", now });
if (!row) {
  await recordReveal({ userId: user.id, ... dealIds: data.cards.map((c) => c.id), ... });
}
after(() => markRevealViewed(user.id, now));
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed ordering is exactly what main does. On a member's first visit `revealRowFor` (page.tsx:51) returns null; `loadIntelligence` (page.tsx:55) then prices every ca …
- *reproduce:* stands — Reproduced from the entry point. A new member (created after live reveal_from 2026-10-01T19:59:59Z, discount 50%, window 7 days per live-markers.md) is sent to /welcome/r …
- *the rule:* stands — The finding stands and is correctly rated. The ordering defect is real and contradicts the batch's own stated intent, not a documented decision. (1) src/app/welcome/revea …

<sub>Reader: Walk 1: new member · confidence high</sub>

#### R2-106 · High · Existing members · `src/lib/sourcing-demand/member-search.ts:116`

**Deep search quotes, runs and refreshes the PRIMARY profile, not the active profile the view is about**

*What's wrong:* loadIntelligence in 'header' mode (src/lib/intelligence/view-server.ts:102 intelligenceMember → activeProfileFor) builds the cards, the tone ('no strong match') and the what-ifs from the ACTIVE profile, then offers deepQuoteFor(user.id) (view-server.ts:201). deepQuoteFor, startDeepSearch and runSearchSlice all go through memberFor → primaryProfileFor (rules.ts primaryOf: the oldest live profile), so the quoted areas, the plan (areasOf(who.member)), the member_searches.profile_id, the finds' confirmation and finish()'s refreshTodayAfterSearch(member) are all for the primary profile. Nothing passes a profile id through; the deep-search row's profile_id is always the primary's.

*How a member or Zac hits it:* A member with “My deals” (Leeds, the first profile) and “Client: JS” (Bristol, active) opens the eye while on Client: JS, sees “I couldn’t find a close match” and “Want me to check the latest listings in your areas and nearby? About £6, up to £15”. Run it → OnTheMarket and PMI are searched for Leeds and its nearby areas, the finds go onto the Leeds profile’s Today list, the Bristol view refreshes with nothing new, and up to £15 (300p raw × 5) is debited for a search of the wrong city.

*Smallest fix:* Give memberFor/deepQuoteFor/startDeepSearch a profile: the header view passes the active profile (intelligenceMember 'header'), the reveal the primary; store it on member_searches.profile_id (already a column) and have runSearchSlice/finish build the MemberContext from profilesByIds(row.profile_id) instead of primaryProfileFor. Show the quoted areas on the offer line.

```
async function memberFor(admin, userId, now) {
  const [{ data: prof }, profile] = await Promise.all([admin.from('profiles').select('email, about_you').eq('id', userId).maybeSingle(), primaryProfileFor(userId)]);
…
export async function startDeepSearch(userId, …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claim is true as stated; every link of the chain is in the code. The header view (/intelligence page.tsx:41 mode "header") builds the cards, the tone and the what-ifs …
- *reproduce:* stands — The finding reproduces end to end on main. Entry point: the header eye opens /intelligence (src/app/intelligence/page.tsx:41 `loadIntelligence({ user, supabase, mode: "he …
- *the rule:* stands — The finding stands and is a genuine defect, not a documented decision. The code path is exactly as reported: the header view is built for the ACTIVE profile (view-server. …

<sub>Reader: Walk 2: existing members · confidence high</sub>

#### R2-107 · High · Existing members · `src/lib/listing/picks-run.ts:496`

**Start again (or an active blank profile) stops every OTHER saved profile's daily pick and sends its Today's 5 free: the quiz-drop-out rule is member-level and reads the live copies the reset cleared**

*What's wrong:* reset_search_profile (supabase/schema.sql Batch 22d) nulls profiles.market_goals, deletes the member's saved_areas and empties profile_quiz.answered — the LIVE copies of the active profile. mandatoryIncompleteFor (src/lib/profile/mandatory-server.ts) judges the MEMBER from exactly those live copies, so after a reset of profile A, or while a Start-blank profile is active, the member is 'incomplete': picks-run drops every seat (profile B's pick is skipped 'profile_incomplete'), and digest-run.ts:251/261/348 marks the whole member free (chargeFor … mandatoryDone: !incomplete.has(p.id)), so B's Today's 5 goes out uncharged. seatsFor's per-profile awaitingAnswers rule (rules.ts) was meant to confine 'no deals, no charge' to the reset profile; the member-level rule overrides it for the others.

*How a member or Zac hits it:* Zac's member has “My deals” (active) and “Client: JS”. Tuesday evening they press Start again on My deals and leave the quiz until the morning. Wednesday 07:00 the picks run skips Client: JS (no pick); 08:10 the digest sends Client: JS's Today's 5 with the profile nudge and does not take the 33p day charge. This repeats every day until My deals' three questions are answered again.

*Smallest fix:* When profileRows exist, judge each seat by its own profile — skip a seat only when its profile.awaitingAnswers (or awaitingAnswers(p) computed from the row) — and apply the member-level incomplete set only to seats with profile null; in digest-run compute chargeFor's mandatoryDone per part from the seat's profile. Add a test: reset the active profile, the other running profile still gets its pick and charge.

```
const incomplete = (await mandatoryIncompleteFor(admin, memberIds.filter((id) => payerIn(payers, id).payerId === id))) ?? new Set<string>();
if (incomplete.size > 0) {
  for (const m of members.filter((x) => incomplete.has(x.id))) skipped.push({ user: m.id, …, …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The finding stands. The quiz-drop-out rule (Batch 21 B49/Q16) is applied per MEMBER from the live copies, and Batch 22d's reset clears exactly those live copies for the a …
- *reproduce:* stands — The finding stands; I reproduced the path end to end. (1) Start again: /profile shows the "Start again" link whenever savedProfiles.active exists (src/app/profile/page.ts …
- *the rule:* stands — The finding stands; the code on main does exactly what it describes and it is not a documented decision. (1) supabase/schema.sql:6460-6475 reset_search_profile nulls prof …

<sub>Reader: Walk 2: existing members · confidence high</sub>

#### R2-95 · Medium · The first low-credit moment · `src/lib/voice/low-credit.ts:37`

**The £20 welcome credit is never a "credit landing", so the low-credit call can never fire for today's (pre-pack) members**

*What's wrong:* `latestLanding` only counts topup/plan grants and the pack's `pack_bonus:` welcome grant. The £20 welcome grant (`welcome:<user>`, kind 'welcome', src/lib/credit/welcome.ts:93) is excluded, so for every member signing up while starter_pack_from is null (live today) `landing` is null and `maybeQueueLowCreditCall` (voice/low-credit-server.ts:135-136) returns {called:false} however fast they spend. The brief's rule ("80% of the latest credit within 7 days at £5") and the call-box wording ("calls when your credit is low") say nothing about excluding the welcome credit; the header comment lists what is excluded and the welcome grant is not among them.

*How a member or Zac hits it:* A member joins today with £20, ticks calls and verifies their mobile, runs four full analyses at the welcome price over the weekend and is at £4.80 on day 5. They were told they'd be called when credit is low; no call is ever queued (no row, no blocked row either), and only Batch 20's £5 email arrives. The low-credit call only becomes possible after their first top-up.

*Smallest fix:* In `counts()` also return true for `g.kind === 'welcome' && ref.startsWith('welcome:')` (and give it its own groupKey), or, if excluding the welcome credit is intended, say so in callBoxNote / the calls chip and the README. Add a test case for the welcome:<id> grant either way.

```
function counts(g: GrantRow): boolean {
  if (!(Number(g.amount_pence) > 0)) return false;
  const ref = g.source_ref ?? '';
  if (ref.startsWith('overdraft:')) return false;
  if (g.kind === 'topup' || g.kind === 'plan') return true;
  return g.kind === 'welc …
```

**Second reader:** confirmed — Traced and confirmed. `counts()` in src/lib/voice/low-credit.ts:37-43 admits only kind 'topup', kind 'plan', and kind 'welcome' whose source_ref starts with 'pack_bonus:' …

<sub>Reader: Walk 1: new member · confidence high</sub>

#### R2-98 · Medium · The intro call · `src/lib/intelligence/consent.ts:65`

**The intro call is dialled the instant the code is verified, while the member is still mid-signup on the same phone**

*What's wrong:* `onCallsSwitchedOn` (triggers-server.ts:94-103) enqueues the intro and, when inside outbound hours, calls `placeCall` at once. From the choices screen the member has just typed a code into the same phone: the intro call arrives before they have pressed Continue, interrupts Safari (the choices form/page may be reloaded on return), and the contact-card text lands while they are on the call. The PR describes "within minutes" as intended, so this is a product check rather than a bug, but nothing delays the dial to after the member has left the flow.

*How a member or Zac hits it:* Weekday 2pm, SI_CALLS_ENABLED=true: a member on iOS ticks the call box, verifies, and 10–20 s later the phone rings with Stayful Intelligence while the choices page is still open; after hanging up they are back on the choices page (calls already on) and may tap Continue twice or lose the daily-email choice they were about to make.

*Smallest fix:* Queue the intro with `not_before = now + a few minutes` (a setting such as si_intro_delay_minutes, default 5) and let the 5-minute cron place it, or trigger the placement from `finishChoicesAction` (Continue) rather than from the verification. Say in the call box note when the intro will come.

```
if (on) {
  const intro = () => import('../voice/triggers-server').then((m) => m.onCallsSwitchedOn(userId))...
  try { after(intro); } catch { void intro(); }
}
```

**Second reader:** confirmed — The path is exactly as described and nothing in it waits for the member to leave the signup flow. From the choices screen the call box opens the code check (src/app/welco …

<sub>Reader: Walk 1: new member · confidence medium</sub>

#### R2-99 · Medium · The pack · `src/app/api/billing/starter-pack/route.ts:177`

**Pack era: buying the pack from the reveal's out-of-credit window sends the member to /today, losing the reveal, the choices screen and their resume intent**

*What's wrong:* RevealAnalyses opens the out-of-credit modal when a label is 'short' (RevealAnalyses.tsx:43-54, 59-61); OutOfCreditModal shows the StarterPackOffer with `returnTo = window.location.pathname + search` = `/welcome/reveal?next=…` (OutOfCreditModal.tsx:88). The route only honours `/welcome`, `/welcome?…` and SETUP_PATH, so `/welcome/reveal?…` (and `/intelligence`) fall to `/today?pack=1`. The resumeId the modal was opened with is not passed to the pack route at all. On return, AppShell's reveal gate sees viewed_at set and does not send them back, so the reveal, Save all 3 and the choices screen are gone and the saved resume_intents row expires unused. (With a saved card the one-click path works: the modal closes and CREDIT_CHANGED_EVENT resumes the reports.)

*How a member or Zac hits it:* Once starter_pack_from is set: a member taps Not now on the pack, reaches the reveal at £0, taps "Run full analysis", sees the pack offer, pays £10 in Checkout and lands on Today with "Your £30 of credit is on your account" — their three matches and the welcome-priced analyses they were about to run are two screens back, and calls/daily-email choices are never asked.

*Smallest fix:* In the route accept any internal path under the quiz/reveal/view: `back === WELCOME_PATH || back.startsWith(`${WELCOME_PATH}?`) || back.startsWith(`${WELCOME_PATH}/`) || back === '/intelligence' || back === SETUP_PATH`; and have StarterPackOffer pass the modal's resumeId so success_url can carry `resume=`, as /api/billing/topup does (topup/route.ts:49,126).

```
success_url: returnUrl(back === WELCOME_PATH || back.startsWith(`${WELCOME_PATH}?`) || back === SETUP_PATH ? back : '/today', { pack: '1' }),
```

**Second reader:** confirmed — Traced end to end on main (5d0ac80); the code does what the finding says. RevealAnalyses.topUpFor saves a resume intent whose return_path is the reveal URL and opens the …

<sub>Reader: Walk 1: new member · confidence high</sub>

#### R2-108 · Medium · Existing members · `src/app/profiles/actions.ts:81`

**After Start again or Start blank the member cannot switch back to another profile until the three mandatory questions are answered; the profiles page says they can**

*What's wrong:* The blank profile is made active and the member is sent to /welcome, which renders Quiz without the AppShell (no profile pill, no switcher). Every members-only page, /profiles included, goes through AppShell → requireProfileStart (src/lib/profile/server.ts:159), which redirects to the quiz while the ACTIVE profile's mandatory answers are missing; the quiz's “Finish later” goes to /profile → AppShell → back to the quiz. The only ways out are answering three questions, signing out, or typing /profiles/switch?to=<id>. src/app/profiles/page.tsx:94 tells the member “no daily deals or charge for it until you switch to it and answer the first questions”, which assumes switching away is possible. The same lock applies after Start again (expected for that profile, but it also locks the member out of their other profiles).

*How a member or Zac hits it:* A member with two working profiles creates a third with Start blank to try a client brief, changes their mind on question 1 and wants to go back to Today for “My deals”: every page returns them to “Let's build your profile”.

*Smallest fix:* On the quiz, when the member has another live profile, show “Use another profile” (a form posting to switchProfileAction with the other profile's id, or a link to /profiles/switch?to=…&next=/today); or let requireProfileStart skip the gate when the active profile is awaitingAnswers and another live profile exists.

```
const switched = await switchProfile(userId, out.id);
refresh();
if (!switched.ok) back('created');
redirect(field(formData, 'start') === 'blank' ? quizPathFor(GOALS_EDITOR_HREF) : `${GOALS_EDITOR_HREF}?new=1`);
```

**Second reader:** confirmed — Confirmed as a real navigation trap; Medium is right (the site works, the member is confused and boxed in, no money moves on its own). Two corrections to the write-up: (1 …

<sub>Reader: Walk 2: existing members · confidence high</sub>

#### R2-110 · Medium · Existing members · `src/components/intelligence/SearchProgress.tsx:24`

**A paid deep search ends with no result notice: the member never learns what it found, or that it found nothing**

*What's wrong:* After “Run it” the only feedback is “I’m on it. I’ll add anything better here and in Today.” (DeepSearchOffer.tsx:41), then the poll silently refreshes the page. member_searches stores found, confirmed, stop_reason and charged_base_pence and /api/intelligence/status returns found, but nothing renders any of it on /intelligence, the reveal or Today; a search that stopped at its first claim (cap or the monthly ceiling: runSearchSlice → result.stop = 'cap'|'month') or found nothing new looks identical to one that worked, and the ledger line is only “Deep search of your areas”.

*How a member or Zac hits it:* The member runs it (about £6, up to £15). The month's deep-search ceiling is already used, every claim is refused, finish('cap') charges nothing and the page refreshes unchanged. They see no message, assume it did not start, and have no way to tell whether they were charged.

*Smallest fix:* After the refresh show one line from the member's latest done search (found/confirmed/charged, or “Nothing new in your areas today — not charged”), from searchStatusFor plus stop_reason/charged_base_pence, on /intelligence and Today for that day.

```
const s = (await r.json()) as { running?: boolean };
if (!s.running) {
  setOn(false);
  router.refresh();
  return;
}
```

**Second reader:** confirmed — Confirmed as Medium, with one correction to the finding's wording. The positive outcome is not entirely invisible: when a deep search's live finds beat one of Today's car …

<sub>Reader: Walk 2: existing members · confidence high</sub>

**Low (tidy-ups)**

- **R2-100** · `src/app/welcome/reveal/actions.ts:139` · The reveal and the Stayful Intelligence view — "Save all 3" drops the reveal's ?next=, so Continue afterwards always goes to Home instead of where the member was heading
  *Fix:* Post `next` (not the full path) as the hidden field and redirect to `/welcome/reveal?next=${encodeURIComponent(revealNext(next))}&saved=all`.
- **R2-101** · `src/app/welcome/reveal/page.tsx:72` · The reveal and the Stayful Intelligence view — The reveal's top button says "Continue to Stayful Intelligence" but opens the notification choices screen
  *Fix:* Label it "Continue" (or "Next: how I keep you posted") while continueHref points at the choices screen, and keep "Continue to Stayful Intelligence"/"Go to Home" afterwards.
- **R2-102** · `src/app/welcome/page.tsx:42` · The pack — Pack era: back from Checkout to the quiz (F32), nothing on the quiz confirms the £30 landed
  *Fix:* Read `pack` in welcome/page.tsx, call latestPurchaseFor + returnMessage as Today does, and pass a `notice` prop to Quiz to show above the next question.
- **R2-103** · `src/lib/intelligence/view-server.ts:178` · The reveal and the Stayful Intelligence view — After a calls-only verification the "What happens when I save a deal?" chip promises texts that will never come
  *Fix:* Compute alertsByText from the registry: verified && enabled && not stopped && at least one SMS_NOTIFICATION_KEYS column on (readNotifications), or pass `texts: state.sms_price_drop || …` into the facts.
- **R2-104** · `src/app/welcome/reveal/page.tsx:53` · The notification choices screen — A member who leaves the reveal without tapping Continue is never shown the notification choices screen
  *Fix:* In AppShell's gate (or revealPending) also send a reveal member with viewed_at set and choices_at null to `/welcome/choices?next=…` once; or accept and document the defaults.
- **R2-112** · `src/lib/notifications/registry.ts:122` · The notification choices screen — Call copy promises “calls about standout deals” that no batch has built (Batch 25)
  *Fix:* Drop the deal-call clause (or say “later, calls about standout deals”) until Batch 25 ships, and bump CALL_CONSENT_VERSION when the wording changes.
- **R2-116** · `supabase/schema.sql:6600` · Existing members — “Properties scanned for you” fixes the baseline to the areas and kinds at the first Home visit, so a member who widens their search later is under-counted
  *Fix:* Store areas/kinds with the baseline (already columns) and recompute when they differ from the stored scope, or say “counted in the areas you had when you joined”.


### K. Second-round sweeps (22c, 22f, files no reader had named)

27 standing: 0 Critical · 3 High · 5 Medium · 19 Low.

#### R2-147 · High · Funnel owners and management companies · `src/app/(marketing)/for-management-companies/page.tsx:157`

**The management-company ad page advertises the £10 starter pack whenever the price settings exist, not when the pack is live — on live today (starter_pack_from = null) it promises £30 of credit that the setup never offers**

*What's wrong:* Every other public surface gates the pack copy on the cutover: src/components/marketing-v3/Pricing.tsx:38 and src/lib/starter-pack/public.ts:13 use packLive(settings.lifecycle, now), and the offer itself is off without it (src/lib/starter-pack/rules.ts:72 `if (!s.starterPackFrom) return { eligible: false, reason: 'off' }`; server.ts:68 also needs priceIdForStarterPack()). This page only checks that starter_pack_price_pence and starter_pack_credit_pence are non-zero, which they are on live (1000 / 3000) while starter_pack_from is null (live-markers.md). The setup then skips Step 0 (context.ts:63 `packOffered: pack.offer.eligible && !snoozed` → false; page.tsx:38–39 redirects to /leads/setup/company), so nothing ever sells the pack the ad page just described, and /admin/management's "Paid the pack" stays 0.

*How a member or Zac hits it:* A letting agent clicks the Meta ad today, reads "Start with the £10 starter pack: £30 of credit, about 5 standard leads", presses Start, signs up, and is taken straight to "Your company" with no pack to buy; they get the £20 welcome grant instead and wonder where the £10-for-£30 offer went. Zac's funnel panel shows every MC account as never having paid the pack.

*Smallest fix:* Gate the paragraph (and packLeads) on `packLive(settings.lifecycle, new Date()) && priceIdForStarterPack()` as Pricing.tsx does, e.g. `const packOn = packLive(lc, new Date());` and render the paragraph only when packOn; otherwise say what a new account actually gets (the welcome credit) or nothing.

```
{lc.starterPackPricePence > 0 && lc.starterPackCreditPence > 0 ? (
  <p style={{ marginTop: 12, fontSize: 14 }}>
    Start with the {pounds(lc.starterPackPricePence)} starter pack: {pounds(lc.starterPackCreditPence)} of credit, about {packLeads} standard leads …
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The code path is exactly as claimed. src/app/(marketing)/for-management-companies/page.tsx:157 renders the "Start with the £10 starter pack: £30 of credit, about N standa …
- *reproduce:* stands — The finding stands and is reproducible from the public entry point. src/app/(marketing)/for-management-companies/page.tsx:157 renders the "Start with the £10 starter pack …
- *the rule:* stands (severity should be Medium) — The finding stands on the code; it is not a documented decision; its severity should be Medium rather than High.

THE DEFECT IS REAL. src/app/(marketing)/for-management-c …

<sub>Reader: round1:22f — management companies, second round: /admin/management figures and test month, setup Steps 1–3, BrandPreview, setup.ts · confidence high</sub>

#### R2-159 · High · Sign-up and first sign-in · `next.config.ts:54`

**next.config.ts still redirects /home → / (308), so 22e's Home page is unreachable and every login/sign-up/reveal landing ends on the marketing homepage**

*What's wrong:* The redirect dates from 2026-06-20 (commit 2dc43e9) and is unchanged since R1. Batch 22e added src/app/home/page.tsx and made `/home` the landing (src/lib/auth/landing.ts:25 `HOME_PATH = '/home'`; src/lib/nav.ts:24 `home: { href: '/home' }`; postAuthPath in (auth)/actions.ts:54, auth/callback/route.ts:42, auth/confirm/route.ts:38/47; revealNext fallback in src/lib/intelligence/reveal.ts:41; AppSwitcher's Home item). Next's documented execution order (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:236-247) is headers → next.config redirects → Proxy → filesystem routes, so the redirect wins over the page. The production build on this checkout confirms both exist: .next/routes-manifest.json lists `{source: "/home", destination: "/", statusCode: 308}` and `/home` as a static route. Nothing in the diff removed the redirect; no test covers redirect/route collisions.

*How a member or Zac hits it:* A brand-new member confirms their email: auth/confirm → postAuthPath → /home → 308 → `/` — the public marketing page, with the header now showing "Open Today". They never see Home, the quiz gate or the reveal until they find and tap "Open Today" themselves. The same for every password login, Google callback, the reveal's Continue (revealNext fallback) and the Home nav item. Because the redirect is permanent, browsers that have followed it once keep sending /home to / even after the fix.

*Smallest fix:* Delete the `/home` redirect entry from next.config.ts (3 lines). Add a test that no `redirects()` source in next.config.ts has a page under src/app (e.g. in src/lib/tracking/wiring.test.ts, which already reads next.config.ts). Note for the deploy: members who hit /home before the fix carry a cached 308 — expect support questions, or land on /today for a few days while caches expire.

```
      {
        source: "/home",
        destination: "/",
        permanent: true,
      },
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The finding stands. next.config.ts:52-56 still carries `{ source: "/home", destination: "/", permanent: true }` (introduced 2026-06-20 in 2dc43e9, untouched by any commit …
- *reproduce:* stands — The finding reproduces end to end on main (5d0ac80). next.config.ts:54-58 still carries the permanent `/home` → `/` redirect, and Batch 22e added a real page at src/app/h …
- *the rule:* stands — The finding stands and the severity is right. (1) The redirect is live on main: next.config.ts:54-58 still has `source: "/home" → destination: "/"`, permanent (308). next …

<sub>Reader: round1:scope — second-round finder: files no reader named · confidence high</sub>

#### R2-160 · High · The quiz · `src/app/(marketing)/for-management-companies/start/route.ts:18`

**The management-company stamp is a GET route handler reached by <Link>, so Next prefetches it and stamps accounts that merely saw the button**

*What's wrong:* All four ways in are `<Link>` from next/link with the default prefetch: src/app/welcome/Quiz.tsx:295 `<Link href="/for-management-companies/start?via=quiz">`, src/app/account/page.tsx:233 `<Link href={`${START_PATH}?via=account`}>`, src/app/(marketing)/for-management-companies/page.tsx:69 and :163 `<Link href={START_PATH}>`. Next's docs for this version say a Link is prefetched when it enters the viewport in production (link.md:298) and warn specifically that a GET route handler reached by <Link> runs on prefetch: "trigger it from a <form method="GET"> rather than a <Link>. Next.js prefetches <Link> components by default, which would clear the cookie before the editor clicks" (01-app/02-guides/draft-mode.md:260). The handler mutates on GET: stampManagement (src/lib/management/stamp-server.ts:36-57) writes profiles.signup_path='management' once, writes sourcing_alerts=false when the mandatory answers are not done, queues a Monday sync, records the mc_signup activity and fires the Meta mc_signup conversion. None of the Links has prefetch={false}.

*How a member or Zac hits it:* A brand-new member ticks "I manage properties" among their roles on the first quiz question (Quiz.tsx:289 shows the box only for the manager role); the "Set up your branded lead form instead" button scrolls into view; the browser prefetches it; the GET stamps them: daily picks written off, mc_signup recorded and sent to Meta, and shellGate (src/lib/management/stamp.ts:71-75) now returns 'none' while the mandatory answers are missing, so the quiz gate and the reveal are lifted, the next sign-in lands on /leads (proxy.ts:49, landing.ts:53) and the intro call is skipped (src/lib/voice/eligibility.ts:14-17). An existing member who scrolls to Sign out on /account is stamped the same way (via 'account'): a Meta mc_signup conversion for an investor, a row in /admin/management, and after a 22d "Start again" (mandatory answers cleared) they become management-only — no quiz gate, lands on Leads, no SI calls. The stamp is once-only and never cleared.

*Smallest fix:* Smallest: `prefetch={false}` on the four Links (App Router: no viewport or hover prefetch, link.md:304). Better: make the stamp a POST (a small form/server action that then redirects to /leads/setup) and leave GET as a plain redirect; the setup page already stamps on arrival (src/app/leads/setup/page.tsx:30) so GET need not write anything. Defensive extra: refuse to stamp when the request carries the `Next-Router-Prefetch`/`RSC` headers. Clean up: `signup_path` rows stamped by prefetch cannot be told from real ones (signup_path_via says only 'quiz'/'account'/'start'); check /admin/management before trusting its funnel.

```
export async function GET(request: Request) {
  ...
  await stampManagement(user.id, via === 'account' ? 'account' : via === 'quiz' ? 'quiz' : 'start');
  return NextResponse.redirect(new URL(SETUP_PATH, url.origin));
```

**Verified by three refuters** (3 of 3 say it stands):
- *code path:* stands — The claimed code path is real. The stamp is a mutating GET route handler: src/app/(marketing)/for-management-companies/start/route.ts:18-29 runs `stampManagement(...)` fo …
- *reproduce:* stands — The finding stands and the path is reachable on live. (1) The handler mutates on GET: src/app/(marketing)/for-management-companies/start/route.ts:18-29 reads the session …
- *the rule:* stands — The finding stands and is a genuine violation of the batch's stated intent, not a documented decision. PR #129 (prs.md:615) says the stamp is set when Start "is pressed", …

<sub>Reader: round1:scope — second-round finder: files no reader named · confidence high</sub>

#### R2-141 · Medium · Later · `src/lib/deal-quality/checks-run.ts:305`

**"Cheap deals first" is not what the checks job actually runs: the plan is round-robined top60 → low_entry → r2r, so the 3/12/5 split only materialises if the whole day's plan completes, and the £1 cap stops it long before**

*What's wrong:* allocateSlots (checks.ts:161-175) correctly gives low entry 12 of 20 and the spare first, but the run order is `interleave`, which walks STREAMS = ['top60','low_entry','r2r','project'] one row per stream per round. With slots {top60: 3, low_entry: 12, r2r: 5} the plan is t,l,r,t,l,r,t,l,r,l,r,l,r,l,l,l,l,l,l,l — low entry's extra nine come last. runPool stops taking rows the moment the day's cap (`outOfCap`, checks-run.ts:401) or the 45 s budget binds. The cap is dailyCapPence = 100 (live-markers: deal_checks.dailyCapPence 100) at COST_PENCE.airbticsBounds = 5p a call (broker/config.ts:39) with up to maxCallsPerCheck = 3 calls a check (search widens until 12 similar homes are found, comps.ts:177-186), i.e. 20 calls a UK day for a plan that needs 20–60 calls. So on a normal day the run stops after roughly 7–15 checks, and the first 9 of the plan are an equal 3/3/3 split: low entry gets a third, not 12/20, and "spare slots go to low entry first" never reaches the provider. The PR's claim (B) and the README §20 sentence describe the allocation, not what is checked.

*How a member or Zac hits it:* Zac sets DEAL_CHECKS_ENABLED=true with the shipped settings. The shortlist holds 30 top-area, 30 low-entry and 10 rent-to-rent candidates. The 03:40 pass plans 3/12/5, checks t,l,r,t,l,r,t,l,r and then stops: the cap has 100p − 9 × ~10p left for one or two more. The day's checked tally is 3 top60, 3–4 low entry, 3 r2r; the 04:00–04:20 passes find `checksLeft` 11 but `capLeftPence` ~0 and do nothing. The admin page's "checked today" never shows the 12 low-entry checks the split promises, and the members' cheap-deal supply grows at a third of the intended rate.

*Smallest fix:* Make the plan follow the slots: a weighted interleave that emits the stream whose emitted/slots ratio is lowest (so 12/20 of the first N rows are low entry), or at least iterate SLOT_ORDER (low entry first) in `interleave`. Separately, a question for Zac: with 5p a call and ≤3 calls a check, dailyCapPence 100 cannot fund perDay 20; either raise the cap (~300p) or accept that the split is a priority order, not a count.

```
function interleave(byStream: Record<Stream, DealRow[]>): DealRow[] {
  const out: DealRow[] = [];
  const longest = Math.max(...STREAMS.map((s) => byStream[s].length));
  for (let i = 0; i < longest; i += 1) for (const s of STREAMS) if (byStream[s][i]) out.pu …
```

**Second reader:** confirmed — Real defect, Medium is right. The allocation is correct (allocateSlots walks SLOT_ORDER low_entry → top60 → r2r, checks.ts:149,161-175; test checks.test.ts:93-103 passes) …

<sub>Reader: round1:22c (cheap deals first) — second-round finder: price rule, auction price, badges, reprice re-stream, check split / shortlist order / 14-day wait, budget-bracket panel · confidence high</sub>

#### R2-148 · Medium · Admin only · `src/lib/management/report.ts:49`

**"Median sign-up to live" and the Journeys "Live" column measure from profiles.created_at, not the management stamp, so an existing member who converts via Account/quiz/Start shows months, not minutes**

*What's wrong:* The stamp is set four ways (stamp.ts:39 StampVia = first_touch | start | quiz | account) and three of them stamp an account that already exists (Account's "Get leads with your own branded form", the quiz's branded-form choice, and Start pressed by a signed-in member). For those, created_at is the original sign-up, possibly months earlier, while stampedAt (profiles.signup_path_at, already read at page.tsx:35 and carried as McAccount.stampedAt) is when they entered the funnel. mcReport ignores stampedAt entirely; the median and the per-row minutes are inflated by whole months for every such account, which with the small early cohort moves the median itself.

*How a member or Zac hits it:* An investor member since June chooses "Get leads with your own branded form" in Account on 2 Oct, finishes the setup in 6 minutes and goes live. /admin/management shows their Journey row as "Live 176,000 min" and, with two other accounts at 5 and 9 minutes, "Median sign-up to live: 9 minutes" — the next conversion of the same kind makes the median read in the tens of thousands.

*Smallest fix:* Measure from the stamp: in report.ts:49 use `Date.parse(x.stampedAt ?? x.createdAt)` and the same in page.tsx:113 (`a.stampedAt ?? a.createdAt`); add a test case with stampedAt later than createdAt.

```
.map((x) => (Date.parse(x.firstLiveAt!) - Date.parse(x.createdAt)) / 60_000)
…
// src/app/admin/management/page.tsx:113
{a.firstLiveAt ? `${Math.round((Date.parse(a.firstLiveAt) - Date.parse(a.createdAt)) / 60_000)} min` : "—"}
```

**Second reader:** confirmed — Confirmed as described. The stamp is written to an already-existing account by three of the four ways in, and both the median and the Journeys "Live" minutes subtract pro …

<sub>Reader: round1:22f — management companies, second round: /admin/management figures and test month, setup Steps 1–3, BrandPreview, setup.ts · confidence high</sub>

#### R2-149 · Medium · Admin only · `src/app/admin/management/actions.ts:63`

**"Set a test month" finds the owner with .ilike('email', …), which the repo's own rule forbids: an underscore or a typo can renumber a different, real owner's month**

*What's wrong:* src/lib/supabase/email-key.ts:6–9 says never to do this: in ILIKE `_` matches any one character and `%` any run, and PostgREST turns `*` into `%` with no escape, so `jane_doe@x.com` matches `jane.doe@x.com`. The lookup is not wrapped in a pattern escape and the error from maybeSingle (two or more matches) is discarded, so the admin is told "No account with that email" when the real problem is ambiguity. With exactly one wrong match the upsert at line 66 silently writes that other account's funnel_lead_months row.

*How a member or Zac hits it:* Zac types test_mc@stayful.co.uk to set a test account to 20 leads; that account does not exist but a paying owner test-mc@stayful.co.uk does. The message says "test_mc@stayful.co.uk: 20 leads this month" and the paying owner's next lead is numbered 21 at £4.00 instead of their real number at £5.00.

*Smallest fix:* Use the exact key the rest of the code uses: `import { emailKey } from '@/lib/supabase/email-key'` and `.eq('email', emailKey(email))`; surface the query error instead of collapsing it into "No account".

```
const { data: p } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
if (!p) return { ok: false, message: 'No account with that email.' };
```

**Second reader:** confirmed — Confirmed as written. src/app/admin/management/actions.ts:63 is the only `.ilike(` left in src/ (grep), introduced by Batch 22f (5d0ac80) after Audit fixes round 2 (08a9a …

<sub>Reader: round1:22f — management companies, second round: /admin/management figures and test month, setup Steps 1–3, BrandPreview, setup.ts · confidence high</sub>

#### R2-150 · Medium · Funnel owners and management companies · `src/lib/funnels/new-lead-server.ts:66`

**The new-lead email says "turn it off in the form's settings" and links to /leads/funnels/{id}, but that page has no such switch; the only "Email me each new lead" control is the setup's Step 3, which nothing links to and which edits only the newest funnel**

*What's wrong:* saveNotifyAction (src/app/leads/actions.ts:283) is only rendered by src/app/leads/setup/delivery/DeliveryStep.tsx:30; a repo-wide search for saveNotifyAction / notifyNewLead / "Email me each new lead" finds nothing in src/app/leads/funnels/[id]/FunnelSettings.tsx or page.tsx. No page links to /leads/setup/delivery once the form is live (setupResume sends a live owner to /leads/setup/live), and setupContext (context.ts:51) works on `funnels[0]` — the newest funnel — so an owner with two forms cannot switch the older form's emails off anywhere. The email is sent for every charged lead, including unqualified and held ones.

*How a member or Zac hits it:* A management company with a busy form gets ten "You have a new lead" emails a day, follows the footer link, lands on the form's settings page (Branding, Rules, Link) and finds no switch. Guessing /leads/setup/delivery only reaches it if that form is their newest one.

*Smallest fix:* Add the checkbox form (saveNotifyAction, hidden id, notifyNewLead defaultChecked from notifyNewLeadOf) to FunnelSettings.tsx next to the branding section, and keep settingsUrl pointing there; or, as the smaller change, point settingsUrl at /leads/setup/delivery and make the delivery page accept ?funnel=<id>.

```
settingsUrl: siteUrl(`/leads/funnels/${o.funnelId}`),
// src/lib/email/new-lead.ts:79
… You get this email for each new lead on this form; <a href="${escapeHtml(i.settingsUrl)}">turn it off in the form's settings</a>.
```

**Second reader:** confirmed — Confirmed as a real Medium defect: the new-lead email's "turn it off in the form's settings" link points at /leads/funnels/{id}, a page that renders no notify control, an …

<sub>Reader: round1:22f — management companies, second round: /admin/management figures and test month, setup Steps 1–3, BrandPreview, setup.ts · confidence high</sub>

#### R2-161 · Medium · Admin only · `scripts/stripe-setup.mjs:61`

**scripts/stripe-setup.mjs's webhook event list omits charge.dispute.closed, which the webhook handles and README §21 step 2 requires**

*What's wrong:* src/lib/stripe/webhook.ts:776 handles `charge.dispute.closed` (R1 B17 / Q6 default: a won or withdrawn dispute gives the clawed-back top-up or pack credit back), README.md:686 says to enable it, and .env.example:67 documents it — but the script's printed instruction (line 186) says the endpoint needs exactly WEBHOOK_EVENTS, which is 12 of the 13. The comment claims the list is what the webhook handles.

*How a member or Zac hits it:* Zac (or a fresh environment) follows the script's printed Dashboard steps when creating the endpoint on the stripe package's API version; `charge.dispute.closed` is not subscribed; a member whose £25 top-up was disputed and then won never gets the credit back — the webhook code for it never receives the event.

*Smallest fix:* Add 'charge.dispute.closed' to WEBHOOK_EVENTS (one line). Optionally a test that every `case '<event>'` in src/lib/stripe/webhook.ts appears in the script's list.

```
// What /api/stripe/webhook handles (src/lib/stripe/webhook.ts; each is explained in .env.example).
const WEBHOOK_EVENTS = [
  'checkout.session.completed', 'invoice.paid', 'invoice.payment_failed',
  'customer.subscription.created', 'customer.subscription.upd …
```

**Second reader:** confirmed — Confirmed as described. Merge order explains it: #110 (cc75b66) introduced WEBHOOK_EVENTS in scripts/stripe-setup.mjs with the 12 events the webhook handled at that point …

<sub>Reader: round1:scope — second-round finder: files no reader named · confidence high</sub>

**Low (tidy-ups)**

- **R2-142** · `src/lib/marketplace/absorb.ts:300` · Later — A deal repriced into the low-entry stream keeps its 7-day shortlist expiry, and the re-stream backfill never touches next_check_due_at: the 14-day wait holds only for deals shortlisted as low entry from the start
  *Fix:* In reconcileDeal, when `repriced && deal.status === 'pending_check' && rec.stream !== streamOfRow(deal…)`, write next_check_due_at = shortlistExpiryAt(new Date(deal.first_seen_at ≥ shortlisted? else now), checks, rec.stream) (or simply extend to now + lowEntry …
- **R2-143** · `src/lib/deal-quality/cheap-rescreen-run.ts:119` · Admin only — The cheap re-screen screens only areas with a card: listings the nationwide low-entry search stored in no-card areas are reported 'unscreenable' and never re-screened, though the search itself screens them on region figures
  *Fix:* Reuse low-entry-run's cardsWithFallbacks (export it) for the candidate areas before screening and pass the same map to absorbListings.
- **R2-144** · `src/lib/marketplace/server.ts:324` · Admin only — "A reprice re-streams the deal (never a Project deal)" holds only on the feed path: the live page read (hourly recheck and paid open) writes recordColumns, which overwrites a live Project deal's stream with top60/low_entry
  *Fix:* In applyLiveRead, drop `stream` from the spread for a live write (`const { stream: _s, ...cols } = recordColumns(merged, rec)`) or apply the same `.or('stream.is.null,stream.neq.project')` filter idea by writing stream in its own guarded statement as absorb.ts …
- **R2-145** · `src/lib/deal-quality/checks-run.ts:264` · Later — The shortlist read is capped at 2,000 rows ordered by annual profit, so once the shortlist is big the cheap, lower-profit candidates that 22c wants first are the ones the job never sees
  *Fix:* Order the read by the same key the job uses (not possible server-side for a JSON ratio) — simplest: raise the limit, or read per stream (three queries, each `.limit(…)`), or page until exhausted; the dry run's `waiting` already shows the counts to watch.
- **R2-146** · `src/lib/deal-quality/budget-panel.ts:39` · Admin only — Budget brackets overlap at the boundary: a deal priced exactly £100,000 (or £200k/£350k/£500k) is counted in two adjacent brackets on the panel and passes two members' budgets, while the explorer's inBudget is half-open
  *Fix:* Make budgetBounds half-open to match inBudget (max exclusive: `p < max`), or make inBudget inclusive; then the panel's count partitions the pool. Decide once in filters.ts and derive sourcing.ts from it.
- **R2-151** · `src/app/admin/management/page.tsx:42` · Admin only — Blind spots in the admin funnel: an owner whose form was already live when stamped via Account never counts as "Went live", and legacy (metered) owners' leads never reach "First real lead" or the monthly tables
  *Fix:* When stamping with via 'account' (or in markFirstLive's caller), stamp first_live_at = created_at on the owner's already-active funnels (an idempotent `update funnels set first_live_at = coalesce(first_live_at, created_at) where user_id = $1 and active`), and …
- **R2-162** · `src/components/marketing-v3/Nav.tsx:58` · Existing members — Marketing header's "Open Today" sends a signed-in member to /today, while 22e made /home the landing and 22f sends management accounts to /leads
  *Fix:* Point the button at `/login` (the proxy applies postAuthPath per account, including the management rule) or at HOME_PATH, and relabel it ("Open Stayful" / "Open Home"); refresh the comment. Depends on the /home redirect finding being fixed first.
- **R2-163** · `src/lib/profile/mandatory-server.ts:34` · The first report — mandatory-server.ts ignores a failed saved_areas read, so seeded (pre-quiz) members read as incomplete and lose that day's pick
  *Fix:* Treat `areas.error` like the other two (return null), or at least log it, so a read failure holds nobody back as documented.
- **R2-164** · `src/app/deals/opened/page.tsx:47` · Existing members — /deals/opened: a paused seat is shown "only its own opens", but opens are stored under the payer, so it sees none of the deals it opened for the team
  *Fix:* Either reword the comment and show a one-line empty state ("Paused seats can't see the team's opened deals"), or record `member_id` on deal_opens at insert and filter on it for a suspended seat.
- **R2-165** · `src/lib/team/remove.ts:43` · Existing members — team/remove.ts reopens the welcome decision but not the profile-credit skip, so the "£5 can follow it" claim fails for a member who touched the quiz on the team
  *Fix:* In the same reopen, `update profile_quiz set credit_skipped_reason = null where user_id = memberId and credit_skipped_reason = 'team_member' and credit_grant_id is null`.
- **R2-166** · `src/app/home/_components/CountUp.tsx:13` · Later — CountUp paints the full figure, drops to 0 and counts up again
  *Fix:* Set the start value in a useLayoutEffect (before paint) or seed the animation from the already-painted value instead of 0; or drop the count-up (nothing on Home needs it).
- **R2-167** · `STAYFUL_DESIGN_BRIEF.md:71` · Admin only — STAYFUL_DESIGN_BRIEF.md says /upgrade loads DM Sans; it does not
  *Fix:* Change the sentence to "loaded only by src/app/markets/layout.tsx".
- **R2-186** · `src/app/estimate/layout.tsx:45` · The first report — /estimate writes profiles.last_seen_at twice per render: the estimate layout's own after() hook duplicates AppShell's hour-guarded write
  *Fix:* Delete the last_seen_at after() block (lines 39-49) from src/app/estimate/layout.tsx; AppShell already records the visit for every members-only page.
- **R2-187** · `src/lib/voice/admin.ts:40` · Admin only — /admin/calls counts an initiate that ElevenLabs refused (status 'failed', never rang) as a placed call, so the answer rate is understated
  *Fix:* In callTotals, define `rang = r.status === 'answered' || r.status === 'missed' || r.status === 'voicemail'` (a closed list from CALL_STATUSES), and count 'failed' separately or leave it in `calls` only; pin with a row {status:'failed'} in admin.test.ts.
- **R2-188** · `src/app/leads/setup/actions.ts:39` · Funnel owners and management companies — 'Not now' on the management-company pack step is logged with surface 'other', and the pack being shown on that step is never recorded
  *Fix:* Add 'setup' to SURFACES in src/lib/starter-pack/server.ts, and call recordPackShown(ctx.userId, 'setup') where src/app/leads/setup/page.tsx renders <PackStep>.
- **R2-189** · `src/app/leads/setup/page.tsx:39` · Funnel owners and management companies — A management company's pack purchase returns to /leads/setup?pack=1, which is redirected server-side before the browser sees it, so the Stripe-return poll (R1 E28/F32) never starts there
  *Fix:* Redirect to `${setupResume(...)}?pack=1` instead of the bare path and add `{ path: '/leads/setup/company', params: ['pack'] }` (and the other step paths) to STRIPE_RETURNS; or have settle() start the poll when a 'pack' one-shot param was just tidied.
- **R2-190** · `src/lib/broker/questions.ts:278` · Sign-up and first sign-in — A member search's PMI and OnTheMarket rungs return null for an empty page, which the broker never caches, so a thin area with no live stock re-pays the provider on every sign-up search inside the 20-hour TTL
  *Fix:* Have the member rungs return [] (an empty, cacheable answer) rather than null, or cache a negative answer with a shorter TTL in resolve.ts; then areaStock's searchedAt is set and the fresh-hours rule works for empty areas.
- **R2-191** · `src/lib/fonts.ts:24` · Sign-up and first sign-in — Every page preloads all seven self-hosted font files (about 307 KB) because the root layout imports the one module that registers six families, though members' pages use Inter alone
  *Fix:* Split the module: src/lib/fonts/inter.ts (imported by the root layout) and src/lib/fonts/marketing.ts (imported only by the (marketing), /markets and /upgrade layouts); or set `preload: false` on the five non-Inter families.
- **R2-192** · `src/app/demo-report/page.tsx:29` · Later — /demo-report stays public (R1 F28 built differently) and shows the Stayful Intelligence narrator to anonymous visitors, whose tap only yields 'You need to sign in to use the narrator'
  *Fix:* Pass a prop from DemoReportPage (e.g. `demo`) and render the narrator only when `!funnel && !demo`; or make the narrator's empty state on the demo a 'Sign up to hear this' link.


## 5. Gap check: what was asked vs what is on main

Area H's table first (Batch 22's and Batch 23's items from the brief, each PR's own "not done / not built yet" list, and every Batch 21 approved fix with the test that covers it or "no test"). Then the other readers' rows for their own bullets, only where the status is not plainly *built*.

| Item | Status | File | Note |
|---|---|---|---|
| B22 · Accuracy levels Basic → Advanced → Stayful Intelligence with real counts | **built** | src/lib/profile/levels.ts; src/lib/profile/server.ts:221-251; src/app/welcome/Quiz.tsx:362 | Levels from the member's real Progress counts against accuracy_advanced_pct (50) and profile_credit_min_real_pct; the 'I checked N live deals' count is the stored day choice tally (today/checked.ts), not a constant. |
| B22 · Evolving eye (level 0–3, ≤1 s level-ups, reduced motion) | **built** | src/components/StayfulEye.tsx; src/app/globals.css:3864-3878; src/lib/intelligence/config.ts:11 | Layers switch on per level; siPowerUp plays once for .9 s (LEVEL_UP_MS 900) and nothing waits; prefers-reduced-motion stops all eight eye keyframes. |
| B22 · Reveal #1 + 2 alternatives | **built** | src/app/welcome/reveal/page.tsx; src/lib/intelligence/reveal.ts; src/lib/intelligence/view-server.ts | Today's first 3 cards for the primary profile (REVEAL_ALTERNATIVES=2); 'closest I have' tone under reveal_low_match_pct or on a near miss; recorded in signup_reveals before render. |
| B22 · 'Save all 3' | **built** | src/app/welcome/reveal/page.tsx; src/app/welcome/reveal/actions.ts | Plain form; keeps every unanswered revealed deal (only ids in the member's reveal row); shown only when ≥2 are unanswered, so it can read 'Save all 2'. |
| B22 · Continue always visible | **built** | src/components/intelligence/IntelligenceView.tsx | Sticky top bar link rendered on the server with the cards; not gated by any animation or search. |
| B22 · reveal→first Keep time recorded and shown | **built** | src/lib/intelligence/reveal-server.ts:130-150; src/app/deals/actions.ts:114; src/app/admin/intelligence/page.tsx | signup_reveals.first_keep_at + first_keep_ms (and ms in the keep activity extras); /admin/intelligence shows the median and the share under 10 s. |
| B22 · Notification screen (daily email on with price, call box unticked, mobile verified first, consent record) | **built** | src/app/welcome/choices/page.tsx; CallBox.tsx; actions.ts; src/lib/intelligence/consent.ts; supabase/schema.sql:5903 | Daily email on with dailyPriceLineFor's line; call box default = profiles.si_calls (off); VerifyNumber(purpose calls) switches calls on after the code; consent = si_call_consents(user_id, choice on\|off, source welcome\|settings, version, created_at). Defect: after verifying, the box renders unticked while calls are on and Continue can't switch them off (finding 1). |
| B22 · 'Calls from Stayful Intelligence' switch in Account → Notifications | **built** | src/lib/notifications/registry.ts:118; src/app/account/notifications/page.tsx:103-125; actions.ts:25 | Registry key si_calls; disabled until a verified number exists; team members see 'calls go to your team's account owner'; writes through setSiCalls(…,'settings') with a consent row. |
| B22 · Tap-to-ask answers pulling live figures | **built** | src/lib/intelligence/answers.ts; src/lib/intelligence/view-server.ts:160-192 | Up to 8 chips; figures = balance (credit snapshot), top-up rate, open ladder min/max, pack price/credit, text alerts on, checked count, full/PMI list prices, welcome price + end day, first deep price, free delay hours, call/text/email prices (si:call_minute unit row) + whether calls are live, top-up presets, auto top-up state, Part F's line — all from billing settings or member rows. |
| B22 · Part F what-ifs with real counts, Show me / Use this with Undo, 'I'm searching your area' | **built differently** | src/lib/intelligence/what-if.ts; what-if-server.ts:20; src/components/intelligence/WhatIfSuggestions.tsx; what-if-actions.ts | ≤6 one-change variants counted against the real pool, best 3 shown; Show me = /deals/<best>; Use this saves via answerQuestion then rechooseForMember, Undo re-answers; a budget band gets 'Change my budget' (link to the quiz) instead of Use this. 'I'm searching your area' is chosen from the env flag, not the member's search (finding 2). |
| B22 · Part G layers (what, order, caps) | **built** | src/lib/sourcing-demand/member-search.ts; member-search-plan.ts; supabase/schema.sql member_search_claim | Layer 1: Today's own choice previewed (no spend); a strong match (no must-have missed, ≥5 checks, ≥90%) ends it. Layer 2 (signup, free): own screenable areas (≤6) × wanted kinds where live stock <5 or not searched in 24 h, OnTheMarket page 1 then PMI only if still thin, then ≤3 income checks and ≤5 live reads (≤40/hour overall); caps 50p raw per search and £20/month, house spend. Stored as signup_reveals.layer=2 when it found live deals. Off unless MEMBER_SEARCH_ENABLED=true. |
| B22 · Part G deep search (quote, reservation, result) | **built** | src/lib/sourcing-demand/member-search.ts:470-560; member-search-quote.ts; src/app/api/deep-search/route.ts; src/components/intelligence/DeepSearchOffer.tsx | Quote 'about £X, up to £Y' = planned OTM+PMI pages (+≤6 checks) × deep_search_markup 5, first one 50% off, up-to = 300p raw cap × markup; start re-quotes, reserves the up-to for 60 min, one at a time; result refreshes Today with live finds and debits min(actual × markup × discount, up to) once; £50/month ceiling in the claim RPC. |
| B22 · Part H analyse 1–3 with progress bars | **built differently** | src/components/intelligence/RevealAnalyses.tsx:219 | Run full analysis / Deep report per card, a select to add 1–3 to 'Analyse all' with a confirm and total, two at a time through the deal page's start/run routes; progress is a text line '{message} ({progress}%)', not a bar. |
| B22 · Welcome price | **built** | src/lib/analysis/offers.ts:66-106; offers-server.ts | Only the member's own reveal deals (offer_deal_ids), within reveal_welcome_days of viewed_at, paysForSelf, once per deal, never on the PMI add-on, floored at the raw ceiling; full × (1 − reveal_analysis_discount_pct). |
| B22 · Deep report price | **built differently** | src/lib/analysis/offers.ts; src/lib/intelligence/view-server.ts:140-150 | List = full_analysis_pence + pmi_addon_pence. On live and in the seed full_analysis_pence is 400, so the Deep report is £6 and the welcome Deep report £3, not the brief's £7 (area B's call). |
| B22 · First-time Deep report price (counting a reveal-discounted one and 'add PMI' as the first) | **built differently** | src/lib/analysis/offers.ts:96-112; offers-server.ts hadDeepReport; deal-analysis.ts:354; pmi-addon.ts:120 | first_deep = full + deep_first_run_extra_pence (100) → £5 on live (brief £6, same £4 root); hadDeepReport is true after any complete second-opinion purchase or a claimed first_deep purchase, and welcome_deep / first_pmi both stamp first_deep, so they count as the first. |
| B22 · PMI comparables and the PDF page ('SECOND OPINION') | **built** | src/app/estimate/_components/SecondOpinionCard.tsx:57-60; src/lib/pdf/report/PageSecondOpinion.tsx; src/lib/pdf/sections.ts:48 | Card and PDF page both lay out PMI's comparables like ours; the page shows ours vs PMI, range, agreement % and months; included only when the result has a second opinion. |
| B22 PR gap · 'price after top-up' display while short of credit | **missing** | src/components/intelligence/RevealAnalyses.tsx | Confirmed absent: a short label shows the plain price and opens the top-up window with a resume intent; nothing says what the price will be after the top-up. |
| B22 PR gap · quiz status line ('screened → live → in budget → fit you') | **missing** | src/app/welcome/Quiz.tsx | No such strings anywhere in src; the quiz header shows the accuracy level, hint and eye only. |
| B22 PR gap · untailored members' 'Use this' not re-choosing Today | **partly built** | src/components/intelligence/what-if-actions.ts:38; src/lib/tailoring/server.ts:298 | Still as declared: the answer is saved, but rechooseForMember returns null when !usesTailoring, so an untailored member's Today is re-chosen only by the next morning's run. |
| B22 PR gap · member searches untested end to end | **partly built** | src/lib/sourcing-demand/member-search.ts; .env.example:434 | Cannot be verified from code; still off by default (MEMBER_SEARCH_ENABLED unset on live, documented only in a comment line of .env.example per the mechanical check). Unit tests cover the plan and quote only (member-search.test.ts). |
| B22 PR gap · turning the daily email off writes a consent row? | **built differently** | src/app/welcome/choices/actions.ts:24; src/lib/notifications/server.ts:13; src/lib/notifications/registry.ts:190 | No: it writes profiles.sourcing_alerts=false + sourcing_opted_out_at stamp, queues the Monday sync and logs notification_settings; consent_records is written only for cookies (tracking/consent-server.ts) and si_call_consents only for calls. |
| B23 · Intro call once ever with a contact card (vCard) | **built differently** | src/lib/voice/triggers-server.ts; queue-server.ts; supabase/schema.sql:6246; src/lib/voice/vcard.ts; src/app/si/card/route.ts; src/lib/voice/agent/prompt.ts:20; fallback-server.ts | Once ever by unique index; the card is a vCard 3.0 (name, ORG, title, TEL=TWILIO_FROM_NUMBER, URL, note, PNG photo) sent as a LINK in a text — by the agent's send_template_text during the call (no code fallback if it skips it, finding 3) or by the missed-call text + email; never an email attachment. |
| B23 · Low-credit call trigger (80% of latest credit within 7 days, at £5) before Batch 20's notice | **built** | src/lib/voice/low-credit.ts; low-credit-server.ts; src/lib/credit/after-debit.ts:120-160 | balance ≤ low_credit_pence (500) AND spent since the latest topup/plan/pack landing ≥ si_low_credit_spent_ratio × landing within si_low_credit_window_days; one per landing; afterDebit asks it first and marks the £5 notice told when a call rang; a blocked call leaves the email as before. Spent is face pence vs the grant's amount_pence — area B to confirm the units. |
| B23 · Auto top-up link (£25 at £5; card saved via Checkout if none) | **built** | src/lib/voice/templates.ts; src/app/si/topup/route.ts; src/app/account/billing/auto-topup/*; src/app/api/billing/topup/route.ts:53-127; src/lib/stripe/webhook.ts:268 | Text link → /si/topup → one-tap page; saved card → /api/billing/auto-topup; none → £25 Checkout with setup_future_usage and auto_topup_on metadata, the webhook switches it on once. Amount must equal reveal_auto_topup_amount_pence and be a topup preset. |
| B23 · Callbacks answered at any hour | **built** | src/lib/voice/inbound-server.ts | No hours rule on inbound; recognised members get missed-intro / missed-low-credit / member context; a callback never counts towards the one-a-day (dayFacts is outbound only). |
| B23 · Unknown callers never charged | **built** | src/lib/voice/inbound-server.ts:69-78; webhook-server.ts:126-129; tools-server.ts:100; sms-replies-server.ts:62 | user_id null and a caller hash only; minutes charged only when call.user_id; texts refused; SMS replies free for unknown numbers. |
| B23 · Text replies ('who is this?' → SI line; else short reply + forwarded copy) | **built** | src/app/api/twilio/inbound/route.ts:90-97; src/lib/voice/sms-replies.ts; sms-replies-server.ts; templates.ts | After STOP/START/HELP; regex variants of 'who is this'; others get 'Thanks, I've passed that on' and a copy to feedback_admin_email; once per MessageSid, ≤3 replies a number a day, silent after STOP; member charged si_text_pence. No reply at all until SI_CALLS_ENABLED=true (by design). |
| B23 · Shared channel-neutral conversation log with outcomes | **built** | src/lib/conversations/log-server.ts; supabase/schema.sql:6147-6194; src/lib/voice/config.ts QUESTION_OUTCOMES | si_conversations (channel call\|sms\|chat) / si_conversation_turns / si_conversation_questions. An 'outcome' is per question: answered \| low_confidence \| could_not_answer \| member_unhappy \| handed_off, set by the agent's log_question and handoff tools, the SMS reply, and the post-call webhook from ElevenLabs' member_unhappy flag. No per-conversation outcome column. |
| B23 · 90-day retention with a deletion job that runs | **built** | src/lib/voice/retention-server.ts; src/lib/voice/run.ts:150-170; vercel.json:145; src/lib/voice/agent/agent-config.ts | Turns deleted (questions kept) for conversations older than si_transcript_retention_days; runs from the every-5-minutes /api/internal/si-calls cron once per UK day via a claimed event, 500 per batch; ?dry=1 counts only; runs whether or not calls are enabled; skipped only when the Batch 23 schema is missing. ElevenLabs' own retention_days is synced to the same number. |
| B23 · Admin calls page (every call incl. blocked; agent sync with dry run) | **built** | src/app/admin/calls/page.tsx; Forms.tsx:68-86; actions.ts:50-58 | Lists every si_calls_log row with the blocked reason text, filters and totals; settings form; 'Dry run' (intent=dry) lists the prompt/voice/max-call/tool changes without sending, 'Sync to ElevenLabs' applies. |
| B23 · Agent instructions kept in the repo and synced | **built** | src/lib/voice/agent/*.ts; src/lib/voice/agent/sync-server.ts; src/lib/persona/stayful-intelligence.ts:170-190 | Synced: 4 webhook tools (ids kept in billing_settings.si_agent_tool_ids), prompt = persona CORE + phone channel + call task + knowledge (FAQs with live prices + a DRAFT service guide), first message, built-in end_call/voicemail tools, tts voice_id = voiceId() (ELEVENLABS_VOICE_ID else Lily), model/stability, max_duration_seconds, member_unhappy data collection, retention_days. |
| B21 fix B1 (atomic plan cycle + in-flight duplicate 409) | **built** | supabase/schema.sql credit_plan_cycle; src/lib/credit/ledger.ts:190; src/lib/stripe/grants.ts; src/app/api/stripe/webhook/route.ts:56-66 | Test: supabase/tests/credit-smoke.sql 'Batch 21 (B1): credit_plan_cycle is atomic and a replay expires nothing'. The route's 409 has no node test. |
| B21 fix B2 (overdraft forgiveness + pack-era shadow stop) | **built** | supabase/schema.sql:5794; src/lib/credit/http.ts:35 | Tests: credit-smoke.sql forgiveness check (line 130); http.test.ts 'Batch 21 (B2): shadow mode lets a member who was given the welcome credit carry on, and nobody else'. |
| B21 fix B3 (one() throws on a read error) | **built** | src/lib/stripe/deps.ts:55-67 | no test |
| B21 fix B4/B46 (house-billed quiz placement for un-welcomed accounts) | **built** | src/lib/profile/server.ts:389-394 | no test |
| B21 fix B5 ('Top up to run it / add it' opens the dialog) | **built** | src/app/deals/_components/AnalysisPanel.tsx:60-63; src/components/report/PmiAddonCard.tsx:20-23 | no test |
| B21 fix B7 (top-up double charge: pending result, nonce per mount) | **built** | src/app/api/billing/topup/route.ts:45-101; src/components/credit/TopupButtons.tsx:21; LowCreditChoice.tsx:25 | no test |
| B21 fix B8 (annual slots) | **built** | src/lib/stripe/annual.ts | Test: annual.test.ts 'every start day gives twelve slots with twelve distinct month keys that cover the whole year (B8)'. |
| B21 fix B9 (referral guard for withheld accounts) | **built** | supabase/schema.sql credit_redeem_code; src/app/api/billing/redeem/route.ts | Test: credit-smoke.sql 'Batch 21 (B9): no referral credit, no referral reward, for a withheld account'; the route's message has no test. |
| B21 fix B10/B16/D16 (recheck cron try/catch, who is billed) | **built** | src/app/api/internal/listing-recheck/route.ts:108,238; src/lib/listing/recheck-billing.ts | Tests: recheck-billing.test.ts ×6 ('Batch 21 (B16, D16): the first watcher who can pay carries the fetch', 'a payer at £0 under enforcement is passed over', …). |
| B21 fix D1 (seat reinstatement keyed on suspended_at, claimed before charging) | **built** | src/lib/team/seats.ts:76-160 | no test (the fix plan asked for one; no *.test.ts mentions reinstatement) |
| B21 fix D2/D18/G9 (Resend 429 wait, keyed 409 = sent, 10 s timeout) | **built** | src/lib/email/send.ts:10-101 | Tests: send.test.ts 'Batch 21 (D2): a 429 is waited out…', 'Batch 21 (D18)…', 'Batch 21 (G9): every call carries a timeout signal'. |
| B21 fix D3 (digest rotation) | **built** | src/lib/notify/digest-run.ts:79,180,431 | no test |
| B21 fix D5/D15/D19 (abandonSend deletes the row) | **built** | src/lib/notify/sends.ts:85; used by 8 runs | no test |
| B21 fix E1 (quiz open/resume record-only) | **built** | src/lib/activity/kinds.ts:110,114 | Test: profile/activity.test.ts 'the quiz's events are registered… (Batch 21, E1)…'. |
| B21 fix E2 (Weeks since sign-up) | **built** | src/lib/crm/monday-funnel/config.ts:86-134; facts.ts weeksSinceSignup | Tests: funnel.test.ts:340 'Batch 21 (E2): weeks since sign-up are ISO weeks…', :348 '…the weeks column exists only once MONDAY_FUNNEL_WEEKS_COLUMN names it'. Still needs the Monday column + env (operational). |
| B21 fix C1 (strip the Stayful pitch on white-label) | **built** | src/lib/funnels/whitelabel.ts:18 | Test: whitelabel.test.ts 'Batch 21 (C1): the Stayful pitch leaves a white-label disclaimer, the rest stays'. |
| B21 fix C2 (presentation view members-only) | **built** | src/app/estimate/page.tsx:1393-1407,1923 | no test |
| B21 fix C3 (failed funnel run refunded, lead stays queued, hour dedupe) | **built** | src/app/api/f/[token]/analyse/route.ts:43,161-176,276 | Test: leads/dedupe.test.ts 'Batch 21 (C3, D10): a resubmission is matched within the hour; a queued lead is claimable after five minutes' (dedupe only; the refund path has no test). |
| B21 fix C4 (leads.input stored and re-run) | **built** | supabase/schema.sql:5759; src/lib/leads/queue-input.ts | Test: queue-input.test.ts 'Batch 21 (C4): a queued lead is re-run as the prospect described the property…'. |
| B21 fix G1 (public lead oracle deleted) | **built** | src/app/api/get-report (gone); src/app/report (gone); src/app/robots.ts | no test |
| B21 fix G2 (Next.js 16.3.7) | **built** | package.json:28,45 | n/a (build, tests and audit green per mechanical.md) |
| B21 fix C30 (constant-time secret compare) | **built** | src/lib/internal-auth.ts:27-41 | internal-auth.test.ts exercises authoriseInternal (6 tests) but none is named for the timingSafeEqual change. |
| B21 fix F32 (pack Checkout returns to the quiz) | **built** | src/app/api/billing/starter-pack/route.ts:177; src/lib/tracking/config.ts:103,171 | Test: surfaces.test.ts '/welcome loses ?next only when it is the default way back'. |
| B21 fix E20 (subscription change counts as the member's only when own) | **built** | src/lib/activity/kinds.ts:255-269; src/lib/stripe/webhook.ts logPlanActivity | Tests: webhook.test.ts:493 '…Stripe dashboard… not logged as the member cancelling (E20)', :507 '…logged by the app, not a second time by the webhook (E20)'; kinds.test.ts:46-47. |
| B21 sampled fixes (B12, B15, B17, B19, B24, B27, B30, B35, B42, B47, C5, C6, C8, C9, C13, C15, C16, C19, C26, D4, D21, D25, D26, E5, E6, E7, E9, E24, E28, F6, F10, F22, G3, G7, G8, G12, G19, F31, B20 FAQ, B38) | **built** | see cleanChecks | All present on main; tested ones listed in cleanChecks; no test for B12, B24, B30, B35, B47, C2, C5, C6, C8, C13, C15, C19, C26, D21, D26, F6, F10, F22, G7, G8, G12, F31, B38 (server/UI changes). |
| NOT DONE · 21b B41 staff accounts at the flip | **built differently** | README.md:673-677; src/lib/credit/auth.ts | Resolved as the manual step in #125: add staff logins to ADMIN_EMAILS before CREDIT_ENFORCE=true. No code; a staff account left off the list is still blocked at £0. |
| NOT DONE · 21c G5 deps-injected tests for grant-server.ts and grants.ts | **missing** | src/lib/starter-pack/grant-server.ts; src/lib/stripe/grants.ts | Still open: no grant-server.test.ts or grants.test.ts on main (only topup-receipt.test.ts touches grants). |
| NOT DONE · 21e D20 unsubscribe link on the credit emails | **missing** | src/lib/email/billing.ts:31-33; src/lib/notify/cap.ts:32-41 | Still open: out-of-credit / running-low emails carry 'Manage notifications' only; cap.ts has no non-slot SendKind (Batch 23 added si_call, which takes the daily slot). |
| NOT DONE · 21e D14 marketing-email switch | **missing** | src/lib/notifications/registry.ts | Still open by Q8 default: no 'marketing' key; Monday's Email OK stays the daily/weekly proxy. |
| NOT DONE · 21f E10 automatic disposable-email exclusion from metrics | **missing** | src/lib/activity/metrics.ts | Still open: no disposable rule in exclusionFor; only the admin 'Exclude from metrics' switch (E8) applies. |
| NOT DONE · 21f E13 double-recorded email clicks | **missing** | src/lib/activity/kinds.ts:121,156 | Still open (deliberate): profile_email_click / feedback_email_click page logs kept as the take-up figures. |
| NOT DONE · 21f E16 creating a second profile logs created + switched | **missing** | src/app/profiles/actions.ts:81; src/lib/profiles/server.ts:310,325 | Still open: createProfileAction → switchProfile logs saved_profile_switched after saved_profile_created; Batch 22d's Start blank takes the same path. |
| NOT DONE · 21f E21 identifying extras at the old call sites | **partly built** | src/app/markets/actions.ts:37; src/app/api/listing/resolve/route.ts:43 | New Batch 21–23 logs carry extras; the pre-existing bare calls (area_saved, listing_check) still have none, so the 60-second guard can still drop a genuine second action. |
| NOT DONE · 21f C21 /profiles/switch on GET | **missing** | src/app/profiles/switch/route.ts:14 | Still a plain GET (deliberate: webmail links); only ?via= was added (E4). |
| NOT DONE · 21g C29 pixel id in funnel RSC payload | **missing** | src/components/tracking/CookieSettingsLink.tsx:9 | Still open; declared no-change (NEXT_PUBLIC_META_PIXEL_ID is in every client bundle anyway). |
| NOT DONE · 21g bad-postcode lead archived as failed | **built differently** | supabase/schema.sql:1225-1228; src/app/api/f/[token]/analyse/route.ts:276; src/app/api/internal/funnel-queue/route.ts:76 | leads_archive_reason_check still allows only inactive \| manual; a GeocodeError run is refunded (C3) and the lead stays queued, retried each drain until the 14-day cutoff (MAX_AGE_DAYS). No later batch changed it. |
| NOT DONE · 21h F8 'See plans' button | **missing** | src/app/deals/[id]/page.tsx:303 | Still /upgrade?redirect=/deals/<id>; only the box copy changed. |
| NOT DONE · 21h B20 pricingDescription 'from £19/month' | **missing** | src/lib/starter-pack/rules.ts:236,251 | Still typed 'from £19/month' in both branches of publicOffer().pricingDescription (the FAQ cost answer is now live, faqs-server.ts). |
| NOT DONE · 21h F7 /deals/opened back link | **missing** | src/app/deals/opened/page.tsx:64 | Still '← All deals' → /deals, a page not in the nav. |
| NOT DONE · 21h G17 licensing re-verification | **missing** | src/lib/data/str-licensing.ts:71 | VERIFIED = '2026-07-18' still; the England scheme and Welsh date have not been re-checked by a person. |
| NOT DONE · 21i's 4 lint warnings (no-location-assign-relative-destination) | **missing** | src/app/deals/_components/AnalysisPanel.tsx:79,99,129; src/app/estimate/page.tsx:758 | Still present on main (mechanical: 67 warnings, 46 in changed files); 21b and 21g did not take them. |

*Area H's notes:* Scope: every Batch 22/23 item in the brief and every finding id named for Batch 21 was checked against the code on main at 5d0ac80 (not the PR text). Prices quoted in the gap table use the live/seeded full_analysis_pence = 400 (mechanical §1c flag); the brief's £5/£7/£6 figures are a settings question for area B, not a code gap in the offers logic. Batch 21 fixes with no test on main (B3, B4, B5, B7, D1, D3, D5, C2, G1, and the route halves of B1/B9) are server or UI changes the fix PRs' own tables also listed without a test; D1 is the one the fix plan explicitly asked a test for. Of the 'not done' list, only B41 (manual step) and the bad-postcode lead (refund + retry) moved; everything else is still open on main, and Batch 22d's Start blank reuses the E16 path. Findings 1–3 are Medium: none charges money or leaks data; finding 1 changes whether a brand-new member can switch calls off at the choices screen after verifying, finding 2 only bites once MEMBER_SEARCH_ENABLED=true (off on live), finding 3 depends on the LLM agent's tool use on an answered intro call.

#### The other readers' gap rows (each area checked its own bullets)

**B1 money: charge paths**

| Item | Status | File | Note |
|---|---|---|---|
| Full analysis at full_analysis_pence (£5) everywhere shown or charged | **built differently** | src/lib/credit/deal-pricing.ts:52; supabase/schema.sql:3459 | Everywhere reads the setting, but the setting, the seed and the fallback are 400 (£4); brief says £5. Deep £6 not £7, first Deep £5 not £6 follow from it. |
| Welcome price: own up-to-3 reveal deals, within 7 days, new members only, once per deal, never on PMI alone | **built differently** | src/lib/analysis/offers.ts:98-101 | All five rules hold (offers.ts:78-84, reveal-server.ts:100), but at the £4 list the floor makes it £2.17, not half price. |
| Deep report £7; first Deep report ever £6, once per member, counting a reveal-discounted one and 'add PMI' as the first | **built differently** | src/lib/analysis/offers.ts:107,115,124; src/lib/analysis/offers-server.ts:39-48 | Logic built (welcome_deep and first_pmi both claim first_deep); amounts £6 / £5 at live; a first Deep whose PMI fails still consumes the claim (finding 3); per-buyer/per-payer mismatch in a team (finding 8). |
| First-time PMI add-on price shown and charged from a report (Part H) | **partly built** | src/app/reports/[id]/page.tsx:41; src/lib/analysis/pmi-addon.ts:92-95 | Server prices it (£1) but the only page that renders PmiAddonCard still labels the list price, so every first-timer is refused with price_changed. |
| Every price read from billing_settings | **partly built** | src/lib/voice/charge-server.ts:36-39; src/lib/intelligence/settings.ts:91 | All but the call minute, which is the si:call_minute unit row (si_call_pence_per_min is a dead setting); the three offer settings have no admin field. |
| 'Price after top-up' display while short of credit | **missing** | src/components/intelligence/RevealAnalyses.tsx:196-206 | PR #121 says not built; resume-after-top-up re-quotes instead (RevealAnalyses shows 'Your top-up credit makes these £X in total now'). |

**B2 money: charge twice**

| Item | Status | File | Note |
|---|---|---|---|
| A call can never push the balance below zero | **built differently** | src/lib/voice/charge-server.ts | The call's own debit is capped, but at total grants rather than spendable credit: it can take credit a running analysis/deep search/funnel lead reserved, and that debit then overdrafts (F1) |
| Call minutes priced from billing_settings | **built differently** | src/lib/voice/charge-server.ts | Charged from the si:call_minute unit row (13p × 5); si_call_pence_per_min is only shown on the choices screen (F2) |
| Deep report £7, first ever £6 once per member (reveal-discounted and add-PMI count) | **built differently** | src/lib/analysis/offers-server.ts | Once per member by index, but the pre-check reads the owner's rows for a team seat (F5); self-payers correct |

**C1 privacy: who sees what**

| Item | Status | File | Note |
|---|---|---|---|
| Signup search: finds refresh the member's Today list / reveal ("I found N for you just now") | **partly built** | src/lib/sourcing-demand/member-search.ts | Works for paid-tier members; for a free member the stale member context means the finds are not in the ranking and never land (finding 1). MEMBER_SEARCH_ENABLED is off on live. |
| 22f: the management stamp as a confirmed, reversible choice | **built differently** | src/app/(marketing)/for-management-companies/start/route.ts | Stamped on a GET, permanent, linked from every Account page; interacts with 22d's Start again (finding 2). |
| 22f: no quiz or reveal gate for a management-only account | **partly built** | src/app/intelligence/page.tsx | AppShell honours the stamp; the eye's /intelligence page does not (finding 3). |

**C2 safety: calls and texts**

| Item | Status | File | Note |
|---|---|---|---|
| Low-credit call trigger (80% within 7 days, at £5) with auto top-up link | **built differently** | src/lib/voice/low-credit-server.ts | Rule and trigger built (low-credit.ts, low-credit-server.ts, /si/topup → /account/billing/auto-topup); but a passing block consumes the landing (finding 1) and the balance is not re-tested when a queued call is dialled (finding 2) |
| SI_CALLS_ENABLED / SI_CALLS_DRY_RUN switches | **partly built** | src/lib/voice/config.ts | Outbound and SMS replies are gated; inbound calls, tools and post-call charges are not gated by either flag (findings 5 and 7) |

**D1 crons and queues**

| Item | Status | File | Note |
|---|---|---|---|
| Batch 22: /api/internal/member-searches every 5 minutes; ?dry=1 lists the searches it would continue or settle and writes nothing | **built differently** | src/lib/sourcing-demand/member-search.ts | Route, schedule and the write-nothing dry run are there; the dry run returns a count (`due`), not a list. |
| Batch 22c: /api/internal/restream-backfill and /api/internal/cheap-rescreen with ?dry=1 that write nothing, plus /admin/deals buttons | **built differently** | src/lib/deal-quality/restream-run.ts | Both exist, secret-gated, admin buttons present, no network or spend; the dry run records a marketplace_runs row with dry=true. |

**D2 messages and the cap**

| Item | Status | File | Note |
|---|---|---|---|
| "The call comes before Batch 20's notice; if a safety rule blocks the call, the notice runs as before" (#124 claim) | **partly built** | src/lib/credit/after-debit.ts:130, src/lib/voice/low-credit-server.ts | True only within one debit and only in hours. Queued-outside-hours calls, calls after the morning email, and failed-after-placement calls break it in both directions. |
| Calls override the cap: a call takes the day's slot; later capped emails move to the next day | **built differently** | src/lib/voice/cap-server.ts | Slot claimed post-dial at any hour; Today's 5 is lost (not moved) when the call lands before the 08:10 digest in BST; pending alerts and the lone £5 notice do move. |
| Call texts vs Batch 8's one-text-a-day and sms_monthly_cap | **built differently** | src/lib/voice/fallback-server.ts, src/lib/voice/tools-server.ts, src/lib/sms/alerts-run.ts, src/app/account/notifications/SmsSection.tsx | Outside both caps and outside sms_messages; copy not updated. Business decision needed. |
| Reveal analysis emails / PDF, deep-search result notice, resume after top-up | **built differently** | src/app/welcome/reveal/actions.ts, src/lib/billing/resume-server.ts, src/lib/sourcing-demand/member-search.ts | No email or text at all; results are in-app. Nothing to cap. |
| 22f "see what a landlord gets" email | **built differently** | src/app/lead-form-sample/page.tsx | A sample page linked from the management page; no email is sent or claimed. |

**E weekly active**

| Item | Status | File | Note |
|---|---|---|---|
| Batch 22f: mc_signup, mc_pack_paid, funnel_live as record-only activity kinds | **built differently** | src/lib/meta/events.ts | mc_signup and funnel_live are activity kinds; mc_pack_paid is a Meta event only — the pack shows in the log as starter_pack (counts) plus funnel_setup_step:0 {pack: bought} (record-only, dedupe collides with 'not now') |

**F product direction**

| Item | Status | File | Note |
|---|---|---|---|
| The reveal, Part F and Today give the same ranking | **partly built** | src/lib/intelligence/view-server.ts:118; src/lib/intelligence/what-if.ts:188-191 | Reveal = Today's stored list by construction (loadTodayView). Part F counts through the same rankForMember/admissible checks but its 'best' is band-then-fit, not Today's tailoredOrder; Browse ('deals picked for you', 22e) ranks without 22c's lift. |
| … and the same deal-type mix (Batch 17's helper) | **partly built** | src/lib/today/choose-day.ts:108-111; src/lib/intelligence/what-if.ts:177-202 | Today and the reveal (one stored list) use mixSlots/fillMix with today_mix. Part F counts all chosen types together and picks one 'best' with no mix (a count, not a list). |
| One definition of the 'deals I checked' count | **built differently** | src/lib/today/choice.ts:31; src/app/today/page.tsx:154; src/lib/home/server.ts:118 | Three: poolTally.checked (reveal/view/chip, copied to signup_reveals), Today's header (mustMatches or countDealsAcross), Home's member_scanned. The quiz status line is not built (PR #121 says so). |
| One definition of the Part F what-ifs | **partly built** | src/lib/intelligence/what-if.ts:71; src/app/today/page.tsx:134 vs src/lib/intelligence/view-server.ts:199 | One variant list and one component, but the 'show them' rule differs (Today: near miss only; reveal/view: near miss, low match or no cards) and the Change-my-budget link ignores brrr_budget. |
| Nav is Today · My deals · Account (+ Leads for funnel owners) | **built differently** | src/lib/nav.ts:1-41; src/components/AppSwitcher.tsx:62-66 | By decision (comment 'decided by Zac', Batch 22e): Eye · Home · Today · My deals · Browse · Market Explorer · Analyser · [Leads] · Account. nav.test.ts pins it. |
| The eye and the view add no nav item | **built differently** | src/lib/nav.ts:41 EYE_NAV; src/components/intelligence/HeaderEyeLink.tsx | By decision: the eye is the first header item ('Talk to Stayful Intelligence' / 'Talk') opening /intelligence; Home's eye links there too. |

**I conflicts and contracts**

| Item | Status | File | Note |
|---|---|---|---|
| Call types list as one enum shared by code and SQL | **built differently** | src/lib/voice/config.ts:13; supabase/schema.sql (si_calls_log_call_type_check) | CALL_TYPES in TS and a literal list in a rebuilt SQL check; context/opener/fallback also hard-code intro\|low_credit (finding 5). |
| Queue with the one-a-day rule reusable by Batch 25 'unchanged' | **partly built** | src/lib/voice/queue-server.ts, eligibility.ts, fallback-server.ts | The one-a-day/in-flight indexes and eligibility are generic; context, fallback texts, cap slot on a missed call and per-type uniqueness are not (finding 5). |

**Walk 1: new member**

| Item | Status | File | Note |
|---|---|---|---|
| Batch 22: welcome price on the reveal's deals (first tap) | **partly built** | src/app/welcome/reveal/page.tsx:55-59 | Rules and charge are right; the reveal's first paint prices before the row exists, so the price shows only on a reload and the first tap returns price_changed |
| Batch 22: "price after top-up" while short of credit | **missing** | src/components/intelligence/RevealAnalyses.tsx:176-187 | The PR says not built; RevealAnalyses shows the plain price and only the tap changes |
| Batch 23: low-credit call trigger (80% within 7 days, at £5) with auto top-up link | **built differently** | src/lib/voice/low-credit.ts:37-43 | The welcome £20 is not a landing, so it cannot fire for pre-pack members; a temporary block (first_days/no_number/intro_day) consumes the landing's one call |

**G code health**

| Item | Status | File | Note |
|---|---|---|---|
| What a member sees when ElevenLabs, Twilio, Anthropic or a data provider is down during the reveal or a call | **partly built** | src/lib/voice/fallback-server.ts, queue-server.ts, webhook-server.ts, run.ts | Reveal, narrator, Stripe and Resend paths degrade cleanly; the call paths have four gaps: 22p charged on a Twilio 5xx/timeout, an intro lost on an ElevenLabs failure, no fallback on a 'failed' call (notice suppressed), and no per-pass time budget in the calls cron |
| CI: runs on PRs to main; schema job covers 22c–22f; 22e SQL check step present | **partly built** | .github/workflows/ci.yml | Runs on every pull_request and push to main; whole schema.sql twice (so 22c–22f idempotency proven); scan-days-smoke (22e) step at lines 73–74; credit-smoke asserts 22f + 23; nothing asserts 22c/22d; no build or audit step |


## 6. Conflicts between batches, and the contracts Batches 24–26 will reuse

### 6.1 Two batches writing the same rows or settings differently

Every reader's conflict rows, as reported (duplicates between readers are left in so each reader's reasoning is visible; the fix plan merges them).

**From B1 money: charge paths**

- **PMI add-on price on a report** [Batch 22 (pmi-addon.ts first_pmi offer) vs Batch 17's src/app/reports/[id]/page.tsx (label unchanged)]
  - *What:* The server charges the first-time price; the page labels the list price; quoteMatches refuses every first-timer.
  - *Files:* src/app/reports/[id]/page.tsx:41; src/lib/analysis/pmi-addon.ts:92-95
  - *Impact:* Add-PMI from a report is broken for every account without a Deep report.
  - *Suggestion:* Price the label with offeredPmiAddonFor (finding 2).
- **Call minute price source** [Batch 22 (billing_settings si_call_pence_per_min) vs Batch 23 (unit_costs si:call_minute)]
  - *What:* Two definitions of the minute price; only the unit row is used.
  - *Files:* src/lib/intelligence/settings.ts:91,120; src/lib/credit/costs.ts (seed); src/lib/voice/charge-server.ts:36-39
  - *Impact:* A dead setting that looks like the price; README §19 says the unit row.
  - *Suggestion:* Delete one (finding 6).
- **Full analysis price** [Batch 10 seed (400) unchanged by Batch 22 vs the R2 brief (£5)]
  - *What:* Brief and PR title say £5; code and live say £4.
  - *Files:* supabase/schema.sql:3459; src/lib/credit/deal-pricing.ts:52
  - *Impact:* Every derived price (Deep, first Deep, welcome) is £1 under the brief; Batch 24–26 prompts and the SI knowledge should state one figure.
  - *Suggestion:* Zac decides; then change the live row + seed + fallback together (finding 1).
- **Funnel price shown vs charged while 22f's schema is not applied** [22f code (deployed) vs 22f schema (not run on live)]
  - *What:* Defaults show tiers; pricingFor says legacy without funnel_tiers_from.
  - *Files:* src/app/(marketing)/for-management-companies/page.tsx:41-147; src/lib/funnels/tiers.ts:186
  - *Impact:* New management companies are quoted £5.00 and metered at funnel_markup until the section runs.
  - *Suggestion:* Run the section; guard the page on tiersFrom (finding 5).
- **first_deep unit** [Batch 22 offers.ts comment ('paying account') vs its own queries/index (buyer_id) vs the brief ('once per member')]
  - *What:* Read is by payer id against a buyer_id column; index is per buyer.
  - *Files:* src/lib/analysis/offers-server.ts:43-44; supabase/schema.sql analysis_purchases_first_deep_uidx
  - *Impact:* Teams can claim several first-time prices on one account.
  - *Suggestion:* Pick per-account or per-member and align read + index (finding 8).

**From B2 money: charge twice**

- **Two definitions of the call's per-minute price** [22 (choices) vs 23 (calls)]
  - *What:* Batch 22's choices screen and call box read billing_settings.si_call_pence_per_min (settings.ts:91, choices.ts:10,15); Batch 23's charge and the SI view read the si:call_minute unit row (charge-server.ts:36-39, costs.ts:104, view-server.ts:192). They agree at 65p only because both are seeded that way.
  - *Files:* src/lib/intelligence/choices.ts, src/lib/intelligence/settings.ts, src/lib/voice/charge-server.ts, src/lib/credit/costs.ts, src/lib/intelligence/view-server.ts
  - *Impact:* An admin edit to either silently diverges what members consent to from what they pay (F2)
  - *Suggestion:* callPencePerMinute() returns the billing_settings value; the unit row is used for raw cost only
- **debitFace (flat charges) vs the reservation model (metered actions)** [23 vs 22 / 22f / 21a]
  - *What:* Batch 22's analyses and deep search, and 22f's funnel holds, reserve credit through credit_reserve/credit_available (grants minus open reservations). Batch 23 charges calls, texts and emails through credit_debit_face, which checks grants only (schema.sql:1844-1846) and caps at totalPence (charge-server.ts:90). The seat charge (pre-R1) has the same shape but is small and hourly; calls are member-facing and frequent.
  - *Files:* supabase/schema.sql (credit_debit_face, credit_available), src/lib/voice/charge-server.ts, src/lib/voice/member-server.ts, src/lib/analysis/deal-analysis.ts, src/lib/sourcing-demand/member-search.ts
  - *Impact:* A call can take reserved credit; the reserved debit then overdrafts (analysis, funnel lead) or is forfeited (deep search) (F1)
  - *Suggestion:* Subtract open reservations in credit_debit_face and cap/eligibility at spendable; Batch 25's deal calls will inherit whichever is chosen
- **Overdraft never again (R1 Q1/21a/21b) vs allow_negative on delivered work** [21a/21b vs 22 / 22f / 23]
  - *What:* 21a forgave every overdraft and 21b stops pack-era accounts overdrawing on reservations; but deal-analysis.ts:625 (allowNegative: true) and 22f's funnel_lead_charge (credit_debit ..., true, ...) still create 'overdraft:<user>' grants whenever a concurrent debit bypassed the reservation.
  - *Files:* src/lib/analysis/deal-analysis.ts, supabase/schema.sql (funnel_lead_charge), src/lib/credit/http.ts
  - *Impact:* Overdraft rows reappear for members and funnel owners after a call (F1); with CREDIT_ENFORCE off they reappear routinely
  - *Suggestion:* Fixing F1 removes the bypass; keep allow_negative as the last resort for delivered work and surface overdraft rows on /admin/billing
- **'First deep report' scope** [22 (Part H) vs the brief]
  - *What:* Brief says once per member; offers.ts:123 says once per paying account; the index is per buyer_id (member) while hadDeepReport filters buyer_id = payerId (the owner's own purchases)
  - *Files:* src/lib/analysis/offers-server.ts, src/lib/analysis/offers.ts, supabase/schema.sql
  - *Impact:* Team seats: denied when the owner had one, granted again when another seat had one (F5)
  - *Suggestion:* Pick one scope and align the pre-check and the index
- **Later batches reusing the call charge path** [23 → 25]
  - *What:* Batch 25's deal calls are told to reuse enqueueCall/placeCall/chargeCallMinutes unchanged; they inherit the totalPence cap and eligibility (F1) and the two-price split (F2)
  - *Files:* src/lib/voice/queue-server.ts, src/lib/voice/charge-server.ts, src/lib/voice/eligibility.ts
  - *Impact:* Each new call type widens the window in which reserved credit is taken
  - *Suggestion:* Fix F1/F2 in the shared path before 25 builds on it

**From C1 privacy: who sees what**

- **Management stamp vs Start again** [22f × 22d]
  - *What:* managementOnly = stamped && !mandatoryDone. 22d's reset clears the mandatory answers, so any investor who was ever stamped (one tap on Account's 'Get leads with your own branded form') and leaves the re-run quiz unfinished becomes management-only: no quiz/reveal gate, sign-in lands on /leads, low-credit call skipped as management_no_deals.
  - *Files:* src/lib/management/stamp.ts (managementOnly), src/lib/profiles/server.ts resetActiveProfile, src/components/AppShell.tsx, src/proxy.ts, src/lib/voice/eligibility.ts
  - *Impact:* Existing investors silently reclassified; calls and daily-deal gates switched off for them.
  - *Suggestion:* Tie managementOnly to how the account was stamped (first_touch/start/quiz with no prior answers) or clear the stamp when deal-finding switches on; make the stamp a POST.
- **The eye vs the management bypass** [22e × 22f]
  - *What:* AppShell skips requireProfileStart for stamped accounts, but the eye it draws on the Leads header links to /intelligence, which calls requireProfileStart directly and sends the account to the investor quiz.
  - *Files:* src/app/intelligence/page.tsx, src/components/AppShell.tsx, src/app/leads/layout.tsx
  - *Impact:* Lead-form customers dropped into the investor quiz from their own header.
  - *Suggestion:* Reuse AppShell's branch in /intelligence, or hide the eye for management-only accounts.
- **Own-finds visibility vs the search slice's member context** [22 (Part G) × 22 (Part B/F)]
  - *What:* tier.ts gives a free member their finds at once, but member-search.ts computes that visibility before the finds exist and reuses it for strongNow and refreshTodayAfterSearch.
  - *Files:* src/lib/sourcing-demand/member-search.ts, src/lib/today/selection.ts, src/lib/marketplace/tier.ts
  - *Impact:* Finds never reach the reveal/Today for free members; the stop-at-strong-match rule cannot fire on a find.
  - *Suggestion:* Refresh the member context (or splice the new find ids into ownFinds) before ranking.

**From C2 safety: calls and texts**

- **Batch 25 deal calls reusing 'the queue with the one-a-day rule'** [23 → 25]
  - *What:* Appending 'deal' to CALL_TYPES is not enough: placeCall hardcodes context = intro|low_credit (queue-server.ts:158), CallContext has no 'deal' (variables.ts:273), sendMissedCallFallback and missedCallText/missedCallEmail accept only intro|low_credit (fallback-server.ts:25, templates.ts:54-62, 76), EligibilityInput.type is typed from CALL_TYPES, the schema check constraint must be rebuilt (schema.sql:6238), and a per-deal trigger_ref would inherit the 'blocked row consumes the trigger' behaviour of the low_credit index if a similar index is added
  - *Files:* src/lib/voice/queue-server.ts, agent/variables.ts, fallback-server.ts, templates.ts, eligibility.ts, supabase/schema.sql
  - *Impact:* Batch 25's prompt will under-estimate its surface; a deal call missed outside the fallback's type list sends no text/email
  - *Suggestion:* Tell Batch 25 to touch all six places and to decide whether blocked deal calls should consume their trigger
- **Batch 20's £5 email vs Batch 23's low-credit call** [20 ↔ 23]
  - *What:* When the trigger fires outside hours the call is queued for the next opening and called:false lets the £5 email go the same evening (low-credit-server.ts:232, after-debit.ts:130-150); if the next-morning call is missed, a second 'nearly out of credit' email and a text follow (fallback-server.ts). Not the same day, so the brief's rule holds, but the member can get three low-credit notices in 14 hours
  - *Files:* src/lib/credit/after-debit.ts, src/lib/voice/low-credit-server.ts, src/lib/voice/fallback-server.ts
  - *Impact:* Noise, and the queued call can be stale by morning (finding 2)
  - *Suggestion:* If the call is queued for tomorrow, either skip tomorrow's call (the email was the notice) or suppress the fallback email for a call whose £5 email already went
- **Batch 8 inbound keyword handling vs Batch 23 auto-replies** [8 ↔ 23]
  - *What:* Every non-keyword text to the one number is now answered and charged (finding 6); 'YES' is a START keyword (keywords.ts:20), so a member replying 'yes' to the agent's auto top-up offer by text is treated as START and never reaches replyToText or the team; Batch 8's route comment still says only the keyword is stored, while Batch 23 stores the whole text for 90 days and emails it
  - *Files:* src/app/api/twilio/inbound/route.ts, src/lib/sms/keywords.ts, src/lib/voice/sms-replies-server.ts
  - *Impact:* Unexpected charges; a 'yes' reply silently re-enables texts instead of being passed on; privacy copy drift
  - *Suggestion:* Decide whether replies are free; mention replies in the alert copy; update the route comment and privacy wording
- **Two writers for profiles.si_calls (consent record)** [22 ↔ 23 ↔ 21e]
  - *What:* setSiCalls (consent.ts) is the intended sole writer (consent row, verified-number check, intro trigger), but 'si_calls' is a registry key and /api/notify/unsubscribe/[token] turns off SWITCHES_BEHIND[kind] through setNotification for an si_call send (cap.ts:59, unsubscribe route:55) — reachable only with a token for an si_call send row, which the missed-call email never carries today
  - *Files:* src/lib/intelligence/consent.ts, src/lib/notify/cap.ts, src/app/api/notify/unsubscribe/[token]/route.ts
  - *Impact:* If a later batch adds an unsubscribe link to call emails, calls would switch off with no si_call_consents row and no si_calls_changed_at
  - *Suggestion:* Route 'si_calls' in the unsubscribe handler through setSiCalls, or keep si_call out of SWITCHES_BEHIND
- **UK day vs UTC day** [21e ↔ 23]
  - *What:* The one-call-a-day rule is a Europe/London day (hours.ts:104), while the message cap's day is UTC (cap.ts capDay) and the call claims the UTC-day slot (cap-server.ts); in BST a call at 00:30 UK on Tuesday takes Monday's cap slot
  - *Files:* src/lib/voice/hours.ts, src/lib/notify/cap.ts, src/lib/voice/cap-server.ts
  - *Impact:* Edge only (calls are 9-19 UK, so no real overlap today); matters if the window is widened on /admin/calls
  - *Suggestion:* Note for area D; no change needed while the window stays inside the UTC day

**From D1 crons and queues**

- **The call queue Batch 25 is told to reuse** [23 → 25]
  - *What:* enqueueCall/placeCall exist with the one-a-day rule, but a call's identity is tied to ElevenLabs' conversation id and Twilio SID only (no own call_id on the call): a deal call placed by Batch 25 inherits the lost-ids failure above unless call_id is added to the dynamic variables first.
  - *Files:* src/lib/voice/queue-server.ts, src/lib/voice/agent/variables.ts, src/lib/voice/store-server.ts
  - *Impact:* Every outbound call type
  - *Suggestion:* Fix in R2 before Batch 25 builds on the queue

**From D2 messages and the cap**

- **The £5 low-credit notice vs the low-credit call** [Batch 20 (21e) vs Batch 23]
  - *What:* Both act on profiles.last_low_balance_email_at but only Batch 23's after-debit path reads the call before the email; the morning senders stamp 'told' with no knowledge of calls and the cron dials queued calls with no knowledge of the stamp. Batch 23's row is stamped at 'ringing' and never cleared on 'failed'.
  - *Files:* src/lib/credit/after-debit.ts, src/lib/credit/low-credit-server.ts, src/lib/listing/picks-run.ts, src/lib/notify/digest-run.ts vs src/lib/voice/low-credit-server.ts, src/lib/voice/queue-server.ts, src/lib/voice/run.ts
  - *Impact:* Email + call (+ missed-call text and email) the same day; or nothing for 30 days after a failed call.
  - *Suggestion:* One owner of the decision: a shared `lowCreditNoticeState(userId, landing)` read by both the morning senders and maybeQueueLowCreditCall/placeCall, stamping told only when a call settles (answered/missed/voicemail) or an email is sent.
- **Two records of texts** [Batch 8 vs Batch 23]
  - *What:* Batch 8 defined sms_messages as the record of every text (price backfill, STOP history, admin views) and notification_sends channel 'sms' as the one-a-day/monthly cap; Batch 23's texts are recorded only as charges and house spend.
  - *Files:* src/lib/sms/store.ts (sms_messages, notification_sends channel 'sms') vs src/lib/voice/fallback-server.ts, tools-server.ts, sms-replies-server.ts (si_call_charges + provider_calls)
  - *Impact:* Caps and the Notifications copy no longer describe all texts; Twilio prices for call texts are never backfilled.
  - *Suggestion:* Batch 23 texts insert an sms_messages row (kind 'call') and either share or explicitly exclude the Batch 8 caps, with the Texts section reworded.
- **Cap override timing vs the morning crons** [Batch 6 (cap) vs Batch 23 (cron every 5 min from 9am UK)]
  - *What:* The cap comment assumes morning emails precede 9am calls; in BST 9am UK is 08:00 UTC, before the 08:10 digest and 08:20 letter.
  - *Files:* src/lib/voice/cap-server.ts, vercel.json (si-calls */5, daily-digest 10 8, picks-paused 20 8)
  - *Impact:* Digest-reliant members lose their daily email on summer call days.
  - *Suggestion:* Claim the slot only after 08:30 UTC, or start outbound dialling at max(9am UK, 08:30 UTC).
- **What Batch 25's deal calls will reuse** [Batch 23 → Batch 25]
  - *What:* The 'queue with the one-a-day rule' exists (DB indexes + checkEligibility) but 'the day's email moves to the next day' is only a post-dial slot claim at any hour, and a queued call is never re-validated against its trigger before dialling (see the top-up finding).
  - *Files:* src/lib/voice/queue-server.ts (enqueueCall/placeCall), eligibility.ts, cap-server.ts
  - *Impact:* A Batch 25 deal call queued overnight would likewise be dialled after the deal went or the member already acted, and would eat the morning digest in summer.
  - *Suggestion:* Before Batch 25: give placeCall a per-type `stillWanted(call, member)` hook (low_credit: balance ≤ £5 and not told; deal: deal still live and unopened) and move the slot claim behind the 08:30 UTC rule.

**From E weekly active**

- **Which page views count as weekly active** [21f vs 22e]
  - *What:* 21f (R1 E1, Q15) made the quiz page reached by redirect record-only ('a redirect is not the member doing something'); 22e made Home, where every login now lands, a counting view (home_view inApp) while keeping the Stayful Intelligence view (si_view) record-only.
  - *Files:* src/lib/activity/kinds.ts:36-37,110-114,192; src/lib/activity/home-only.ts
  - *Impact:* Weekly active again includes members who only signed in; the 'Home only' admin row exists to measure it.
  - *Suggestion:* Zac decides (default per E1's reasoning: home_view record-only); record the decision beside Q15 in the README.
- **Consent records for calls** [22 (choices, Account) vs 23 (calls)]
  - *What:* Batch 22's setSiCalls is the one writer of si_call_consents and of the notification_settings activity for calls, but it writes both on every call whether or not the switch changed; the choices screen (verify-inline then Continue) and the Account switch can both call it twice for one decision. Batch 23 reads si_calls / si_call_consents as the consent proof.
  - *Files:* src/lib/intelligence/consent.ts:38-45; src/app/welcome/choices/CallBox.tsx:13; src/app/welcome/choices/actions.ts:40; src/app/account/notifications/actions.ts:26
  - *Impact:* Duplicate consent rows and duplicate counting events; no wrong call (the intro trigger is idempotent).
  - *Suggestion:* Guard setSiCalls on an actual change (also area C).
- **Where a batch's record-only events are written** [22f vs log.ts (Batch 9/21)]
  - *What:* log.ts's contract (logActivity in a page/action, recordActivity after the response) is followed by 22, 22c, 22d and 22e; 22f awaits recordActivity in actions, a route and a page render.
  - *Files:* src/app/leads/setup/actions.ts:31,40,48,82; src/app/leads/setup/page.tsx:35; src/lib/management/stamp-server.ts:55
  - *Impact:* Latency only (record-only kinds attach the same way); Batch 24–26 prompts that say 'through logActivity' should expect this pattern in 22f's files.
  - *Suggestion:* Switch to logActivity in the request paths.
- **Later batches reusing the activity registry** [22 → 26]
  - *What:* Batch 26 (Stayful Intelligence chat) is told to reuse si_view's surface/step tokens: STEPS is a closed list in src/components/intelligence/actions.ts ('open','question','show_me','deep_line') and SURFACES ('header','reveal','today'); 'Use this' already overloads 'show_me'.
  - *Files:* src/components/intelligence/actions.ts:7-8; src/components/intelligence/what-if-actions.ts:37
  - *Impact:* Batch 26 will need to extend both lists (and the brief's rule that a chat question is record-only should be stated in its prompt).
  - *Suggestion:* Add 'use_this' and 'undo' now; tell Batch 26 to add 'chat' surface/steps rather than reuse 'question'.

**From F product direction**

- **22c return-on-cash lift vs 22e Browse 'deals picked for you'** [22c (#126) vs 22e (#128)]
  - *What:* 22c put the lift inside rankForMember only; 22e made Batch 14's bestForYouOrder (which re-derives fit from blendFit + motivation lift) the default Browse list. Two orders for the same profile.
  - *Files:* src/lib/listing/rank.ts:126; src/lib/tailoring/browse.ts:105
  - *Impact:* Today/reveal/email order purchases by return on cash; Browse does not.
  - *Suggestion:* Browse adds returnOnCashLift from the row's figures (finding) or bestForYouOrder is rebuilt on rankForMember's output.
- **Part F trigger on Today vs the reveal/view** [22 (#121) within itself (Part F on two surfaces)]
  - *What:* revealTone (near miss | <reveal_low_match_pct | no cards) decides on the reveal; selection.nearMiss alone decides on Today.
  - *Files:* src/app/today/page.tsx:134; src/lib/intelligence/view-server.ts:158,199
  - *Impact:* The same member sees what-ifs on the reveal and none on Today for a low-match or empty day.
  - *Suggestion:* One helper deciding 'what-ifs wanted' used by both pages.
- **Primary (22) vs active (13) profile on one screen** [22 (#121) vs 13; 22d (#127) Start blank makes a second profile easy]
  - *What:* Reveal cards/what-ifs = primary; level, Use this, Undo, re-choose = active.
  - *Files:* src/lib/intelligence/view-server.ts:95; src/components/intelligence/what-if-actions.ts:29; src/lib/tailoring/server.ts:288
  - *Impact:* Same profile for a brand-new member; diverges only with ≥2 profiles on the reveal's day.
  - *Suggestion:* Pass the surface to applyWhatIfAction, or let the reveal read the active profile and keep primaryOf for the signup search and Batch 25.
- **What later prompts should reuse (Batches 24–26)** [24, 25, 26 prompts vs main]
  - *What:* Part F function = whatIfViewFor(member: MemberContext, now) → {items, none} (needs intelligenceMember(user, mode) first; variants: whatIfChanges + whatIfResults). Count function = checkedCountFor(profileId, now) → StoredChoice {checked, meeting, capped, nearby, finds} and checkedLine(); Home's memberScanned(member, now) is the different 'scanned since joined' figure. Primary profile = primaryOf/primaryProfileFor(userId); active = activeProfileFor. Nav destinations = NAV_DESTINATIONS (home, today, marketArea, deal, myDealsStage, analyser). Strong match = isStrongMatch (never stored).
  - *Files:* src/lib/intelligence/what-if-server.ts:17; src/lib/today/selection.ts:180; src/lib/profiles/rules.ts:240; src/lib/home/server.ts:113; src/lib/nav.ts:135
  - *Impact:* A Batch 25/26 prompt that expects one 'count function' or a what-if function taking a userId will not find that shape.
  - *Suggestion:* Name these signatures in the prompts; add the strong-match write before Batch 24's learning loop reads signup_reveals.

**From H gap check**

- **'Member searches on' has two definitions** [22 (Part F) vs 22 (Part G)]
  - *What:* src/lib/intelligence/what-if-server.ts:20 reads process.env.MEMBER_SEARCH_ENABLED directly while every other caller uses memberSearchEnabled() (sourcing-demand/member-search.ts:73); the what-if line is also keyed on the flag rather than the member's own search status that view-server.ts already loads.
  - *Files:* src/lib/intelligence/what-if-server.ts; src/lib/sourcing-demand/member-search.ts; src/lib/intelligence/view-server.ts
  - *Impact:* Two places to change when the flag moves; a wrong 'I'm searching your area' promise for members with no search (finding 2).
  - *Suggestion:* Pass `searching` into whatIfViewFor from searchStatusFor(userId).running and delete the env read.
- **Two writers switch calls on at the welcome screen** [22 Part C (choices) vs 22 Part C (VerifyNumber)]
  - *What:* verifySmsCodeAction (purpose=calls) calls setSiCalls(…, true, 'welcome') and finishChoicesAction calls it again when the box is ticked; CallBox's local state ignores the first, so the box and the stored choice disagree and a second 'on' consent row can be written for one decision.
  - *Files:* src/app/welcome/choices/CallBox.tsx; src/app/welcome/choices/actions.ts; src/app/account/notifications/sms-actions.ts
  - *Impact:* Member sees an unticked box with calls on; cannot turn them off from the screen; duplicate consent rows (finding 1).
  - *Suggestion:* One writer: let verification only verify (textsOn:false) and let finishChoicesAction write on/off from the box, or sync the box from props and add the 'off' branch.

**From I conflicts and contracts**

- **'Shown' records** [22, 22c, 22d, 22e]
  - *What:* Batch 22 stores what a choice read in profile_today_lists.choice ({checked, meeting, capped, nearby, finds, fp, answeredAt}), written only by the request whose list won the upsert; rechooseAllowed refuses a re-choose with the same fingerprint or older answers. Replaced cards from a search refresh go to profile_today_lists.shown_ids (Today's excludedFor reads them); the reveal's 3 deals go to signup_reveals.deal_ids/shown_ids (the picks run's revealedFor reads them; addRevealShown never runs). 22d's reset_search_profile clears market_goals, saved_areas, profile_quiz.answered, filter_modes and hides tracked entries; it does NOT touch signup_reveals, profile_today_lists, today_selections or deal_reactions, so every deal ever shown or answered stays excluded from Today after a reset (excludedFor has no restart cutoff) while learning (feedback.ts:33-34, picks-run.ts:401-405, tailoring/server.ts:175-201, selection.ts:417) restarts at the latest profile_restarts row. 22e's Home reads the stored list only. 22c's lift is at choose time only; stored lists are never re-ordered.
  - *Files:* src/lib/today/choice.ts, src/lib/today/selection.ts:148-152/209-262/330-399, src/lib/intelligence/reveal-server.ts:144-158/209-226, src/lib/listing/picks-run.ts:827-835, supabase/schema.sql (Batch 22d reset_search_profile), src/lib/home/server.ts:136-172, src/lib/listing/rank.ts:126
  - *Impact:* Consistent today. After a reset a member never sees a previously shown or passed deal on Today even with new criteria (by Batch 14's rule, not 22d's); the two shown_ids columns and the dead addRevealShown are a trap for Batch 24/25 (finding 11).
  - *Suggestion:* Say in the 22d docs that a reset does not bring shown/passed deals back; fix or delete addRevealShown and correct the schema comment; give later batches one helper ('shownToMember(userId, profileId)') that unions both columns.
- **Consent records** [8, 19, 22, 23]
  - *What:* Calls: profiles.si_calls + si_calls_changed_at + a si_call_consents row ('on'|'off', 'welcome'|'settings', version 'si-calls-2026-10') — written by setSiCalls only (today). Cookies: Batch 19 consent_records, untouched. Daily email off: the registry's sourcing_opted_out_at stamp, no row (22 says so). Texts: sms_contacts (verified_at, enabled, stopped_at, consent_source 'signup'|'account'); verifying for calls passes textsOn:false so the four alert switches stay off; Batch 23 reads verified/stopped but not enabled.
  - *Files:* src/lib/intelligence/consent.ts:34-56, src/app/account/notifications/sms-actions.ts:88-106, src/lib/sms/verify-server.ts:116-162, src/lib/notifications/registry.ts:195-202/352-356, src/lib/voice/member-server.ts:38-65, src/lib/sms/choose.ts:51
  - *Impact:* Four stores, four shapes; Batch 24's learning loop has si_call_consents only. The 'Texts: Off' switch does not stop SI texts (finding 3); the choices screen can write two consents (finding 7); setNotification can bypass setSiCalls (finding 8).
  - *Suggestion:* Make setNotification refuse 'si_calls'; add enabled to numberOk; de-duplicate on the choices screen; tell Batch 24 that call consent = si_call_consents and texts consent = sms_contacts.consent_*.
- **Notification settings** [1/6, 22, 22f, 10 (schema backfill)]
  - *What:* The registry's columns are written by setNotification/setNotifications (opt-out stamp for daily_picks). 22's choices screen uses them. 22f writes profiles.sourcing_alerts=false directly, deliberately without the stamp. The Batch 10 backfill (every schema run) and leads/provision both read 'false + no stamp + never sent' as 'never chose' and flip it back on.
  - *Files:* src/lib/notifications/registry.ts, src/lib/notifications/server.ts, src/app/welcome/choices/actions.ts:22-30, src/lib/management/stamp-server.ts:47-52, supabase/schema.sql:1056-1060, src/app/api/internal/leads/provision/route.ts:129
  - *Impact:* Finding 1 (High): management accounts get the investor daily email and, once they answer the quiz, picks ticked and charged.
  - *Suggestion:* Guard the backfill (and provision) with signup_path is null, or write the stamp and un-tick the switch on the choices screen for management accounts.
- **The message cap** [6, 20, 21e, 23]
  - *What:* A placed call or a missed-call fallback claims the day's daily slot as kind 'si_call' (null unsubscribe token) and goes anyway if the slot is used; later capped emails (deal_changes, low_credit alone, picks_paused) then go tomorrow; the 07:00 picks and 08:10 digest usually precede 9am calls. The low-credit call pre-empts Batch 20's email only when it is placed inside the same afterDebit.
  - *Files:* src/lib/notify/cap.ts:79-108, src/lib/voice/cap-server.ts, src/lib/voice/queue-server.ts:208-209, src/lib/voice/fallback-server.ts:279, src/lib/credit/after-debit.ts:262-299, src/lib/voice/low-credit-server.ts
  - *Impact:* Finding 2: a call queued for later the same day lets the £5 email go first (GMT) or cancels that day's Today's 5 (BST).
  - *Suggestion:* Treat 'queued for today' as the day's notice, or hold the alone-email until the call's outcome.
- **22f's call skip vs 23's intro once ever** [22f, 23]
  - *What:* management_no_deals is a skip: no row at enqueue, a queued intro is deleted at dial time; the once-ever index is untouched; the cron's owed list re-tries every 5 minutes and places the intro once the three questions are answered (isManagementOnly false).
  - *Files:* src/lib/voice/eligibility.ts:58-66, src/lib/voice/queue-server.ts:80-87/113-121, src/lib/voice/run.ts:53-96, src/lib/management/stamp-server.ts:161-165
  - *Impact:* Works as claimed. Side effect: perpetual re-evaluation and no admin visibility for waiting intros (finding 9).
  - *Suggestion:* Record a 'waiting' row or filter the owed query.
- **Login landing** [21h, 22, 22e, 22f]
  - *What:* postAuthPath: ?next wins; else /leads for a management-only account, else /home. The reveal gate runs inside AppShell on /home and /leads; revealNext → choices → next; /upgrade back → Home; team join → Leads or Home; resume-after-top-up fallback → /today (odd one out).
  - *Files:* src/lib/auth/landing.ts:233-253, src/app/(auth)/actions.ts:54, src/app/auth/callback/route.ts:41-42, src/app/auth/confirm/route.ts:38/46-47, src/proxy.ts:49-50, src/lib/intelligence/reveal.ts:41-45, src/app/upgrade/page.tsx:42-43, src/lib/billing/resume-rules.ts:80, src/components/AppShell.tsx:78-82
  - *Impact:* Consistent except resumeReturnPath (finding 12). A management-only account with ?next=/today reaches /today ungated (by design: no quiz in front of app pages).
  - *Suggestion:* Default resumeReturnPath to HOME_PATH.
- **22d's reset vs reveal_from** [22, 22d]
  - *What:* 'No reveal after a reset' = the quiz's revealHref guard (hasRestartFor) + no signup search; AppShell's revealPending only checks viewed_at, which every reset member already has; a pre-reveal_from member never qualifies.
  - *Files:* src/app/welcome/page.tsx:86-87, src/lib/profile/server.ts:349-351, src/lib/intelligence/reveal-server.ts:112-138, src/app/welcome/reveal/page.tsx:46-53, src/lib/profiles/server.ts:452-457
  - *Impact:* Clean.
  - *Suggestion:* None; note that /welcome/reveal typed directly on the same UK day as the first view re-renders harmlessly.
- **Budget brackets** [22, 22c, 22f (leads)]
  - *What:* u100 / 100-200 / legacy u200 agree everywhere; what-if steps u200 up to 200-350; the lead form maps ≤100k → u100 and ≤200k → 100-200.
  - *Files:* src/lib/market/filters.ts, src/lib/listing/sourcing.ts:113-156, src/lib/intelligence/what-if.ts:62-68, src/lib/market/lead-goals.ts:53-80, src/lib/profile/questions.ts:198-199, src/app/markets/_components/explorer/v2/find/FilterBar.tsx:64-65
  - *Impact:* Consistent. Edge: a lead whose 'up to £100,000' maps to u100 while inBudget('u100') is strictly < 100,000.
  - *Suggestion:* Decide whether exactly-£100k is 'Under £100k' and make inBudget/budgetBounds/budgetFrom agree on the boundary.
- **HOME_PATH vs the emails' /today links** [6, 20, 22e]
  - *What:* Emails and texts link /today (or the profile switch route); login with no ?next lands on /home.
  - *Files:* src/lib/notify/message.ts:428-436, src/lib/notify/week.ts:213, src/lib/email/billing.ts:119, src/lib/listing/picks-run.ts:1498, src/lib/notify/digest-run.ts:315
  - *Impact:* By design (22e: 'every email link unchanged').
  - *Suggestion:* None.
- **'Save all 3' vs hidden_tracked_deals vs the tracked list** [5, 22, 22d]
  - *What:* Keeps go to deal_reactions with the primary profile id; a reset hides by entry key; a later Keep/stage move un-hides (lastChangedAt > hidden_at); restore within 30 days.
  - *Files:* src/app/welcome/reveal/actions.ts:18-38, src/lib/profiles/reset.ts:63-117, src/lib/listing/tracked-server.ts:262-275/345-362
  - *Impact:* Clean.
  - *Suggestion:* None.
- **21e's £0 member vs 22's welcome price** [21b, 21e, 22]
  - *What:* The welcome price is offered, the purchase is refused at £0 (requireCredit for un-welcomed payers), the dialog opens with a resume intent; the 7-day window is from viewed_at.
  - *Files:* src/lib/analysis/offers.ts:91-118, src/lib/analysis/deal-analysis.ts:537/561, src/lib/credit/action.ts:48-70/87-93, src/components/intelligence/RevealAnalyses.tsx:53
  - *Impact:* Refuses, never overdraws. The PR admits the 'price after top-up' line is not built.
  - *Suggestion:* Build the 'after you top up it's £2.00' line or accept the dialog.
- **21b's shadowModeAllows vs 22's searches and 23's charges** [21b, 22, 23]
  - *What:* Signup search: house spend, no member debit. Deep search: credit_reserve refuses when spendable < up-to regardless of CREDIT_ENFORCE. Calls: debitFace (never negative) capped at the balance.
  - *Files:* src/lib/sourcing-demand/member-search.ts:464-466/546-553, supabase/schema.sql:742-757, src/lib/voice/charge-server.ts:108-156, src/lib/credit/ledger.ts:141-150
  - *Impact:* No path lets a pack-era account overdraw.
  - *Suggestion:* None.
- **Low-credit safety rules vs once-per-landing index** [23 (internal), relevant to 25]
  - *What:* A blocked low-credit row carries the landing's trigger_ref and satisfies the unique index; maybeQueueLowCreditCall never retries.
  - *Files:* src/lib/voice/eligibility.ts:69-78, src/lib/voice/queue-server.ts:80-87, supabase/schema.sql (si_calls_log_low_credit_uidx)
  - *Impact:* Finding 4.
  - *Suggestion:* Defer instead of block, or exclude blocked rows from the index predicate.

### 6.2 The contracts exactly as they are on main

Area I documented each shape a later batch is told to reuse — exports, signatures, tables, columns, the row shapes and the places that would need touching. Once the Batch 24–26 prompts are available, the mismatch comparison is made against this section; the known mismatches already found are R2-86 (the queue is not type-agnostic), R2-168 (no once-per-trigger guard for a new call type), R2-87 (no 'chat' question source), R2-92 (two 'shown' columns and dead code), R2-171 (two outbound-type lists), R2-170 / R2-195 (a 'Batch 23b' that is in no plan).

### Contracts exactly as on main (5d0ac80) — for the Batch 24–26 prompts

#### 1. The conversation log — `src/lib/conversations/log-server.ts` (server-only)
Tables (`supabase/schema.sql`, "Batch 23", lines ~6148–6196; all RLS on, 0 policies, service role only):
- `si_conversations(id uuid pk, channel text check in ('call','sms','chat'), user_id uuid null → profiles on delete set null, persona_version text, started_at timestamptz, ended_at timestamptz, transcript_purged_at timestamptz, created_at)`; indexes (user_id, started_at desc), (started_at desc).
- `si_conversation_turns(id bigint identity pk, conversation_id → si_conversations cascade, seq int, role text check in ('member','agent'), text text, at timestamptz, knowledge_ref text)`; unique (conversation_id, seq); text is sliced to 4000 chars.
- `si_conversation_questions(id uuid pk, conversation_id → cascade, question text 1–500 chars, outcome text check in ('answered','low_confidence','could_not_answer','member_unhappy','handed_off'), knowledge_ref text, source text default 'tool' check in ('tool','analysis','sms'), at timestamptz)`. **No 'chat' source (finding 6).**
Exports:
- `type Channel = 'call' | 'sms' | 'chat'`
- `startConversation({ channel, userId: string | null, startedAt?: Date }): Promise<string | null>` — stamps `PERSONA_VERSION`; null on failure (callers continue without a log).
- `interface Turn { role: 'member'|'agent'; text: string; at?: Date; knowledgeRef?: string | null }`
- `addTurns(conversationId, turns: readonly Turn[], fromSeq = 0): Promise<void>` — upsert on (conversation_id, seq) with ignoreDuplicates (idempotent per seq; a replay rewrites nothing).
- `recordQuestion(conversationId, { question, outcome: QuestionOutcome, knowledgeRef?, source?: 'tool'|'analysis'|'sms' }): Promise<void>`
- `hasOutcome(conversationId, outcome): Promise<boolean>` (true on read error).
- `closeConversation(conversationId, endedAt = now): Promise<void>` (only while ended_at is null).
`QuestionOutcome` / `QUESTION_OUTCOMES` live in `src/lib/voice/config.ts:60-61` and must mirror the SQL check.
Who writes turns today: `src/lib/voice/webhook-server.ts:finishCall` (the whole ElevenLabs transcript after a call, `at` = started_at + seconds; adds a `member_unhappy` question from data_collection when the agent did not log one, source 'analysis'); `src/lib/voice/sms-replies-server.ts:replyToText` (channel 'sms': the inbound text + the auto reply, question outcome 'answered' for "who is this?" else 'handed_off', source 'sms'). Questions during a call come from the agent's `log_question` tool (`tools-server.ts:logQuestion`, source 'tool') and `handoff_to_team` ('handed_off'). Conversation rows are opened by `queue-server.ts:placeCall` (outbound, before dialling) and `inbound-server.ts:answerInitiation` (callbacks, member or unknown).
Linking: `si_calls_log.conversation_id` → si_conversations. Admin list: `/admin/conversations` (`src/app/admin/conversations/page.tsx`, filters ?channel= and ?id=).
Retention: `src/lib/voice/retention-server.ts:purgeTranscripts({ apply, days, now?, limit? })` deletes turns for conversations with started_at < now − days and stamps transcript_purged_at; questions are kept. Run once a UK day from the si-calls cron (run.ts step 4, claim key `retention:<ukDay>` in si_webhook_events provider 'cron'), days = `si_transcript_retention_days` (90).

#### 2. The call types list — `src/lib/voice/config.ts`
- `CALL_TYPES = ['intro','low_credit','callback'] as const; type CallType`; `OUTBOUND_CALL_TYPES = ['intro','low_credit']` (declared, not read by run.ts).
- SQL mirror: `si_calls_log_call_type_check check (call_type in ('intro','low_credit','callback'))` rebuilt in a `do $$` block (schema.sql Batch 23) — a new type must rebuild it.
- Triggers: `intro` ← `setSiCalls(on=true)` → `after(onCallsSwitchedOn)` (`consent.ts:47-54`, `triggers-server.ts:94-103`) and the cron's step 1 catch-up (`run.ts:53-96`, every si_calls=true owner with a verified, not-stopped number and no intro row); `low_credit` ← `afterDebit` → `maybeQueueLowCreditCall` (`after-debit.ts:267/296`, `low-credit-server.ts`), trigger_ref = the latest credit landing's grant id (`low-credit.ts:latestLanding`); `callback` ← ElevenLabs conversation-initiation webhook (`/api/voice/elevenlabs/initiate` → `inbound-server.ts:answerInitiation`), direction 'inbound', never through the queue.
- `CALL_STATUSES = queued | ringing | answered | missed | voicemail | failed | blocked` (SQL check mirrors). `BLOCKED_REASONS` keys: daily_limit, first_days, intro_day, in_flight, no_number, no_credit, calls_off, not_owner, auto_topup_on, stale, management_no_deals (column is free text).
- `si_calls_log.context` (free text) values come from `CallContext` in `agent/variables.ts:21`: 'intro' | 'low_credit' | 'missed_intro' | 'missed_low_credit' | 'member' | 'unknown'; placeCall sets it from the type by a two-way ternary (finding 5).
- `CALL_TEXT_TEMPLATES = ['contact_card','auto_topup_link','resend_last_link']`; `CALL_TYPE_LABEL`; `TOOL_LIMITS`; `STALE_RINGING_MS` 30 min; `STALE_QUEUED_MS` 4 days; `CALL_MINUTE_UNIT = {provider:'si', unit:'call_minute'}`; `CALL_ACTION = 'si_call'`; env readers `voiceConfig()`, `callsEnabled()` (SI_CALLS_ENABLED==='true'), `callsDryRun()`, `webhookSecret()`, `initiateSecret()`, `toolSecret()`.

#### 3. The queue with the one-a-day rule — `src/lib/voice/queue-server.ts`
- `enqueueCall({ userId, type: 'intro'|'low_credit', triggerRef?, now? }): Promise<EnqueueResult>` where `EnqueueResult = {outcome:'queued', call: CallRow} | {outcome:'blocked', reason, call} | {outcome:'skipped', reason: BlockedReason|'disabled'|'unknown_member'} | {outcome:'exists'} | {outcome:'error'}`. Steps: callsEnabled → memberFacts (`member-server.ts`, below) → `checkEligibility` (`eligibility.ts`) with dayFacts; a SKIP reason (calls_off, not_owner, auto_topup_on, management_no_deals) or an intro with no_number/no_credit writes nothing; other failures insert a `blocked` row; otherwise inserts `queued` with `not_before` = now (inside hours) / nextOpening / nextDayOpening. A unique-index refusal returns 'exists' (or a blocked 'in_flight' row for non-intros). Row base: `{user_id, direction:'outbound', call_type, trigger_ref, context: type, persona_version}`.
- `placeCall(call: CallRow, { apply, now? }): Promise<PlaceResult>` (`placed {conversationId} | deferred {until} | blocked {reason} | failed {message} | dry_run {would} | not_due | gone`). Re-checks everything; stale (>4 days) → drop/block; deferrals update not_before; the **claim** is `update si_calls_log set status='ringing', uk_day=ukDay(now), placed_at, context, persona_version where id=? and status='queued'` — a 23505 from `si_calls_log_one_a_day_uidx` marks it blocked daily_limit. Then `startConversation`, `placeOutboundCall` (ElevenLabs), on failure status 'failed' (no redial), then `claimCallSlot` (cap). Dry run / SI_CALLS_DRY_RUN / missing env / no phone → `dry_run`.
- Unique indexes (schema.sql Batch 23), exact predicates: `si_calls_log_one_a_day_uidx (user_id, uk_day) where direction='outbound' and uk_day is not null`; `si_calls_log_in_flight_uidx (user_id) where direction='outbound' and status in ('queued','ringing')`; `si_calls_log_intro_uidx (user_id) where call_type='intro'` (any status, blocked included — hence intros are dropped, not blocked); `si_calls_log_low_credit_uidx (user_id, trigger_ref) where call_type='low_credit'` (any status — finding 4); `si_calls_log_el_conv_uidx (el_conversation_id) where not null`; `si_calls_log_call_sid_uidx (twilio_call_sid) where not null`.
- Eligibility input (`eligibility.ts:28-48`): type, now, settings (VoiceSettings), callsOn, isOwner, numberOk, autoTopupOn, joinedAt, placedToday, otherInFlight, introToday, affordableSeconds, managementOnly?. Order: not_owner → calls_off → management_no_deals → (low_credit) auto_topup_on → no_number → (low_credit) first_days, intro_day → daily_limit (intro defers next_day) → in_flight (intro defers) → no_credit (<60 s) → hours (defer). `affordableSeconds(balance, perMin, maxCallSeconds, reserve = textsPerCallMax × siTextPence)`.
- Hours: `hours.ts` `inOutboundHours`, `nextOpening`, `nextDayOpening`, `ukDay`, `ukWeekday`; settings `si_outbound_start_hour` 9, `_end_hour` 19 (exclusive), `_weekdays` [1..5]; bank holidays count as weekdays.
- `dayFacts(admin, userId, now, exceptId)`: unreadable → {placedToday:99, otherInFlight:true, introToday:true} (places nothing).
- What a later batch must pass to queue a new type: add it to CALL_TYPES + the SQL check; a `triggerRef` that makes the call unique for its purpose (there is no generic per-type uniqueness: only intro-ever and low-credit-per-trigger_ref exist, so a 'deal' type needs its own index or a trigger_ref convention); its own context/opener (today hard-coded, finding 5); its own fallback template (fallback-server/templates typed to intro|low_credit); and a cron entry point (run.ts places only rows already queued; nothing enqueues a new type).
- Cron: `/api/internal/si-calls` (`run.ts:runCalls({ apply, now?, onlyUserId? })`, every 5 min, maxDuration 120, `?dry=1`, `?only=<email>`); per pass: 20 intros, 20 places, 20 reconciles, retention once a UK day.
- `CallRow`/`CALL_COLUMNS` (`store-server.ts:94-122`): id, user_id, direction, call_type, status, blocked_reason, trigger_ref, context, uk_day, not_before, queued_at, placed_at, started_at, ended_at, seconds, charged_pence, texts_sent, fallback_sent_at, handoff, el_conversation_id, twilio_call_sid, conversation_id, persona_version, error. Helpers: `insertCall`, `updateCall(admin,id,patch,onlyStatus?)`, `callById`, `callByConversation`, `dayFacts`, `lastOutbound`, `contactCardSent`, `lastTemplateSent`, `claimEvent(provider,key)` → 'new'|'done'|'busy'|'retry'|'unavailable' (providers in use: 'elevenlabs', 'cron', 'si_text_slot', 'twilio_sms', 'twilio_sms_reply'), `finishEvent`, `logTool`, `toolCount`, `isSchemaMissing`.
- Charges (`charge-server.ts`): guard rows in `si_call_charges` keyed `call:<id>:minutes`, `call:<id>:text:<template>`, `call:<id>:email:fallback`, `sms:<MessageSid>`; `claimCharge/releaseCharge/settleText/settleEmail/chargeCallMinutes`; price per minute from the `si:call_minute` unit row (`callPencePerMinute()`); texts `si_text_pence`, emails `si_email_pence`; every charge `capToBalance` then `debitFace`, admin accounts and suspended seats never charged; `afterDebit` fired after a charge.
- Member facts (`member-server.ts:memberFacts(userId)`): { userId, isOwner, callsOn, numberOk (verified ∧ ¬stopped ∧ UK mobile — not `enabled`, finding 3), phone, autoTopupOn, joinedAt, firstName, email, balancePence, managementOnly }.
- The cap: `cap-server.ts:claimCallSlot(userId, now)` → SendKind 'si_call' in the 'daily' slot.

#### 4. The Part F function — `src/lib/intelligence/what-if.ts` (pure) + `what-if-server.ts`
- `type WhatIfKey = 'budget'|'brrr_budget'|'rent_10'|'rent_20'|'areas'|'miles'|'beds_down'|'beds_up'|'type_either'|'profit'|`add_${DealType}``; `isWhatIfKey(v)`.
- `interface WhatIf { key; phrase; mustHave: boolean; save: 'use'|'budget'; goals: MarketGoals; savedAreas: string[]; profile: TailoringProfile }`.
- `whatIfChanges(p: TailoringProfile, extra: { nearbyAreas: readonly string[] }): WhatIf[]` — the step list: budget / brrr_budget = next band up (`nextBand`: u100→100-200→200-350→350-500→500+; legacy u200→200-350), save 'budget' (a link, not saved); rent_10 / rent_20 = maxRentPcm × (1+WHAT_IF_BUDGET_STEPS [0.1, 0.2]) rounded to £50; miles = +WHAT_IF_EXTRA_MILES (10) for near-home; areas = + the WHAT_IF_NEARBY_AREAS (3) nearest areas for areas/null; beds_down/beds_up ±1 within 1–4; type_either; profit = minimum profit × (1−WHAT_IF_MIN_PROFIT_STEP 0.2) to £25; add_<type> = the first available deal type not chosen. Nice-to-haves first, then must-haves; at most WHAT_IF_MAX_VARIANTS (6).
- `whatIfResults(input: ChooseInput, p: TailoringProfile, reads: Pick<ChooseReads,'pool'>, variants): Promise<WhatIfResult[]>` — one `tailoredRows` read of the pool (sourcingKind 'both', extra areas), each variant counted with `admissible()` on its own deal types minus what today's answers already admit; `WhatIfResult { key, phrase, mustHave, save, count, best: { dealId, matchPct | null, profitLine | null } | null }`. Counts' source: the live marketplace pool via `rankingPool({...filters, types: []}, visibility, {userId}, limit)` (selection.ts:613), i.e. Today's own checks, no AI, no provider call.
- `bestWhatIfs(results, shown)`, `whatIfLine(r)`, `NO_WHAT_IF_LINE` / `NO_WHAT_IF_LINE_NO_SEARCH`, `whatIfAnswer(v, before): { questionId, value, undo } | null` ('Use this' writes through the quiz's answerQuestion; null for budget bands).
- Server: `whatIfsForMember(member: MemberContext, now): { variants, results }` (`src/lib/today/selection.ts:597`); `whatIfViewFor(member, now): WhatIfView { items: { key, line, mustHave, save, bestHref }[], none }` (`what-if-server.ts:17`; `none` depends on MEMBER_SEARCH_ENABLED). Member context from `intelligenceMember(user, 'reveal'|'header')` (`view-server.ts:93`).
- Config (`src/lib/intelligence/config.ts`): WHAT_IF_* constants, WHAT_IF_SHOWN 3, TODAY_LIST_MAX 5, REVEAL_ALTERNATIVES 2, CHIP_ORDER, MAX_CHIPS 8, CALL_CONSENT_VERSION 'si-calls-2026-10', ANSWERS_VERSION.

#### 5. The count function(s)
- "Deals I checked" (the reveal / Today / the answers chips): `profile_today_lists.choice` jsonb `{ checked, meeting, capped, nearby, finds, fp, answeredAt }` (`src/lib/today/choice.ts:StoredChoice`, `parseStoredChoice`, `poolTally`, `answersFingerprint`, `rechooseAllowed`); read by **`checkedCountFor(profileId: string, now = new Date()): Promise<StoredChoice | null>`** (`src/lib/today/selection.ts:180`) — the one a later batch should call (the calls batch is named as a reader); worded by `checkedLine(tally, { tailored, smallCount })` (`src/lib/today/checked.ts`). The reveal copies it into `signup_reveals.checked` at record time.
- "Properties scanned" (Home, Batch 23b's briefing): **`memberScanned(member: { userId, joinedAt }, now): Promise<ScannedFigure>`** (`src/lib/home/server.ts:113`) = SQL `member_scanned(p)` (baseline + new_since) with `memberScanTotal(baseline, revealChecked, newSince)` (`home/scan-days.ts:418`) = max(baseline, reveal.checked) + Σ listing_scan_days after the join day, in the union of the live profiles' areas and kinds. Not reset by Start again.
- `TIME_SAVED` rates (`home/config.ts`): 30 s per property scanned, 30 min per full analysis.

#### 6. The primary-profile definition
- `primaryOf(profiles): string | null` (`src/lib/profiles/rules.ts:240`): the earliest-created live (not deleted) profile, ties by id. Server: `primaryProfileFor(userId): Promise<SavedProfile | null>` (`profiles/server.ts:149`). Used by: the reveal (`intelligenceMember(…,'reveal')`), Save all 3, the signup and deep searches, and (per comment) Batch 25.
- `activeProfileFor(userId)` (`profiles/server.ts:144`) = `is_active` (the header pill); `activeProfileIdOf` read-only; `runningProfilesFor(admin, userIds)` = not paused, not deleted (daily runs; `seatsFor` drops a profile `awaitingAnswers` unless active).
- The agent's variables (`agent/variables.ts:23`) carry no profile: `VARIABLE_NAMES = first_name, caller_status, call_type, context, card_sent, minutes_available, topup_amount, topup_threshold, persona_version`; `callVariables(VariablesInput)`, `openerFor(context)`, `fill(template, vars)`. A Batch 25 deal call must add its own variables and resolve the profile itself (primary vs active is undecided for calls).
- `SavedProfile` columns: `PROFILE_COLUMNS = id, user_id, name, criteria, areas, answered, for_client, copied_from, is_active, paused_at, deleted_at, created_at` (+ transient `awaitingAnswers`). Restarts: `profile_restarts(id, user_id, profile_id, kind 'reset'|'blank', answers 'search'|'everything', deals 'keep_all'|'clear_all'|'choose', deals_kept, deals_cleared, created_at)`; `latestRestartsFor(admin, profileIds, since): Map<profileId, iso>`; `restartedSince(admin, {userId, profileId}, since)`; `hasRestartFor(userId)` (cached; "no reveal / no signup search ever after"); `learningSince(windowStart, restartAt)`, `afterRestart(entries, at, restartAt)` (`profiles/reset.ts`).

#### 7. NAV_DESTINATIONS and EYE_NAV — `src/lib/nav.ts`
- `NAV_TARGETS = { home:'/home', today:'/today', browse:'/deals', markets:'/markets' ('Market Explorer'), analyser:'/estimate', myDeals:'/my-deals', account:'/account' }`; `NAV_ORDER = ['home','today','myDeals','browse','markets','analyser','account']`; `LEADS_NAV = { label:'Leads', href:'/leads' }` (funnel owners only); `Section` adds 'home'; `NAV_FOR_SECTION.home = 'home'`.
- `EYE_NAV = { label: 'Talk to Stayful Intelligence', shortLabel: 'Talk', href: '/intelligence' } as const` — drawn by AppSwitcher before the items; the eye level comes from `eyeLevelFor(profile)` (`src/lib/home/eye-server.ts`, 0–3, team member = 3) and `EyeLevel` in `src/components/StayfulEye.tsx:34`.
- `NAV_DESTINATIONS = { home(): string; today(): string; marketArea(code): `/markets/<lower-cased, encoded>`; deal(id): `/deals/<encoded>`; myDealsStage(stage: 'watching'|'contacted'|'viewing'|'offer'|'secured', profileId?): `/my-deals[?profile=…]#stage-<stage>`; analyser(): '/estimate' }`; `type DestinationKey`; `type MyDealsStage`. No destination for /account, /profile, /intelligence, /picks or a report.
- Also: `joinLandingPath(teamOwnsFunnel)`, `ACCOUNT_MORE.calls = { label:'Your calls', href:'/account/calls' }` (owners only via `accountMoreLinks`), `HOME_PATH = '/home'`, `MANAGEMENT_HOME_PATH = '/leads'`, `postAuthPath(next, { management? })` (`src/lib/auth/landing.ts`).
- IntelligenceView reserves `#si-chat-slot` for Batch 26 (`src/components/intelligence/IntelligenceView.tsx:17/122`).

#### 8. The persona — `src/lib/persona/stayful-intelligence.ts` (no server-only)
- `PERSONA_VERSION = 'si-voice-v1'`, `PERSONA_NAME`, `interface PersonaRule { id; full; compact }`, `CORE: readonly PersonaRule[]` (ids identity, what, audience, ai, no_guarantee, no_advice, honest_gaps, tone, numbers), `type PersonaChannel = 'in_app_spoken'|'phone'|'sms'|'email'|'chat'`, `CHANNELS: Record<PersonaChannel, readonly PersonaRule[]>` (phone: phone_no_figures, phone_no_actions, phone_texts, phone_unknown, phone_short; sms: sms_form; email: email_form; chat: chat_figures 'the member is signed in, exact figures are fine'; in_app_spoken: spoken_form).
- **`buildSystemPrompt(channel: PersonaChannel, task?: string, opts: { compact?: boolean } = {}): string`** — "Who you are and how you speak:\n- rule…" then a blank line and the task; compact drops the heading.
- `SMS_SIGN_OFF = '– Stayful Intelligence'`; `FALLBACK_VOICE_ID` (Lily); `VOICE = { modelId:'eleven_turbo_v2_5', stability 0.45, similarityBoost 0.75, style 0 }`; `voiceId(env?, now?)` (ELEVENLABS_VOICE_ID or the fallback, warns once a day); `ttsVoiceSettings()`.
- Phone agent prompt: `agentPrompt(knowledge) = buildSystemPrompt('phone', callTask(knowledge))` (`src/lib/voice/agent/prompt.ts`); scripts in `agent/scripts.ts` (INTRO_SCRIPT/OPENER, LOW_CREDIT_SCRIPT/OPENER/YES/NO, CALLBACK_* openers, HANDOFF_LINE); agent object `agentConfig({ knowledge, voiceId, toolIds, maxCallSeconds, retentionDays })` (`agent/agent-config.ts`) with built-in end_call and voicemail_detection, data_collection `member_unhappy`, first_message override enabled.

#### 9. The agent tools registry — `src/lib/voice/agent/tools.ts` + `src/lib/voice/tools-server.ts`
- Names/limits: `TOOL_LIMITS = { lookup_caller: 3, send_template_text: 2, handoff_to_team: 1, log_question: 40 }` (`config.ts:51`); `TOOL_NAMES`, `type ToolName`.
- `toolConfig(name, baseUrl): Record<string, unknown>` → ElevenLabs webhook tool: POST `${base}/api/voice/tools/<name>`, header `x-si-tool-token` from dynamic variable `secret__tool_token`, injected params `conversation_id` (system__conversation_id), `call_sid`, `caller_id`, `called_number`, plus the tool's own params (`TOOLS: Record<ToolName, { description, params, required }>`). `response_timeout_secs: 10`.
- Server: `runTool(tool, req: ToolRequest, now?): Promise<ToolAnswer { ok, say, …}>` — resolves the live call by ids (status 'ringing', within maxCallSeconds + TOOL_GRACE_MS), rate-limits per call via `si_tool_calls`, logs every call. Route `src/app/api/voice/tools/[tool]/route.ts` checks the secret in constant time and `TOOL_NAMES`.
- How a tool is added: (1) a key in `TOOL_LIMITS`; (2) its entry in `TOOLS` (typed Record — the compiler demands it); (3) a `case` in `tools-server.ts:dispatch` (the switch must return) and its handler; (4) `/admin/calls` → Sync (`sync-server.ts:syncAgent`) creates it (POST /v1/convai/tools), stores the id under `billing_settings.si_agent_tool_ids`, and PATCHes the agent's `tool_ids`; (5) a line in `callTask` (prompt.ts) telling the agent when to use it. Answers are instructions to speak, never data; a tool must never return a balance, address or deal figure.

#### 10. The knowledge entries — `src/lib/voice/agent/knowledge.ts`, `service-guide.ts`, `src/lib/faqs-data.ts`
- `renderKnowledge(faqs: FAQItem[], trustFaqs: FAQItem[], guide: GuideEntry[]): string` → one line per entry: `[guide.<id>] <topic>: <text>`, `[faq.N] q a`, `[trust.N] q a` — the ids the agent reports in `log_question.knowledge_ref`.
- `serviceGuide(f: GuideFigures { callPencePerMin, textPence, emailPence, topupAmountPence, topupThresholdPence }): GuideEntry[]` — DRAFT FOR ZAC (header says Batch 24 replaces it): ids guide.what, guide.picks, guide.reports, guide.credit, guide.autotopup, guide.calls, guide.stop, guide.privacy, guide.team, guide.management. Prices are injected, never typed. **Drafts a fix must update if a rule changes:** guide.calls (weekday 9am–7pm, per-minute price, missed free, text/email prices, "(later) about a standout deal"), guide.autotopup (£25 below £5), guide.stop (STOP or Account → Notifications), guide.team (hello@stayful.co.uk), and the Batch 22 chip answers in `src/lib/intelligence/answers.ts` (`answersFor(AnswerFacts)`: credits, open_cost, pack, save, how_picked, analysis, free_delay, calls, topup, no_match — every figure from `AnswerFacts`, including `call.live = callsEnabled()`), which Batch 26 is told to reuse.
- FAQs: `faqsWith(offer: { costLead }, figures: CostFigures): FAQItem[]`, `TRUST_FAQS`, `costFiguresNow()` (`faqs-server.ts`). Synced by `syncAgent` with the live settings; the prompt is diffed by hash on a dry run.
- Texts/emails wording: `src/lib/voice/templates.ts` (`callText`, `missedCallText`, `missedCallTemplate`, `SMS_REPLY_WHO`, `SMS_REPLY_OTHER`, `missedCallEmail`), link paths `/si/card`, `/si/topup` → `/account/billing/auto-topup`.

#### 11. Other shapes later batches will meet
- Call choice: `profiles.si_calls boolean default false`, `si_calls_changed_at`; `si_call_consents(user_id, choice 'on'|'off', source 'welcome'|'settings', version, created_at)`; `setSiCalls(userId, on, source)`, `siCallsOn`, `hasVerifiedMobile` (`src/lib/intelligence/consent.ts`).
- Reveal: `signup_reveals(user_id pk, profile_id, day, deal_ids, offer_deal_ids, shown_ids, level, checked, layer, no_match, strong, search_id, viewed_at, first_keep_at, first_keep_ms, choices_at)`; `revealRowFor`, `isRevealMember(userId, createdAt)`, `revealPending`, `recordReveal`, `markRevealViewed`, `noteRevealKeep`, `markChoicesDone`, `revealedFor(userIds)` (`reveal-server.ts`).
- Offers: `analysis_purchases.offer` ('welcome'|'welcome_deep'|'first_deep'|'first_pmi'), `first_deep`; `offeredPricesFor(userId, dealId, withPmi)`, `offerPricingFor(userId, adminUser)` (`analysis/offers-server.ts`).
- Member searches: `member_searches` (purpose 'signup'|'deep', status queued|running|done|failed, caps, quote, reservation) + `member_search_finds`; `deepQuoteFor`, `startDeepSearch`, `searchStatusFor`; env `MEMBER_SEARCH_ENABLED` (not in .env.example).
- Management: `profiles.signup_path` ('management'|null), `signup_path_at`, `signup_path_via` ('first_touch'|'start'|'quiz'|'account'); `isManagementOnly(userId)`, `stampManagement(userId, via)` (`management/stamp-server.ts`); pure `managementOnly`, `shellGate` (`management/stamp.ts`).
- New activity kinds (`src/lib/activity/kinds.ts`): reveal_viewed, deep_search_run (count), si_view (record), profile_reset (count), home_view/browse_filter (count), home_tile_tap/home_feed_tap (record), mc_signup, funnel_setup_step, funnel_live, funnel_demo_emailed, funnel_snippet_copied, funnel_lead_charged (record).
- Webhook event shape (`src/lib/voice/elevenlabs.ts:WebhookEvent`): post_call_transcription { conversationId, callSid, durationSecs, terminationReason, transcript: TranscriptTurn[], dataCollection, summary, startedAt, direction } | call_initiation_failure | answering_machine_detection | other.
- Not present on main although a prompt might expect it: a call-types enum shared by code and SQL (two literal lists), a per-type uniqueness/trigger convention beyond intro/low_credit, a `context` parameter on the queue, a 'chat' question source, a single "shown to member" helper, a helper that says "intro owed but waiting" for admin, and a declared `NAV_DESTINATIONS` entry for /intelligence, /account or /profile.
## 7. Proposed fix plan

Ten branches, each from a fresh `origin/main`, each owning its files so they cannot collide. **Every `supabase/schema.sql` change lives in r2a** (one labelled section, `-- Review R2: fixes`, idempotent) and r2a merges and is run first, as 21a did; a code branch that needs a new SQL shape waits for it. r2d passes a profile id that r2f adds, so r2f merges before r2d. Everything else is independent. Marks: 💷 changes a price or a number members see · 👤 changes existing members' experience · 🗄️ needs a schema run · 🧭 a business decision in section 8 first.

| Branch | Findings | Files it touches | Marks |
|---|---|---|---|
| **review-r2a-schema** | R2-13 (SQL half: `credit_debit_face` subtracts open reservations), R2-82 (the Batch 10 backfill gains `and signup_path is null`), R2-121 (22e backfill clamped and guarded), R2-119 (offer check as drop-and-add), R2-120 (A8: show or drop `referred_by_code`), R2-87 (`'chat'` question source), R2-136 (referral amount from the setting in `credit_redeem_code`), R2-177 (a once-only `credit_grant` variant for B14), the `full_analysis_pence` seed if Q1 = £5, a retention job for `si_conversations` / `si_conversation_questions` / `si_calls_log` if Q10 | `supabase/schema.sql`, `supabase/tests/credit-smoke.sql`, README deploy step | 🗄️ 💷 🧭 Q1, Q10 |
| **review-r2b-landing-nav-shell** | R2-159, R2-196, R2-133, R2-162, R2-93, R2-176, R2-197, R2-198, R2-175, R2-174 (the AppShell half: no eye for a management-only account), R2-181 | `next.config.ts`, `src/components/{ProfilePill,AppSwitcher,AppShell}.tsx`, `src/components/credit/UsageChip.tsx`, new `src/app/upgrade/layout.tsx`, `src/components/marketing-v3/Nav.tsx`, `src/lib/billing/resume-rules.ts` + test, `src/proxy.ts`, `src/app/robots.ts`, `src/lib/nav.ts`, `src/lib/tracking/wiring.test.ts` (a test that no `redirects()` source has a page) | 👤 |
| **review-r2c-offers-and-prices** | R2-1, R2-2, R2-10, R2-11, R2-12, R2-17, R2-94, R2-68, R2-92, R2-177 (the receipt idempotency key), R2-0 / R2-3 code halves (fallback, README) | `src/lib/analysis/{offers,offers-server,deal-analysis,pmi-addon}.ts` + tests, `src/app/reports/[id]/page.tsx`, `src/app/welcome/reveal/page.tsx`, `src/lib/intelligence/reveal-server.ts`, `src/lib/credit/deal-pricing.ts`, `src/lib/stripe/grants.ts` + `webhook.test.ts`, `src/app/admin/billing/*`, README | 💷 🧭 Q1, Q6 |
| **review-r2d-reveal-part-f-view** | R2-67, R2-70, R2-79, R2-71, R2-72, R2-77, R2-99, R2-100, R2-101, R2-103, R2-104, R2-110, R2-127, R2-132, R2-21, R2-60, R2-61, R2-62, R2-65, R2-74, R2-174 / R2-20 (the `/intelligence` page half), R2-106 (the view passes the active profile), R2-194 | `src/lib/intelligence/{view-server,what-if,what-if-server,answers,config,reveal}.ts` + tests, `src/components/intelligence/**`, `src/app/welcome/reveal/actions.ts`, `src/app/today/page.tsx`, `src/app/intelligence/page.tsx`, `src/app/api/billing/starter-pack/route.ts`, `src/components/starter-pack/*`, `src/app/deals/actions.ts`, `src/app/api/{deep-search,welcome/search}/route.ts` | 👤 (after r2f) |
| **review-r2e-choices-consent-copy** | R2-78, R2-54, R2-89, R2-112, R2-48 (the copy half), R2-156, R2-158, R2-155, R2-154 (the copy half) | `src/app/welcome/choices/**`, `src/lib/intelligence/consent.ts` + test, `src/lib/notifications/{registry,server}.ts`, `src/lib/notify/cap.ts`, `src/app/account/notifications/SmsSection.tsx`, `src/app/(marketing)/{terms,privacy}/page.tsx` | 👤 🧭 Q7, Q10 |
| **review-r2f-searches-profiles-22c** | R2-18, R2-106 (an optional `profileId` through `memberFor` / `deepQuoteFor` / `startDeepSearch`), R2-107, R2-108, R2-134, R2-9, R2-40, R2-39, R2-139, R2-190, R2-163, R2-165, R2-59, R2-69, R2-141, R2-142, R2-143, R2-144, R2-145, R2-146, R2-75, R2-38, R2-140 | `src/lib/sourcing-demand/**` + tests, `src/lib/broker/questions.ts`, `src/lib/listing/{picks-run,sourcing}.ts`, `src/lib/notify/digest-run.ts`, `src/lib/profile/{mandatory-server,server}.ts`, `src/lib/profiles/**`, `src/app/profiles/**`, `src/lib/team/remove.ts`, `src/app/my-deals/cleared/actions.ts`, `src/lib/deal-quality/**`, `src/lib/marketplace/{absorb,server}.ts`, `src/lib/market/filters.ts`, `src/lib/tailoring/browse.ts` + test, `src/app/api/internal/member-searches/route.ts` | 👤 🧭 Q12 |
| **review-r2g-call-charges-triggers** | R2-13 (TS half: cap and eligibility at spendable credit), R2-23, R2-43, R2-45, R2-95, R2-122 (the fallback half), R2-15, R2-46, R2-41, R2-52, R2-84, R2-35, R2-37, R2-185, R2-184, R2-187, R2-53, R2-48 (the `sms_messages` record half) | `src/lib/voice/{charge-server,member-server,low-credit,low-credit-server,cap-server,fallback-server,run,admin}.ts` + tests, `src/lib/credit/after-debit.ts`, `src/lib/notify/cap.test.ts` | 💷 👤 🧭 Q4, Q7, Q8 (after r2a) |
| **review-r2h-queue-inbound-agent** | R2-24, R2-34, R2-25, R2-26, R2-27, R2-28, R2-183, R2-29, R2-80, R2-49, R2-50, R2-51, R2-32, R2-33, R2-90, R2-152, R2-153, R2-157, R2-171, R2-172, R2-193, R2-98, R2-122 (the tools half), R2-86 / R2-168 (an explicit `context` on the queue and the per-type uniqueness note, so Batch 25 inherits a type-agnostic queue) | `src/lib/voice/{queue-server,inbound-server,webhook-server,sms-replies,sms-replies-server,store-server,tools-server,config,elevenlabs,templates,eligibility}.ts` + tests, `src/lib/voice/agent/**`, `src/lib/email/si-calls.ts`, `src/app/api/voice/**`, `src/app/api/twilio/inbound/route.ts`, README §19 | 👤 💷 🧭 Q3, Q5, Q9, Q10 |
| **review-r2i-management-funnels** | R2-160, R2-19, R2-147, R2-4, R2-148, R2-149, R2-150, R2-151, R2-36, R2-6, R2-57, R2-63, R2-188, R2-189, R2-137, R2-169, R2-82 (the `leads/provision` guard) | `src/app/(marketing)/for-management-companies/**`, `src/app/welcome/Quiz.tsx` (the link only), `src/app/account/page.tsx`, `src/lib/management/**` + tests, `src/app/api/internal/{leads/provision,funnel-queue}/route.ts`, `src/lib/funnels/**` + tests, `src/app/admin/management/**`, `src/app/leads/**`, `src/lib/crm/deliver.ts`, `src/lib/email/new-lead*.ts`, `src/lib/starter-pack/server.ts` | 👤 💷 🧭 Q11 |
| **review-r2j-home-activity-docs** | R2-56, R2-55, R2-58, R2-66, R2-91, R2-116, R2-166, R2-170, R2-195, R2-135, R2-138, R2-178, R2-179, R2-180, R2-182, R2-42, R2-129, R2-130, R2-131, R2-161, R2-164, R2-167, R2-186, R2-191, R2-192 | `src/lib/activity/**` + tests, `src/lib/home/**`, `src/app/home/**`, `src/app/admin/weekly-active/**`, `src/app/deals/page.tsx`, `src/app/markets/actions.ts`, `src/app/api/listing/resolve/route.ts`, `src/app/api/track/route.ts` (delete), `src/lib/email/billing.ts`, `src/lib/tracking/report-server.ts`, `src/lib/auth/sign-in-hooks.ts`, `scripts/stripe-setup.mjs`, `.github/workflows/ci.yml`, `src/app/deals/_components/AnalysisPanel.tsx`, `src/app/estimate/{page,layout}.tsx`, `src/lib/fonts.ts`, `src/app/demo-report/page.tsx`, `src/app/deals/opened/page.tsx`, README, `.env.example`, `STAYFUL_DESIGN_BRIEF.md` | 🧭 Q2, Q13 |

Suggested order: **r2a** (merge, run the schema) → **r2g** and **r2h** (the call fixes, before any real member is called) and **r2b** (the landing and the header) → **r2c** and **r2e** → **r2f** then **r2d** → **r2i** → **r2j**. Each branch gets a test that would have caught the bug where a test can reach it (at least R2-159, R2-94, R2-1, R2-2, R2-13, R2-23, R2-24, R2-43, R2-122, R2-106, R2-107, R2-82, R2-18, R2-67, R2-68, R2-160), and before hand-back: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, the diff review the brief lists (credit charged wrongly, free/paid leaks, address leaks, calls or texts to the wrong person or time, missing dry runs, non-idempotent schema, `ACCESS_COLUMNS`, unlogged member actions), and the Stayful Intelligence knowledge drafts (`src/lib/voice/agent/service-guide.ts`, `src/lib/intelligence/answers.ts`) updated where a price or rule changes.

Not in any branch, deliberately: R2-173 (the nav bullet in the brief is stale; the header on main is Zac's decision in #128) and the Batch 25-only items in R2-168 (a `si_calls_log_deal_uidx` and an intro-style skip for deal calls belong in Batch 25's schema section); both are in the contracts (section 6) for the 24–26 prompts.

## 8. Questions before I fix

Each is a business decision; the default is what I'd do if I hear nothing.

1. **Full analysis: £4 or £5? (R2-0, R2-3)** The seed, the live row, the code fallback and every member-facing string say £4, so the Deep report is £6, the first Deep report £5 and the welcome price £2.17 (the raw-cost floor, not half of £4); only the brief says £5 / £7 / £6. *Default:* £5 as the brief says: set the live row on `/admin/billing`, change the seed (`schema.sql:3459`) and the fallback (`deal-pricing.ts:52`), fix README §6's "£4 on a plan"; at £5 the welcome price is exactly £2.50 and the first Deep report £6. 💷 Every member sees the new prices; existing members' saved analyses are unaffected.
2. **Does a Home visit count as weekly active? (R2-56)** 22e made `home_view` a qualifying kind and every login lands on Home, so signing in counts as active again — the opposite of R1's E1/Q15 decision. 22e added the "Home only" admin row to measure it. *Default:* record-only; the tiles' target pages already log their own counting views.
3. **Who pays for callbacks and auto-replies? (R2-26, R2-28)** Today any verified number that rings or texts the SI number is charged (65p a minute, 22p a reply) whether or not calls were ever switched on, and no price is spoken. Batch 8's alert texts come from the same number, so ringing or replying is the natural thing to do. *Default:* charge a callback only when the member's calls are on, and say the price in the opener; auto-replies are free.
4. **Is the £20 welcome credit a "credit landing"? (R2-95)** It is excluded from `latestLanding`, so while `starter_pack_from` is null no new member can get the low-credit call. *Default:* count it (the brief's rule names no exclusion).
5. **When does the intro call dial? (R2-98)** Today the instant the code is verified, while the member is still on the choices screen on the same phone. *Default:* `not_before` = now + 5 minutes (a `si_intro_delay_minutes` setting), or place it from Continue.
6. **First Deep report: once per member or once per paying account? (R2-17)** The pre-check reads the payer, the unique index is per buyer. *Default:* per paying account; move the index to the payer.
7. **Call texts and Batch 8's caps. (R2-48, R2-84)** Texts from calls bypass the one-a-day and monthly caps and are never written to `sms_messages`, while Account → Notifications still says "at most one text a day … free"; and the "Texts: Off" switch does not stop them. *Default:* outside the alert caps (they are consented per call and limited to 2 + 1 fallback), recorded in `sms_messages`, honour the Texts switch, copy reworded.
8. **Mornings: the £5 email or the call? (R2-43)** The 07:00 picks email carries the £5 decision before any 9am call can go. *Default:* the morning email is the notice and a queued call is dropped once it went; the call is used when the trigger fires inside hours and no email went for that landing.
9. **ElevenLabs audio. (R2-152)** *Default:* send `record_voice: false, delete_audio: true` so the policy's "not recorded as audio" is true; the alternative is to reword the policy.
10. **Text bodies and call records. (R2-153, R2-154)** *Default:* store a fixed string as the question for a text or an "unhappy" line, and give `si_conversations`, `si_conversation_questions` and `si_calls_log` the 24-month retention the policy already promises.
11. **The management stamp. (R2-160, R2-19)** *Default:* a POST (a one-button form) with `prefetch={false}` on the links, and `managementOnly` true only for accounts stamped before they ever answered the quiz, so Start again cannot reclassify an investor. Check `/admin/management` for accounts stamped by prefetch before trusting its funnel.
12. **Deal checks: the split or the cap? (R2-141)** At 5p a call and up to 3 calls a check, `dailyCapPence` 100 funds three or four cheap checks a day, not twelve. *Default:* fix the run order now (weighted interleave, cheap first); raise the cap to about 300p only if you want 20 checks a day.
13. **Disposable-email sign-ups in the metrics. (R2-179, R1 E10)** Left to 21a, which did not do it. *Default:* exclude them automatically, as R1 suggested.

## 9. Appendix

### A. Mechanical checks (origin/main at 5d0ac80, Node 22.22.2, Postgres 16.13)


| # | Check | Result | Raw |
|---|-------|--------|-----|
| 1a | schema.sql run 1 (fresh r2 + shim) | PASS: 0 ERROR, 0 WARNING, 90 NOTICE | schema-run1.log |
| 1b | schema.sql run 2 | PASS: 0 ERROR, 0 WARNING, 449 NOTICE | schema-run2.log |
| 1c | pg_dump schema diff run1 vs run2 | EMPTY (0 lines) | schema1.sql, schema2.sql, schema-diff.txt |
| 1d | pg_dump data diff run1 vs run2 | EMPTY (0 lines) | data1.sql, data2.sql, data-diff.txt |
| 1e | supabase/tests/credit-smoke.sql | PASS ("ALL CREDIT SMOKE CHECKS PASSED", 12 named checks incl. "funnel lead tiers ok") | credit-smoke.log |
| 1f | supabase/tests/scan-days-smoke.sql | PASS (3 checks) | scan-days-smoke.log |
| 1g | RLS per public table | 112 tables, ALL relrowsecurity=t, forced=f; 19 NEW since R1, all 0 policies | rls.txt |
| 1h | Functions secdef/search_path | 59 functions; ALL have pinned search_path; 34 definer, 25 invoker (listed) | functions.txt |
| 1i | billing_settings seeds vs live | 44 new keys since R1; all match live except funnel_tiers_from (timestamp, expected); full_analysis_pence seeded 400 vs brief "£5" | billing-settings-r2.txt |
| 2a | npm test | PASS 2677/2677, 0 fail, 0 skipped, 30.3 s | npm-test.log |
| 2b | npm run lint | PASS exit 0: 0 errors, 67 warnings (46 in files changed since R1) | npm-lint.log, lint-changed.txt |
| 2c | npm run typecheck | PASS exit 0, no output | npm-typecheck.log |
| 2d | npm run build | PASS exit 0, 0 warnings, 1m30s (compiled 34.7 s), 221 routes | npm-build.log |
| 2e | npm audit --audit-level=high | 0 vulnerabilities (any severity) | npm-audit.log/json |
| 3 | Env cross-check | 90 names read, 57 documented; 49 read-but-undocumented; 0 documented-but-unread; 0 'use client' file reads a non-NEXT_PUBLIC env; MEMBER_SEARCH_ENABLED missing from .env.example | env-*.txt |
| 4 | Cron cross-check | 36 schedules → 25 routes, every path has route.ts; 4 pairs share an exact schedule; all 39 internal routes auth first (3 use admin-or-internal, 1 admin-session only) | cron-paths.txt, cron-overlaps.txt, internal-routes*.txt |
| 5 | Column cross-check (572 changed src files) | 0 misses: 760 .from, 42 .rpc, 502 literal selects (1,912 columns), 48+ constant selects | colcheck.out, constcheck*.out |
| 6 | TODO/FIXME/later-batch comments | 31 lines (all "Batch 24–29 will…" notes; no TODO/FIXME in code) | todos.txt |
| 7 | ACCESS_COLUMNS | unchanged since R1; all 9 columns exist on profiles | profiles-columns.txt |


Raw outputs are in the review session's scratchpad (`r2/mech/`); the commands are CI's own (`.github/workflows/ci.yml`) and the npm scripts. Environment notes: the throwaway database used `supabase/tests/shim.sql`; the first test run on a stub `node_modules` failed for install reasons only and was rerun after `npm ci`.

Cross-check misses, in total: (i) `MEMBER_SEARCH_ENABLED` is read but not documented in `.env.example`; (ii) `.env.example`'s cron count is stale (33 schedules / 23 routes vs 36 / 25); (iii) `full_analysis_pence` is seeded 400 while the brief says £5 (question 1); (iv) `reset_search_profile` is security invoker while its eight new siblings are definer (granted to service_role only; not exploitable); (v) `credit-sweep` and `screen-report` have no `?dry=1` (both pre-R1). Everything else clean.

### B. Merges on main since R1 (first-parent, newest first)

- 5d0ac80 2026-10-02 Batch 22f: management companies — from ad to a live branded link (#129)
- c3809a2 2026-10-02 Batch 22e: the header, Home and Browse (#128)
- 4f57836 2026-10-02 Batch 22d: Start again on the profile, Start blank for new profiles (#127)
- 2bc2c29 2026-10-02 Batch 22c: cheap deals first (#126)
- 09d526e 2026-10-02 Batch 21 deploy notes: add the staff-account step before the CREDIT_ENFORCE flip (B41) (#125)
- 8d2efae 2026-10-02 Batch 23: Stayful Intelligence calls — one voice, the intro call, the low-credit call, callbacks and text replies (#124)
- 12da543 2026-10-01 Batch 22: signup reveal, accuracy levels, Stayful Intelligence view (#121)
- a266d5c 2026-10-01 Batch 21 follow-up (E20): a subscription change counts as the member's only when they made it (#123)
- 6304107 2026-10-01 Batch 21 follow-ups: constant-time internal secret compare (C30), pack Checkout returns to the quiz (F32) (#122)
- d683e70 2026-10-01 Batch 21h: product, nav and code health (#120)
- d741540 2026-10-01 Batch 21i: Next.js 16.3.7 and a quiet test run (#118)
- 989d1f7 2026-10-01 Batch 21f: weekly active from day one, inactivity, and the Monday figures (#117)
- 00d6faf 2026-10-01 Batch 21: read-only review of Batches 1–20 (#111)
- c956233 2026-10-01 Batch 21d: privacy and access review fixes (#113)
- ecce236 2026-10-01 Batch 21b: credit-enforce review fixes (#115)
- fea8814 2026-10-01 Batch 21e: messages and crons review fixes (#116)
- 49c879b 2026-10-01 Batch 21g: white-label funnels say nothing of Stayful, and a failed run is refunded (#119)
- 59a680b 2026-10-01 Batch 21c: Stripe and ledger review fixes (#114)
- 25a1693 2026-10-01 Batch 21a: schema review fixes (atomic plan cycle, overdraft forgiveness, referral guard, policies, CI schema job) (#112)
- cc75b66 2026-10-01 Docs: the Stripe webhook must be on the stripe package's API version (#110)


None missing, none merged twice. Two notes: 22c–22f were merged after Batch 23 although named as Batch 22 parts (each appended its own schema section after 23's); no 22a or 22b merge exists. 626 files changed, +29,154/−5,746; `schema.sql` 5,716 → 6,813 lines. The 22f schema section was not on live until 13:23 UTC on 2 Oct, 33 minutes after 22f's code deployed; it is now.

### C. Completeness rounds


**Round 1:** the critic listed 11 uncovered bullets; the finders returned 44 new findings, 44 stand.

- [H] Batch 21's approved fixes: each one on main with its test. — *Every reader only SAMPLED. Across all readers the R1 ids verified on main are roughly A1 A2 A3 A4 A6 A7 A8 A11 A13 A15 A16 A18 · B1 B2 B7 B8 B10 B13 B15 B16 B17 B18 B19 B27 B36 B37 B40 B41 B42 B44 B45 …*
- [H] Batch 22: … Part H analyse 1–3 with progress bars, welcome price, Deep report, first-time price, PMI comparables and PDF page. — *'PMI comparables' was checked only on the PDF (PageSecondOpinion). The on-screen half — src/lib/analysis/second-opinion.ts (comparableRows / monthRows) and the month-by-month table + 'PMI's comparable …*
- [H] Batch 22: … Part G layers and deep search — *Readers checked the caps, house spend and the charge, but nobody named src/lib/sourcing-demand/member-search-plan.ts, which IS the 'layers' (signup: only screenable areas of the member's kinds, thin s …*
- [D] Every new cron and queue: … and it finishes in Vercel's time limit. — *D1 traced time budgets for si-calls and member-searches only and said 'the other new routes 60' (maxDuration). /api/internal/restream-backfill (walks every marketplace_deals row to re-stream) and /api …*
- [scope: 22c] Batch 22c Part A/B (PR #126): 'An auction lot is judged on its auction price (guide + 15%)'; 'The badge on cards and the deal sheet follows the price rule'; 'A reprice now re-streams the deal (never a Project deal)'; 'Default check split is now 3 / 12 / 5, and spare slots go to low entry first. shortlistOrder (checks.ts) ranks each stream by profit ÷ cash in. Low-entry candidates wait 14 days on the shortlist.' — *No reader looked at src/lib/deal-quality/checks.ts (shortlistOrder, spare-slot pass), src/lib/deal-quality/checks-run.ts, src/lib/deal-quality/streams.ts (price rule, auction +15%, shortlistExpiryAt b …*
- [scope: 22c] Batch 22c Part F: 'Budget-bracket panel on /admin/deals.' — *src/lib/deal-quality/budget-panel.ts (134 lines) and budget-panel-server.ts (91 lines) and the panel on src/app/admin/deals/page.tsx were not named by any reader; whether the panel's counts use the fi …*
- [scope: 22f] Batch 22f: '/admin/management: the funnel, median minutes to live, leads a month, revenue by tier, journeys, the price notice (dry run, then send), and a test month.' and 'Step 1 company name, logo, swatches, live preview; Step 2 reply-to and privacy policy …; Step 3 email each new lead (on by default), Monday and webhook panels' — *The price notice was covered (D1/D2). Not looked at by anyone: src/lib/management/report.ts (the admin figures: page views → sign-ups → paid → live → first lead, median minutes, revenue by tier — Zac' …*
- [H (Batch 23) / I] Batch 23: … shared channel-neutral conversation log with outcomes and 90-day retention (and the deletion job actually runs) — *The code and cron were covered, but src/app/(marketing)/privacy/page.tsx and terms/page.tsx (changed by Batch 23) were not read by anyone. The privacy policy now states: transcripts deleted after DEFA …*
- [scope: files no reader named] 'git diff --name-only 91c76c2 HEAD' lists every file in scope — *Changed since R1 and not named by any reader (beyond those listed above): STAYFUL_DESIGN_BRIEF.md; public/icon-neutral.svg (21g neutral favicon — does /f and /r use it, and does the Stayful icon leak …*
- [I] Anything a later batch (24, 25, 26) is told to reuse that doesn't exist in the shape its prompt expects … List mismatches so I can revise those prompts before they're built. — *All six named things were checked, but no Batch 24/25/26 prompt exists in the repo (docs/ holds only extension-store-submission.md, market-explorer and reviews), so every reader judged 'the shape its …*
- [F] Nav is still Today · My deals · Account (+ Leads for funnel owners); the eye and the view add no nav item — *Covered in substance, but note for the report: the nav on main is NOT 'Today · My deals · Account' — 22e (merged after the brief was written) made it eye · Home · Today · My deals · Browse · Market Ex …*

**Round 2:** the critic listed 5 uncovered bullets; the finders returned 22 new findings, 22 stand.

- [H] Batch 21's approved fixes: each one on main with its test. — *Only partly covered. The H reader says it 'sampled' the fixes and the second round verified many more, but across every reader these R1 fix-plan ids have neither a finding nor a clean check: 21a schem …*
- [D] The message cap: every new email, text and call goes through src/lib/notify/cap.ts or is deliberately outside it — *The SMS auto-reply (Batch 23's 'who is this?' reply from src/lib/voice/sms-replies-server.ts) is checked for its own per-number daily cap and once-per-MessageSid, and the in-call/missed-call texts are …*
- [scope] Files changed since R1 that no reader names (scope.md file list) — *Unread by every reader: src/app/error.tsx and src/app/not-found.tsx (new, R1 F6), src/app/extension/connect/layout.tsx (new, R1 F12), src/app/demo-report/page.tsx (R1 F28), src/app/api/listing/quick-e …*
- [G] TODO / 'later batch' comments added since R1, and whether a later batch is due to do them. — *Covered in substance (29 forward references all name Batch 24–29; the 'Batch 23b' comments are a finding), but the G reader refers to a 'TODO table' that is not in its listed findings or clean checks …*
- [F] the header fits a 375px phone with Feedback, Usage chip, Profile pill and eye — *Checked by two readers, but both by arithmetic from the styles ('no Playwright / no Chromium in this container'), not by rendering. Not a gap in attention — a gap in evidence the report should state p …*

### D. Checked and found clean (803 items, by reader)

One line each, in the reader's own words, cut short for size; the full text is in the review session's working files.

**B1 money: charge paths** (31)

- Full analysis list price is read from billing_settings.full_analysis …
- The card, the deal page, the reveal/intelligence view, resume-after- …
- Welcome price applies only to signup_reveals.offer_deal_ids (= the u …
- signup_reveals is written only on /welcome/reveal for a reveal accou …
- Offer-priced purchases must be affordable whatever CREDIT_ENFORCE sa …
- A double tap or second tab on an offer hits the partial unique index …
- Every offer is floored at the live worst-case raw cost (full, full+P …
- First Deep report = full + deep_first_run_extra_pence (not full + PM …
- Deep search: quoted on the server (deepQuoteFor), re-quoted at start …
- Deep search first-time discount is held by member_searches_first_dis …
- Signup search: cap_raw_pence = signup_search_cap_pence (50), every p …
- Signup search is queued only for reveal accounts and once per member …
- Call minutes are charged once, from post_call_transcription only, on …
- Voicemail, answering-machine detection and call_initiation_failure w …
- Texts are si_text_pence (22) from billing_settings, one guard per te …
- The missed-call email is si_email_pence (20), sent and charged once …
- A call charge never takes the balance below zero: capToBalance clamp …
- Admin accounts and suspended seats are never charged for calls; a te …
- The per-minute price is the same number everywhere it is shown or ch …
- Low-credit call trigger reads low_credit_pence, si_low_credit_spent_ …
- Auto top-up from the SI link: amount = reveal_auto_topup_amount_penc …
- Auto top-up core is unchanged in behaviour (cooldown claim before th …
- Funnel tiers are priced from funnel_tiers / funnel_enhanced_extra_pe …
- Legacy funnel owners stay on funnel_markup until funnel_price_notice …
- Funnel settings, the cost estimator, the Usage line, the setup's 'ab …
- 22d: reset_search_profile never writes credit_grant_id, credit_skipp …
- 22c claims no price, charge or profit change: the diff (git diff 2bc …
- Every Batch 22/23 price and threshold is a billing_settings row pars …
- Resume after top-up re-quotes every ticked report with the member's …
- 'Analyse all 3' and each reveal button go through the deal page's ow …
- Stage 1: supabase/tests/credit-smoke.sql passes on the throwaway dat …

**B2 money: charge twice** (44)

- Call minutes charged once: si_webhook_events claim (store-server.ts: …
- Missed, voicemail and unknown callers free: finishCall charges only …
- Missed-call fallback once per call: CAS on fallback_sent_at (fallbac …
- Agent texts: guard key call:<id>:text:<template> then per-call slot …
- SMS auto-reply charged once per MessageSid: claimEvent twilio_sms:<s …
- Credit floor on a call: charged = capToBalance(price, balance) (char …
- Wrong account impossible on inbound: sms_contacts_verified_phone_uid …
- Team member's call/text charged to the owner: settle() → payerFor(sp …
- Intro call once ever and never placed twice: si_calls_log_intro_uidx …
- Low-credit call once per credit landing: trigger_ref = landing grant …
- Auto top-up (debit-triggered) cannot double-charge: claim on auto_to …
- Webhook and one-click/auto paths cannot both grant a top-up: grantTo …
- Call-link auto top-up: no saved card → Checkout with metadata auto_t …
- R1 B7 holds: TopupButtons.tsx:21 and LowCreditChoice.tsx:26 mint the …
- R1 B1 holds: stripe_events claim, 409 while an earlier delivery is i …
- R1 D1 holds: reinstateSeats keys chargeSeat on r.suspended_at and ma …
- R1 B44/B45/C17 holds: captured_at stamped after capture, 'failed' ro …
- R1 B13 holds: typed-address report deduped on (user, address, postco …
- R1 B37 holds: admin adjustment grants keyed admin:<email>:<form nonc …
- Welcome price once per deal: analysis_purchases_welcome_uidx (buyer_ …
- Welcome price never on PMI alone and never for a team seat: pmiAddon …
- Welcome window and deal set: offer_deal_ids and viewed_at from signu …
- First deep report once (reveal-discounted and 'add PMI' count): firs …
- Offer-priced purchases never overdraft: mustAfford = isEnforcing() | …
- Analysis charged once per purchase: analysis_purchases_running_uidx …
- Analyse 1–3 from the reveal: the client goes through the same /analy …
- Resume after a top-up: intent inserted with an expiry (resume-server …
- Deep search one at a time: member_searches_active_uidx (user_id) whe …
- Deep search first-time discount once per paying account: member_sear …
- Deep search charged once and never above the up-to: reservation of u …
- Deep/signup search raw cap and monthly ceiling: every step claims be …
- Signup search never charged to the member and once per sign-up: all …
- 22f funnel lead charged once per lead: funnel_lead_charge locks the …
- 22f hold vs charge: tiers mode runs the report as a fixed-price acti …
- 22f new-lead email once per lead: leads.owner_notified_at claimed wi …
- 22f lead reuse (R1 C3) holds: the same email+postcode on the same fu …
- 22d £5 never twice: grant keyed profile_complete:<user> (profile/ser …
- 22d no house spend after a reset: the signup search is once per user …
- Checklist £1 rewards and welcome credit stay idempotent on source_re …
- Funnel address lookups included in tiers: address-autocomplete runs …
- Listing recheck billing (R1 B10/B16): recheckBillFor picks the first …
- Picks cron re-run cannot charge a pick twice: todays_5 slot claim pe …
- Stripe refund/dispute paths unchanged since R1 except B17/B18/B36 (r …
- Pure rules pinned by tests and passing: minutesChargePence / capToBa …

**C1 privacy: who sees what** (41)

- src/lib/marketplace/tier.ts: ownFinds is set only in dealVisibilityF …
- src/lib/marketplace/visibility.ts: dealVisibleTo/visibilityOrFilter …
- src/lib/marketplace/queries.ts dealsQuery: own finds are added with …
- Every member-scoped read uses dealVisibilityFor + dealVisibleTo (ver …
- src/lib/sourcing-demand/member-search.ts recordFinds: finds are writ …
- src/app/welcome/reveal/page.tsx: session required; team seats and pr …
- src/components/intelligence/cards.tsx + src/app/deals/_components/De …
- src/app/welcome/reveal/actions.ts saveAllAction: posted deal ids are …
- src/lib/intelligence/answers.ts: every chip fact is the member's own …
- src/lib/intelligence/what-if.ts / what-if-server.ts / what-if-action …
- src/app/api/intelligence/status/route.ts: signed out → 401 {running: …
- src/app/api/welcome/search/route.ts: session only; runs only the cal …
- src/app/api/deep-search/route.ts + startDeepSearch: session only; th …
- src/app/intelligence/page.tsx: session + requireProfileStart; loadIn …
- src/app/welcome/choices/page.tsx + actions.ts: isRevealMember gate; …
- src/app/my-deals/cleared/page.tsx + actions.ts + listing/tracked-ser …
- src/app/profile/start-again/page.tsx + profiles/server.ts resetActiv …
- src/lib/home/server.ts + feed.ts + emailed.ts + HomeView.tsx: every …
- src/lib/tailoring/browse-server.ts forYouPage + src/app/deals/page.t …
- src/lib/security/frame-headers.ts + next.config.ts: node --test src/ …
- src/app/f/[token]/page.tsx + f/layout.tsx + not-found.tsx: token is …
- src/app/lead-form-sample/page.tsx: preview:true with DEMO_MAP data a …
- src/app/api/mc/view/route.ts: same-origin JSON only, 512-byte cap, s …
- src/app/(marketing)/for-management-companies/page.tsx: public, price …
- src/app/leads/setup/{context,actions}.ts + live/page.tsx: ownerIdOrN …
- Management-path reach without the quiz (src/components/AppShell.tsx: …
- src/lib/voice/templates.ts: the three call texts, two missed-call te …
- src/lib/voice/agent/variables.ts: the call carries first_name, calle …
- src/lib/voice/agent/prompt.ts + src/lib/persona/stayful-intelligence …
- src/lib/voice/tools-server.ts + api/voice/tools/[tool]/route.ts: x-s …
- src/lib/voice/inbound-server.ts + member-server.ts memberByNumber + …
- src/lib/voice/fallback-server.ts: the missed-call text goes only to …
- src/lib/voice/sms-replies-server.ts + api/twilio/inbound/route.ts: r …
- src/app/account/calls/page.tsx: owner only (team seats → /account); …
- src/app/admin/conversations/page.tsx, admin/calls/page.tsx + actions …
- src/lib/conversations/log-server.ts: transcripts are written only by …
- src/components/intelligence/resume-actions.ts + src/lib/billing/resu …
- src/lib/intelligence/reveal.ts revealNext + src/lib/safe-path.ts: ev …
- src/components/intelligence/actions.ts recordSiViewAction + src/app/ …
- R1 21d privacy fixes verified on main: G1 (src/app/api/get-report an …
- live-markers.md vs code: every new member-data table (signup_reveals …

**C2 safety: calls and texts** (26)

- The dialled number is only ever sms_contacts.phone_e164 for the memb …
- A verified number belongs to one account (sms_contacts_verified_phon …
- Outbound calls go only to owners: eligibility.ts:64 not_owner (a ski …
- Switch, consent and number are re-checked at dial time: placeCall → …
- Window: Europe/London via Intl with DST handled (sms/uk-time.ts:17-3 …
- One outbound call per member per UK day: uk_day = londonDay (hours.t …
- No low-credit call in the first si_low_credit_min_member_days (profi …
- Text templates are fixed strings whose only variables are siteUrl() …
- Texts per call are capped server-side at min(TOOL_LIMITS.send_templa …
- STOP is respected everywhere: numberOk requires !stopped_at (member- …
- The agent's four tools never return a balance, address or deal figur …
- Tool requests are bound to a live ringing call by ElevenLabs-injecte …
- Post-call webhook: ElevenLabs-Signature parsed as t=,v0=, HMAC-SHA25 …
- Initiate secret compared in constant time (api/voice/elevenlabs/init …
- Unknown callers: matched only by exact E.164 equality after ukMobile …
- Answered minutes are charged once under charge_key call:<id>:minutes …
- The missed-call fallback fires once per call (fallback_sent_at compa …
- Variables at conversation start are first_name, caller_status, call_ …
- Nothing in Batch 23 carries deal content: the intro prompt says 'No …
- 22f: a management company without deal-finding gets neither call, as …
- Welcome choices: the call box is unticked unless already on, needs a …
- The intro is once ever (si_calls_log_intro_uidx, schema.sql:6246) an …
- Dry run / disabled: with SI_CALLS_ENABLED unset enqueueCall writes n …
- Transcript retention: turns deleted after si_transcript_retention_da …
- /admin/calls and /admin/conversations are isAdminEmail-gated (admin/ …
- R1 report checked: no R1 finding concerns calls or texts (only G7's …

**D1 crons and queues** (31)

- si-calls auth is first: internalSecretsConfigured → authoriseInterna …
- member-searches, restream-backfill and cheap-rescreen: the same two …
- vercel.json: 36 schedules, 25 distinct paths, every path has a route …
- README §Member emails table (lines 940-949) matches vercel.json row …
- si-calls ?dry=1 writes nothing: step 1 is reads only (run.ts:55-84 a …
- si-calls safe to overlap: the queued→ringing claim is a conditional …
- si-calls crash recovery: a queued call is picked up by the next run …
- Missed-call fallback fires at most once per missed call however many …
- The 90-day conversation-log deletion runs: step 4 of runCalls under …
- member-searches time budget: deadlineMs 50 s with maxDuration 60; no …
- member-searches safe to overlap: a slice leases the row with one con …
- member-searches crash recovery: a slice that dies leaves status 'run …
- member-searches ?dry=1 works with MEMBER_SEARCH_ENABLED off and writ …
- restream-backfill is idempotent and spend-free: the plan is recomput …
- cheap-rescreen makes no provider call: candidates are stored snapsho …
- 22e scan-day recounts: dry runs return before recordScanDays in all …
- 22f funnel-price notice: dry run reads only and returns audience, sa …
- 22f tier charge in the lead drain: funnel_lead_charge numbers and de …
- funnel-queue dry run leases, reserves, runs and alerts nothing (`wou …
- crm-deliveries (21e/21g): ?dry=1 lists due ids only, 40 s budget, ea …
- lead-retention (21e D17): archive-warning and archived-notice marks …
- market-warm (21e D23): 50 s budget, key stats skipped after 20 s, sn …
- listing-recheck (21b B10/B16/D16): each URL in its own try/catch so …
- leads/provision is the only route that accepts N8N_SHARED_SECRET ({ …
- Agent sync from /admin/calls: admin session required; the dry run ma …
- The low-credit call trigger is queue-first: enqueueCall writes the r …
- Intro backfill in the cron is idempotent: only profiles with si_call …
- Inbound callbacks stuck 'ringing' (lost webhook) are reconciled too: …
- The ElevenLabs post-call webhook verifies the HMAC signature (30-min …
- maxDuration is still a route-segment export in this Next.js version …
- Batch 22d (Start again) adds no cron, queue or internal route (git d …

**D2 messages and the cap** (32)

- src/lib/notify/cap.ts:30–40: si_call is a SendKind in the daily slot …
- src/lib/notify/sends.ts:85–88: abandonSend deletes only a 'sending' …
- supabase/schema.sql:2417 and 2433–2461: notification_sends_slot_uidx …
- src/lib/credit/after-debit.ts:120–157: within one debit the low-cred …
- src/lib/credit/after-debit.ts:89–119: the out-of-credit path is unto …
- src/lib/credit/low-credit-server.ts:152–176: sendLowCreditAlone clai …
- src/lib/voice/low-credit-server.ts:40–49 + schema si_calls_log_low_c …
- src/lib/voice/low-credit.ts:77–82 (lowCreditTriggered): £5 or less A …
- src/lib/voice/eligibility.ts:62–81: owner only, calls on, management …
- src/lib/voice/queue-server.ts:176–186 and 209: a call is claimed que …
- src/lib/voice/store-server.ts:125–141 (dayFacts): only direction 'ou …
- src/lib/voice/fallback-server.ts:28–35: the missed-call fallback fir …
- src/lib/voice/fallback-server.ts:42–67: text only to the member's ve …
- src/lib/voice/webhook-server.ts:38–57 + store-server.ts claimEvent: …
- src/lib/voice/run.ts:119–142: a 'ringing' call with no webhook is se …
- src/lib/voice/sms-replies-server.ts:38–41 and 53–64: replies only wh …
- src/lib/voice/tools-server.ts:132–149: template texts only to the nu …
- src/lib/email/si-calls.ts:46–68: handoff and text-forward emails go …
- src/lib/voice/templates.ts:97–134: every text is one GSM-7 segment e …
- src/app/welcome/choices/actions.ts:22–43 + src/lib/intelligence/cons …
- src/app/welcome/choices/CallBox.tsx + src/app/account/notifications/ …
- src/app/welcome/reveal/actions.ts, src/lib/analysis/offers-server.ts …
- 22e (src/lib/home/*, tailoring/browse*, AppShell): no sender in any …
- src/lib/funnels/new-lead-server.ts:21–79: once per lead (conditional …
- src/lib/funnels/price-notice-run.ts:116–179: admin-pressed with a dr …
- 22f 'see what a landlord gets': src/app/(marketing)/for-management-c …
- src/app/api/internal/leads/provision/route.ts:158–184: the provision …
- src/lib/listing/daily-notice-run.ts:58–61 (21e D26): the admin 'pick …
- src/lib/notify/digest-run.ts:394–417, picks-run.ts:1349–1355, picks- …
- src/lib/email/send.ts:76–104 (21e): a keyed 409 counts as sent, 429 …
- src/app/api/twilio/inbound/route.ts:74–105: STOP/START/HELP are hand …
- Call texts never claim the 'sms' slot, so a call does not block that …

**E weekly active** (26)

- reveal_viewed is inApp (counts), logged once per member (dedupeKey ' …
- Opening the view from the header is record-only: /intelligence logs …
- Tapping a question chip is record-only: AnswerChips → recordSiViewAc …
- Part F 'Use this' counts: applyWhatIfAction → answerQuestion(editing …
- 'Run a deep search' counts: deep_search_run (inApp) logged once per …
- Background search layers never log: the only logActivity in src/lib/ …
- Calls placed, answered, missed, voicemail, callbacks, texts and STOP …
- 'Save all 3' logs keep (inApp) per deal with dealId, profileId and e …
- Analyse from the reveal: full_analysis logged once per purchase via …
- reveal→first Keep time is recorded in signup_reveals.first_keep_at / …
- Choices screen: daily email on/off logs notification_settings {key: …
- Calls opt-in records consent (si_call_consents with wording version) …
- Mobile verified logs sms_verified (inApp) once per successful code c …
- 22c: a budget change goes through answerQuestion and logs profile_an …
- 22d: profile_reset is inApp, logged once per reset with dedupeKey `p …
- 22e: home_view is logged by the heartbeat only (presence.ts:57) with …
- 22e: browse_filter (inApp) is logged only when the filter bar posted …
- 22e admin: the 'Home only' per-week row is correct — loadHomeOnly re …
- 22f: mc_signup is recordOnly, once per account (dedupeKey 'mc_signup …
- 22f: 'mc_pack_paid' is a Meta custom event (src/lib/meta/events.ts:2 …
- Every new extra is a short token, number, boolean, uuid or list of t …
- Every call in files changed since R1 goes through logActivity / reco …
- No action is logged in both a page and its server action: reveal pag …
- R1 21f fixes verified on main: E1 profile_started / profile_resumed …
- Dedupe keys added since R1 do not collide across kinds except funnel …
- npm test, lint, typecheck, build pass on main per mechanical.md (2,6 …

**F product direction** (22)

- The reveal is Today's own list by construction: view-server.ts:118-1 …
- One ranking function: rankForMember (rank.ts:101) is the only ranker …
- The 22c lift is applied before the depth cut and re-sorted within ba …
- One mix helper: mixSlots/fillMix (mix.ts) are called only from choos …
- Only chosen deal types: typesFor(member) → typesShown feeds chooseDa …
- Part F judges each variant with Today's own checks (admissible: excl …
- Primary profile has one definition, primaryOf (earliest live profile …
- The voice agent carries no profile, count, deal-type or ranking defi …
- Deal types are one list: GOAL_OPTIONS.dealTypes and AVAILABLE_DEAL_T …
- Budget brackets: the quiz question and the Explorer filter derive fr …
- Part F what-ifs have one variant list (whatIfChanges) and one view b …
- Nav config is one object with the 'decided by Zac' comment; AppSwitc …
- Every header destination is reachable and lights the right item: /ho …
- 375px header (reasoned from the styles; no Playwright in the checkou …
- Tailwind's responsive classes used by the header (sm:hidden, hidden …
- Eye level is one computation on all four surfaces: accuracyView(prog …
- Nothing on the reveal waits for an animation: the page is a server c …
- Continue is visible at every reveal state: it sits in the sticky top …
- The reveal never blocks on the signup search layers: the quiz fires …
- The reveal's data waits are bounded and are data, not animation: get …
- Signup search strong-match stop uses the same chooser (previewToday …
- Tests for everything above pass: node --test rank, what-if, reveal, …

**H gap check** (31)

- Accuracy levels: src/lib/profile/levels.ts accuracyLevel/levelMarker …
- 'I checked N live deals' comes from the stored day choice tally (pro …
- Eye: src/components/StayfulEye.tsx renders layers by level 0–3; siPo …
- Reveal: revealDeals() takes Today's first 1+REVEAL_ALTERNATIVES(2) c …
- Save all 3: reveal/actions.ts saveAllAction only keeps ids present i …
- Continue: IntelligenceView.tsx renders the Continue link in a sticky …
- Choices screen: daily email reads readNotifications().daily_picks wi …
- Account → Notifications: registry key si_calls (column profiles.si_c …
- Tap-to-ask: answers.ts has no typed price; every figure is in Answer …
- Part F what-ifs: whatIfResults counts admissible rows from the real …
- Part G signup search: queueSignupSearch only for reveal accounts, un …
- Part G deep search: startDeepSearch re-quotes and refuses a changed …
- /api/internal/member-searches: in vercel.json (*/5), ?dry=1 lists du …
- Part H offers: analysisOffer (offers.ts) welcome price only for pays …
- Part H UI: RevealAnalyses prices come from offerPricingFor + quoterF …
- PDF: sections.ts has { id: 'second_opinion', label: 'SECOND OPINION' …
- /admin/intelligence: reveals, viewed, median time to first Keep and …
- Intro call once ever: si_calls_log_intro_uidx (schema 6246) + enqueu …
- vCard: src/lib/voice/vcard.ts builds VERSION 3.0 with FN/N/ORG/TITLE …
- Low-credit call: low-credit.ts latestLanding merges the pack's two g …
- Eligibility (eligibility.ts, eligibility.test.ts): owner only, calls …
- Auto top-up link: /si/topup → /account/billing/auto-topup?from=si; A …
- Callbacks: inbound-server.ts answerInitiation has no hours rule; day …
- Text replies: /api/twilio/inbound keeps STOP/START/HELP first; reply …
- Conversation log: si_conversations / _turns (unique conversation_id, …
- Retention: purgeTranscripts deletes turns for conversations started …
- Agent sync: sync-server.ts dry run reads the live agent and lists pr …
- Voice routes: elevenlabs/webhook verifies the HMAC header (401 on a …
- /admin/calls: every si_calls_log row incl. blocked with BLOCKED_REAS …
- B41 manual step is documented: README.md:673-677 says add staff logi …
- Sampled Batch 21 fixes present on main with their named tests: B8 an …

**I conflicts and contracts** (21)

- 22f's management skip vs 23's intro-once index: management_no_deals …
- Consent: profiles.si_calls is written only by setSiCalls (src/lib/in …
- 'Verifying for calls keeps texts off': verifySmsCodeAction passes { …
- The cap: 'si_call' is a SendKind in the daily slot (src/lib/notify/c …
- Low-credit call vs Batch 20's email on the day the call rings: after …
- Call charges vs 21b: settle() debits through debitFace, which never …
- Signup search is house spend: chargeDeep runs only for purpose 'deep …
- 21e's £0 teaser member vs 22's welcome price: the welcome price is c …
- Login landing: one function postAuthPath (src/lib/auth/landing.ts:23 …
- 22d's reset vs reveal_from: 'no reveal after a reset' is the quiz's …
- 22c's budget brackets: filters.ts (BUDGET_CHOICES without u200, inBu …
- 22e's HOME_PATH vs email links: every email and text still links /to …
- 'Save all 3' vs 22d's hidden_tracked_deals vs My deals: saveAllActio …
- 22c re-ranking vs stored lists: rank.ts's return-on-cash lift is app …
- 22e's Home reads Today's stored list read-only (home/server.ts:141-1 …
- Notification settings: the registry is the one list (registry.ts:204 …
- Primary profile has one definition: primaryOf (src/lib/profiles/rule …
- 'I checked N' has one source: profile_today_lists.choice written onl …
- Part F has one implementation: whatIfChanges → whatIfResults (src/li …
- The persona is built in one place: buildSystemPrompt(channel, task, …
- Adding a server tool is forced by types: TOOL_LIMITS (config.ts:51-5 …

**Walk 1: new member** (36)

- Welcome decision is one pure, tested rule (team → invite → disposabl …
- Pack-era (un-welcomed) accounts can never overdraw: shadowModeAllows …
- Quiz home placement is billed to the house for an un-welcomed accoun …
- Mandatory questions have no "Not sure"; level 0 "Waking up" until th …
- Level-up text clears after LEVEL_UP_MS (900 ms) and the next questio …
- Thinking background is loaded client-side after first paint inside a …
- Five budget brackets are offered (u100, 100-200, 200-350, 350-500, 5 …
- The signup search is queued exactly when the mandatory answers first …
- The quiz's keepalive kick runs one 38 s slice of the signed-in membe …
- The reveal gate fires only for a non-team, non-management-only accou …
- The reveal is Today's own first three cards (primary profile) from t …
- The reveal's cards are Today's DealCard with no address, postcode or …
- Save all N keeps only deal ids the member's own reveal recorded, tim …
- reveal_viewed is logged once (dedupeKey) and counts; chip taps, Show …
- Continue is in the sticky top bar on every reveal, server-rendered, …
- What-if "Use this" re-derives the change server-side from the member …
- The no-match line says "I'm searching your area" only when MEMBER_SE …
- Daily email is on by default (profiles.sourcing_alerts default true) …
- The call box is unticked by default; calls switch on only with a ver …
- Pack Checkout started from the quiz returns to the quiz (F32) and To …
- Pack "Not now" on the quiz snoozes the Today card for starter_pack_s …
- With starter_pack_from null the pack is never offered (off) and the …
- Welcome price applies only to the member's own offer_deal_ids, withi …
- Analyse 1–3 runs two at a time with one confirm showing the face tot …
- Short of credit nothing starts: the ticked reports are saved as a re …
- Intro call: once ever (si_calls_log_intro_uidx), owed rather than us …
- The intro script names no deal, address or figure ("No deals on this …
- Answered minutes are charged once per webhook event key (si_webhook_ …
- The si:call_minute price members are told, the agent's minutes_avail …
- A placed call or its missed-call email claims the day's email slot s …
- The low-credit call runs before Batch 20's £5 notice: when it rang, …
- Low-credit call safety: never with auto top-up on, never in the firs …
- The auto top-up link lands on a sign-in-only page; with a saved card …
- Home charges nothing; every tile settles on its own; "properties sca …
- Login lands on Home and the quiz gate sends a brand-new member to /w …
- First daily email: quiz drop-outs get no charged pick, a £0 member g …

**Walk 2: existing members** (48)

- A member created before reveal_from is never sent to the reveal or t …
- Header order is Zac's decided list (eye, Home, Today, My deals, Brow …
- Home charges nothing: Today's 5 is read back from profile_today_list …
- Scanned count: listing_scan_days is recounted from sourced_listings, …
- “Emailed <date>” on Browse comes only from notification_sends with s …
- Browse default is the active profile's own list (deal types, areas, …
- browse_filter logged once per search per UK day (dedupeKey), home_vi …
- Opening /intelligence and tapping a chip are record-only si_view eve …
- Every chip answer reads its figure from settings or the member's sta …
- The welcome price never applies to a pre-reveal member: offerDealIds …
- An older member who already bought PMI (a pmi_addon purchase complet …
- Deep report = full + PMI from settings; first time = full + deep_fir …
- Part F “Use this” re-derives the change from the key alone (whatIfCh …
- Part F on Today only when the day is a near miss, for the active pro …
- Deep search: quoted server-side, re-quoted on start, a changed ‘up t …
- Deep search charged once at min(actual × markup × discount, up to) k …
- Every paid search step is claimed against the search's raw cap and t …
- deep_search_run is logged once (qualifying) when the member starts i …
- Account → Notifications: the Calls switch reuses Batch 8's verified …
- Switching calls on writes profiles.si_calls + si_calls_changed_at, a …
- Intro queued at 20:00 on a Friday is deferred to nextOpening = Monda …
- Intro once ever and one outbound call a member a UK day: unique inde …
- /account/calls: owners only, blocked rows hidden, charged_pence is t …
- Callback from the verified mobile is recognised through sms_contacts …
- Callback from another phone: an inbound row with user_id null and on …
- No low-credit call in a member's first 3 days or on the intro day; t …
- Start again is always the session's ACTIVE profile (no posted id); r …
- A reset clears the live copies and the Batch 13 triggers carry that …
- “Clear everything” also clears About you and the page warns that it …
- Cleared deals are hidden, not deleted and not a Pass: nothing writes …
- The reset tick list and Cleared deals show title, stage and price th …
- Learning cutoff after a restart applied in Today's feedback, keeps-b …
- No reveal and no signup search after Start again or Start blank (src …
- An old pick-email link cannot refill reset goals (src/lib/listing/pi …
- profile_reset logged once per reset, deduped on the restart id, with …
- Start blank makes a profile with no criteria, areas or answers, reco …
- Management stamp set once (first way in kept) by first touch on emai …
- Stamped and unanswered: AppShell skips the quiz and reveal gates; lo …
- sourcing_alerts is written false at stamping only while the mandator …
- Setup resumes at the first step not done; the pack's Checkout succes …
- Every funnel save goes through src/app/leads/actions.ts; go-live sta …
- Framing: /f/* alone gets Content-Security-Policy frame-ancestors * w …
- A funnel lead is charged once by tier through funnel_lead_charge (gu …
- The owner's new-lead email goes once per lead (owner_notified_at cla …
- Legacy rule: an owner whose first funnel predates funnel_tiers_from …
- When a stamped account answers the three questions: managementOnly t …
- mc_signup, funnel_setup_step, funnel_live, funnel_demo_emailed, funn …
- The management page's view count is anonymous (no cookie, IP or acco …

**A database** (21)

- Double run: stage 1 ran supabase/schema.sql twice on a fresh Postgre …
- Idempotency, new sections (schema.sql 5707-6813): every create table …
- Once-only blocks set their marker AFTER the work, in the same transa …
- In-place edits inside old sections (the redefinition risk) all carry …
- Only one name-guarded `pg_constraint` block remains in the whole fil …
- RLS: all 19 new tables (si_call_consents 5903-5915, signup_reveals 5 …
- Every src read or write of a new table goes through createAdminClien …
- Member-facing reads of member data are scoped to the signed-in user …
- ACCESS_COLUMNS: `git diff 91c76c2 HEAD -- src/lib/access.ts` only re …
- Columns the new code reads/writes all exist: stage 1 resolved 760 .f …
- The reverse (created but never named in src): across the 19 new tabl …
- Check constraints match the code's enums: si_calls_log call_type ('i …
- New functions: all nine new public functions have search_path pinned …
- RPC argument keys match each function's reads: credit_plan_cycle(p_u …
- funnel_lead_charge's UK month key (date_trunc('month', now() at time …
- Safety-rule indexes on si_calls_log (6245-6250) match the rules the …
- Seeds vs live (mech/billing-settings-r2.txt vs live-markers.md): all …
- 22f absent on live at 13:15 UTC: there is no guard, marker or condit …
- Private schema and trigger plumbing: `create schema if not exists pr …
- credit_forgive_overdrafts (5796-5815) matches how credit_debit names …
- Tests and CI for the schema: .github/workflows/ci.yml:32-74 runs shi …

**G code health** (32)

- npm test 2,677/2,677 pass, lint 0 errors (67 warnings), typecheck cl …
- CI runs on every pull_request (no branch filter, so PRs to main incl …
- CI schema job loads supabase/schema.sql twice with ON_ERROR_STOP and …
- 22e's new SQL check step is in CI (scan-days-smoke.sql, 'Properties …
- credit-smoke.sql asserts the Batch 23 call safety indexes (second ca …
- ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID, ELEVENLABS_WEBHOOK_ …
- ELEVENLABS_VOICE_ID documented with the fallback rule (Lily, never R …
- TWILIO_FROM_NUMBER documented (sender when no Messaging Service; mus …
- MEMBER_SEARCH_ENABLED IS documented, contrary to mechanical.md §3 — …
- No secret is NEXT_PUBLIC_: the 7 NEXT_PUBLIC_ names are the Supabase …
- No 'use client' file reads a non-NEXT_PUBLIC env — mech §3; spot-che …
- No TODO / FIXME / XXX / HACK in any src or supabase file changed sin …
- Every NEW server-side fetch since R1 carries a timeout: elevenlabs-s …
- Client-side fetches without a signal (BillingClient, AutoTopupOneTap …
- A timed-out or 5xx narrator call is not charged and its reservation …
- The reveal never waits for a provider: /welcome/reveal/page.tsx:55 l …
- The eye cannot get stuck 'thinking' from a search: IntelligenceView. …
- Signup-search provider steps are house spend and never charged to th …
- Tap-to-ask answers use no LLM: src/lib/intelligence/answers.ts is pu …
- ANTHROPIC_API_KEY unset → /api/summarise answers 503 with a plain me …
- A call with no post-call webhook is reconciled: after STALE_RINGING_ …
- A late post-call webhook cannot charge a reconciled call: finishCall …
- Every webhook event is claimed once in si_webhook_events before any …
- Every call charge is keyed (si_call_charges.charge_key unique) and c …
- Missed-call email on a Resend outage: sendEmail returns sent:false a …
- Stripe down on the £25 auto top-up page: with a saved card the one-t …
- Low-credit call failure at placement does not swallow the £5 notice: …
- Text reply to an inbound text is returned as TwiML (api/twilio/inbou …
- A deep search's reservation outliving the search is harmless: credit …
- si-calls, member-searches, cheap-rescreen and restream-backfill all …
- npm audit: 0 vulnerabilities after the R1 next@16.3.7 bump; nothing …
- mechanical.md's env table re-checked: 47 of the 49 'read-but-undocum …

**Second round 1** (242)

- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:H (second round): Batch 21's approved fixes on main with the …
- [round1:D] restream-backfill time budget: src/app/api/internal/restr …
- [round1:D] restream-backfill real run chunking: src/lib/deal-quality …
- [round1:D] restream-backfill entry points: not in vercel.json (one-o …
- [round1:D] restream-backfill OFFSET paging under concurrent writes: …
- [round1:D] cheap-rescreen snapshot wait is bounded: src/lib/deal-qua …
- [round1:D] cheap-rescreen reads are chunked and bounded by the feed, …
- [round1:D] cheap-rescreen index note (not a defect): sourced_listing …
- [round1:D] cheap-rescreen is safe to run twice and self-heals after …
- [round1:D] cheap-rescreen per-area absorb does no network: `existing …
- [round1:D] cheap-rescreen revalidation on a kill: revalidateDeals() …
- [round1:D] Both routes: internalSecretsConfigured then authoriseInte …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22c (cheap deals first) — second-round finder: price rule, a …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:22f — management companies, second round: /admin/management …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:H (Batch 23) / I — second-round finder: the privacy and term …
- [round1:scope — second-round finder: files no reader named] public/i …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] scripts/ …
- [round1:scope — second-round finder: files no reader named] scripts/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/comp …
- [round1:scope — second-round finder: files no reader named] src/comp …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/comp …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/lib/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] src/app/ …
- [round1:scope — second-round finder: files no reader named] STAYFUL_ …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:I — conflicts between batches (second-round finder: "anythin …
- [round1:F (second-round finder: nav bullet)] src/lib/nav.ts:38 and s …
- [round1:F (second-round finder: nav bullet)] src/components/AppShell …
- [round1:F (second-round finder: nav bullet)] src/lib/nav.ts:22-47 — …
- [round1:F (second-round finder: nav bullet)] src/components/intellig …
- [round1:F (second-round finder: nav bullet)] src/components/AppSwitc …
- [round1:F (second-round finder: nav bullet)] Every link into /intell …
- [round1:F (second-round finder: nav bullet)] src/lib/nav.test.ts:8-2 …
- [round1:F (second-round finder: nav bullet)] All ten AppShell `activ …
- [round1:F (second-round finder: nav bullet)] src/components/AppSwitc …
- [round1:F (second-round finder: nav bullet)] src/components/credit/U …
- [round1:F (second-round finder: nav bullet)] 375px fit (arithmetic, …
- [round1:F (second-round finder: nav bullet)] src/components/ProfileP …
- [round1:F (second-round finder: nav bullet)] src/app/markets/layout. …
- [round1:F (second-round finder: nav bullet)] src/lib/nav.ts:122-124 …
- [round1:F (second-round finder: nav bullet)] src/lib/nav.ts:135-143 …
- [round1:F (second-round finder: nav bullet)] src/lib/nav.ts:153-181 …
- [round1:F (second-round finder: nav bullet)] src/proxy.ts:9 and src/ …
- [round1:F (second-round finder: nav bullet)] src/lib/home/eye-server …
- [round1:F (second-round finder: nav bullet)] R1 F22 — src/app/str-re …
- [round1:F (second-round finder: nav bullet)] src/components/marketin …

**Second round 2** (119)

- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:H (second round) — Batch 21 approved fixes: the 35 R1 ids no …
- [round2:D] The SMS auto-reply is OUTSIDE src/lib/notify/cap.ts, deli …
- [round2:D] notification_sends has no CHECK on kind — only slot and s …
- [round2:D] claim_notification_slot (supabase/schema.sql:2436-2460) i …
- [round2:D] The si_call claim uses the default channel 'email' (src/l …
- [round2:D] Intro call: src/lib/voice/triggers-server.ts:224-229 → pl …
- [round2:D] Low-credit call: src/lib/voice/low-credit-server.ts:65 go …
- [round2:D] Missed-call fallback: src/lib/voice/fallback-server.ts:92 …
- [round2:D] claimEvent-backed slots ('twilio_sms_reply' at sms-replie …
- [round2:D] handoffEmail (src/lib/voice/tools-server.ts:158) and text …
- [round2:D] In-call texts (src/lib/voice/tools-server.ts:131-147): ou …
- [round2:D] Missed-call text and email are charged only after they we …
- [round2:D] memberFacts.numberOk (src/lib/voice/member-server.ts:56) …
- [round2:D] SMS_REPLY_WHO and SMS_REPLY_OTHER pass the sendSms body r …
- [round2:D] Auto-reply charging: once per MessageSid (claimCharge `sm …
- [round2:D] Inbound route (src/app/api/twilio/inbound/route.ts:74-105 …
- [round2:D] SI_CALLS_ENABLED is described as 'lets calls be placed an …
- [round2:D] No new capped member email was added by Batch 22 or 22c–2 …
- [round2:D] New or changed email senders outside Batch 23 are all tra …
- [round2:D] The Batch 8 alert text run (src/lib/sms/alerts-run.ts:148 …
- [round2:D] The £5 notice sent alone (src/lib/credit/low-credit-serve …
- [round2:D] src/lib/email/send.ts since R1 (D2/D18/G9): 10 s timeout, …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:scope (second-round finder: files changed since R1 that no r …
- [round2:G] No TODO / FIXME / XXX / HACK was added anywhere since R1 …
- [round2:G] src/lib/home/config.ts:3 claim "nothing else defines them …
- [round2:G] src/lib/home/scan-days.ts:32 and server.ts:112 claim "no …
- [round2:G] src/lib/funnels/tiers.ts:25 claim "Batch 23's intro and l …
- [round2:G] src/lib/voice/config.ts:10 claim holds: the constraint Ba …
- [round2:G] src/lib/voice/templates.ts:3 claim "nothing else in the c …
- [round2:G] src/components/intelligence/IntelligenceView.tsx:17,122: …
- [round2:G] src/lib/nav.ts:126 NAV_DESTINATIONS ("for Batch 26") is n …
- [round2:G] src/lib/intelligence/consent.ts:5 claim "which the calls …
- [round2:G] src/lib/persona/stayful-intelligence.ts:7,30 (Batches 25/ …
- [round2:G] Batch 24 references (src/app/admin/conversations/page.tsx …
- [round2:G] Batch 25 references (src/lib/profiles/rules.ts:236, src/l …
- [round2:G] Batch 26 references (IntelligenceView.tsx:17,122, src/lib …
- [round2:G] Batch 29 reference (src/lib/funnels/tiers.ts:29) refines …
- [round2:G] Batch 28 references (src/lib/market/goals.ts:145,203, src …
- [round2:G] Pre-existing "not built yet" notes unchanged since R1: .e …
- [round2:G] Soft-marker sweep of added comment lines (for now / comin …
- [round2:G] mechanical.md §6 (31 items, mech/todos.txt) agrees with t …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] node_modul …
- [round2:F (second-round finder: the 375px header bullet)] src/app/la …
- [round2:F (second-round finder: the 375px header bullet)] src/app/gl …
- [round2:F (second-round finder: the 375px header bullet)] src/compon …
- [round2:F (second-round finder: the 375px header bullet)] Repo-wide …

### E. Inventories and the two walks

The brief's inventories as the readers returned them: the new tables, functions and settings (A); every charge path with its key (B); the call types, text templates, agent tools and webhook checks (C2); every new or changed job (D1); the contracts' index (I); and the two walks, step by step with file:line. The D2 message table is folded into section 6.1's conflicts and the D findings.

### B1 money: charge paths

#### Every charge path added or changed since R1 (amounts at live values: full_analysis_pence 400, pmi_addon_pence 200, deep_first_run_extra_pence 100, reveal_analysis_discount_pct 50, deep_search_markup 5, deep_search_max_raw_pence 300, deep_search_first_discount_pct 50, si_text_pence 22, si_email_pence 20, si:call_minute raw 13p × markup 5, funnel_tiers 500/400/325/250 + 200, spend rate top-up 1.3)

| # | What | Where (file:line) | Setting read | Amount at live values | Who is debited | Idempotency key / guard |
|---|---|---|---|---|---|---|
| 1 | Full analysis (list) | src/lib/analysis/deal-analysis.ts:316-333 (quote), :589-648 (debit) | full_analysis_pence, pmi_addon_pence, deal_open_ladder (unit-costs.ts:160) | £4 less the Quick-look paid (+£2 PMI only if delivered) | payer (team owner for a member); admin free | analysis_purchases pending claim per (user_id, deal_id); debit action_id = purchase id; allowNegative true |
| 2 | Welcome-price Full analysis | src/lib/analysis/offers.ts:98-101 via offers-server.ts:77-80; deal-analysis.ts:316 | reveal_analysis_discount_pct, reveal_welcome_days, floored at fullAnalysisRawCeiling | max(£2, 216.835p) = **£2.17** at the seed unit costs (£2.50 if list were £5) | the member only (paysForSelf) | analysis_purchases_welcome_uidx (buyer_id, deal_id) where offer in (welcome, welcome_deep) and status <> 'failed'; usedWelcomeOn |
| 3 | Welcome-price Deep report | offers.ts:102-108 | as 2, floored at the full+PMI raw ceiling (291.835p) | £3.00 (lines 200 + 100) | member | welcome uidx + first_deep uidx (firstDeep when never had one) |
| 4 | First Deep report | offers.ts:112-116 | deep_first_run_extra_pence | £5.00 (400 + 100; list £6) | payer | analysis_purchases_first_deep_uidx (buyer_id) where first_deep and status <> 'failed' |
| 5 | First PMI add-on from a report | offers.ts:121-126; src/lib/analysis/pmi-addon.ts:92-95, :207-211 | deep_first_run_extra_pence, floored at PMI raw (75p) | £1.00 (list £2) — currently unreachable (finding 2) | payer | pmi_addon pending claim per report (+ stale sweep); first_deep uidx; debit action_id = purchase id |
| 6 | Deep search | src/lib/sourcing-demand/member-search.ts:506-517 (quote), :528-551 (start/reserve), :471-491 (charge) | deep_search_markup, deep_search_max_raw_pence, deep_search_first_discount_pct, deep_search_monthly_cap_pence, deep_search_nearby_areas | first: about ≈ raw est × 5 × 0.5, up to £7.50; later up to £15; charged min(actual raw × 5 × (1−disc), up to) | payer (row.payer_id) | reservation (60 min) on the search id; actionAlreadyCharged(search id); member_searches_first_discount_uidx (payer_id); member_searches_active_uidx (user_id); member_search_claim per step |
| 7 | Signup layered search | member-search.ts:158-178 (queue), :340 and :404-436 (steps), :445-466 (finish) | signup_search_cap_pence, signup_search_monthly_cap_pence, signup_* limits | ≤ 50p raw per sign-up, ≤ £20 raw a month | **house** (runMetered userId null); never the member | member_searches_signup_uidx (user_id); member_search_claim advisory lock per purpose |
| 8 | Call minutes | src/lib/voice/charge-server.ts:145-151 from webhook-server.ts:127-131 | unit_costs row si:call_minute (raw 13p × markup 5) — **not** si_call_pence_per_min | ceil(seconds × 65p / 60), capped at the displayed balance | payer (owner for a team member's callback); admins and suspended seats free; unknown callers never | si_webhook_events (provider, event_key); si_call_charges.charge_key call:<id>:minutes; debitFace action_id = guard id |
| 9 | Texts during a call | src/lib/voice/tools-server.ts:131-146 | si_text_pence | 22p each, ≤ si_texts_per_call_max (2) per call | payer | charge_key call:<id>:text:<template>; si_text_slot <call>:<n> |
| 10 | Missed-call text + email | src/lib/voice/fallback-server.ts:42-67 | si_text_pence, si_email_pence | 22p + 20p once per missed intro / low-credit call | payer | si_calls_log.fallback_sent_at conditional stamp; guards call:<id>:text:<template>, call:<id>:email:fallback |
| 11 | SMS auto-reply | src/lib/voice/sms-replies-server.ts:66-71 | si_text_pence, si_sms_auto_replies_per_number_day | 22p per reply to a verified member; unknown numbers free | payer | twilio_sms claim per MessageSid; charge_key sms:<MessageSid>; per-number daily slots |
| 12 | SI auto top-up link | src/app/si/topup/route.ts → account/billing/auto-topup; src/app/api/billing/topup/route.ts (autoTopup); src/lib/stripe/webhook.ts:71-78 | reveal_auto_topup_amount_pence, reveal_auto_topup_threshold_pence, topup_presets_pence | £25 card charge, auto top-up on at £5 | the member's card (owners only) | Stripe idempotency topup:<user>:<nonce>; grant pi:<id>; activity auto_topup_on:pi:<id>; 409 when a card is already saved |
| 13 | Auto top-up (existing rule) | src/lib/stripe/auto-topup-core.ts:51-83 | profiles.auto_topup_* | member's chosen amount | member's card | auto_topup_last_at claim; idempotency autotopup:<user>:<minute-slot> |
| 14 | Funnel lead, tier pricing | src/lib/funnels/charge-server.ts:39-49 (hold), :68-133 (charge); schema.sql:6737-6790 funnel_lead_charge; src/app/api/f/[token]/analyse/route.ts:180-265; src/app/api/internal/funnel-queue/route.ts:123-193 | funnel_tiers, funnel_enhanced_extra_pence, funnel_tiers_from, funnel_notice_days | £5.00 / £4.00 / £3.25 / £2.50 per lead by number in the owner's UK month, + £2.00 enhanced (× 1.3 from top-up credit) | funnel owner | funnel_lead_charges.lead_id PK (already = true on retry); owner row lock; meta lead_id / lead_number, deliberately no action_id |
| 15 | Funnel lead, legacy owner | same files, mode 'legacy' | funnel_markup (2) | metered per provider call as before R1 | funnel owner | R1's action refund path |
| 16 | £5 profile credit (22d) | src/lib/profile/server.ts:413-436 | profile_complete_pence (500) | grant, once per account, never re-paid after Start again / Start blank | — (grant) | credit_grants.source_ref profile_complete:<user>; profile_quiz.credit_grant_id never cleared by reset_search_profile |
| 17 | 22c cheap deals first | — | — | no price, charge or profit figure changes (verified in the diff) | — | — |

Observed member prices at live values: Full analysis £4 · Deep report £6 · first Deep £5 · welcome analysis £2.17 (seed floor) · welcome Deep £3 · deep search first ≈ £2–3 about / £7.50 up to, later up to £15 · call minute 65p · text 22p · fallback email 20p · funnel lead £5.00 → £2.50 (+£2.00 enhanced). Brief: £5 · £7 · £6 · half price · half price first · 65p · 22p · 20p · £5.00 → £2.50.

### C2 safety: calls and texts

#### Call types (src/lib/voice/config.ts CALL_TYPES = intro | low_credit | callback)

| Type | Trigger | Consent check (queue AND dial) | Window | Cap | Charge |
|---|---|---|---|---|---|
| intro (outbound) | profiles.si_calls flips on → consent.ts:47 `after()` → triggers-server.ts onCallsSwitchedOn (enqueue + place at once if inside hours); cron catch-up every 5 min for owners with si_calls on, no intro row, callable number (run.ts:286-328, 20 a pass, shuffled) | owner (team_members), si_calls=true, sms_contacts verified && !stopped_at && +447…, not management-only; auto top-up irrelevant | si_outbound_weekdays [1-5], si_outbound_start/end 9-19 Europe/London; outside → not_before = next opening | once ever (intro_uidx); one outbound per UK day; one queued/ringing; waits a day for credit or number; dropped (deleted, still owed) after 4 days queued (STALE_QUEUED_MS) | needs ≥ 60 s affordable after a 2×22p reserve; answered seconds at si:call_minute (65p/min, capped at balance); contact-card text 22p; missed/voicemail → text 22p + email 20p; never charged if missed/failed/voicemail |
| low_credit (outbound) | afterDebit (after-debit.ts:130, 159) → maybeQueueLowCreditCall: balance ≤ low_credit_pence (£5) AND spent ≥ si_low_credit_spent_ratio (80%) of the newest top-up / plan / pack landing within si_low_credit_window_days (7) | as intro, plus auto top-up off, ≥ si_low_credit_min_member_days (3) since profiles.created_at, not the intro's UK day | same; if outside hours the call is queued for the next opening and Batch 20's £5 email goes today | one per landing (low_credit_uidx on user_id + trigger_ref = grant id — including blocked rows, finding 1); one a day; one in flight | minutes 65p/min; auto top-up text 22p; missed → text + email 42p; balance NOT re-tested at dial (finding 2) |
| callback (inbound) | someone rings TWILIO_FROM_NUMBER → ElevenLabs conversation-initiation webhook → answerInitiation | caller_id must equal a verified, non-stopped UK mobile on sms_contacts; si_calls NOT checked; unknown/withheld → generic answer | any hour, any day | none; does not count toward the day or in-flight indexes | recognised: minutes to the payer (owner for a seat), capped at balance; texts 22p; unknown: free, no texts, hash of number only |
| deal (Batch 25) | not built; CALL_TYPES/check constraint/placeCall context/fallback all intro-or-low_credit only | | | | |

Which number: sms_contacts.phone_e164 for the member's own user_id (member-server.ts:50), only ever written with verified_at (sms/store.ts:76-91); one verified number per account (schema.sql:2643). Never profiles.mobile, never the consent row, never anything said on a call.

#### Text templates (src/lib/voice/templates.ts — fixed strings; variables filled by the server only: siteUrl(), reveal_auto_topup_amount/threshold)

| Name | Sent by | Body |
|---|---|---|
| contact_card | agent tool / resend | "Here's my contact card. Tap to save me, so you know it's me when I call: <base>/si/card" + "– Stayful Intelligence" + "Reply STOP to opt out" |
| auto_topup_link | agent tool / resend | "Your one-tap link to turn on auto top-up (£25 when you drop below £5): <base>/si/topup" + sign-off + STOP |
| resend_last_link | agent tool | resolves to whichever of the two was last sent to this member (default contact_card); same charge key, so never a third template |
| missed intro | fallback-server | "I tried to call to introduce myself. Save my number so you know it's me: <base>/si/card" |
| missed low credit | fallback-server | "I tried to call you - you're nearly out of credit. Auto top-up in one tap: <base>/si/topup" |
| SMS_REPLY_WHO | sms-replies-server (TwiML) | "It's Stayful Intelligence, your AI property assistant from Stayful. Ring me on this number any time." + STOP |
| SMS_REPLY_OTHER | sms-replies-server (TwiML) | "Thanks, I've passed that on. You can also ring me on this number." + sign-off + STOP |
| emails | email/si-calls.ts | missed intro / missed low credit to the member (same links); handoffEmail and textForwardEmail to feedback_admin_email |

Cap: 2 per call (TOOL_LIMITS + si_texts_per_call_max + slot rows). STOP: numberOk excludes stopped_at; SMS replies skip stopped numbers. No template carries an address, postcode or listing link. /si/card is public (SI's own vCard: name, number, logo); /si/topup redirects to the signed-in auto top-up page.

#### Agent tools (src/lib/voice/tools-server.ts; configs in agent/tools.ts; per-call limits config.ts TOOL_LIMITS)

| Tool | Limit/call | Reads | Writes / sends | Returns to the agent |
|---|---|---|---|---|
| lookup_caller | 3 | profiles (si_calls, auto_topup_amount_pence, created_at, full_name, email), sms_contacts, team_members, credit balance (read, not returned), management stamp | si_tool_calls | first_name, member_status, last_called_about (= call.context), auto_topup on/off; unknown caller → an instruction only. `number` argument ignored |
| send_template_text | 2 (and si_texts_per_call_max) | as above + si_call_charges (last template) + settings | si_call_charges guard, si_webhook_events slot, Twilio SMS to m.phone only (refused if the number on the call differs), debitFace 22p via settleText (→ afterDebit), si_calls_log.texts_sent / charged_pence | "Sent" or a refusal line |
| handoff_to_team | 1 | memberFacts, feedback_admin_email | si_calls_log.handoff, si_conversation_questions (handed_off), email to admin (name, email, masked phone, question, summary, transcript link) | a line to say |
| log_question | 40 | — | si_conversation_questions | "Logged" |
| built-in | — | — | end_call; voicemail_detection (hang up, no message) | — |

None returns a balance, an address or a deal figure; none changes a setting; none takes payment; texts go only to the number on file. Data collection: member_unhappy (boolean) → a question row from the post-call webhook.

#### Variables at conversation start (agent/variables.ts VARIABLE_NAMES)
first_name (or "there"), caller_status member|unknown, call_type, context intro|low_credit|missed_intro|missed_low_credit|member|unknown, card_sent, minutes_available (balance-derived, 1-10), topup_amount "25 pounds", topup_threshold "5 pounds", persona_version; plus secret__tool_token (the tool header). Opener per context from agent/scripts.ts, sent as a first_message override.

#### Webhook and route checks

| Endpoint | Auth | Replay / idempotency |
|---|---|---|
| POST /api/voice/elevenlabs/webhook | ElevenLabs-Signature `t=<unix>,v0=<hex>`: HMAC-SHA256(ELEVENLABS_WEBHOOK_SECRET, `${t}.${raw}`), |now−t| ≤ 30 min, timingSafeEqual per v0, before parsing | si_webhook_events (elevenlabs, `${type}:${conversationId}`): done → 200 duplicate, busy (< 2 min) → 409, retry after an error; RetryLater → 409 so ElevenLabs redelivers |
| POST /api/voice/elevenlabs/initiate | x-si-secret = ELEVENLABS_INITIATE_SECRET, constant-time | none: each POST inserts an inbound ringing row and returns the tool secret (finding 3) |
| POST /api/voice/tools/[tool] | x-si-tool-token = ELEVENLABS_TOOL_SECRET (from a secret__ dynamic variable), constant-time; tool name in TOOL_NAMES; must match a ringing row within max_call_seconds + 5 min | si_tool_calls counts (ok rows) per call; text slots in si_webhook_events; charge keys in si_call_charges |
| POST /api/twilio/inbound, /status | X-Twilio-Signature (HMAC-SHA1 over URL + params) against siteUrl(path) and request.url, constant-time | sms_messages unique sid; replyToText claims twilio_sms:<MessageSid> and twilio_sms_reply:<hash>:<ukDay>:<n> (3 a day) |
| GET /api/internal/si-calls (*/5) | authoriseInternal (cron bearer / internal secret); maxDuration 120 | every write guarded on apply; ?dry=1 and ?only=<email>; retention once a UK day via claimEvent `retention:<day>` |
| Twilio voice | no inbound voice webhook in the app (ElevenLabs owns the number); the app only POSTs Status=completed and GETs a call with basic auth (twilio-voice.ts) | — |

#### What still happens when the flags are off
- SI_CALLS_ENABLED unset: no outbound row is queued (enqueueCall 'disabled'); the cron lists intros due but queues none and leaves queued rows untouched ('disabled'), which go stale after 4 days; no low-credit call and the Batch 20 email runs as before; no SMS auto-reply (Batch 8 STOP/START/HELP unchanged); BUT inbound calls are answered, matched, charged and can text, and the post-call webhook charges (finding 5); the reconcile still sends fallbacks for rows placed earlier.
- SI_CALLS_DRY_RUN=true: rows are queued and re-evaluated each pass but never claimed (never 'placed', never take the cap slot, never charge); tool texts, the fallback text and email are logged instead of sent and their charges released; SMS auto-replies and inbound-call minute charges are NOT covered (finding 7).

#### Schema indexes (schema.sql:6244-6247) — states they do not cover
- one_a_day: only rows that reached the queued→ringing claim (uk_day set); a 'failed' placement counts as the day's call; inbound rows never count (by design).
- in_flight: outbound queued/ringing only; an inbound callback and an outbound call can overlap (by design).
- intro: any status, so a blocked intro row would be the member's one intro ever — the only writer of such a row is placeCall's 23505 branch (queue-server.ts:183-186), which the in_flight index makes practically unreachable.
- low_credit: any status, so a blocked row consumes the landing (finding 1); a null trigger_ref would escape the index entirely, but only maybeQueueLowCreditCall enqueues low_credit and it always passes the landing id.

### D1 crons and queues

#### Every job new or changed since R1

| Job | Schedule / trigger | Auth (position) | maxDuration | Internal budget | ?dry=1 prints / still writes | Claim or lease | Crash half-way → next run |
|---|---|---|---|---|---|---|---|
| `/api/internal/si-calls` (NEW, 23) `src/lib/voice/run.ts` | `*/5 * * * *` | internalSecretsConfigured → authoriseInternal → hasServiceRole, lines 24-26, before any read | **120** | **none** (20 placements × ≤15 s ElevenLabs, 20 reconciles × ≤8 s Twilio, intro scan, 10 purge loops; no deadline) | prints intros due, due calls with `would` (type, vars incl. first name), stale ringing rows with their Twilio status, purge `due`; writes nothing; **reads Twilio** for stale rows | queued→ringing conditional update + 4 unique indexes (one a day, in flight, intro ever, low-credit per landing); reconcile `status in ('ringing')`; purge claimed per UK day in si_webhook_events | queued → placed next run; ringing with ids → settled from Twilio at 30 min (minutes never charged; fallback if missed); **ringing without ids → 'failed' at 30 min, no fallback, webhook 409s forever**; purge error → skipped for the day |
| `/api/internal/member-searches` (NEW, 22) `src/lib/sourcing-demand/member-search.ts` | `*/5 * * * *` (plus the quiz kick `/api/welcome/search` and `/api/deep-search` start, both session-gated, 38 s slice) | authoriseInternal lines 20-21; `MEMBER_SEARCH_ENABLED` gate skipped on dry | 60 | 50 s; ≥5 s left to start a search; slice deadline before each step/check; snapshot wait bounded | `{enabled, due: n, ran: []}` — a count, no ids; writes nothing | 90 s lease (`lease_until`, conditional update), cursor saved per step; `member_search_claim` advisory lock + per-search cap + monthly ceiling; one active search per member; deep charge keyed on search id; reservation 60 min | re-leased after 90 s and resumed from cursor; unsettled claim stays claimed (safe); deep debit never doubles (actionAlreadyCharged) but a kill between debit and save leaves charged_base_pence 0 |
| `/api/internal/restream-backfill` (NEW, 22c) `src/lib/deal-quality/restream-run.ts` | no schedule; `/admin/deals` "Dry-run the re-stream" / "Re-stream deals" (requireAdmin) | authoriseInternal lines 20-21 | 60 | none (pages of 1000, updates of 200; no network) | counts per stream before/after + up to 40 moves (id, area, beds, price); **writes one marketplace_runs row (dry=true)** | idempotent recompute; `.or('stream.is.null,stream.neq.project')` | part-moved; re-run completes |
| `/api/internal/cheap-rescreen` (NEW, 22c) `src/lib/deal-quality/cheap-rescreen-run.ts` | no schedule; `/admin/deals` buttons | authoriseInternal lines 21-22 | 60 | snapshot wait 20 s; no overall budget | candidates, how they screen, would-add list; **writes one marketplace_runs row (dry=true)**; no provider call | candidates exclude URLs with a deal; absorb keyed on canonical_url | partially absorbed; re-run adds the rest |
| scan-day recount (22e) in `sweep-run.ts:201`, `picks-run.ts:684`, `low-entry-run.ts:270` | sweep `*/10 5-6`; sourcing 07:00/20/40/50; low-entry 03:00/10/20 | (their routes, unchanged) | 60 | (their budgets) | dry returns before the call | `record_listing_scan_days`: delete-missing + upsert in one statement, PK (day, area, kind) | next job recounts yesterday and today |
| `/api/internal/funnel-queue` (changed 21e/21g/22f) | `7,37 * * * *` (was */30) | authoriseInternal lines 69-71 | 60 | START_BUDGET 15 s (no new lead after it) | `would_run` / `still_short` per lead; no lease, reserve, run or alert | `leaseQueuedLead` (5-min lease on updated_at); `reserveSpend` day cap; `funnel_lead_charge` guard on lead_id (tiers); `owner_notified_at` + Resend key | queued lead re-leased after 5 min; tiers: nothing charged until complete; legacy: metered debits of a killed run stay (R1 D13); **completed-but-uncharged lead never reconciled** |
| Funnel price notice (NEW, 22f) `src/lib/funnels/price-notice-run.ts` | no cron; `/admin/management` "Dry run the notice" then "Send" | requireAdmin (session + isAdminEmail) in the action | page default (server action; Fluid default 300 s assumed) | 45 s, `remaining` / `ranOutOfTime` | audience count, sample emails, subject, preview; writes nothing; 409 until `funnel_tiers_from` exists | `funnel_price_notice_sent_at` stamped after each send, `.is(null)`; Resend key `funnel-price-notice:<owner>` | unsent owners stay in the audience; press again |
| `/api/internal/crm-deliveries` (changed 21e/21g) | `*/10 * * * *` | authoriseInternal | 60 | 40 s | due ids only; nothing sent | 5-min claim on next_attempt_at | claim expires; retried |
| `/api/internal/lead-retention` (changed 21e D17) | `15 2 * * *` | authoriseInternal | 60 | — | counts only | conditional mark before send, undone on failure | marks undone or kept consistently |
| `/api/internal/market-warm` (changed 21e D23) | `45 4 * * *` | authoriseInternal | 60 | 50 s; key stats only within first 20 s | `dryRun()` reads, no spend | — | snapshot build carries on in cache |
| `/api/internal/listing-recheck` (changed 21b) | `3 6 * * *` (was 06:00) | authoriseInternal | 60 | existing budgets | wouldFetch / wouldRefresh lists, no fetch | per-URL try/catch; deferred rows | rows wait for tomorrow |
| `/api/internal/picks-paused`, `/api/internal/daily-digest` | 08:20 (was 08:00), 08:10 | unchanged | 60 | unchanged | unchanged | unchanged | unchanged (comment-only changes) |
| `/api/internal/leads/provision` (changed 21e/22d) | POST from n8n | authoriseInternal({ n8n: true }) line 83 — the only route taking N8N_SHARED_SECRET | 30 | — | none (not a cron) | — | — |
| Agent sync (NEW, 23) `/admin/calls` → `src/lib/voice/agent/sync-server.ts` | admin button, Dry run then Sync | requireAdmin in the action | page default | — | one ElevenLabs GET; lists prompt/voice/max-call/tool changes; writes nothing | tool ids kept in billing_settings.si_agent_tool_ids | partial: tools created, agent not patched; re-sync updates |

#### vercel.json vs README
36 schedules on 25 routes; every path has a route. Matches README §Member emails table, §17 step 6, §18 step 2, §19 step 8 and every per-job mention except README line 457 (project-checks hour 05 now :02–:52) and .env.example line 255 ("33 schedules, 23 routes"). Four pairs share an exact schedule (03:00 credit-sweep + low-entry; 04:00 planning-signals + deal-checks; */10 crm-deliveries + monday-funnel; */5 member-searches + si-calls). The Vercel plan could not be read through the API (the team object carries no billing field); a deploy that accepts 36 entries at */5 implies Pro (Hobby allows 2 daily crons), whose limit is 40 — four slots left for Batches 24–26.

#### Missed-call fallback (text + email)
One text and one email per missed outbound intro/low-credit call: `si_calls_log.fallback_sent_at` conditional stamp (at-most-once), then `si_call_charges` keys `call:<id>:text:<template>` and `call:<id>:email:fallback` (once each, 22p / 20p via settleText/settleEmail), Resend key `si-missed:<id>`. Fired from the post-call webhook (missed/voicemail), the initiation-failure webhook (busy/no-answer), the AMD webhook (machine) and the 30-minute reconcile; all four converge on the same stamp.

#### Retention of si_conversations
Delete = `purgeTranscripts` (src/lib/voice/retention-server.ts) called by `runCalls` step 4 (src/lib/voice/run.ts:147-166) under `/api/internal/si-calls` (`*/5`, in vercel.json), once per UK day, 500 × 10 rows, days from `si_transcript_retention_days` (90 live). `?dry=1` reports `retention: { ran: false, due, purged: 0 }`. Runs with SI_CALLS_ENABLED unset.

### I conflicts and contracts

Traced every batch pair the brief names (22 vs 22d vs 22e vs 22c on 'shown' rows; 22/19/8/23 on consent; 1/22/22f on notification settings; 6/20/21e/23 on the cap; 22f vs 23 on the intro skip; 21h/22/22e/22f on landing; 22d vs reveal_from; 22c brackets across what-if/reveal/lead form/Explorer; 22e HOME_PATH vs email links; 22 Save-all vs 22d hidden vs Batch 5; 21e £0 teasers vs 22 welcome price; 21b shadowModeAllows vs 22 searches and 23 charges) plus two found on the way (the Batch 10 picks backfill vs 22f's stamp; Batch 23's own safety rules vs its once-per-landing index). Files read end to end: src/lib/voice/* (config, queue-server, eligibility, triggers-server, run, cap-server, low-credit(-server), member-server, store-server, webhook-server, tools-server, retention-server, sms-replies-server, inbound-server, fallback-server, charge(-server), settings, hours, templates, agent/*), src/lib/conversations/log-server.ts, src/lib/persona/stayful-intelligence.ts, src/lib/intelligence/* (consent, choices, config, reveal, reveal-server, what-if, what-if-server, settings, view-server, answers head), src/lib/today/{choice,view-server,checked,refresh,forget-server,selection (relevant parts)}, src/lib/home/{server,scan-days,config,figures head}, src/lib/profiles/{reset,rules,server (relevant parts)}, src/lib/nav.ts, src/lib/auth/landing.ts, src/lib/management/{stamp,stamp-server,setup}, src/lib/notifications/{registry,server}, src/lib/notify/{cap,sends}, src/lib/credit/{after-debit,low-credit-server (parts),action (parts),ledger (parts)}, src/lib/analysis/{offers,offers-server}, src/lib/sms/{verify-server,store (head),choose (line)}, src/lib/market/{filters,lead-goals (parts)}, src/lib/listing/{rank (head),tracked-server (parts)}, src/lib/sourcing-demand/member-search.ts (billing parts), the welcome/choices and welcome/reveal routes, account/notifications actions and page, the notify unsubscribe route, the si-calls and voice tool routes, the management start route, AppShell's gate, and schema.sql sections Batch 22, 23, 22c, 22d, 22e, 22f plus the Batch 10 daily-picks block and claim_notification_slot/credit_reserve. Live markers used: reveal_from, funnel_tiers_from, si_* settings (no live writes). Mechanical.md checked before finishing: nothing there overlaps these findings (its si_* notes are seeds and RLS only).

### Walk 1: new member

**Step 1 — sign-up.** The ad lands on `/signup` (src/app/(auth)/signup/page.tsx:16-17,29,41): headline from `publicOfferNow()` → "Start with £20 of free credit" while `starter_pack_from` is null (live today); pack headline once the cutover is set. Form (signup-form.tsx:21-71): full name, email, mobile (required), password, optional "Text me…" and the Meta checkbox; attribution fields carry the ad. In the Facebook in-app browser the Google button is replaced by "Open in browser / copy link" (google-button.tsx:116,154-165). `signupAction` (actions.ts:57-149) validates, calls `supabase.auth.signUp` with `emailRedirectTo = /auth/callback?confirm=1[&next]`, records attribution/consent (`onEmailSignup`, 118-126), pushes a Monday trial row in `after()` (129-143) and redirects to check-email. The confirmation link → `/auth/callback` (callback/route.ts:27-42): PKCE exchange; opened in another browser (the in-app case) → `/login?error=confirmed_elsewhere` and they sign in by password; then `runSignInHooks` (Monday, lead activation), `onSignIn`, and `postAuthPath` → `/home` (22e, landing.ts:116,143-150) or `/leads` for a management stamp. **Welcome decision**: the first members' page (AppShell.tsx:65; also welcome/page.tsx:56) calls `ensureWelcomeGrant` (welcome.ts:25-105 → welcome-rules.ts:161-169): team seat / open invite / disposable email / mobile already used / cutover unreadable → postpone / pack account → stamped, no grant / else **£20 'welcome' grant** (source_ref `welcome:<id>`, idempotent) and the `sf_ref` referral redeemed. Logged: console warnings on withheld; `welcome_checked_at` + `welcome_withheld_reason` stamped. Charged: nothing. Pack path: nothing granted, `welcome:<id>` absent, so `shadowModeAllows` is false (http.ts:35-39) and the account can never overdraw. AppShell then reads the management stamp (77-78) and `requireProfileStart` sends them to `/welcome?next=/home`.

**Step 2 — the quiz.** `/welcome` (welcome/page.tsx:42-125) grants the welcome credit if not yet, reads the summary, logs `profile_started` (`markQuizOpened`), computes `revealHref` (line 87: reveal member and no restart) and the pack state only before the mandatory answers and only if eligible (90-91: null today). The thinking canvas mounts for reveal members only (97). Each answer → `answerQuestionAction` → `answerQuestion` (profile/server.ts:270-376): a new home postcode is placed once — billed to the house when the account was not welcomed, else metered from the member's credit under a penny (414-439) — goals/about saved as the member (309-325), then bookkeeping with the service role: quiz row, the £5 profile credit at 75% real answers (348, 445-475), `profile_answered`/`profile_not_sure`/`profile_edited`, `welcome_completed` once plus `queueSignupSearch` when the mandatory set first completes (355-360; MEMBER_SEARCH_ENABLED only), `profile_completed` + Meta ProfileComplete, Today re-chosen after the response, live match count. The header (Quiz.tsx:356-391) shows the eye at the accuracy level (thinking while busy), the bar with three markers, the hint, minutes left and "N deals match you"; levels from levels.ts:60-81 (0 Waking up → 1 Basic at mandatory done → 2 Advanced at ≥ ceil(optional×accuracy_advanced_pct 50%) → 3 Stayful Intelligence at the profile-credit count); a level-up shows "<Level> unlocked" for 900 ms (config.ts:121) and the canvas gets a wave. 22c's budget question offers five brackets (questions.ts:250-261; filters.ts:25). When the mandatory answers complete the quiz kicks `/api/welcome/search` (Quiz.tsx:154-160 → route.ts:13-25, one 38 s slice of their own search) and, pack era only, shows the pack screen (162-165). A samples screen precedes the last question (117-125; no address). End of quiz or "Finish later" → `revealHref` (109-115, 179-184). Charged: the geocode (<1p) and nothing else; granted: £5 at 75%.

**Step 3 — the reveal.** AppShell's second gate (AppShell.tsx:81-83 → reveal-server.ts:78-88) sends a reveal member (created ≥ reveal_from = 2026-10-01T19:59:59Z, not a team seat, mandatory done, viewed_at null) to `/welcome/reveal?next=<page>`; it fails open. The page (reveal/page.tsx:33-115) re-checks, redirects stale reveals (viewed on an earlier Today-day) on, then `loadIntelligence` (view-server.ts:103-230): primary profile, `loadTodayView` (today/view-server.ts:38-56 — creates today's list, no charge), the first 1+2 cards (`revealDeals`, REVEAL_ALTERNATIVES = 2), card views, offers per card (135-154), tone match/closest/none (158), "I checked N live deals…" (160), accuracy level, chip facts (172-196), what-ifs and the deep quote only when there is no match (198-202), search status. Then `recordReveal` upserts signup_reveals (deal_ids, offer_deal_ids, shown_ids, checked, no_match, level) and `markRevealViewed` runs in `after()` (→ `reveal_viewed`, counts). What the member sees: the eye and "Here's your best match right now, and 2 close alternatives" / "This is the closest I have today" / "I couldn't find a close match…", the cards as Today draws them (no address), **Save all N** (a plain form → Keep on each recorded deal, first-Keep timing), the running-search line polling `/api/intelligence/status` every 4 s and refreshing when done, the analyses block, the auto-top-up offer (only under £5), the deep-search line (only with MEMBER_SEARCH_ENABLED and no strong match), "I'm at Basic accuracy. Answer N more…", and the question chips (answers.ts, every figure from settings). **Background search** (member-search.ts): layer 1 = Today's preview; a strong match ends it (300-303); layer 2 = OnTheMarket page 1 for the member's own thin/stale screenable areas, PMI only where still thin, each step claimed against the 50p cap and the monthly ceiling (`member_search_claim`), metered as house spend (340), then ≤3 income checks and ≤5 live reads (40/hour across members), then `refreshTodayAfterSearch` pins the revealed cards and swaps unanswered ones (453-466); the 5-minute cron finishes leftovers. **No match**: what-ifs with real counts (what-if.ts), "Use this"/Undo through the quiz, "Change my budget" link; the plain line says "I'm searching your area" only when searches are on. Charged: nothing on the reveal. **Defect**: the first paint is priced before the row exists, so the welcome price is missing and the first tap fails (finding 1).

**Step 4 — the choices screen.** `/welcome/choices` (choices/page.tsx:30-84), reveal members only: "✓ I'll email your 5 best matches every morning" with the price line from the shared quoter (per-pick on live: "Each pick is charged from your credit, its price shown with it."; `daily_picks` default on) and a Turn off/on that writes through the registry (actions.ts:106-114, logged `notification_settings`); the **call box** (CallBox.tsx) unticked, label "Call me when a deal as good as this one comes up, or when I'm running low on credit.", note with 65p/min, texts 22p, emails 20p from settings; ticking without a verified mobile opens the inline code check (`VerifyNumber purpose="calls" source="welcome"`, "Skip — leave calls off"); verifying (sms-actions.ts:130-148 → verify-server.ts:116-162) saves the number with `textsOn:false` (the four text switches stay off) and calls `setSiCalls(…, 'welcome')` (consent.ts:52-74: `profiles.si_calls`, `si_call_consents` row with version `si-calls-2026-10`, activity, intro trigger). Continue (`finishChoicesAction`, actions.ts:121-127) switches calls on only for a ticked box with a verified number, stamps `choices_at`, and goes to `next` (= /home). Defects: the box stays unticked after verification (finding 4); the intro dials immediately (finding 5); a member who never presses Continue never sees this screen again (finding 11).

**Step 5 — the pack.** Today: `starter_pack_from` is null → `starterPackStateFor` is `off` (starter-pack/server.ts:261) → no pack screen anywhere; the member runs on the £20. Pack era: after the mandatory answer the quiz shows `PackScreen` (Quiz.tsx:231-246: StarterPackOffer `screen` variant, consent tickbox, `packShownAction` once a day). **Not now** → `packNotNowAction('welcome')` snoozes the Today card 7 days (starter-pack/actions.ts:288-296) and the quiz carries on; the account stays at £0 and every paid door is refused (no overdraft, 21b), while the daily email still goes with uncharged teasers (21e). **Buy** → `/api/billing/starter-pack` (route.ts:55-193): eligibility re-checked, the Stripe price compared with `starter_pack_price_pence`, saved card = one-click manual-capture + settle; otherwise Checkout whose `success_url` is `/welcome?next=/home&pack=1` for a quiz purchase (F32, line 177) else `/today?pack=1`, with a 10-minute cookie hiding the offer. Back on the quiz it resumes at the next question (no confirmation line — finding 9); the webhook grants `pi:<pi>` (topup, £10) + `pack_bonus:<pi>` (welcome-kind, £20) (R1-reviewed). From the reveal's out-of-credit window the pack returns to /today and loses the reveal (finding 6).

**Step 6 — the first report from the reveal.** `RevealAnalyses` (RevealAnalyses.tsx): per card "Run full analysis · <price>" and "Deep report · <price>" with the strike-through list price and "welcome price"/"first-time price" note when an offer applies, plus a per-card "Analyse all" selector; "Analyse all 3 · £X" asks once ("Run 3 reports for £X in all?") and runs two at a time (`ANALYSES_AT_ONCE`), each `POST /api/deals/[id]/analysis` with the quoted base/face price → `startDealAnalysis` (deal-analysis.ts:253-…): readable/pending guards, visibility, **offer priced server-side** (316: welcome = 50% of full_analysis_pence — 400 on live, so £2 — floored at the raw ceiling; welcome_deep; first_deep = full + £1), `mustAfford` for any offer (319), 409 `price_changed` on mismatch (322), the claim row carries `offer`/`first_deep` with unique indexes (338-365), the Quick-look open is charged first then the rest reserved; then `POST …/analysis/run` streams progress (74-106) to "Open report". **At £0 after Not now** (pack era): labels are 'short' → nothing starts; `saveResumeIntentAction` stores the ticked reports (30 min) and the out-of-credit window opens with the pack offer (or plans/top-up); a top-up Checkout returns with `?resume=` (topup/route.ts:49,126) and `resumeAction` re-quotes and starts only if every price matches, else asks to confirm the new total; a one-click top-up resumes on `CREDIT_CHANGED_EVENT`. 21e: that morning's email still arrives, uncharged teasers. 21b: no overdraft for an un-welcomed account (action.ts:58-60) and, for everyone, never on an offer price (deal-analysis.ts:319). "Price after top-up" is not built (the PR says so): the button shows the plain price and only the tap changes.

**Step 7 — the intro call.** Queued the moment calls switch on (consent.ts:65-72 → triggers-server.ts:94-103 → `enqueueCall` intro): eligibility (eligibility.ts:62-82) = owner, calls on, not management-only, verified not-stopped UK mobile, under the one-outbound-a-day limit, nothing in flight, ≥60 s affordable (65p/min + 2×22p reserve ≈ £1.09 — fine at £20), inside Mon–Fri 09:00–19:00 UK (hours.ts:341-345; bank holidays count as weekdays); a missing number or credit skips without a row (the intro stays owed); outside hours it waits for the next opening and the 5-minute cron (`/api/internal/si-calls`, `?dry=1`, `?only=<email>`; run.ts) places it, after backfilling intros for members who said yes earlier (221-263). `placeCall` (queue-server.ts:227-315) re-checks everything, drops stale (>4 days) queued calls, returns a dry-run answer under `SI_CALLS_DRY_RUN` or without ElevenLabs config (row left queued), claims queued→ringing with the UK day (the one-a-day index is the last word), opens a conversation row, calls ElevenLabs with the dynamic variables (first_name, caller_status, call_type, context, card_sent, minutes_available, topup_amount/threshold, persona_version — never a balance, address or deal) and `INTRO_OPENER`, then claims the day's email slot. **What the member hears** (scripts.ts:87-91): "Hi <name>, it's Stayful Intelligence, your AI property assistant from Stayful. I'm the one searching thousands of short-let deals for you every day… I'll only call when there's something worth your time. I'll give you the headline, and I'll text you the link. You can ring me back… I've just texted you my contact card… Speak soon." — no deal, no address, no figure ("No deals on this call", prompt.ts:129); during it the agent sends the `contact_card` template to the number on file (tools-server.ts:264-298; `/si/card` vCard with TWILIO_FROM_NUMBER), 22p from credit. Charged from the post-call webhook once per event key: answered seconds × 65p/min rounded up, capped at the balance (~44p for 40 s); missed/voicemail free + one "I tried to call" text (22p) and email (20p) once per call (fallback-server.ts). Logged: si_calls_log, si_call_charges, si_conversations (90-day purge), si_tool_calls; `/admin/calls` shows blocked rows with reasons. SI_CALLS_ENABLED gates all of it (config.ts:458).

**Step 8 — the first low-credit moment.** Every debit ends in `afterDebit` (after-debit.ts:397-522). At 'low' (balance ≤ low_credit_pence £5) it tries auto top-up, then **the call first** (`lowCreditCalled` → voice/low-credit-server.ts:121-168): calls on, no auto top-up, balance ≤ £5, the latest *landing* from credit_grants (low-credit.ts:37-64: top-ups, plan credit, the pack's two grants — **not the £20 welcome grant**, finding 2), one call per landing (schema.sql:6247 — a blocked row also counts, finding 3), `lowCreditTriggered` = ≥80% of the landing spent (debits − refunds since it landed) within 7 days; `enqueueCall low_credit` adds auto_topup_on (skip), first_days (<3 days since joining), intro_day; placed at once inside hours else `{called:false}`. Called → the £5 email is marked told (388-395) so it never also goes that cycle; not called → Batch 20's notice (low-credit.ts:231-246) at the top of the next daily email (digest-run.ts:286,337) or alone after 08:30 UTC (257-259; pack-era members get the pack offer). The call's script offers auto top-up and texts `auto_topup_link` → `/si/topup` → `/account/billing/auto-topup?from=si` (sign-in) → one tap: saved card → `/api/billing/auto-topup`; none → £25 Checkout at the preset with auto-topup metadata, the webhook switches it on. Never verified a mobile: the intro is skipped (owed) and a low-credit trigger writes a `no_number` blocked row (notice runs). For today's £20 member the honest answer is: no call, the email only (first_days for the first three days, and no landing at all). **Home on day one** (home/server.ts:118-132 → `member_scanned`): join_day = today, so the baseline (live sourced_listings in the profile's areas and kinds on the join day — every area for "anywhere") is computed live and not stored until tomorrow, new_since = 0, total = max(baseline, reveal.checked); the tile reads "Properties scanned for you: N — Since you joined on 2 Oct, in your 4 areas"; Today's 5 shows "N waiting for you" because the reveal created the day's list; the feed says "Nothing yet this week". `listing_scan_days` was seeded from stored rows and is recounted by the sweep/picks/low-entry runs (picks-run.ts:685). **The first daily email** (21e): the 07:00–07:50 UTC picks passes send Today's 5 with the charged pick only to members with the mandatory answers (profile_incomplete skipped) and never a revealed deal (picks-run.ts:827-835); the 08:10 digest sends everyone else with picks on and `welcome_checked_at` set their teasers (no address), uncharged at £0 or when the profile is incomplete, with the £5/pack decision at the top when due; the 08:20 picks-paused letter only if nothing went. On an intro-call day the call claims the daily slot (cap.ts si_call), so a 9am-BST (08:00 UTC) intro dialled by the cron comes before the 08:10 digest and that day's digest email moves to tomorrow — the brief's own rule.

### Walk 2: existing members

#### Walk (a): paid member from 19 Sep, verified mobile, two profiles (“My deals” primary, “Client: JS” active), kept deals — desktop 1280px

**Header (22e).** Eye “Talk to Stayful Intelligence” (level = the ACTIVE profile's accuracy from the live copies), Home, Today, My deals, Browse, Market Explorer, Analyser, Account, then the Profile pill (names the active profile, switcher), Usage chip, Feedback. No Leads item (owns no funnel). Nothing logged by the header itself; `last_seen_at` touched hourly.

**/home.** Greeting from `profiles.full_name`. Today's 5 tile: read back from `profile_today_lists` for the active profile for the 07:00-UTC day plus `todaysPick` — “N waiting for you · kept · passed” or “on their way … 7am” before a list exists; never chosen, never charged. Properties scanned: `member_scanned` baseline (listings live in the active+other running profiles' areas and kinds on 19 Sep, stored once) + `listing_scan_days` since 20 Sep; note “Since you joined on 19 Sep … in your N areas” (“counted from …” only if `sourced_listings` began after 19 Sep). Time saved: 30 s × scanned + 30 min × (Analyser reports + complete full analyses). Deals picked: distinct ids across every Today list, legacy `today_selections` and the reveal; shows “For this profile; N across all” because they have two profiles. Analyses run: reports + full analyses (full) and own `deal_opens` not via a pick (quick). Total spent: debits − refunds since 19 Sep from the ledger. Saved deals: own entries, cleared ones excluded, split by stage for the active profile with “N across all”. This week: per-day screened/picked/emailed lines (emailed from `notification_sends.summary` of sent sends) + alert/analysis/report events, no address. Visit logs `home_view` (qualifying, once a UK day); tile/feed taps `home_tile_tap`/`home_feed_tap` (record-only). Any tile that fails shows “—”.

**Browse.** Default = “Deals picked for you”: live deals matching the ACTIVE profile (types from `profiles.market_goals/about_you`, areas/budget/must-haves via `judgeDeal`), Best-for-you order, passes removed fresh, cards through `dealCardsByIds` (paid tier: no 48-h delay). “Show all deals” → `?all=1` (the old grid). Nothing matches → 10 nearest with “Budget / Location / Deal type” misses. “Emailed 2 Oct” on cards emailed in a sent daily/alert email. A filter change logs `browse_filter` (qualifying, once per search per UK day). Charges nothing.

**/intelligence (eye).** `requireProfileStart` (passes), `loadIntelligence('header')` = ACTIVE profile: Today's first 3 cards (choosing today's list if none yet — the normal Today choice, uncharged on the web), “I checked N live deals”, accuracy line, prices for Full analysis (£4 live) and Deep report (£6; first-time £5 only if the account never had PMI/first_deep), what-ifs only when tone ≠ match, SearchProgress if a search is running, AutoTopupOffer when balance < £5 and no auto top-up, DeepSearchOffer when tone ≠ match and MEMBER_SEARCH_ENABLED — **but the quote, the search and the result refresh are for the PRIMARY profile (finding)**. Open logs `si_view` (record-only, once a day); chips: credits (balance), open cost (ladder), pack (only if on offer), save, how picked (“I ranked N …”, “Improve accuracy” below level 3), analysis (£4, deep £6, first-time £5 if unused), free delay (free tier only), calls (65p/min from the unit row, “I'm not making calls yet” when SI_CALLS_ENABLED is off), top-up, no match (when Part F applies). Chip taps log `si_view` record-only.

**Part F on Today.** Only when today's list is a near miss, for the active profile; up to 3 one-change what-ifs with real counts; “Show me” logs `si_view`; “Use this” saves through `answerQuestion` (`profile_edited`, qualifying), re-chooses, offers Undo; budget bands link to the quiz.

**Run a deep search.** Offer line “About £X, up to £Y — half price the first time” (first discount per paying account). Run it → `/api/deep-search start` re-quotes, refuses a changed up-to, inserts the row (one at a time: 'busy'), reserves the up-to for 60 min, logs `deep_search_run` (qualifying), runs one 38-s slice; the cron continues. Charge at finish: min(actual raw × 5 × discount, up-to), once, keyed on the search id; reservation released; `afterDebit`. Result: today's list of the PRIMARY profile refreshed with finds that beat unanswered cards; the page refreshes silently — **no result or cost notice (finding)**.

**Deep report on a kept deal.** Deal page prices via `offerPricingFor`: £4 full / £6 deep; first-time £5 unless `analysis_purchases` has a complete `second_opinion=true` row or a claimed `first_deep` for this buyer — an older member who added PMI in Batch 10 has one, so no first-time price (as the brief wants). Charged once via reserve → run → debit; ledger line carries “— first-time price” when it applied; first_deep unique index per buyer (team seats each get one — Low finding).

**Account → Notifications → Calls.** Line: “A short intro call, calls about standout deals, and calls when your credit is low. About 65p a minute…” (deal calls not built — Low). Switch enabled because Batch 8's `sms_contacts` row is verified and not stopped; no re-verification. On: `profiles.si_calls=true`, consent row (version), `notification_settings` logged, intro enqueued in `after()`. At Friday 20:00: eligible except hours → queued with not_before Monday 09:00 UK; cron places it 09:00–09:05 Monday (4-day stale limit not reached); with < ~£1.09 credit no row is written and the cron retries every 5 min (Low). The call: 65p/min charged once from the post-call webhook, capped at the balance; missed/voicemail → one text (22p) + one email (20p), each guarded; the day's email slot claimed.

**/account/calls.** Owner only; every non-blocked row (queued shows “Coming up”), type, status, length, charge (minutes + texts + email).

**Callback.** From the verified mobile: recognised (one account per verified number), context member/missed_intro/missed_low_credit, charged per minute from the webhook once, texts only to that number. From another phone: `user_id null`, hash only, general answer, never charged, no texts.

#### Walk (b): the same member, Start again (22d)

**/profile → Start again.** Confirm screen: “Clear my search answers only” (About you kept) or “Clear everything” (About you cleared for every profile — warned); deals tracked for this profile with title/stage/price (no address when unopened): Keep all / Clear all / Choose which to keep; “You've already had your £5…”. Confirm → `reset_search_profile` on the ACTIVE profile only (live copies cleared; Batch 13 triggers copy into the active row; Client: JS untouched; filter_modes reset; chosen deals hidden) → `profile_reset` logged once → straight to the quiz.

**The quiz.** No reveal (pre-reveal_from member; and `hasRestartFor` blocks it for new members too), no signup search, no £5 (settleProfileCredit returns the “already had” line at 100%). **Until the three mandatory questions are answered every members page redirects to the quiz; there is no way to switch to Client: JS (finding).**

**Next morning.** If still unanswered: picks-run skips BOTH profiles ('profile_incomplete') and the digest sends Client: JS's Today's 5 uncharged with the profile nudge — **the second profile is affected (finding)**. Once answered: My deals' list is chosen on the new answers; Keeps/Passes/opens before the reset no longer shape its ranking or deal-type mix (learning cutoff in feedback, keepsByType, tailoring, picks-run); deals shown on earlier days stay excluded (never-again rule, not learning). Client: JS's learning is untouched.

**Cleared deals.** /my-deals/cleared lists hidden entries for 30 days; “Bring back” sets restored_at and the deal returns at its old stage; a Keep/stage move after clearing un-hides it by itself; nothing was Passed.

**Start blank (third profile).** Created with no criteria/areas/answers, `profile_restarts` kind 'blank', switched to active, quiz opened. While active: the whole app is gated to the quiz (same lock as above) and the member-level incomplete rule stops the other two profiles' picks/charges. If switched away (only possible by URL today): awaitingAnswers → not a seat → no daily deals, no charge, listed on /profiles as “Waiting for its answers”.

#### Walk (c): a management company (22f), on a phone

**/for-management-companies.** View counted anonymously (tagged if utm/fbclid). Tier table from `funnel_tiers` (£5.00/£4.00/£3.25/£2.50 + £2 enhanced), “£5.00 a lead (£6.50 from top-up credit)”, and “Start with the £10 starter pack: £30 of credit, about 5 standard leads” — **shown while starter_pack_from is null on live, so the setup will not offer it (finding)**. Start → /for-management-companies/start.

**Sign-up.** Signed out → /signup?next=/for-management-companies/start. Stamp paths: first touch cookie / hidden attr field → `onEmailSignup` → `stampManagement('first_touch')`; Google → stamped before the callback redirect; otherwise the start route stamps 'start' once signed in (via 'quiz'/'account' from those doors). Stamping writes `signup_path/_at/_via`, sets `sourcing_alerts=false` (mandatory not done), logs `mc_signup` (record-only) and the Meta event. Team seats are never stamped. Confirm email → callback → `postAuthPath(next)` → start route → /leads/setup (no quiz, no reveal: AppShell skips both for `isManagement`). The eye in the header → /intelligence → **quiz (finding)**.

**/leads/setup.** Step 0 pack only when `packOffer` eligible (needs starter_pack_from; Checkout returns to /leads/setup?pack=1; “Not now” snoozes); Step 1 company/logo/swatches creates the funnel (every save via leads/actions.ts); Step 2 reply-to and privacy policy (without a policy the form stays paused); Step 3 email-each-lead (default on), Monday, webhook; resume always at the first step not done (`setupResume`). Go live → `active`, `first_live_at` once, `funnel_live` (record-only) + pixel event; link, button and iframe embed (escaped) with copy logged `funnel_snippet_copied`.

**Embed on another site.** /f/* carries `frame-ancestors *` only; the form and report render inside the frame; everything else on the site is SAMEORIGIN.

**A landlord submits.** `quoteFunnelLead` → tiers for a new owner: hold = next lead's tier price (£5.00; +£2 enhanced), solvency checked explicitly, daily cap claimed, fixed-price run; on a complete report `funnel_lead_charge` numbers the lead in the owner's UK month and debits once (guard row; welcome credit at 1×, top-up at 1.3×) — lead 21 is the first at £4.00; `funnel_lead_charged` record-only; failed/no-figures/reused runs never charged. Then `notifyOwnerOfLead`: one email per lead to the owner's login address with the lead's details and links, claimed on `owner_notified_at`.

**Legacy owner.** First funnel before funnel_tiers_from (13:23 UTC 2 Oct) → metered at funnel_markup until 30 days after their funnel-price email (`funnel_price_notice_sent_at`, sent from /admin/management); never a silent price change.

**Later answers the 3 profile questions (from the Profile pill).** `managementOnly` → false: the reveal appears (post-reveal_from account, viewed_at null) and the free signup search is queued (≤ 50p house spend); then the choices screen shows the daily email OFF with “Turn on” (sourcing_alerts does not flip back by itself) and the call box; if ticked, `setSiCalls` queues the intro and eligibility no longer skips them. Daily picks resume only if they turn the email on.

### A database

#### Tables added since R1 (19) — every one: RLS on, not forced, 0 policies, `revoke all from anon, authenticated` (r2 catalog; live-markers confirms the same for the 15 it listed — member_scan_baselines, funnel_lead_months, funnel_lead_charges and mc_page_views were applied after that query and were not re-checked on live)

| Table | Section (schema.sql) | Member data? | Who reads it in src (all via createAdminClient) | Scoping |
|---|---|---|---|---|
| si_call_consents | 22 (5903) | yes: call-consent history | written only: src/lib/intelligence/consent.ts:43 (insert); no reader | n/a |
| signup_reveals | 22 (5925) | yes: the 3 deals shown, offer ids | src/lib/intelligence/reveal-server.ts (53, 82, 98-172), src/lib/analysis/offers-server.ts:57, src/lib/sourcing-demand/member-search.ts:465, src/app/admin/intelligence/page.tsx:50, src/app/admin/demand/page.tsx:65 | `.eq('user_id', userId)`; admin pages isAdminEmail |
| member_searches | 22 (5956) | yes: signup/deep search, costs | member-search.ts (155-583), src/app/api/welcome/search/route.ts:20, src/app/admin/intelligence/page.tsx:51 | by user_id / payer_id; cron by status |
| member_search_finds | 22 (5997) | yes: deals a member's search found | member-search.ts (256-441), src/lib/marketplace/tier.ts:44 | `.eq('user_id', userId)` |
| resume_intents | 22 (6012) | yes: what to buy after a top-up | src/lib/billing/resume-server.ts (25, 39, 66, 73) | `.eq('id', id).eq('user_id', userId)` |
| si_conversations / si_conversation_turns / si_conversation_questions | 23 (6150 / 6167 / 6182) | yes: conversation log (any channel) | src/lib/conversations/log-server.ts (26, 48, 55, 60, 66), src/lib/voice/retention-server.ts (18, 24, 26), src/app/admin/conversations/page.tsx (40-42, 78, 83) | admin only; retention by started_at |
| si_calls_log | 23 (6206) | yes: every call, placed/received/blocked | src/lib/voice/{store,run,queue,fallback,low-credit,inbound,charge}-server.ts, src/app/account/calls/page.tsx:38, src/app/admin/calls/page.tsx:73 | account page `.eq('user_id', user.id)`, owners only |
| si_call_charges | 23 (6262) | yes: one guard row per charge | src/lib/voice/charge-server.ts (64-134), store-server.ts (160, 168) | by call_id / user_id |
| si_webhook_events | 23 (6277) | no (provider, event_key) | src/lib/voice/store-server.ts (184-201) | – |
| si_tool_calls | 23 (6288) | per call | src/lib/voice/store-server.ts (206, 211) | by call_id |
| profile_restarts | 22d (6383) | yes: resets/blank profiles | src/lib/profiles/server.ts (402, 413, 425, 444, 454), src/lib/profiles/admin-server.ts:48 | by the member's own profile ids / user_id |
| hidden_tracked_deals | 22d (6411) | yes: cleared My-deals entries | src/lib/listing/tracked-server.ts (199, 349) | `.eq('user_id', userId)` |
| listing_scan_days | 22e (6506) | no (counts per day/area) | src/lib/home/server.ts:218 | – |
| member_scan_baselines | 22e (6572) | per member (a count) | SQL only (member_scanned) | – |
| funnel_lead_months | 22f (6697) | per owner (a count) | src/lib/funnels/tiers-server.ts:59, src/app/admin/management/actions.ts:66 (upsert) | `.eq('owner_id', ownerId)` |
| funnel_lead_charges | 22f (6710) | per owner/lead | src/app/admin/management/page.tsx:36; written by funnel_lead_charge | admin only |
| mc_page_views | 22f (6793) | no | src/app/admin/management/page.tsx:37; written by mc_page_view_hit | – |

Columns added to old tables (none granted to authenticated, none in ACCESS_COLUMNS): profiles.si_calls, si_calls_changed_at (22, 5897-5898); profiles.signup_path (+check), signup_path_at, signup_path_via, funnel_price_notice_sent_at (22f, 6660-6672); profile_today_lists.choice (22, 5918); analysis_purchases.offer, first_deep + analysis_purchases_welcome_uidx / first_deep_uidx + offer check (22, 6029-6043); leads.input (21, 5759), leads.owner_notified_at (22f, 6682); funnels.notify_new_lead, first_live_at (22f, 6675-6677); starter_pack_purchases.captured_at (21, 5218-5225); provider_calls_action_idx (21, 5753); trigger profiles_touch_updated_at (21, 5728-5737). Dropped (R1 A7/A13): profiles.onboarding_skips, monday_funnel_runs.cursor.

#### Functions added since R1 (9 public + 1 private trigger)

| Function | Section | Definer | search_path | Grants | Callers in src (argument keys) |
|---|---|---|---|---|---|
| credit_plan_cycle(p_user, p_amount, p_expires_at, p_source_ref, p_description) | 21 (5768) | yes | public | service_role only | src/lib/credit/ledger.ts:197 (planCycle), src/lib/stripe/grants.ts:46 — same five keys |
| credit_forgive_overdrafts(p_reason) | 21 (5796) | yes | public | service_role only | none in src; the once-only block 5817-5825 (marker batch21_overdrafts_forgiven_at; live result members 0, pence 0) |
| private.profiles_touch_updated_at() (trigger) | 21 (5728) | no | '' | execute revoked from public | trigger before update on profiles |
| member_search_claim(p {search_id, pence}) | 22 (6053) | yes | public | service_role | member-search.ts:217 |
| member_search_true_up(p {search_id, claimed, actual}) | 22 (6085) | yes | public | service_role | member-search.ts:237, 413 |
| reset_search_profile(p {user, answers, deals, kept, cleared, shared, hide}) → uuid | 22d (6437) | **no (invoker)** | '' | service_role only | src/lib/profiles/server.ts:499 (resetPayload). Touches profiles, saved_areas, profile_quiz, search_profiles, profile_restarts, hidden_tracked_deals, all public.-qualified; works under service_role (bypassrls + default grants); same convention as Batch 13's create_search_profile / select_search_profile. Harmless. |
| record_listing_scan_days(p_days date[]) → int | 22e (6525) | yes | '' | service_role | src/lib/home/scan-record.ts:17 (sweep, picks, low-entry search) + the backfill block 6638-6645 |
| member_scanned(p {user, join_day, today, areas, kinds}) → jsonb | 22e (6587) | yes | '' | service_role | src/lib/home/server.ts:125 |
| funnel_lead_charge(p {owner, lead, funnel, enhanced, reservation, tiers, enhanced_extra, meta}) → jsonb | 22f (6738) | yes | public | service_role | src/lib/funnels/charge-server.ts:71 (sends every key except `reservation`; debits with p_allow_negative = true, line 6781) |
| mc_page_view_hit(p_tagged) → void | 22f (6802) | yes (sql) | public | service_role | src/app/api/mc/view/route.ts:24 |

Changed in place (old sections): handle_new_user (created_at from auth.users, 140-156), credit_spend_rate (fallback 1.3, 711), credit_redeem_code (referral_withheld, 985-990), activity_weekly_facts (now security definer; signed_in from auth.users; `not (extras ? 'env')`, 3016-3210), lifecycle_active_days_sync (2-minute commit cutoff; env filter, 5432-5500), starter_pack_claim (captured_at keeps a paid hold, 5267). Still invoker (pre-existing, R1-noted): the 25 listed in mechanical §1b.

#### billing_settings keys added since R1 (seed → live; all `on conflict do nothing`)
- Batch 22 (5864-5892): reveal_from (marker; live 2026-10-01T19:59:59Z), accuracy_advanced_pct 50, reveal_low_match_pct 70, reveal_small_count 20, strong_match_pct 90, strong_match_min_checked 5, signup_search_cap_pence 50, signup_thin_stock 5, signup_search_fresh_hours 24, signup_confirm_live_max 5, signup_income_checks_max 3, signup_search_monthly_cap_pence 2000, member_search_confirms_per_hour 40, deep_search_markup 5, deep_search_max_raw_pence 300, deep_search_monthly_cap_pence 5000, deep_search_first_discount_pct 50, deep_search_nearby_areas 3, reveal_analysis_discount_pct 50, reveal_welcome_days 7, deep_first_run_extra_pence 100, reveal_auto_topup_amount_pence 2500, reveal_auto_topup_threshold_pence 500, si_call_pence_per_min 65, si_text_pence 22, si_email_pence 20 — **all equal on live**.
- Batch 23 (6132-6145): si_outbound_start_hour 9, si_outbound_end_hour 19, si_outbound_weekdays [1,2,3,4,5], si_max_outbound_calls_per_uk_day 1, si_low_credit_spent_ratio 0.8, si_low_credit_window_days 7, si_low_credit_min_member_days 3, si_max_call_seconds 600, si_texts_per_call_max 2, si_wrap_up_seconds 45, si_transcript_retention_days 90, si_sms_auto_replies_per_number_day 3 — **all equal on live**.
- Batch 21 (5823): batch21_overdrafts_forgiven_at (marker; live {at 2026-10-01T13:34:35Z, pence 0, members 0}).
- Batch 22c (6327-6348): batch22c_cheap_applied_at (marker; live 2026-10-02T11:31:37Z); moves low_entry (+cheapMaxPrice 150000, +lenderMinPrice 75000, searchMaxPrice 135000→150000) and deal_checks (split 6/8/6 → top60 3 / low_entry 12 / r2r 5, +lowEntryShortlistExpiryDays 14) — **live matches**.
- Batch 22f (6689-6694): funnel_tiers [{1:500},{21:400},{61:325},{151:250}], funnel_enhanced_extra_pence 200, funnel_notice_days 30, funnel_tiers_from (marker; live 2026-10-02T13:23:36Z, applied by hand after the 11:31 run pre-dated the 22f merge) — **live matches**.
- Pre-R1 key the brief asks about: full_analysis_pence — seed 400 (3459, do nothing), live 400 (updated 27 Sep), code default 400 (src/lib/credit/deal-pricing.ts:52), read via src/lib/credit/unit-costs.ts:160, editable on /admin/billing; the code charges and shows £4.00, not the brief's £5 (finding 1; area B owns the member-facing figures).

### F. Refuted findings

Reported by a reader, refuted by the verifiers; listed so the reasoning is on record.

- **R2-14** (reported Medium) · `src/lib/intelligence/choices.ts:10` — The call's per-minute price has two definitions: the choices screen and call box show billing_settings.si_call_pence_per_min, the charge and the SI view use the si:call_minute unit row
  - *second reader:* refuted — The finding's premise is wrong on main: the choices screen and the Notifications panel do NOT show billing_settings.si_call_pence_per_min. choices.ts's callPriceLine/callBoxNote are pure functions that take the number as a parameter, and both callers explicitly override it with callPencePerMinute() — the si:call_minute unit row — before rendering (src/app/welcome/choices/page.tsx:73; src/app/account/notifications/page.tsx:49-51, with the comment "the minute price is the si:call_minute unit row's …
- **R2-124** (reported High) · `src/lib/sourcing-demand/member-search.ts:571` — One throwing member search blocks every later member's signup and deep search for ever (no try/catch in the cron loop, oldest first)
  - *code path:* refuted — The structural facts are true (runDueSearches :570-575 awaits runSearchSlice with no try/catch, oldest-first, SEARCH_LEASE_MS=90s vs a */5 cron), but the claimed trigger does not exist: neither of the two code paths the finding names can throw, and nor can any other bare call in the slice that I traced. (1) strongNow → previewToday: selection.ts:193-199 wraps excludedFor/chooseToday in try/catch and returns null, so the throw at selection.ts:467 (answeredOrOpened) is caught inside previewToday a …
  - *reproduce:* refuted — The structural observation is true (runDueSearches awaits runSearchSlice with no try/catch, member-search.ts:570-575, and /api/internal/member-searches has none either), and oldest-first ordering plus a 90 s lease would indeed make a persistently throwing search the first pick on every 5-minute pass. But the finding stands or falls on a reachable throw, and none of the throw sites it names exist on this path: (1) previewToday wraps its whole body in try/catch and returns null (selection.ts:193-1 …
  - *the rule:* stands — The structural half of the finding stands; the causal half does not, and High is overstated. STANDS: runDueSearches (member-search.ts:570-575) awaits runSearchSlice with no try/catch, the route (member-searches/route.ts:24) has none, the due list is oldest-first (:565), SEARCH_LEASE_MS is 90 s against a */5 cron (vercel.json:85-86), and there is no attempts counter or terminal 'failed' write on an exception — so IF one search threw deterministically, the same id would be leased first every pass …

### G. Duplicates merged before verification

- kept **R2-0** (Full analysis is £4 on main (seed, live and code fallback all 400); the brief says £5, so every deri …) ← merged #117 — Full analysis priced 400 (£4) everywhere while the brief says £5
- kept **R2-4** (/for-management-companies advertises the volume tiers (£5.00 / £4.00 / £3.25 / £2.50 from the code d …) ← merged #111 — 22f settings section (funnel_tiers_from / starter_pack_from) not applied on live while the landing page advertises them
- kept **R2-14** (The call's per-minute price has two definitions: the choices screen and call box show billing_settin …) ← merged #5 — si_call_pence_per_min setting vs si:call_minute unit row: two definitions of the per-minute price
- kept **R2-6** (The tier charge is made after the run's hold has been released, without the reservation funnel_lead_ …) ← merged #118 — funnel_lead_charge debits with allow_negative after the hold is released, allowing overdraft
- kept **R2-17** (First-time Deep report price: the pre-check is per paying account but the unique index is per member …) ← merged #7, #113 — First-time Deep price checked per paying account but recorded per buyer/member
- kept **R2-13** (A call's debitFace ignores open reservations, so a call can take credit a running analysis, deep sea …) ← merged #8 — Call debit ignores open reservations so later reserved debits overdraft
- kept **R2-19** (/for-management-companies/start stamps the signed-in account as a management company on a plain GET, …) ← merged #115 — Management stamp on GET turns an investor using Start again into a management-only account
- kept **R2-20** (The header eye on a management-only account's Leads pages opens /intelligence, which gates on requir …) ← merged #109 — /intelligence header eye sends a management-only account into the investor quiz
- kept **R2-23** (A low-credit call blocked for a passing reason (first 3 days, intro day, daily limit, in flight, no …) ← merged #85, #96 — Blocked low-credit call writes a row that the once-per-landing index counts, so the landing never gets a call
- kept **R2-24** (A queued low-credit call is never re-tested against the balance at dial time: a member who topped up …) ← merged #44 — Queued low-credit call not re-checked against balance before dialling
- kept **R2-84** (Batch 23's texts ignore Batch 8's 'Texts: Off' switch (sms_contacts.enabled): a member who turned te …) ← merged #30 — Call texts ignore sms_contacts.enabled Texts: Off switch
- kept **R2-48** (Call texts bypass Batch 8's one-text-a-day and sms_monthly_cap and are never written to sms_messages …) ← merged #31 — Call texts bypass sms_messages and Batch 8's daily/monthly caps
- kept **R2-90** (An intro that is waiting (no credit, no number, management-only) writes no row, so it is invisible o …) ← merged #105, #114 — Owed intro that cannot be placed yet is re-evaluated by the cron every 5 minutes forever
- kept **R2-34** (A timed-out or 5xx ElevenLabs outbound-call request after Twilio already started the call leaves a ' …) ← merged #123 — ElevenLabs timeout/5xx at placement leaves a failed row with no ids and burns the intro
- kept **R2-35** (si-calls has no internal time budget: 20 placements × 15 s ElevenLabs timeout (or 20 reconciles × 8 …) ← merged #126 — si-calls cron has no per-pass time budget and outruns maxDuration
- kept **R2-43** (Batch 20's £5 email and the low-credit call both go the same day: neither side checks the other once …) ← merged #83, #47 — Low-credit £5 email and low-credit call do not check each other (queued read as not called), both go the same day
- kept **R2-45** ("Neither": a low-credit call that is placed and then fails stamps the member as told, and no £5 noti …) ← merged #125 — Placed-then-failed low-credit call stamps member as told so no £5 notice goes
- kept **R2-54** (setSiCalls writes a consent row and a counting notification_settings event on every call, changed or …) ← merged #88 — Calls-on consent recorded twice on /welcome/choices (verify then Continue)
- kept **R2-78** (Choices screen: after verifying the mobile for calls, the call box stays unticked while calls are al …) ← merged #97 — Call box stays unticked after inline mobile verification although calls are already on
- kept **R2-60** ('Use this' logs si_view with step 'show_me' and surface hard-coded 'reveal' from any surface; Undo i …) ← merged #73, #81 — 'Use this' logs si_view with hard-coded surface 'reveal' and step 'show_me' from any surface
- kept **R2-42** (README and .env.example cron figures are stale: project-checks hour 05 minutes and the cron count) ← merged #128 — README and .env.example cron schedule/route counts are stale
