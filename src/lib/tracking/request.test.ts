import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientDetails, cookieFrom, isSameOrigin, isSameOriginJson } from './request.ts';

const req = (headers: Record<string, string>) => new Request('https://intelligence.stayful.co.uk/api/consent', { method: 'POST', headers, body: '{}' });

test('only a JSON post from our own pages is accepted', () => {
  assert.equal(isSameOriginJson(req({ 'content-type': 'application/json', origin: 'https://intelligence.stayful.co.uk', host: 'intelligence.stayful.co.uk' })), true);
  assert.equal(isSameOriginJson(req({ 'content-type': 'application/json', origin: 'https://evil.example', host: 'intelligence.stayful.co.uk' })), false);
  assert.equal(isSameOriginJson(req({ 'content-type': 'text/plain', origin: 'https://intelligence.stayful.co.uk', host: 'intelligence.stayful.co.uk' })), false);
  assert.equal(isSameOriginJson(req({ 'content-type': 'application/json', host: 'intelligence.stayful.co.uk' })), false);
});

test('behind Vercel the forwarded host is compared', () => {
  const h = new Headers({ origin: 'https://intelligence.stayful.co.uk', host: 'internal:3000', 'x-forwarded-host': 'intelligence.stayful.co.uk' });
  assert.equal(isSameOrigin(h), true);
});

test('cookies are read from the header, decoded', () => {
  assert.equal(cookieFrom('a=1; _fbp=fb.1.1596403881668.1116446470; b=2', '_fbp'), 'fb.1.1596403881668.1116446470');
  assert.equal(cookieFrom('x=%7Cy', 'x'), '|y');
  assert.equal(cookieFrom('a=1', '_fbc'), null);
});

test('the browser behind a request, with malformed Meta cookies dropped', () => {
  const h = new Headers({
    'x-forwarded-for': '198.51.100.7, 10.0.0.1',
    'user-agent': 'Mozilla/5.0 (iPhone)',
    cookie: '_fbp=fb.1.1596403881668.1116446470; _fbc=garbage',
  });
  assert.deepEqual(clientDetails(h), { ip: '198.51.100.7', userAgent: 'Mozilla/5.0 (iPhone)', fbp: 'fb.1.1596403881668.1116446470', fbc: null });
  assert.deepEqual(clientDetails(new Headers()), { ip: null, userAgent: null, fbp: null, fbc: null });
});
