# Chrome Web Store submission — Stayful Intelligence

Everything the Developer Dashboard asks for, ready to paste. The code side is
done; what remains is a Google account, an upload and a review.

## Before you start

- A Google account for the developer registration. Use a shared/ops account,
  not a personal one — the listing belongs to whoever registers.
- A **one-off $5** developer registration fee, and Google's identity
  verification (allow a day or two the first time).
- Register at <https://chrome.google.com/webstore/devconsole>.

## Build the upload

```bash
npm run package:extension   # → extension/stayful-intelligence-1.0.0.zip
```

Upload that zip. The version in `extension/manifest.json` must increase on
every subsequent upload — the store rejects a re-used version number.

## Visibility

Set **Unlisted**, not Public and not Private.

The store cannot check whether someone pays for Stayful: its "Private" option
only restricts to a Google Workspace domain or a named list of Google
accounts, neither of which maps to our members. Unlisted keeps the listing out
of store search, so the install link only reaches people we hand it to — it's
on `/extension/connect` and `/account`, both behind the member gate.

The real gate is unchanged and does not depend on the store: the extension does
nothing without a connection token, and tokens are only mintable at
`/extension/connect`, which redirects non-members to `/login` or `/upgrade`.
Someone who gets hold of the install link still sees nothing.

## Listing copy

**Name:** Stayful Intelligence

**Short description** (132 characters max):

> See what a Rightmove, Zoopla, OnTheMarket, Airbnb or Booking.com listing would earn as a short-term let, without leaving the page.

**Detailed description:**

> Stayful Intelligence puts a short-let revenue estimate on the property
> listing you are already looking at.
>
> Open a listing on Rightmove, Zoopla, OnTheMarket, Airbnb or Booking.com and a
> small Stayful bar appears. Click Check and you get:
>
> - Estimated annual short-let revenue, average nightly rate and occupancy
> - The area's Stayful score, nearby competition and licensing position
> - Deal maths at the asking price or rent, for a purchase or a rent-to-rent
> - One click to save the listing to your Stayful pipeline or open the full report
>
> Nothing is read or sent until you click Check.
>
> The extension is part of a Stayful Intelligence membership. You connect it to
> your account once, from your account page, and can revoke that connection at
> any time.

**Category:** Productivity. **Language:** English (UK).

## Privacy tab

- **Single purpose:** Show a Stayful short-term-let revenue estimate for the
  property listing page the member is viewing, and save that listing to their
  Stayful account.
- **Privacy policy URL:** <https://intelligence.stayful.co.uk/extension/privacy>

### Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Stores the member's connection token and the Stayful site address so they do not have to reconnect on every page. Nothing else is stored. |
| Host permission — `https://intelligence.stayful.co.uk/*` | The extension's own backend. It is where the estimate is calculated and where the member's saved listings live. |
| Content scripts — Rightmove, Zoopla, OnTheMarket, Airbnb, Booking.com listing pages | The extension reads the property listing the member is viewing (price or rent, bedrooms, location) to produce the estimate. It is limited to listing-detail URL paths on those five sites and runs nowhere else. |

The extension requests no `tabs`, `activeTab`, `scripting`, `history` or
`webRequest` permission.

### Data use disclosures

Declare **Website content**, and nothing else. Be explicit about the HTML —
this is the part reviewers ask about:

> When the member clicks Check, the extension sends the listing page's URL and
> its HTML to intelligence.stayful.co.uk, which parses out the property details
> (price or rent, bedrooms, postcode, photo links) needed for the estimate.
> Only those typed fields are retained; the HTML itself is discarded after
> parsing. Nothing is sent before the member clicks.

Tick the three certifications — data is not sold to third parties, not used for
purposes unrelated to the single purpose, and not used to determine
creditworthiness or for lending.

**Not collected:** personally identifiable information, health, financial or
payment information, authentication information, personal communications,
location, web history, user activity.

### Remote code

Answer **no**. Everything is bundled by esbuild at build time
(`extension/build.mjs`); the extension does not fetch or execute any script at
runtime. Answering this wrongly is a common rejection.

## Screenshots

At least one is required, 1280×800 or 640×400 PNG. These have to be captured
on a machine with the extension installed and connected to a real member
account:

1. The panel showing a result on a Rightmove listing (the main screenshot).
2. The panel on an Airbnb listing showing tracked revenue.
3. The toolbar popup showing a connected account.

A 440×280 promo tile is optional. `extension/icons/icon512.png` is generated by
`extension/icons/make-icons.mjs` if a large icon is wanted for the listing.

## After approval

Google assigns a permanent 32-character extension id, which is **not** the dev
id from `node extension/build.mjs --dev`. Take it from the listing URL and set
both variables on Vercel (production and preview), then redeploy:

```
NEXT_PUBLIC_EXTENSION_ID=<the store id>
EXTENSION_IDS=<the store id>
```

Both are documented in `.env.example`. Until they are set:

- `/api/ext/*` rejects the extension's CORS preflight, so nothing works;
- `/extension/connect` cannot hand the token over directly and falls back to
  copy-and-paste;
- the "Add to Chrome" link does not appear on `/extension/connect` or
  `/account`.

If you later add a second published build (a Chrome beta channel, or an Edge
listing), add its id to `EXTENSION_IDS` as a comma-separated list.

Review usually takes a few days. An extension that sends page content to its
own backend sometimes draws a follow-up question; the disclosures above answer
it up front.
