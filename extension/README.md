# Stayful Intelligence browser extension

Shows a Stayful quick view (estimated short-let revenue, area score, deal maths) on Rightmove, Zoopla, OnTheMarket, Airbnb and Booking.com listing pages, and saves checked listings to the member's pipeline. Members only.

## How it works

- `src/content.ts` mounts a small bar on listing pages (shadow root). Nothing leaves the page until the member clicks **Check**; the page HTML then goes to the service worker.
- `src/background.ts` holds the connection token and calls `/api/ext/*` on the Stayful site (`/api/ext/me`, `/api/ext/check`, `/api/ext/disconnect`). It also receives the token from `/extension/connect` via `externally_connectable`.
- `src/popup.ts` shows connection status, allows pasting a token manually, and disconnects.
- URL detection and types come from `src/lib/listing/` in the main app, so the extension and the site never disagree.

Zoopla and Booking.com block server-side fetches, so the extension is the only way those pages are read. The site parses the HTML it receives and keeps only typed fields.

## Build

```bash
npm run build:extension          # production → extension/dist
npm run package:extension        # production build, zipped for the Web Store
node extension/build.mjs --dev   # also allows http://localhost:3000
node extension/build.mjs --watch
```

Load `extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode → Load unpacked). Note the extension id and set `NEXT_PUBLIC_EXTENSION_ID` (and `EXTENSION_IDS`) on the site so `/extension/connect` can hand the token over directly. Without it, members paste the token into the popup.

The content script hosts mirror the `PATTERNS` list in `src/lib/listing/detect.ts`.
Adding a site or a TLD there means adding a match here too, or the site parses
the URL happily and the panel never appears.

`icons/make-icons.mjs` draws the toolbar icons (a cream "S" on a rounded green
tile) from signed distance fields, rendering each size at its own resolution so
16px stays legible. Re-run it after changing the colours or the mark; it also
emits `icon512.png` for the Web Store listing, which the build does not copy
into `dist`.

## Web Store

Listing is **unlisted**: the install link is handed to members on
`/extension/connect` and `/account` rather than published, and the panel stays
locked until a member connects. See `docs/extension-store-submission.md` for
the listing copy, permission justifications, data-use disclosures and the
post-approval environment variables.
