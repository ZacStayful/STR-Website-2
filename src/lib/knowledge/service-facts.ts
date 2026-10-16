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
- Stayful Intelligence is a deal-finding service for UK short-let and buy-to-let investors, rent-to-rent operators and deal sourcers, run by Stayful Ltd (which also runs a separate short-let management company, Stayful Management, at {management_fee}).
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
- A pay-as-you-go member (no plan) whose credit reaches {low_credit_mark} between {nudge_days_min} and {nudge_days_max} days after their last top-up gets one text ({text_cost}) and email ({email_cost}) with the one-tap auto top-up link, instead of the usual low-credit email; one notice per credit, whichever comes first (the call, the nudge or the email).
- The starter pack, when offered: {pack_credit} of credit for {pack_cost}, once.
- Account → Usage shows where credit goes; Account → Billing shows every charge, top-ups and receipts. Reopening a saved report never costs anything.

DEALS
- Today shows the member's daily picks (Today's 5) from live deals that fit their profile, also sent as one daily email. Daily deals cost {daily_deals_cost} a day from credit.
- The daily email and Today open with a morning briefing: a greeting and a short note on one thing in the member's own figures (counts, their kept deals and pipeline; never a listing's title, description or an address). With AI briefings switched on it is written by Stayful Intelligence and charged at most {briefing_max_cost} of credit, after the day's own charge and only if the balance covers it; a rejected, late or switched-off one is the standard line, free. Members who did not come in from the email see it once on Today, where Play reads it aloud at the speak price; "Useful" and "Not for me" are a tap.
- Browse is the marketplace of screened deals. Opening a deal (the address, photos and listing) costs between {open_cost_min} and {open_cost_max}, depending on how profitable it is.
- Free members (who have never paid) see a new deal {free_delay_hours} hours after it goes live; members who have paid see it at once.
- Keep saves a deal to My deals (free); Pass hides it and teaches the matching. My deals groups deals by stage (Kept, Contacted, Viewing, Offer, Secured, Passed).
- The more a member answers and keeps or passes, the better the picks fit.
- Standout deals: when a deal fits a member's main profile better than anything found for them so far ({standout_min_match} match or better, on a deal type that profile chose, well above their minimum profit, and confirmed still on the market), Stayful Intelligence saves it to their My deals, marked "Saved for you by Stayful Intelligence". Opening it is free. "Not for me" passes it (with a few seconds to undo). Saves it doesn't call about are listed under "Saved for you" in the next daily email.
- "I've noticed": when what a member keeps and passes says something different from their answers, Today asks once ("I've noticed you've passed every BRRR one. Want me to stop showing BRRR?"). Nothing changes unless they tap to accept; "Keep my answer" stops the question for a while.

BUY-TO-LET DEALS
- Buy to let is a deal type: a sale listing bought with a {btl_ltv} interest-only buy-to-let mortgage at the typical 2–3-year fixed rate and let to long-term tenants, judged on the rent. Members tick it in their profile's deal types and then say what they're after (income, growth or a bit of both) and the cash they can put in ({btl_cash_bands}). Profiles that chose "All of them" before buy to let arrived don't get it until the member taps Add Buy to let.
- The rent is a range from the district's rent and live rentals nearby (same area, size and type), sometimes checked against a PropertyData rent valuation; a rough one is labelled. Every figure is a range at the low, middle and high rent, before tax, with {btl_running_costs}, a flat's service charge and ground rent (an estimate when the listing doesn't say). Cash in is the deposit, the tax on a second home for its nation and the buying costs; the top end adds {btl_epc_allowance}.
- A buy-to-let deal must pass the lender's rent test (the rent {btl_rent_test}) on the middle rent and break even at the low end, on a home a lender would lend on (not cash buyers only, an auction or a short lease).
- It is compared with the typical deal on the market in the member's cash band, starting near their area and widening out (miles, then the region, then the UK) until there are enough deals; Today and the email say when it looked further. A standout needs its low end to be {btl_standout_margin} of the typical deal's.
- The card shows the cash in, the monthly cashflow and the return or growth (by what the member is after), with flags such as "Rough rent estimate", "Service charge not confirmed" and "EPC not checked". The deal page shows the costs line by line, the rent test, what it was compared with and the rules for the nation (drafts). It never says buy, and says "Before tax. An estimate, not advice. Get a mortgage broker's view."
- A buy-to-let report is {btl_report_cost}: rent and sale valuations, sold prices nearby, the EPC, flood and planning checks and the figures with all of it in. The price is shown first, it's charged once and only when made, never on failure, and a deal revealed in the member's first days can have a welcome price. Web only, saved in My deals.
- The Full analysis has a "Buy to let instead?" section from its own long-let valuation, at no extra charge. The Market Explorer has a free "Buy to let" view of districts by gross yield, growth, average price and typical cash in.

REPORTS
- A Full analysis is {full_analysis_cost}: a report on the deal of up to {report_sections} sections (the ones its deal needs) with {forecast_months} months of short-let income, costs, comparables, risks, due-diligence checks and the local market, as a PDF. It opens the deal too.
- PMI's second opinion can be added for {pmi_addon_cost}; with it the report is a deep report at {deep_report_cost}.
- A saved analysis of the same property is reused free for {analysis_reuse_days} days.
- Reports are in My deals → Reports and by link from emails.

ALERTS
- Changes on saved deals (a price drop, back on the market, getting attention, gone) come in the daily email.
- Text alerts: a member can verify a UK mobile in Account → Notifications and get at most one alert text a day and {sms_monthly_cap} a month, between {sms_hours_start} and {sms_hours_end} UK time. Alert texts are free, and are the only texts those caps count; a text from Stayful Intelligence about a call or a deal it saved costs {text_cost}, needs the same Texts switch, and is outside them. Reply STOP to any text to stop them; START to restart.
- Every email and text type has its own switch in Account → Notifications.

CALLS FROM STAYFUL INTELLIGENCE
- Stayful Intelligence is an AI and always says so. It only calls members who said yes (in the welcome steps or Account → Notifications): one introduction call, a call when credit is running low, and a short call about a standout deal it saved for them, at most {standout_calls_per_month} times a calendar month, never more than one call a day, and only with {standout_call_floor} of credit or more (below that, a text and email instead). A deal call gives the town, the size and the rough profit, then texts a link to the deal in the app.
- Outbound calls happen on {call_days} between {call_hours_start} and {call_hours_end} UK time. Members can ring the number back any time.
- An answered call costs about {call_minute_cost} a minute from credit; missed calls are free. A text from it costs {text_cost} and a follow-up email {email_cost}.
- On the phone it never says an address, an exact balance or a deal's figures, and never takes card details (caller ID can be faked); those are in the app.
- Calls are switched off in Account → Notifications. It never changes settings on a call.
- Call transcripts are kept for {transcript_days} days; the questions asked and whether they were answered are kept longer to improve the answers, without the member's name.

TYPED QUESTIONS (THE CHAT)
- Members can type questions: quick answers in the box under the header eye (about {chat_quick_cost}; only the member's account basics and the approved answers) and the full Stayful Intelligence view (about {chat_full_cost}; it can also look up the member's own deals, picks, profile, credit, why nothing matched and why it did or didn't call them).
- A question costs what the AI actually cost × {chat_markup}, never more than {chat_quick_max} (quick) or {chat_full_max} (full view), and only when it is answered; "I don't know", "ask in the full view" and anything that fails are free. It never takes the balance below zero. The tap-to-ask questions are free.
- It answers only from approved answers and its look-ups, never gives advice ("Get a survey and your own advice before you offer") and never gives an address or postcode. The quick box never changes anything; the full view can act for the member (below).
- Members see their chat for {transcript_days} days in the full view and can delete it; after that the questions are kept without the member's name.
- Members can also talk to it: the microphone by the box records the question (it stops by itself when they stop talking), and a question asked out loud is answered out loud in the Stayful Intelligence voice, then it listens once more for a follow-up and after that waits for another tap; the microphone is always off while it speaks, so it never hears itself. Typing, or tapping to stop it speaking, ends the spoken conversation. Hearing a question costs a fraction of a penny; a spoken answer is charged as AI voice on top of the question, about {chat_speak_quick_cost} for a quick answer and {chat_speak_full_cost} for a full one, and that charge is shown under the answer; a recording it couldn't make out is free, and a reply that is not an answer (I don't know, top up, something went wrong) is never read aloud. Typing works the same as ever.

ACTING FOR THE MEMBER (THE FULL VIEW)
- In the full Stayful Intelligence view a member can tell it what to do, and it does it through the same code as the buttons: check a pasted listing link (Rightmove, OnTheMarket or Airbnb; Keep saves it afterwards), run Full analyses, deep reports or a deep search, Keep, Pass or move deals between stages, change the active profile's criteria (it only adds a deal type unless told plainly to remove one), and draft a message to an agent from the next-step template (the member copies and sends it themselves, then can tap to move the deal to Contacted or Offer).
- Each action costs exactly what its button would charge that member (a Full analysis {full_analysis_cost} plus opening the deal if needed, a deep report {deep_report_cost}, a deep search up to {deep_search_max_cost}, a listing check a few pence), plus the question's own charge. Keep, Pass, stage moves, criteria changes and drafts are free. Nothing that fails is charged, and the balance never goes below zero.
- It acts without asking, except: when an instruction would leave the balance under {low_credit_mark} it asks first; past {si_action_cap} in one instruction it runs up to that and asks once about the rest; with not enough credit nothing runs and it offers the pack or a top-up. Before the first paid step it shows a spend line with Stop for {si_action_stop_seconds} seconds; after that "Stop the rest" stops what hasn't started.
- Keep, Pass, stage moves and criteria changes can be undone for {si_action_undo_hours} hours, from the chat or a line at the top of My deals; anything the member changed since is left alone. Charges are never undone.
- It never pays, tops up, changes plans or auto top-up, cancels, deletes, shares, changes notifications or contacts anyone: those are buttons only. One instruction at a time, with hourly and daily limits. A deal it hasn't been shown by the member's own look-ups can't be touched, and text inside a listing is never taken as an instruction.
- Free members can use it with credit; new deals still wait {free_delay_hours} hours for them.
- When something's wrong it files a bug report for the member (shown under Your feedback with a reference; that question isn't charged), and when it can't help it offers a filled-in feature request for the member to check and send. A step that fails unexpectedly is reported to the team automatically.

MEMORY
- Stayful Intelligence can remember a lasting preference or plan (for example "prefers 2-bed flats near stations") only after asking "Want me to remember that?" and hearing yes. Members see and delete everything it remembers in Account → What Stayful Intelligence remembers about you. It never keeps health, money beyond the profile, or anything about other people.

HELP AND PRIVACY
- Anything it can't help with (billing disputes, refunds, something not working) goes to the Stayful team, who reply by email; members can also email {team_email}, and report a problem from the app.
- Personal data is handled as the privacy policy at /privacy says; terms are at /terms. Pricing is at /pricing.
`.trim();
