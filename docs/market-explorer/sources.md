# Market Explorer — which analyser reports count, and where

The explorer is built from the `analyser_reports` table in this app's Supabase
project. The Stayful estimate software (calculator.stayful.co.uk, repo
`Stayful-STR-estimate-software`) writes the analyses; since Batch 16 this app
writes one kind of row of its own, a marketplace deal's comparables check
(`deal_comps`, below). Every row is tagged with a `source`.

| `source` | What it is | Rows (2026-09-25) |
|---|---|---|
| `analyser` | A property run through the free calculator | 404 |
| `monday_backfill` | Figures read from Stayful's own analysis PDFs on Monday, loaded once on 2026-07-16 | 409 |
| `lead_db` | A property a Stayful lead-database customer paid £3 to analyse from their **own** lead list | 0 (no analysis bought yet) |
| `deal_comps` | A marketplace deal's own Airbnb comparables check (Batch 16, Part B: `src/lib/deal-quality/checks-run.ts`), stored in the analyser's shape and keyed on the deal id (`request_id`), so a re-check replaces it. Carries the outward code only: no full postcode, no address, no listing | 0 until the checks are switched on |

## Where each source counts

| | `analyser` | `monday_backfill` | `lead_db` | `deal_comps` |
|---|---|---|---|---|
| Area, region and district figures, per-bedroom figures, yield, verdict, score, confidence tier, competition, demand, seasonality | yes | yes | yes | yes |
| "Analyser reports" totals, API, MCP `market_snapshot`, market PDF, alerts "became Confirmed", daily picks, screen report | yes | yes | yes | yes |
| Monthly trend series: "Reports per month", "Enquiries, last 3 months", trend arrows, the national pulse | yes | yes | **no** | **no** |
| Listing quick view's single-postcode figure ("Average of N recent Stayful reports for this postcode") | yes | yes | **no** | **no** |

- **`deal_comps` rows feed the area and district figures on purpose**: the
  free screening every listing gets first reads those figures, so the
  shortlist gets better as the checks run. They are not dated enquiries
  (kept out of the series) and not reports anyone ran (kept out of the
  single-postcode figure, `usableForPostcodeFigure`), and they carry the
  outward code only, so a deal's location stays behind the paid open.

- **Kept out of the trend series** (`DEFAULT_SERIES_SOURCES` in
  `src/lib/market/aggregate.ts`). A customer analyses an imported list in one
  go, so those rows would read as a one-day spike, and they are not dated
  enquiries. An area's "Analyser reports" total can therefore be higher than
  the sum of its monthly bars. That is expected.
- **Kept out of the single-postcode figure** (`usableForPostcodeFigure` in
  `src/lib/market/quality.ts`). A full postcode covers a handful of addresses,
  and that figure can rest on one report, so it would show one customer's
  property on its own. Those rows count at area and district level instead.
  ⚠️ That is not a promise they are always pooled with other reports. A
  district's figures stay hidden until it has 3 reports (`MIN_DISTRICT_SAMPLES`
  in `confidence.ts`), but an area is shown from its first report
  (`min_samples = 1`), and so is each bedroom size inside an area, or inside a
  district that is showing figures. So one `lead_db` report can be all there is
  behind a thin area's figures (shown at the `early` tier), or behind one
  bedroom size. The line drawn is the full postcode, a handful of addresses; a
  district or an area covers thousands.
- **No street address is stored for `lead_db` rows.** The estimate software
  writes them with `address` null and coordinates rounded to about 1 km.
  Nothing here reads the address for any source.

## Which reports are market data at all

`isTrustworthyReport` (`src/lib/market/quality.ts`) drops two kinds of report,
whatever the source:

- **Synthetic estimates.** When the analyser finds no comparable listings it
  still returns a plausible figure, with `dataQuality.comparablesFound` = 0.
- **Low-quality reports.** Any report the analyser itself rated
  `dataQuality.level` = `low`.

This is the estimate software's own side-effect gate, and the lead database
uses the same rule to decide whether to charge a customer. So a property a
customer was refunded for never becomes a figure here.

Rows with no quality block are kept. That covers every `monday_backfill` row,
because those came from PDFs and never carried one.

The rule is applied in `buildSnapshot`, which every explorer consumer reads,
and in the single-postcode figure. On the live data it removed 23 of the 404
`analyser` rows (13 with no comparables, 10 rated low). It touched 20 of 101
areas, changed no area's confidence tier and removed no area.
