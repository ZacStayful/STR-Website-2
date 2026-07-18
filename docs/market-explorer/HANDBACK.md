# Market Explorer — Build Handback

Status at handback: **Phase 1 & 2 complete; Phase 3 QA done. One item blocked on
sign-off (the score card); one on your input already actioned (occupancy).**

## PRs (unmerged, ready for review)

| Repo | PR | Contents | State |
|---|---|---|---|
| STR-Website-2 (frontend) | **#19** `claude/market-explorer-stayful-9fnank` | Licensing dataset, score proposal, yield-on-cost, area verdict, `/markets` pages, SEO | Open, preview green |
| Stayful-STR-estimate-software (backend) | #5 (merged), #6 (merged) | market-stats route + occupancy-unit fix | **Merged** (you approved) |

> Backend PRs were merged at your explicit request so the endpoint could go live
> and be sanity-checked. Everything else is unmerged for your review.

## What was built

- **Backend `/api/market-stats`** — live on production, secret set, sanity-checked
  against real data (13 areas). Found & fixed a mixed-unit occupancy bug (was
  returning 5560% instead of 55.6%).
- **Licensing dataset** — `src/lib/data/str-licensing.ts`, 85 postcode areas
  (20 licensed / 52 unrestricted / 13 unconfirmed) + honest `unconfirmed`
  fallback, cited sources per confirmed entry.
- **Yield-on-cost** — `src/lib/market/yield.ts`, sample-weighted, omits the stat
  when property value is null (never £NaN). 9 unit tests.
- **Long-let vs short-let verdict** — `src/lib/market/verdict.ts`, reuses
  `analysis.ts` unchanged (byte-identical, proven by test + zero git diff), fed an
  area-average PropertyData long-let via the existing client. 7 unit tests.
- **`/markets` + `/markets/[area]`** — server-rendered, fully open (no paywall),
  filters (region/budget/bedrooms), unique per-area SEO, 13 area pages SSG,
  empty/unconfirmed states, CTA into the `/estimate` analyser.
- **Score** — proposal written (`score-proposal.md`); NOT implemented (awaiting
  sign-off). A marked slot is left in the card/explorer.

## Phase 3 — QA results

| Check | Result |
|---|---|
| Frontend `tsc --noEmit` | ✅ clean |
| Frontend `next build` | ✅ clean, `/markets` + 13 area pages prerendered |
| Frontend tests | ✅ 16/16 |
| Backend `tsc` / tests / `next build` | ✅ clean / 16/16 / clean |
| **`analysis.ts` regression** | ✅ **byte-identical to main** (zero diff) — single-address analyser unchanged |
| Filter combo → zero areas | ✅ real empty state ("No areas match those filters") |
| Null property value | ✅ yield shows `—`, not £NaN/£0 |
| PropertyData long-let null | ✅ verdict degrades to "not enough data" (unit-tested; VerdictLabel null branch) |
| `unconfirmed` licensing | ✅ distinct grey badge, never omitted |
| `min_samples` boundary | ✅ group of exactly 5 included at `min_samples=5`, dropped at 6 (verified live) |
| Stale/guessed area link | ✅ "not enough data" state; bogus slug → 404 |
| Browser console (all pages) | ✅ zero errors (fixed a React #418 hydration mismatch) |

## Known issues / flagged, not fixed

1. **Data is thin.** Only 13 areas clear `min_samples=5` (5–15 samples each) despite
   ~409 backfilled rows — most rows don't clear the per-bedroom threshold. Not a bug;
   the product just needs more data. As it grows, more areas appear automatically.
2. **Property values null for most areas.** So yield-on-cost is shown for only ~2 of 13
   areas today (handled cleanly with `—`). Improves as the analyser stores more sale
   valuations.
3. **Occupancy mixed units in the DB (root cause not fully removed).** The route now
   normalises defensively, but the underlying `analyser_reports.occupancy` column still
   holds a mix of 0–1 (live analyser) and 0–100 (backfill). Worth a one-off DB
   normalisation later so the column has one unit; flagged rather than done (out of
   scope + you declined DB access this session).

## Deviations from spec (called out, not buried)

1. **Score not built** — per the Step 2 hard stop, awaiting your sign-off. This is the
   one remaining Phase 2 element.
2. **Long-let comparator = one representative central postcode per area**, not a true
   multi-point average across the area. Bounds PropertyData to one call/area. Documented
   in `area-postcodes.ts`. (Locally I couldn't set `PROPERTYDATA_API_KEY`, so verdicts in
   my screenshots use the national-median fallback; production has the key and will be
   area-specific.)
3. **Bedroom filter is availability-only** — selecting a bedroom count filters to areas
   that have that group; it doesn't recompute the card's blended headline stats. v1
   simplification to avoid duplicating the weighting logic client-side.
4. **Budget filter excludes null-value areas** when a specific bracket is chosen (a budget
   search should only surface areas we can confirm fit). Documented in `FilterableAreas`.
5. **No test runner existed** in the frontend — added `node --test` (mirroring the
   backend) + `allowImportingTsExtensions` in tsconfig (matching the backend's).
6. **Next.js is 16.2.1**, not 14 as the original spec stated.

## Score sign-off — still needed from you

`docs/market-explorer/score-proposal.md` — weights (40/25/20/15), regulatory ordering
(unrestricted > licensed > unconfirmed), and anchor bands. Once approved I'll wire it into
the card + explorer sort (the only remaining piece).
