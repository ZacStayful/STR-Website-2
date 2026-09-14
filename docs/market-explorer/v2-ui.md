# Market Explorer v2 — UI handback

The members' Market Explorer was rebuilt in September 2026 from the Claude Design
handoff "Market explorer UX redesign" (`Market Explorer v2 Stayful.dc.html`). This
note records what was built, what the data could not support and what was done
instead, and the URL contract the e-mails and deep links rely on.

## Screens

| Route | Component | What it is |
|---|---|---|
| `/markets` | `src/app/markets/_components/explorer/v2/find/FindShell.tsx` | "Find a market": region menu, filter bar, Markets / Sub-markets / My deals grid on the left, sticky UK choropleth on the right, compare dock. |
| `/markets/[slug]` | `src/app/markets/_components/explorer/v2/market/MarketPage.tsx` | "Market overview": header, eleven tabs, the member's deals, the compare dock. Replaces the old side drawer. |
| `/markets/map` | redirect to `/markets` | unchanged |

Signed-out visitors still get the public product page (`MarketExplorerProductPage`)
at both routes; blocked members are sent to `/upgrade` by `requireMarketAccess`.

## URL contract

| Param | Where | Meaning |
|---|---|---|
| `region=<slug>` | `/markets` | Narrow to one region. Absent, or `all`, is every area. |
| `level=sub` | `/markets` | Show postcode districts instead of areas. |
| `pane=listings` | `/markets` | Open the My deals level (kept for the alert e-mails). |
| `listing=<id>` | `/markets` | Open that deal's sheet (only ids the member owns). |
| `check=<url>` | `/markets` | Prefill the paste box with a listing link. Never auto-checked: a link must not spend credit. |
| `sort=<key>` | both | One of `rank.ts` `SortKey` (now including `adr`). |
| `q=<text>` | `/markets` | Area / postcode search. |
| `tab=<key>` | `/markets/[slug]` | One of `tab-model.ts` `TAB_KEYS`; omitted for the overview. |
| `district=<code>` | `/markets/[slug]` | Scope the figures to one district of the area. |

All of these are written with `history.replaceState`, so refresh and share keep
the view.

## Data → UI

Everything comes from the hourly snapshot (`src/lib/market/cached.ts`). The card
shape is `AreaCardData` (`src/lib/market/explorer.ts`); districts and regions carry
`LevelFigures`.

- **Market score** — the signed-off `AreaScore` (yield 40 / occupancy 25 / revenue
  20 / regulatory 15, `docs/market-explorer/score-proposal.md`). The prototype's
  four-bar "blend" was not ported; the four bars are `score.components`.
- **Your fit** — `PersonalScore`, null until the member sets goals; every place
  that shows it has a "Set goals" state.
- **Deltas** — `AreaTrend` compares the last full months with the ones before
  (`delta.ts`). Tags say "vs prior N mo" and never "past year": there is no
  year-on-year history.
- **Map bands** — `buckets.ts` quantile thresholds over the visible areas,
  rounded and deduped so no band is empty with thin data.
- **Tabs** — `src/lib/market/tab-model.ts` builds the KPI tiles, chart, table and
  key/value list for every data tab from the card or district; it is pure and
  unit-tested.

## Naming markets and sub-markets

Titles are places; codes live in the subtitle. Every name comes from
`src/lib/market/labels.ts` so cards, breadcrumbs, tables, the source line, the
PDF and e-mails agree.

| Level | Title | Subtitle | Short form (menus, table cells) |
|---|---|---|---|
| Market | Leicester | LE postcode area · East Midlands | — |
| Sub-market | Leicester · Clarendon Park | LE2 postcode district · also Knighton, Stoneygate, Aylestone & 1 more | Clarendon Park (LE2) |
| Sub-market, no locality on file | Leicester LE2 | LE2 postcode district | LE2 |

- Every one of the 124 UK postcode areas has a place name in
  `src/lib/market/areas.ts` (Royal Mail post town; compass quarters for the
  London areas), so "BD postcode area" no longer appears for a real area. The
  code-only fallback fires only for a code that is not a postcode area.
- District localities live in `src/lib/market/district-localities.ts` (lead
  first, from the Royal Mail / Wikipedia district lists): the live areas and
  major cities in that file, the rest of the UK split by region under
  `src/lib/market/localities/`. Every postcode area is covered; a district
  missing from the table still falls back to its code. The snapshot carries
  them as `DistrictCardData.locality` / `localities`, and search on `/markets`
  matches them ("clarendon" finds LE2).
- Slugs and URLs are unchanged (`/markets/leicester?district=LE2`); the bare
  code (`/markets/le`) is an alias for the named slug.

## What the design showed that the data does not have

| Design element | Why not | What is shown instead |
|---|---|---|
| Active listings count, its YoY, "Entire homes %" | no inventory data | Listing density (per km² around the analysed addresses), no delta |
| 36-month supply chart | only 12 months of report activity | Reports per month |
| "+8% past year" | 3-month windows only | "+8% vs prior 3 mo" / "Building history" |
| Top-performing listings | no per-listing comparables stored | The member's own checked listings in the area |
| Peak / low-season rate, weekend uplift, peak occupancy month | no calendar ADR or occupancy | Highest / lowest month in the 12-month series; revenue share by month from seasonality |
| Property type, bathrooms filters | not in the data | Bedrooms only |
| Hero photo per market | no imagery | The area on the UK map |
| District score | districts carry no score, licensing or verdict | Confidence column; licensing / verdict / score follow the area, with a note |
| Licensing rules table (90-night rule, business rates) | not per-area data | The dataset's `headline`, `detail`, `changeIncoming`, `straddle`, `sources`, `lastVerified` |
| 15 / 11 / 12 % long-let costs | the analyser's shared financials are the single source | `verdict.financials`, with toss-up and no-comparator states |

## What survived from the previous explorer

Deal pipeline (list, sheet, compare, pasted-link checks, pins, e-mail deep links),
the Regions level (as the region menu), goals modal and alert toggles, PDF export,
home marker and radius, "Stayful manages here" enquiry, and every null state.

## Styling

All new rules are `.mx2-*` inside `src/app/markets/markets.css`, scoped under
`.mx`, using the `--font-playfair` / `--font-dmsans` variables from
`src/app/markets/layout.tsx`. The design's `stayful-mx.css` was not imported: it
restyles `html`, `body`, headings and `:focus` globally.

## Verification

```
npx tsc --noEmit
npm run lint
npm test
npm run build
```

The screens were rendered in headless Chromium from an esbuild harness with fixture
data during the build (phases 2–4); real-data checks happen on the Vercel preview
with a member session.
