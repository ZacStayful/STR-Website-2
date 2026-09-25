# Web fonts

Google's own latin-subset variable `woff2` files for the six families the site
uses. They are committed rather than fetched because `next/font/google`
downloads at build time, and Google intermittently answers with an
extensionless `/l/font?kit=…` URL that Next mishandles in both bundlers
(vercel/next.js#99114) — enough to redden roughly one build in four.

Registered once each in `../fonts.ts`. Refresh or add a family with:

    npm run fonts:fetch

then commit what lands here.

These are **not** the PDF report's fonts — `react-pdf` reads real TTFs from
`../pdf/fonts/` at render time and cannot use `next/font`. Keep the two in
step: `../pdf/design/font-files.test.ts` asserts the report ships the same
faces and weights as the website.

All six families are licensed under the SIL Open Font License 1.1:
Inter, Cormorant Garamond, JetBrains Mono, Caveat, Playfair Display, DM Sans.
