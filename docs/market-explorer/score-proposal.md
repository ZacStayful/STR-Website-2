# Market Explorer — Transparent Area Score (Proposal for sign-off)

**Status: PROPOSAL — awaiting Zac's approval. No scoring code or score UI will be
built until this is signed off (Phase 1, Step 2 hard stop).**

## Why a transparent score (not a black box)

AirDNA gives one opaque "Investability" number you can't interrogate. Our
deliberate differentiator is *"we show our working."* So this is **not** a single
mystery number — it's a **0–100 composite built from four named sub-scores**, and
every area card/page shows the sub-scores and the raw figure behind each one. A
customer (or Zac, defending it on a call) can always answer *"why did this area
score 72?"* down to the pound.

This mirrors the scoring style the app already uses elsewhere
(`src/lib/scores.ts` — `directBookingScore` is an additive 0–100 with visible
contributions), so it will feel native to the product.

**Higher is better.** 0–100 scale. Four components that sum to 100.

---

## Inputs (all already available — no new data needed)

Everything comes from `/api/market-stats` (per area, per bedroom group) plus the
Step 1 licensing flag. No new API calls, no live PropertyData-per-area.

| Input | Source | Notes |
|---|---|---|
| `avg_gross_revenue` | market-stats | £/yr |
| `avg_occupancy` | market-stats | already 0–100% |
| `avg_property_value_low/high` | market-stats | midpoint = purchase-price proxy |
| Yield-on-cost | Step 3 = `avg_gross_revenue / avg_property_value_mid` | derived |
| Licensing flag | Step 1 dataset | `confirmed-unrestricted` / `confirmed-licensed` / `unconfirmed` |
| `sample_count` | market-stats | confidence, **not** part of the score (see below) |

**Area-level aggregation.** The API returns metrics per bedroom group. For the
headline area score we aggregate each metric as a **sample-count-weighted average
across that area's bedroom groups**, then score once. (Rationale: a 2-bed group
with 40 samples should weigh more than a 5-bed group with 6.) The per-bedroom
breakdown is still shown on the area page.

---

## The four components

### 1. Yield-on-cost — 40 points (the biggest lever)

The single most investor-relevant metric: *return relative to capital deployed.*
Gross STR revenue ÷ property value. This is what makes area-picking an investment
decision rather than a revenue beauty contest.

```
yieldPct = avg_gross_revenue / avg_property_value_mid × 100
points   = clamp( (yieldPct − 4) / (14 − 4) × 40 , 0 , 40 )
```

Anchors: **4% gross yield → 0 pts** (roughly a long-let gross yield floor — no STR
premium), **≥14% → full 40 pts** (a genuinely exceptional STR yield). Linear
between, so it's fully explainable ("11% yield = 28/40").

### 2. Occupancy — 25 points (demand reliability)

How dependably the area actually books. High occupancy de-risks the revenue
figure — it's earned demand, not a headline ADR that sits empty.

```
points = clamp( (avg_occupancy − 40) / (75 − 40) × 25 , 0 , 25 )
```

Anchors: **40% → 0**, **75% → full 25**. (UK STR occupancy typically lands
50–70%, so this band discriminates where it matters.)

### 3. Revenue scale — 20 points (absolute earning power)

Balances the yield component, which structurally favours cheap-property areas. A
£45k/yr revenue market is a different proposition from a £16k/yr one even at the
same yield. Uses absolute gross revenue.

```
points = clamp( (avg_gross_revenue − 15000) / (45000 − 15000) × 20 , 0 , 20 )
```

Anchors: **£15k/yr → 0**, **£45k/yr → full 20**.

### 4. Regulatory ease — 15 points (the UK-specific differentiator)

AirDNA has no real depth here; this is ours. Rewards areas that are simply
easier/clearer to operate a legal STR in.

| Licensing flag | Points | Rationale |
|---|---|---|
| `confirmed-unrestricted` | **15** | Legal, no extra hoops — easiest to operate |
| `confirmed-licensed` | **9** | Legal and *clear*, but licence cost/time is real friction |
| `unconfirmed` | **6** | Lowest — uncertainty is itself an investor risk, and we won't reward a regulatory position we can't verify |

**Ordering is deliberate: unrestricted > licensed > unconfirmed.** Note this is a
judgment call — one could argue `licensed` (known rules) should beat `unconfirmed`
by *more*, or that a licensing regime shouldn't be penalised at all since STR is
still fully legal there. **This is the main thing I'd like your steer on.**

---

## Score → grade badge

The card shows the number *and* a letter grade + colour ring (brand sage greens,
per the design tokens — `#5D8156` deep / `#B9D5C6` mid / `#D0D6BA` light):

| Score | Grade | Label |
|---|---|---|
| 80–100 | A | Exceptional |
| 65–79 | B | Strong |
| 50–64 | C | Moderate |
| 35–49 | D | Marginal |
| 0–34 | E | Weak |

---

## Edge cases (decided, not improvised)

- **Null property value** (`avg_property_value_low/high` both null): the yield
  component (40 pts) can't be computed. We **drop it and renormalise the remaining
  three components to 100** (×100/60), and flag the score as **"Partial"** on the
  card so it's honest that the biggest lever is missing. We never divide by null or
  show a fabricated yield. (Ties into Step 3's null handling.)
- **Confidence ≠ quality.** `sample_count` is shown as a *separate* confidence
  badge (e.g. <10 low · 10–29 medium · 30+ high), never folded into the score.
  Baking data-confidence into an investment-quality number would conflate two
  different things. `min_samples` already guarantees ≥5.
- **`unconfirmed` licensing** still scores (6 pts) and renders with its own honest
  visual treatment — never silently dropped.

---

## Worked example

Area with £28,000 avg gross revenue, 63% occupancy, £310k avg property value,
`confirmed-unrestricted`:

- Yield = 28000/310000 = **9.03%** → (9.03−4)/10×40 = **20.1/40**
- Occupancy 63% → (63−40)/35×25 = **16.4/25**
- Revenue £28k → (28000−15000)/30000×20 = **8.7/20**
- Regulatory unrestricted → **15/15**
- **Total ≈ 60 → Grade C (Moderate)**, and the card shows exactly those four lines.

---

## What I need from you

1. **Approve or adjust the weights** (40 / 25 / 20 / 15).
2. **Steer on the regulatory ordering** (unrestricted > licensed > unconfirmed —
   agree? or should `licensed` not be penalised vs unconfirmed?).
3. **Approve the anchor bands** (yield 4–14%, occupancy 40–75%, revenue £15k–£45k)
   — these are my best UK STR estimates; happy to tune once we've eyeballed the
   real market-stats distribution.

Once you reply with explicit approval I'll wire it into the area cards. Until then
I'll build everything else in Phase 2 (yield-on-cost, long-let vs short-let
verdict, the pages) and leave a clean slot for the score.
