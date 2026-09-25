# Market Explorer — which analyser reports count, and where

The explorer is built from the `analyser_reports` table in this app's Supabase
project. STR-Website-2 never writes to it. The Stayful estimate software
(calculator.stayful.co.uk, repo `Stayful-STR-estimate-software`) is the only
writer, and it tags every row with a `source`.

| `source` | What it is | Rows (2026-09-25) |
|---|---|---|
| `analyser` | A property run through the free calculator | 404 |
| `monday_backfill` | Figures read from Stayful's own analysis PDFs on Monday, loaded once on 2026-07-16 | 409 |
| `lead_db` | A property a Stayful lead-database customer paid £3 to analyse from their **own** lead list | 0 (no analysis bought yet) |

## Where each source counts

| | `analyser` | `monday_backfill` | `lead_db` |
|---|---|---|---|
| Area, region and district figures, per-bedroom figures, yield, verdict, score, confidence tier, competition, demand, seasonality | yes | yes | yes |
| "Analyser reports" totals, API, MCP `market_snapshot`, market PDF, alerts "became Confirmed", daily picks, screen report | yes | yes | yes |
| Monthly trend series: "Reports per month", "Enquiries, last 3 months", trend arrows, the national pulse | yes | yes | **no** |
| Listing quick view's single-postcode figure ("Average of N recent Stayful reports for this postcode") | yes | yes | **no** |

- **Kept out of the trend series** (`DEFAULT_SERIES_SOURCES` in
  `src/lib/market/aggregate.ts`). A customer analyses an imported list in one
  go, so those rows would read as a one-day spike, and they are not dated
  enquiries. An area's "Analyser reports" total can therefore be higher than
  the sum of its monthly bars. That is expected.
- **Kept out of the single-postcode figure** (`usableForPostcodeFigure` in
  `src/lib/market/quality.ts`). A full postcode covers a handful of addresses,
  and that figure can rest on one report, so it would show one customer's
  property on its own. Those rows only count where they are pooled with others.
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
