import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Webhook guide — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * How to wire the lead webhook into n8n, Zapier or Make.
 *
 * The worked payload is the point of this page. Someone building a workflow
 * needs to see the exact field names before a real lead exists, and the
 * alternative — burning a lead's worth of credit on themselves to find out
 * what arrives — is not acceptable.
 */

const SAMPLE = `{
  "version": 1,
  "event": "lead.created",
  "leadId": "b3f1c2d4-1111-2222-3333-444455556666",
  "createdAt": "2026-03-04T09:30:00.000Z",
  "funnel": { "id": "5f0e…", "name": "Website enquiry form" },
  "contact": {
    "name": "Dana Okafor",
    "email": "dana@example.com",
    "phone": "07700 900123",
    "consentAt": "2026-03-04T09:29:00.000Z"
  },
  "property": {
    "address": "17 Park Crescent, York",
    "postcode": "YO31 7NU",
    "postcodeArea": "YO",
    "bedrooms": 3
  },
  "metrics": {
    "annualRevenue": 42812,
    "occupancy": 0.68,
    "averageNightlyRate": 172,
    "averageReviewCount": 54,
    "saturation": "uncontested"
  },
  "qualification": {
    "qualified": true,
    "summary": "Met all 3 rules.",
    "unknownChecks": 0,
    "checks": [
      {
        "rule": "grossRevenue",
        "label": "Projected gross revenue",
        "status": "pass",
        "actual": 42812,
        "threshold": "£40,000+ gross a year",
        "reason": ""
      }
    ]
  },
  "report": {
    "url": "https://stayful.co.uk/r/9fK2…",
    "pdfUrl": "https://stayful.co.uk/r/9fK2…/pdf"
  }
}`;

const VERIFY_JS = `const crypto = require('crypto');

// The raw body, NOT the parsed object. Re-serialising JSON can reorder keys
// or change spacing, and the signature is over the exact bytes we sent.
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim())),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp)) return false;

  // Refuse anything more than five minutes out, in either direction — that
  // is what stops a captured request being replayed later.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(parts.v1, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}`;

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-foreground">
        <span className="mr-2 text-muted-foreground">{n}.</span>
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </li>
  );
}

export default function WebhookGuidePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <Link href="/leads/integrations" className="text-xs text-muted-foreground underline underline-offset-2">
          ← Back to Integrations
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-foreground">Sending your leads anywhere</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every lead is POSTed to a URL you choose as signed JSON. If your CRM is not one we support directly,
          this is how you reach it — n8n, Zapier and Make all connect to hundreds of systems, and the whole
          setup takes about ten minutes.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">What arrives</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One POST per lead, <code className="rounded bg-muted px-1">Content-Type: application/json</code>. Reply
          with any 2xx and we are done; anything else and we retry with backoff for about an hour before giving
          up and showing you the error.
        </p>
        <Code>{SAMPLE}</Code>
        <p className="mt-2 text-xs text-muted-foreground">
          A field that we could not measure is <code className="rounded bg-muted px-1">null</code>, never zero — so
          a rule like &ldquo;revenue under £20,000&rdquo; will not also catch the properties we could not price. A lead
          captured while your balance was empty arrives with{" "}
          <code className="rounded bg-muted px-1">qualification.qualified: null</code> and no report links; it is
          sent again properly once the report runs.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Checking it really came from us</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your endpoint is a public URL, so anyone who learns it could post fake leads into your CRM. Every
          request carries a signature over the body, and you should check it before trusting anything.
        </p>
        <Code>{`x-stayful-signature: t=1772614200,v1=8f3c…\nx-stayful-timestamp: 1772614200`}</Code>
        <p className="mt-2 text-sm text-muted-foreground">
          The signed value is <code className="rounded bg-muted px-1">{"<timestamp>.<raw body>"}</code>, HMAC-SHA256
          under your signing secret, hex encoded. The timestamp is inside the signed string on purpose: it means
          a captured request cannot be replayed later with a fresh timestamp.
        </p>
        <Code>{VERIFY_JS}</Code>

        <h2 className="mt-8 text-lg font-semibold text-foreground">n8n</h2>
        <ol className="mt-3 space-y-5">
          <Step n={1} title="Add a Webhook node">
            <p>
              Set the method to <strong>POST</strong> and copy the <em>production</em> URL. Paste it into
              Integrations here and save — that also generates your signing secret, which is shown once.
            </p>
          </Step>
          <Step n={2} title="Turn on raw body">
            <p>
              In the Webhook node&apos;s options, enable <strong>Raw Body</strong>. Without it n8n parses and
              re-serialises the JSON, the bytes change, and every signature check fails.
            </p>
          </Step>
          <Step n={3} title="Verify, then parse">
            <p>
              Add a Code node with the function above, reading the secret from an n8n credential rather than
              pasting it into the workflow. Stop the run if it returns false.
            </p>
          </Step>
          <Step n={4} title="Send it on">
            <p>
              Add your CRM&apos;s node — HubSpot, Pipedrive, GoHighLevel, Airtable, a Google Sheet, anything.
              Map <code className="rounded bg-muted px-1">contact.email</code>,{" "}
              <code className="rounded bg-muted px-1">property.address</code> and{" "}
              <code className="rounded bg-muted px-1">metrics.annualRevenue</code>, and put{" "}
              <code className="rounded bg-muted px-1">report.url</code> somewhere clickable.
            </p>
          </Step>
          <Step n={5} title="Test before you go live">
            <p>
              Press <strong>Send a test</strong> on the Integrations page. It sends a real, signed request with a
              payload shaped exactly like a lead, so you can build the whole workflow before a prospect ever
              fills in your form.
            </p>
          </Step>
        </ol>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Zapier</h2>
        <ol className="mt-3 space-y-5">
          <Step n={1} title="New Zap, trigger: Webhooks by Zapier → Catch Raw Hook">
            <p>
              <strong>Raw</strong> rather than the plain Catch Hook — the signature is over the exact bytes, and
              the plain version hands you a parsed object.
            </p>
          </Step>
          <Step n={2} title="Paste the URL into Integrations and save">
            <p>Copy your signing secret when it appears. It is not shown again.</p>
          </Step>
          <Step n={3} title="Add a Code by Zapier step">
            <p>
              Use the function above to check the signature, then{" "}
              <code className="rounded bg-muted px-1">JSON.parse</code> the body and return the fields you want.
            </p>
          </Step>
          <Step n={4} title="Add your CRM action and turn the Zap on">
            <p>Send a test from Integrations to give Zapier a sample to map against.</p>
          </Step>
        </ol>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Things worth knowing</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">The same lead can arrive twice.</strong> If your endpoint is slow
            to answer we may retry one we had already delivered. Use{" "}
            <code className="rounded bg-muted px-1">leadId</code> as the key when you create or update the record.
          </li>
          <li>
            <strong className="text-foreground">Leads that miss your rules</strong> only arrive if that funnel is
            set to send them on. Set it to hold instead and they stay in Leads for you to review — and you can
            still send one across by hand later.
          </li>
          <li>
            <strong className="text-foreground">The report links keep working</strong> long after the prospect
            closes their browser, so they are safe to store in a CRM field.
          </li>
          <li>
            <strong className="text-foreground">You are the data controller</strong> for everyone who fills in
            your funnel. Sending their details on to another system is your decision to document in your own
            privacy notice.
          </li>
          <li>
            <strong className="text-foreground">Rotating the secret is instant.</strong> The old one stops working
            the moment you regenerate, so update your workflow in the same sitting.
          </li>
        </ul>
      </div>
    </main>
  );
}
