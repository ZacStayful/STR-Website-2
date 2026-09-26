import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from './send.ts';

type Call = { url: string; headers: Record<string, string>; body: string };
let calls: Call[] = [];
let answers: (() => Promise<Response>)[] = [];
const realFetch = globalThis.fetch;
const realError = console.error;
const env = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

beforeEach(() => {
  calls = [];
  answers = [];
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'Stayful <hello@stayful.test>';
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const next = answers.shift();
    return next ? next() : new Response('{}', { status: 200 });
  }) as typeof fetch;
  // The helper logs every failure; keep the test output readable.
  console.error = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  // Assigning undefined would store the string "undefined".
  if (env.key === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = env.key;
  if (env.from === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = env.from;
});

const mail = { to: 'm@x.test', subject: 'S', html: '<p>h</p>', text: 't' };

test('the idempotency key is an HTTP header on the API call, never an email header', async () => {
  await sendEmail({ ...mail, idempotencyKey: 'email/daily/2026-09-28/u1', headers: { 'List-Unsubscribe': '<https://x>' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['Idempotency-Key'], 'email/daily/2026-09-28/u1');
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.headers, { 'List-Unsubscribe': '<https://x>' });
  assert.ok(!('Idempotency-Key' in (body.headers ?? {})));
});

test('without a key nothing is retried, however the send failed', async () => {
  answers.push(async () => new Response('down', { status: 503 }));
  const r = await sendEmail(mail);
  assert.deepEqual(r, { sent: false, reason: 'http_503' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['Idempotency-Key'], undefined);
});

test('with a key, an ambiguous failure is retried once with the same key and body', async () => {
  answers.push(async () => {
    throw new TypeError('fetch failed');
  });
  answers.push(async () => new Response('{"id":"e1"}', { status: 200 }));
  const r = await sendEmail({ ...mail, idempotencyKey: 'k1' });
  assert.deepEqual(r, { sent: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['Idempotency-Key'], 'k1');
  assert.equal(calls[1].body, calls[0].body);
});

test('a 5xx twice is a failure after exactly one retry', async () => {
  answers.push(async () => new Response('x', { status: 500 }), async () => new Response('x', { status: 502 }));
  const r = await sendEmail({ ...mail, idempotencyKey: 'k2' });
  assert.deepEqual(r, { sent: false, reason: 'http_502' });
  assert.equal(calls.length, 2);
});

test('a 4xx is a definite answer and is not retried (a key reused for another email is refused)', async () => {
  answers.push(async () => new Response('{"name":"invalid_idempotent_request"}', { status: 409 }));
  const r = await sendEmail({ ...mail, idempotencyKey: 'k3' });
  assert.deepEqual(r, { sent: false, reason: 'http_409' });
  assert.equal(calls.length, 1);
});
