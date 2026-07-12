# Stayful Intelligence — Lead Database & Marketing Context

> **Purpose of this document.** A self-contained briefing for any team, project, or
> agent that needs to understand what the Stayful lead database is, who is in it,
> how those leads got there, and how to market to them — without having read a
> single line of this codebase. If you are here to write ads, emails, landing
> pages, sales scripts, or nurture sequences, start here.
>
> *Last updated: 2026-07-12. Source: the Stayful Intelligence web app (this repo)
> and the Stayful design/brand brief.*

---

## 1. The one-paragraph version

**Stayful** is a UK full-service Airbnb & holiday-let management company. To
generate demand for that management service, Stayful built **Stayful
Intelligence — the Property Analyser**: a free web tool where a UK property
owner or investor types a postcode and, in 10–20 seconds, gets a 10-section
report on what that property could earn as a short-term rental, how the local
market behaves, and what it would take to win in it. Every person who runs a
report signs up first — handing over their **name, email, mobile number, and the
property/postcode they're evaluating**. Those signups flow automatically into a
**Monday.com CRM board** ("Stayful Intelligence enquiries"), each one tagged with
its lifecycle stage and a copy of the PDF report it generated. **That CRM board
is the "lead database."** It is a stream of warm, self-qualified UK property
owners who have actively raised their hand about turning a property into a
short-let — exactly the audience Stayful's management service sells to.

---

## 2. What the service actually is

### 2.1 The product: Stayful Intelligence (the Property Analyser)

A web app (marketed at the top of the funnel as "The Stayful Property Analyser"
/ "Stayful Intelligence — the decision engine for short-term rental").

- **What the user does:** types any UK postcode / address.
- **What they get back, in 10–20 seconds:** a **10-section report** plus a
  downloadable, branded **PDF**.
- **Positioning line the whole product hangs on:** *"A decision engine, not a
  revenue calculator."* Most tools tell you what an **area** earns. Stayful tells
  you what to **do** — for that exact property, in that exact postcode.

### 2.2 The 10 report sections (the "features")

| # | Section | What it answers |
|---|---------|-----------------|
| 01 | **Property intake** | Auto-detects postcode, property type, EPC, capacity from UK address data — no spreadsheets. |
| 02 | **Live data ingest** | Pulls live data from multiple sources in 10–20s for the exact postcode. |
| 03 | **Decision overview** | Top-performer income vs the user's filtered estimate, shown **net of all fees** — the number that lands in their account. |
| 04 | **Comparables** | Real, active nearby Airbnb listings with nightly rate, occupancy, annual revenue, reviews. User can include/exclude to refine. |
| 05 | **Amenities & demand drivers** | Hospitals, universities, transport, events — each rated for booking impact. |
| 06 | **Revenue breakdown** | Gross-to-net, line by line: platform fees, cleaning, laundry, management. |
| 07 | **12-month forecast** | Month-by-month occupancy and revenue with seasonality — **including the quiet months**, which most tools hide. |
| 08 | **Local area report** | Long-term direct-booking demand catchment (up to 50km) — hospitals, universities, major construction. |
| 09 | **Setup costs** | Itemised furnishing quote with real retailer pricing (Dunelm, Argos, Amazon, B&Q) — defensible enough to take to a lender. |
| 10 | **Risk assessment** | Council short-let regulation, supply saturation, seasonality/concentration risk. Honest scoring, not best-case. |

### 2.3 Where the data comes from (credibility anchors)

Every figure is **sourced** — no projection without a comparable behind it.

- **Airbtics** — live Airbnb comparables (nightly rate, occupancy, revenue)
- **PropertyData** — long-let valuations, floor area, sale valuations
- **Google Places** — nearby amenities & demand drivers
- **Ticketmaster** — live local events & demand spikes
- **EPC Register** & **Companies House** — property and entity data

### 2.4 Access & pricing

- **Free tier:** 5 full reports, **no card required.**
- **Analyser (most popular):** £39.99/month, unlimited reports, saved
  properties, branded PDF export.
- **Annual:** £360/year (save 25%), adds quarterly market briefings + phone
  support.
- All prices ex VAT · cancel any time · no contract.

### 2.5 How this relates to Stayful's core business

Stayful is **a management company first.** They run short-lets for owners across
the UK at **15% + VAT**. The Analyser is the *same income model they use
internally before taking a property under management* — released publicly so
anyone can get that answer "in 20 seconds rather than on a sales call."

The Analyser and the management service are deliberately positioned as
**separate**: most Analyser users never become management clients, "and that's
fine." This honesty is a brand asset — don't undercut it with hard-sell copy.

---

## 3. What the "lead database" actually is

**The lead database = the Monday.com CRM board "Stayful Intelligence enquiries."**
The Analyser is the lead magnet; the CRM board is where the leads live.

### 3.1 How a lead enters the database

1. A visitor lands on the marketing site and wants to run a report.
2. To run one, they **sign up** — this is a hard gate. Signup captures:
   - **Full name** (required)
   - **Email** (required)
   - **Mobile number** (required)
   - Password
3. On email confirmation, a CRM enquiry row is created in the "Free Trial"
   group, stamped **"Trial started."**
4. Each time they run an analysis, the generated **PDF report is uploaded to
   their CRM row** (matched by email). That PDF contains the **property address
   and the income estimates** they were evaluating.
5. Lifecycle events update the same row: **Subscription started** (they began
   paying) and **Cancel date** (they churned).
6. Engagement signals are also tracked (time on site, scroll depth, sections
   viewed, CTA clicks, an **engagement score /100**).

### 3.2 What a single lead record tells you

For each person in the database you can typically know:

- **Who they are:** name, email, mobile.
- **What they're evaluating:** the property address(es) / postcode(s) they ran,
  attached as PDF report(s).
- **What they expect to earn:** the income, occupancy, and risk figures from
  their own reports.
- **How serious they are:** number of reports run, engagement score, whether
  they subscribed, whether they cancelled.

This is why the leads are **warm and self-qualified**: they arrived with intent,
told you their contact details, and told you *which specific property* they're
thinking about turning into a short-let.

### 3.3 ⚠️ Consent & compliance — read before marketing

The mobile number is collected under a specific promise shown on the signup
form: *"We may text you about urgent account or report issues. **No marketing.**"*

- **Do not** use the mobile number for SMS marketing campaigns. That consent was
  not given, and using it would breach the stated promise (and likely UK
  PECR/GDPR rules).
- Email and on-platform channels are the appropriate marketing surfaces; confirm
  the current opt-in basis with Stayful before any outbound campaign.
- Treat every lead record as personal data. Don't export, share, or repurpose it
  outside its intended use without checking.

---

## 4. Who the audience is

Two primary personas, both **UK property owners/investors**:

### Profile A — Investors evaluating deals (most common use)
They run **prospective** properties through the Analyser *before making an
offer*. The setup-cost calculator and risk score are built for this pre-purchase
decision. They want to know: *is this deal worth doing, and what would it take to
win?*

### Profile B — Cautious existing landlords
They own property on long-term tenancies and are considering switching to
short-let. They are sceptical and want **real figures including the slow
months** — not a best-case pitch — before they change anything.

**Shared mindset:** cautious, numbers-led, allergic to hype. They've likely seen
inflated "you could earn £X!" claims elsewhere and distrust them. They want a
figure they could *defend to a lender or a partner.*

---

## 5. How to market to this audience

### 5.1 Positioning & differentiators (what to lead with)

- **"Decision engine, not a calculator."** Competing tools (AirDNA, PriceLabs,
  AirROI, Property Market Intel) tell you what an area earns; Stayful tells you
  what to *do* about a specific property. This is the single sharpest hook.
- **Both income models side by side** — short-let vs long-let — so owners see
  which strategy actually wins for *their* property.
- **Honesty as a feature:** shows the quiet months, real risk scoring, net (not
  gross) figures, and sourced comparables. "Answers, not pitches."
- **Built by operators**, not analysts — founders Zac Harrison & Martyn Butler
  run short-let portfolios themselves. Credibility, not theory.
- **Free and instant** — full report, no card, no sales call, ~20 seconds.

### 5.2 Proof points / benchmark figures (use consistently)

These are the standard Stayful benchmarks. Use them; keep them consistent.

- ~**70% occupancy** vs ~55% UK market average
- ~**£110 ADR** (average daily rate)
- ~**12-night** average stay
- **4.8 Google / 4.6 Airbnb** ratings
- **40% direct bookings**
- **70+ properties** managed · **£3M+** earned for landlords
- **48–66% net monthly uplift** vs long-let (stated conservatively)
- **Live in 7–14 days** · income paid **1st–5th of each month**

### 5.3 Tone & copy rules (non-negotiable brand guardrails)

- **Direct, honest, number-led.** Speak to a cautious landlord who's been
  burned by hype.
- **Never guarantee income.** Say *"typically see"* or *"comparable properties
  achieve"* — never *"you will earn."*
- When mentioning the management service, **always** surface the **15% + VAT**
  fee prominently — transparent pricing is a competitive advantage.
- Avoid stock-photo clichés (handshakes, generic upward graphs). Use bright,
  real property interiors and local-area imagery.

### 5.4 Ready-made messaging angles

- *"What could your property earn on Airbnb? Find out in 20 seconds — free, no
  card."* (top-of-funnel, Profile A & B)
- *"Most tools tell you what an area earns. We tell you what to do."*
  (differentiator)
- *"See short-let vs long-let side by side — before you commit."* (Profile B)
- *"Run the deal before you make the offer."* (Profile A / investors)
- *"The quiet months, shown as plainly as the peak."* (trust / anti-hype)
- *"A number you can defend to a lender."* (funding-minded owners)

### 5.5 Calls to action

- **Primary CTA:** *"Run free analysis"* / *"Estimate your income"* — always
  points to signup (the lead-capture gate).
- **Secondary:** *"See what your property could earn."*
- Reinforce the low-friction promise near every CTA: **Free · No card required ·
  10–20s report.**

### 5.6 The funnel to keep in mind

```
Ad / SEO / referral
      │
      ▼
Marketing site  ──►  Signup (name, email, mobile)  ──►  LEAD CAPTURED (CRM: "Trial started")
      │                                                        │
      ▼                                                        ▼
Runs report(s)  ──►  PDF + income estimate attached to CRM row (property + numbers known)
      │
      ├──►  Subscribes to Analyser (£39.99/mo)      → CRM: "Sign up started"   → SaaS revenue
      └──►  Becomes a Stayful Management client (15%+VAT) → Management revenue (the bigger prize)
```

Marketing has **two conversion goals** off the same lead: the **Analyser
subscription** (self-serve SaaS) and, more valuably, **management clients**.
Segment nurture accordingly — e.g. a lead whose report shows strong income + a
"hands-off" signal is a management-service prospect, not just a SaaS trial.

---

## 6. Quick-reference glossary

- **STR** — short-term rental (Airbnb / holiday let / serviced accommodation).
- **The Analyser / Stayful Intelligence** — the free report tool (the lead
  magnet).
- **Stayful Management** — the paid, full-service property management business
  (15% + VAT) that the leads are ultimately for.
- **ADR** — average daily rate (nightly price).
- **Occupancy** — % of nights booked.
- **Long-let vs short-let** — traditional tenancy income vs nightly-let income;
  the core comparison the Analyser resolves.
- **Enquiry** — one lead's row on the Monday CRM board.
- **Lead database** — the Monday "Stayful Intelligence enquiries" board holding
  all captured enquiries and their lifecycle.
