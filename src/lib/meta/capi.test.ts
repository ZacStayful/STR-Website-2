import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapiEvent, ipFromForwardedFor, sendCapi, type CapiEvent } from './capi.ts';
import { hashEmail, hashExternalId } from './hash.ts';

const EM = hashEmail('member@example.com')!;
const EXT = hashExternalId('11111111-2222-3333-4444-555555555555')!;
const base = {
  event: 'Purchase' as const,
  eventId: 'pi_123',
  eventTime: new Date('2026-10-05T10:00:00Z'),
  sourceUrl: 'https://intelligence.stayful.co.uk/account/billing?topup=1',
  emailHash: EM,
  externalIdHash: EXT,
  client: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 test', fbp: 'fb.1.1596403881668.1116446470', fbc: 'fb.1.1700000000000.abc' },
  valuePence: 1000,
};

test('an event carries only the listed fields', () => {
  const r = buildCapiEvent(base);
  assert.equal(r.ok, true);
  const e = (r as { ok: true; event: CapiEvent }).event;
  assert.deepEqual(Object.keys(e).sort(), ['action_source', 'custom_data', 'event_id', 'event_name', 'event_source_url', 'event_time', 'user_data']);
  assert.deepEqual(Object.keys(e.user_data).sort(), ['client_ip_address', 'client_user_agent', 'em', 'external_id', 'fbc', 'fbp']);
  assert.equal(e.action_source, 'website');
  assert.equal(e.event_time, 1791194400);
  assert.deepEqual(e.custom_data, { value: 10, currency: 'GBP' });
});

test('the page address never carries a query string', () => {
  const r = buildCapiEvent(base);
  assert.equal(r.ok && r.event.event_source_url, 'https://intelligence.stayful.co.uk/account/billing');
});

test('the journey events carry no value', () => {
  const r = buildCapiEvent({ ...base, event: 'FirstReport', valuePence: 400 });
  assert.equal(r.ok && r.event.custom_data, undefined);
});

test('no browser details: not built (Meta needs a user agent on website events)', () => {
  assert.deepEqual(buildCapiEvent({ ...base, client: { ip: '203.0.113.9' } }), { ok: false, reason: 'no_browser_details' });
});

test('no identity at all: not built', () => {
  assert.deepEqual(buildCapiEvent({ ...base, emailHash: null, externalIdHash: null }), { ok: false, reason: 'no_identity' });
});

test('an unhashed value is never passed through as em', () => {
  const r = buildCapiEvent({ ...base, emailHash: 'member@example.com' });
  assert.equal(r.ok && r.event.user_data.em, undefined);
});

test('malformed IP, fbp and fbc are dropped, not sent', () => {
  const r = buildCapiEvent({ ...base, client: { userAgent: 'UA', ip: 'not-an-ip', fbp: 'bad', fbc: 'bad' } });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.event.user_data).sort(), ['client_user_agent', 'em', 'external_id']);
});

test('the browser IP is the first x-forwarded-for entry', () => {
  assert.equal(ipFromForwardedFor('198.51.100.7, 10.0.0.1'), '198.51.100.7');
  assert.equal(ipFromForwardedFor('2001:db8::1'), '2001:db8::1');
  assert.equal(ipFromForwardedFor(null), null);
});

function event(): CapiEvent {
  const r = buildCapiEvent(base);
  assert.ok(r.ok);
  return (r as { ok: true; event: CapiEvent }).event;
}

test('sending: the token and test code go in the body, never the address', async () => {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    return new Response('{"events_received":1}', { status: 200 });
  }) as typeof fetch;
  const r = await sendCapi({ pixelId: '123456789', token: 'EAAsecret', testCode: 'TEST12345', events: [event()], fetchImpl, log: () => {} });
  assert.deepEqual(r, { ok: true, status: 200, note: 'sent_test' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://graph.facebook.com/'));
  assert.ok(calls[0].url.endsWith('/123456789/events'));
  assert.ok(!calls[0].url.includes('EAAsecret'));
  assert.equal(calls[0].body.get('access_token'), 'EAAsecret');
  assert.equal(calls[0].body.get('test_event_code'), 'TEST12345');
  assert.equal(JSON.parse(calls[0].body.get('data')!)[0].event_id, 'pi_123');
});

test('no test code in live mode', async () => {
  let body: URLSearchParams | null = null;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = init.body as URLSearchParams;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const r = await sendCapi({ pixelId: '123456789', token: 't', testCode: null, events: [event()], fetchImpl, log: () => {} });
  assert.equal(r.note, 'sent');
  assert.equal((body as URLSearchParams | null)?.has('test_event_code'), false);
});

test('a refusal comes back as a short note without the token', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token EAAsecret' } }), { status: 400 })) as unknown as typeof fetch;
  const r = await sendCapi({ pixelId: '123456789', token: 'EAAsecret', testCode: null, events: [event()], fetchImpl, log: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.ok(r.note.startsWith('http_400'));
  assert.ok(!r.note.includes('EAAsecret'));
});

test('a timeout never throws and never waits past the limit', async () => {
  const fetchImpl = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
    })) as unknown as typeof fetch;
  const started = Date.now();
  const r = await sendCapi({ pixelId: '123456789', token: 't', testCode: null, events: [event()], fetchImpl, timeoutMs: 50, log: () => {} });
  assert.deepEqual(r, { ok: false, status: null, note: 'timeout' });
  assert.ok(Date.now() - started < 2000);
});

test('a network error never throws', async () => {
  const fetchImpl = (async () => {
    throw new Error('getaddrinfo ENOTFOUND graph.facebook.com');
  }) as unknown as typeof fetch;
  const r = await sendCapi({ pixelId: '123456789', token: 't', testCode: null, events: [event()], fetchImpl, log: () => {} });
  assert.equal(r.ok, false);
  assert.ok(r.note.startsWith('network'));
});

test('a dry run never calls Meta', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response('{}');
  }) as unknown as typeof fetch;
  const r = await sendCapi({ pixelId: '123456789', token: 't', testCode: null, events: [event()], fetchImpl, dryRun: true, log: () => {} });
  assert.equal(r.note, 'dry_run');
  assert.equal(called, false);
});
