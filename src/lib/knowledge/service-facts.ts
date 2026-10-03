/**
 * Batch 24: the service facts — a short written account of Stayful
 * Intelligence, from the code, that the nightly job's drafting model may use
 * (with the approved knowledge and the settings) and nothing else. Every
 * figure is a {placeholder}, so the facts never go out of date on a price
 * change; a feature, rule or limit that changes must be changed here too
 * (CLAUDE.md). If something isn't here, the model must say the facts don't
 * cover it rather than guess.
 *
 * Pure: no network, no database, no server-only.
 */

export const SERVICE_FACTS = `
WHAT IT IS
- Stayful Intelligence is a deal-finding service for UK short-let investors, rent-to-rent operators and deal sourcers, run by Stayful Ltd (which also runs a separate short-let management company, Stayful Management, at {management_fee}).
- It searches live UK property listings every day, checks each one against comparable short-lets and long-let rents, and picks the ones that fit what the member told it they want. Figures come from comparables (Airbtics), long-let and area data (PropertyData), amenities (Google Places), events (Ticketmaster) and the real operating data of the properties Stayful runs.
- It also has the Property Analyser (type an address, get a report), Market Explorer (areas compared on short-let figures) and a browser extension that checks a listing while browsing Rightmove, Zoopla or OnTheMarket.
- It describes deals and numbers. It never tells anyone to buy or rent a property, never guarantees returns, and never gives financial, mortgage or legal advice.

ACCOUNTS AND WHO CAN USE IT
- Anyone can sign up free; every new account gets {welcome_credit} of free credit, enough for about {analyses_in_welcome} Full analyses.
- Members answer a short profile quiz (budget, areas, the kind of deal, deposit and mortgage rate, and more). A complete profile with real answers earns a one-off {profile_credit} of credit. Answers can be changed any time on the profile page.
- A member can keep up to {saved_profiles_max} saved profiles (for example a sourcer with several clients); the active one decides Today, Browse and the Explorer.
- Teams: an owner can invite colleagues, who use the owner's credit. Each seat costs {team_seat_cost} of the owner's credit every {team_seat_days} days. Team members manage nothing to do with billing.
- Management companies can sign up for branded lead forms (a separate part of the product, under Leads).

CREDIT, PLANS AND PAYING
- Everything is paid from credit. Plans give monthly credit and start at {lowest_plan_cost} a month; plan credit resets each month. Plans can be paused or cancelled in Account.
- Top-ups: {topup_amounts}, any time, in Account → Billing. Top-up credit never expires but is spent at {topup_rate} the plan rate.
- Auto top-up adds credit automatically when the balance runs low and needs a saved card; the one-tap offer is {auto_topup_amount} whenever the balance drops below {auto_topup_threshold}.
- The starter pack, when offered: {pack_credit} of credit for {pack_cost}, once.
- Account → Usage shows where credit goes; Account → Billing shows every charge, top-ups and receipts. Reopening a saved report never costs anything.

DEALS
- Today shows the member's daily picks (Today's 5) from live deals that fit their profile, also sent as one daily email. Daily deals cost {daily_deals_cost} a day from credit.
- Browse is the marketplace of screened deals. Opening a deal (the address, photos and listing) costs between {open_cost_min} and {open_cost_max}, depending on how profitable it is.
- Free members (who have never paid) see a new deal {free_delay_hours} hours after it goes live; members who have paid see it at once.
- Keep saves a deal to My deals (free); Pass hides it and teaches the matching. My deals groups deals by stage (Kept, Contacted, Viewing, Offer, Secured, Passed).
- The more a member answers and keeps or passes, the better the picks fit.

REPORTS
- A Full analysis is {full_analysis_cost}: a {report_sections}-section report on the deal with {forecast_months} months of short-let income, costs, comparables, risks, due-diligence checks and the local market, as a PDF. It opens the deal too.
- PMI's second opinion can be added for {pmi_addon_cost}; with it the report is a deep report at {deep_report_cost}.
- A saved analysis of the same property is reused free for {analysis_reuse_days} days.
- Reports are in My deals → Reports and by link from emails.

ALERTS
- Changes on saved deals (a price drop, back on the market, getting attention, gone) come in the daily email.
- Text alerts: a member can verify a UK mobile in Account → Notifications and get at most one alert text a day and {sms_monthly_cap} a month, between {sms_hours_start} and {sms_hours_end} UK time. Texts are free. Reply STOP to any text to stop them; START to restart.
- Every email and text type has its own switch in Account → Notifications.

CALLS FROM STAYFUL INTELLIGENCE
- Stayful Intelligence is an AI and always says so. It only calls members who said yes (in the welcome steps or Account → Notifications): one introduction call, and a call when credit is running low.
- Outbound calls happen on {call_days} between {call_hours_start} and {call_hours_end} UK time. Members can ring the number back any time.
- An answered call costs about {call_minute_cost} a minute from credit; missed calls are free. A text from it costs {text_cost} and a follow-up email {email_cost}.
- On the phone it never says an address, an exact balance or a deal's figures, and never takes card details (caller ID can be faked); those are in the app.
- Calls are switched off in Account → Notifications. It never changes settings on a call.
- Call transcripts are kept for {transcript_days} days; the questions asked and whether they were answered are kept longer to improve the answers, without the member's name.

MEMORY
- Stayful Intelligence can remember a lasting preference or plan (for example "prefers 2-bed flats near stations") only after asking "Want me to remember that?" and hearing yes. Members see and delete everything it remembers in Account → What Stayful Intelligence remembers about you. It never keeps health, money beyond the profile, or anything about other people.

HELP AND PRIVACY
- Anything it can't help with (billing disputes, refunds, something not working) goes to the Stayful team, who reply by email; members can also email {team_email}, and report a problem from the app.
- Personal data is handled as the privacy policy at /privacy says; terms are at /terms. Pricing is at /pricing.
`.trim();
