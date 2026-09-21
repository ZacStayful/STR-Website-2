# Stayful — Design Brief

> **How to use this file:** it points at the code rather than restating it.
> Where a value lives in `globals.css` or a module, go and read it there — the
> previous version of this brief duplicated a palette and a typeface, both
> drifted, and it spent months telling people the site was white with DM Sans
> when it had been sage green with Inter and Cormorant for some time.
>
> Anything below with a file path beside it is checkable. If you change one,
> change the other.

---

## 1. Brand identity

| Property | Value | Source |
|---|---|---|
| Company name | Stayful | `src/lib/brand.ts` |
| Legal name | Stayful Limited | `src/lib/brand.ts` |
| Tagline | Full-Service Airbnb & Holiday Let Management Across the UK | — |
| Wordmark | `public/assets/stayful-logo.png` — script wordmark, transparent PNG, no icon | — |

The wordmark is a **transparent** PNG, so it sits directly on the sage
background with no plate behind it. Do not composite it onto white.

Trust figures (properties managed, revenue earned, Google rating) live in
`TRUST` in `src/lib/brand.ts`. **Read them from there rather than copying
them into a page** — that is exactly how this file ended up quoting a Google
rating that no longer matched.

---

## 2. Which design system you are in

The repo runs three surfaces with different type and colour. Check which one
you are editing before reaching for a token.

| Surface | Routes | Wrapper | Tokens |
|---|---|---|---|
| **Marketing v3** — the current public design | `src/app/(marketing)`, `/markets` | `.sf-page-v3` | `--sage-*`, `--ink-*`, `--cream*`, `--line*`, `--v3-radius-*` |
| **Analyser / app UI** | `/estimate`, `/leads`, `/reports`, … | shadcn defaults | `:root` tokens: `--background`, `--card`, `--primary`, … |
| **Legacy `.sf-page`** | a handful of older pages | `.sf-page` | `--sf-*` |

`.sf-page-v3` is the live system — it outnumbers `.sf-page` in `globals.css`
by roughly sixty to one. New marketing work belongs there.

The `--sf-*` variables still exist and still work, but several the old brief
listed (`--sf-success`, `--sf-body-strong`) were never defined, and others
have moved: `--sf-bg` is `#BAD6C7`, not white; `--sf-body` is `#5D8156`, not
`#555555`. Treat `globals.css` as the only authority.

---

## 3. Typography

**There is no single site font.** Four families are loaded, and which apply
depends on the route.

`src/lib/marketing-fonts.ts` → used by `(marketing)` and `/markets`:

| Role | Family | Variable | Weights |
|---|---|---|---|
| Headings (h1–h4 under `.sf-page-v3`) | **Cormorant Garamond** | `--font-serif` | 400/500/600 |
| Body, UI | **Inter** | `--font-sans` | 400/500/600 |
| Labels, eyebrows, table headers | **JetBrains Mono** | `--font-mono` | 400/500 |
| Handwritten accents | **Caveat** | `--font-script` | 500/600/700 |

`src/app/layout.tsx` loads **Inter** as the root `--font-sans`, which is what
the analyser and app UI render in.

**DM Sans is route-scoped, not the site font.** It is loaded only by
`src/app/markets/layout.tsx` (alongside Playfair Display, for `markets.css`)
and `src/app/str-report/layout.tsx`. Do not reach for it anywhere else.

Headings are a **serif** on marketing v3. If you are writing a heading in a
bold grotesque, you are either on the analyser side or doing it wrong.

---

## 4. Colour

Every colour is defined in `src/app/globals.css`. The groups:

- **Marketing v3** — `--sage-50` … `--sage-900` (the ramp), `--ink` /
  `--ink-soft` / `--ink-mute` (type), `--cream` / `--cream-2` / `--cream-3`,
  `--line` / `--line-2` (hairlines), `--shadow-sm|md|lg`.
- **Analyser** — `--background: #d0d6ba`, `--card: #e6ebd7`,
  `--primary: #5d8156`, `--secondary: #bad6c7`, `--border: #aab99b`,
  `--muted-foreground: #6e9164`. *Do not change these without checking the
  analyser still renders* — the comment above them in `globals.css` says so
  for good reason.
- **Brand** — `--stayful-green: #5d8156`, `--stayful-sage: #d0d6ba`,
  `--stayful-mint: #bad6c7`. The dark-mode block redefines
  `--stayful-green` to `#8ab382`: that is the brand green that works **on a
  dark ground**, and it is what dark panels should use.
- **Footer** — `--sf-footer-bg: #2E3D2B` (top band),
  `--sf-footer-base: #1e2a1c` (base strip, and the deepest brand dark).

Two rules worth keeping:

- Never pure `#000000` for type. The brand's dark is green-black.
- Tints of `--primary` toward `--card` stop being visible against
  `--background` at about 70%. Anything lighter disappears on the page.

---

## 5. The property report (PDF)

`src/lib/pdf/` renders the six-page property income analysis. It is a separate
renderer (react-pdf, not the DOM) but **not** a separate brand.

- Colours: `src/lib/pdf/design/tokens.ts`. Every value there is a quoted
  `globals.css` property — the report is downstream of the site, never a
  parallel palette.
- Type: `src/lib/pdf/fonts/` holds Inter 400/500/600 and JetBrains Mono
  400/500 as committed TTFs, because react-pdf cannot use `next/font`. They
  must stay in step with `src/lib/marketing-fonts.ts`; the test in
  `design/font-files.test.ts` fails if the set drifts.
- Headings are Inter SemiBold, not Cormorant: the approved report design uses
  a grotesque, and 600 is the heaviest weight the site loads.

---

## 6. Spacing & layout

Read from `globals.css` rather than this table where the two disagree.

| Token | Value |
|---|---|
| `--sf-max-width` | `1140px` |
| `--v3-radius-sm` / `--v3-radius` / `--v3-radius-lg` | `8px` / `14px` / `24px` |
| `--sf-radius-card` / `--sf-radius-pill` / `--sf-radius-btn` | `12px` / `999px` / `8px` |
| Section padding | `80px` desktop, `48px` mobile |
| Grid gap | `24px` |

---

## 7. Components

Component classes live in `src/app/globals.css`. Marketing v3 uses
`.sf-page-v3` descendants; the legacy set is scoped behind `.sf-page` so it
cannot bleed into the analyser at `/estimate`.

Legacy `.sf-*` components: `.sf-pill`, `.sf-numbers`, `.sf-btn`
(+ `.sf-btn--ghost`), `.sf-card`, `.sf-table`, `.sf-faq`, `.sf-step`,
`.sf-nav`, `.sf-footer`.

Marketing v3 components are React, under `src/components/marketing-v3/`.

---

## 8. Copy rules

- **Tone:** direct, honest, number-led. Written for cautious landlords who
  want real figures, slow months included.
- **Never** guarantee income. "Typically see", "comparable properties
  achieve".
- **Always** state the management fee prominently — it is a competitive
  advantage, not small print.
- **CTA copy:** "Estimate your income" (primary), "See what your property
  could earn" (secondary).
- **H1 pattern:** `[Service] in [City] — [Benefit statement]`.

Benchmark figures used in marketing copy — occupancy, ADR, average stay,
direct-booking share, uplift vs long-let, time to go live — are **business
claims, not code facts**. They are not verifiable from this repo, so check
them with the team before reusing. Where a figure *does* exist in code
(`TRUST` in `src/lib/brand.ts`), cite that.

---

## 9. Imagery

- Property photography: bright, airy interiors; clean beds; modern kitchens.
- Local area: landmarks, rivers, markets, parks.
- Alt text descriptive: `"Stayful-managed property lounge in Lincoln city centre"`.
- No stock clichés — handshakes, generic upward graphs.

---

## 10. SEO

- Every page: `<title>`, `<meta name="description">`, `<link rel="canonical">`.
- FAQ sections use `application/ld+json` FAQ schema.
- Primary keyword pattern: `airbnb management [city]`,
  `holiday let management [city]`.
- Secondary: `short term rental management`,
  `serviced accommodation management`, `guaranteed rent [city]`.

---

## Keeping this file honest

This brief went stale because it held copies of values that lived elsewhere.
When you extend it:

- Cite the file, don't copy the value — especially for colours, fonts and
  trust figures.
- If you must state a number here, say where it came from and when.
- If you find something in this file that the code contradicts, the code
  wins. Fix the file in the same change.
