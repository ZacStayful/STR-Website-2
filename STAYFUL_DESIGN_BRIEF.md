# Stayful — Design Brief for Claude Code

> Reference this file in every prompt: *"Follow the Stayful design brief."*

---

## 1. Brand Identity

| Property | Value |
|---|---|
| **Company name** | Stayful |
| **Tagline** | Full-Service Airbnb & Holiday Let Management Across the UK |
| **Logo (PNG)** | `https://images.squarespace-cdn.com/content/v1/64946e7680c92451dce86167/b6f59d1c-fee6-4f55-948b-3c05b6e18a3b/Stayful_Dark_Green.png?format=1500w` |
| **Logo description** | Dark green wordmark, no icon, horizontal lockup |

---

## 2. Colour Palette

| Name | Hex / RGB | Usage |
|---|---|---|
| **Brand Green** (primary) | `rgb(93, 129, 86)` / `#5D8156` | All headings, pill text, icon fills, borders, CTA text |
| **White** | `#FFFFFF` | Page backgrounds, card backgrounds |
| **Light grey background** | `#F7F7F5` | Section alternates, snippet card backgrounds |
| **Soft grey body text** | `#555555` / `#444` | Body copy — never pure black |
| **Dark green (nav/footer)** | `#2E3D2B` | Footer background, nav on dark variants |
| **Accent green (light tint)** | `rgba(93,129,86,0.08)` | Pill/badge backgrounds |
| **Success green** | `#3B7A3B` | Positive uplift figures, "+" numbers |

> **Rule:** Never use pure `#000000` for body text. Use `#444` or `#555`.

---

## 3. Typography

| Role | Family | Weight | Notes |
|---|---|---|---|
| **Headings (H1-H3)** | `'DM Sans', sans-serif` — fallback `'Inter', sans-serif` | 600-700 | Sentence case preferred, not all-caps |
| **Body copy** | `'DM Sans', sans-serif` | 400 | 16-18px, line-height 1.65 |
| **Stat/number callouts** | `'DM Sans', sans-serif` | 700 | Large (2-4rem), brand green |
| **Pill/badge labels** | `'DM Sans', sans-serif` | 500 | 13-14px, uppercase letter-spacing 0.04em |
| **Navigation** | `'DM Sans', sans-serif` | 500 | 15px |
| **Footer** | `'DM Sans', sans-serif` | 400 | 14px, white on dark |

DM Sans is loaded via `next/font/google` in `src/app/layout.tsx` and bound to the `--font-sans` CSS variable.

---

## 4. Spacing & Layout

| Token | Value |
|---|---|
| **Max content width** | `1140px` |
| **Section vertical padding** | `80px` top/bottom (desktop), `48px` (mobile) |
| **Card padding** | `28px` |
| **Card border-radius** | `12px` |
| **Pill border-radius** | `999px` (fully rounded) |
| **Grid gap** | `24px` |
| **Standard CTA button padding** | `14px 28px` |
| **CTA button border-radius** | `8px` |

---

## 5. Component Library

All component classes live in `src/app/globals.css` and are scoped behind a `.sf-page` wrapper so they don't bleed into the analyser app at `/app`.

### 5.1 Pill / Badge — `.sf-pill`
### 5.2 Stat tiles — `.sf-numbers` + `.sf-numbers__tile` + `.sf-numbers__value` + `.sf-numbers__label`
### 5.3 Primary CTA — `.sf-btn`
### 5.4 Ghost CTA — `.sf-btn .sf-btn--ghost`
### 5.5 Case study card — `.sf-card` with `.sf-card__top`, `.sf-card__title`, `.sf-badge`, `.sf-card__desc`, `.sf-metrics`, `.sf-metric`
### 5.6 Comparison table — `<table className="sf-table">`
### 5.7 FAQ accordion — `<details className="sf-faq">` with `.sf-faq__q`, `.sf-faq__a`
### 5.8 Process steps — `.sf-step` with `.sf-step__num`, `.sf-step__body`
### 5.9 Nav — `.sf-nav` / `.sf-nav__inner` / `.sf-nav__logo` / `.sf-nav__links`
### 5.10 Footer — `.sf-footer` / `.sf-footer__cols` / `.sf-footer__col` / `.sf-footer__base`

Standard pill set (hero):
*Reviews · Multi-platform advertising · Dynamic pricing · Cleaning & linen · Maintenance + keys · Guest communication · Direct bookings*

---

## 6. Navigation

**Logo** (left) · **Nav links** (centre/right): Home · How it works · Pricing · Case studies · Sign in

**Primary CTA button** (far right): `Try free for 14 days` → `/signup`

Nav background: white. Border-bottom: `1px solid #eee`. Sticky on scroll.

---

## 7. Footer

Two-tone: dark green (`#2E3D2B`) top band with logo + column links, lighter `#1e2a1c` base strip with copyright.

**Footer columns:** Product · Company · Resources · Legal

---

## 8. Page Section Structure (standard landing page)

| # | Section | Component |
|---|---|---|
| 1 | **Hero** | H1 + body + pills + sf-numbers + CTA |
| 2 | **Social proof bar** | Logos + star rating |
| 3 | **How it works** | sf-steps (4 steps) |
| 4 | **Case studies** | 3× sf-card grid |
| 5 | **Comparison table** | Stayful vs typical valuation tools vs guesswork |
| 6 | **Testimonials** | 3-4 quote cards |
| 7 | **FAQ** | sf-faq accordion |
| 8 | **Final CTA** | Headline + button |
| 9 | **Footer** | sf-footer |

---

## 9. Key Copy Rules

- **Tone:** Direct, honest, number-led. Speak to cautious landlords (Profile B: existing landlords on long-term tenancies who need real figures including slow months).
- **Never** make guarantees on income. Say "typically see" or "comparable properties achieve."
- **Always** include the 15% + VAT fee prominently — competitive advantage.
- **Benchmark figures** to use consistently:
  - ~70% occupancy (vs 55% UK market average)
  - ~£110 ADR
  - ~12-night average stay
  - 4.8 Google / 4.6 Airbnb ratings
  - 40% direct bookings
  - 70+ properties, £3M+ earned for landlords
  - 48-66% net monthly uplift vs long-let (conservative)
  - Live in 7-14 days
  - Income paid 1st-5th of each month
- **CTA copy:** "Estimate your income" (primary) · "See what your property could earn" (secondary)
- **H1 structure:** `[Service] in [City] — [Benefit statement]`

---

## 10. Imagery Guidelines

- Property photography: bright, airy interiors; clean beds; modern kitchens
- Local area: city landmarks, rivers, markets, parks — 10 images per carousel
- Alt text: descriptive (`"Stayful-managed property lounge in Lincoln city centre"`)
- No stock-photo clichés (handshakes, generic graphs)

---

## 11. SEO / Structured Data

- Every page needs: `<title>`, `<meta name="description">`, `<link rel="canonical">`
- FAQ sections use `application/ld+json` FAQ schema
- Case study sections use `Dataset` schema where applicable
- Primary keyword pattern: `airbnb management [city]` / `holiday let management [city]`
- Secondary: `short term rental management`, `serviced accommodation management`, `guaranteed rent [city]`

---

## 12. Quick Reference — CSS Variables

Defined in `src/app/globals.css`:

```css
:root {
  --sf-green:        rgb(93, 129, 86);
  --sf-green-dark:   #4a6e44;
  --sf-green-tint:   rgba(93, 129, 86, 0.08);
  --sf-green-border: rgba(93, 129, 86, 0.18);
  --sf-success:      #3B7A3B;
  --sf-footer-bg:    #2E3D2B;
  --sf-footer-base:  #1e2a1c;
  --sf-body:         #555555;
  --sf-body-strong:  #444444;
  --sf-heading:      rgb(93, 129, 86);
  --sf-bg:           #ffffff;
  --sf-bg-alt:       #F7F7F5;
  --sf-radius-card:  12px;
  --sf-radius-pill:  999px;
  --sf-radius-btn:   8px;
  --sf-max-width:    1140px;
  --sf-font:         'DM Sans', 'Inter', sans-serif;
}
```

---

*Last extracted: May 2026 from www.stayful.co.uk*
