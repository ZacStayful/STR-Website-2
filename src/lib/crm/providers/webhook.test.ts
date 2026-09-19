import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWebhookUrl } from './webhook.ts';

test('a normal https webhook URL is accepted', () => {
  for (const url of [
    'https://hooks.zapier.com/hooks/catch/123/abc/',
    'https://n8n.example.co.uk/webhook/stayful-leads',
    'https://make.com/path?x=1',
  ]) {
    assert.deepEqual(checkWebhookUrl(url), { ok: true }, url);
  }
});

test('http is refused, because a lead payload carries personal data', () => {
  const r = checkWebhookUrl('http://hooks.zapier.com/x');
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /https/);
});

test('loopback and internal names are refused', () => {
  // The one field where a customer types an address and our server calls it.
  for (const url of [
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://[::1]/hook',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://anything.internal/hook',
    'https://app.localhost/hook',
  ]) {
    assert.equal(checkWebhookUrl(url).ok, false, `${url} should be refused`);
  }
});

test('private network literals are refused', () => {
  for (const url of [
    'https://10.0.0.5/hook',
    'https://192.168.1.10/hook',
    'https://172.16.4.2/hook',
    'https://172.31.255.255/hook',
    'https://169.254.169.254/latest/meta-data/',
  ]) {
    assert.equal(checkWebhookUrl(url).ok, false, `${url} should be refused`);
  }
});

test('public addresses that merely look private are still allowed', () => {
  // 172.32 is outside the private range; refusing it would be a false positive.
  assert.equal(checkWebhookUrl('https://172.32.0.1/hook').ok, true);
  assert.equal(checkWebhookUrl('https://11.0.0.1/hook').ok, true);
});

test('nonsense is refused with something a person can act on', () => {
  for (const bad of [null, undefined, '', '   ', 'not a url', 'ftp://x.test/hook']) {
    const r = checkWebhookUrl(bad);
    assert.equal(r.ok, false);
    assert.ok((r.reason ?? '').length > 0, 'every refusal explains itself');
  }
});
