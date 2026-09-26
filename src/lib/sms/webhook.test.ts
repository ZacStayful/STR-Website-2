import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twilioSignature } from './twilio.ts';
import { twiml, verifiedTwilioForm } from './webhook.ts';

const TOKEN = 'test-auth-token-0123456789';
const SITE = 'https://intelligence.example.co.uk';
const FIELDS = { MessageSid: 'SM0123456789abcdef0123456789abcdef', From: '+447700900123', To: '+447700900999', Body: 'STOP' };

function request(opts: { url?: string; signature?: string | null; type?: string; fields?: Record<string, string> } = {}): Request {
  const url = opts.url ?? `${SITE}/api/twilio/inbound`;
  const fields = opts.fields ?? FIELDS;
  const headers: Record<string, string> = { 'content-type': opts.type ?? 'application/x-www-form-urlencoded' };
  const sig = opts.signature === undefined ? twilioSignature(TOKEN, url, fields) : opts.signature;
  if (sig !== null) headers['x-twilio-signature'] = sig;
  return new Request(url, { method: 'POST', headers, body: new URLSearchParams(fields).toString() });
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

const configured = { TWILIO_AUTH_TOKEN: TOKEN, NEXT_PUBLIC_SITE_URL: SITE };

test('a correctly signed form is accepted, with its fields', async () => {
  await withEnv(configured, async () => {
    const r = await verifiedTwilioForm(request());
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.params.get('Body'), 'STOP');
  });
});

test('an unsigned request is refused with 403', async () => {
  await withEnv(configured, async () => {
    const r = await verifiedTwilioForm(request({ signature: null }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.response.status, 403);
  });
});

test('a forged or replayed-with-changes request is refused', async () => {
  await withEnv(configured, async () => {
    const forged = await verifiedTwilioForm(request({ signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }));
    assert.equal(!forged.ok && forged.response.status, 403);
    // Signed for STOP, body changed to START.
    const sig = twilioSignature(TOKEN, `${SITE}/api/twilio/inbound`, FIELDS);
    const changed = await verifiedTwilioForm(request({ signature: sig, fields: { ...FIELDS, Body: 'START' } }));
    assert.equal(!changed.ok && changed.response.status, 403);
    // Signed with someone else's token.
    const other = await verifiedTwilioForm(request({ signature: twilioSignature('another-token', `${SITE}/api/twilio/inbound`, FIELDS) }));
    assert.equal(!other.ok && other.response.status, 403);
  });
});

test('without an auth token nothing is accepted (503, not trusted)', async () => {
  await withEnv({ ...configured, TWILIO_AUTH_TOKEN: undefined }, async () => {
    const r = await verifiedTwilioForm(request());
    assert.equal(!r.ok && r.response.status, 503);
  });
});

test('a JSON body is refused', async () => {
  await withEnv(configured, async () => {
    const r = await verifiedTwilioForm(request({ type: 'application/json' }));
    assert.equal(!r.ok && r.response.status, 415);
  });
});

test('a request signed for our public URL verifies even if it arrived on another host', async () => {
  await withEnv(configured, async () => {
    const sig = twilioSignature(TOKEN, `${SITE}/api/twilio/status?m=abc`, FIELDS);
    const r = await verifiedTwilioForm(request({ url: 'https://deployment-123.vercel.app/api/twilio/status?m=abc', signature: sig }));
    assert.equal(r.ok, true);
  });
});

test('TwiML replies escape the text, and an empty reply sends nothing', async () => {
  assert.equal(await twiml(null).text(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  assert.match(await twiml('A & B <c>').text(), /<Message>A &amp; B &lt;c&gt;<\/Message>/);
  assert.equal(twiml(null).headers.get('content-type'), 'text/xml; charset=utf-8');
});
