import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerEnabled, deployment, metaPixelId, metaStatus, pixelEnabled, serverSendMode, testEventCode } from './env.ts';

const PROD = { VERCEL_ENV: 'production', NEXT_PUBLIC_META_PIXEL_ID: '123456789012345', META_CAPI_ACCESS_TOKEN: 'EAAsecret-token' };

test('deployment follows VERCEL_ENV only: a production build run elsewhere is never the live site', () => {
  assert.equal(deployment({ VERCEL_ENV: 'production' }), 'production');
  assert.equal(deployment({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), 'preview');
  assert.equal(deployment({ NODE_ENV: 'production' }), 'development');
  assert.equal(pixelEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_META_PIXEL_ID: '1234567890' }), false);
  assert.equal(deployment({}), 'development');
});

test('the dataset id must be digits only', () => {
  assert.equal(metaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: ' 123456789 ' }), '123456789');
  assert.equal(metaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: 'abc123' }), null);
  assert.equal(metaPixelId({ NEXT_PUBLIC_META_PIXEL_ID: '' }), null);
  assert.equal(metaPixelId({}), null);
});

test('the pixel loads only on production; the banner wherever there is a dataset', () => {
  assert.equal(pixelEnabled(PROD), true);
  assert.equal(pixelEnabled({ ...PROD, VERCEL_ENV: 'preview' }), false);
  assert.equal(pixelEnabled({ VERCEL_ENV: 'production' }), false);
  assert.equal(bannerEnabled({ ...PROD, VERCEL_ENV: 'preview' }), true);
  assert.equal(bannerEnabled({}), false);
});

test('server events: live from production only, test events anywhere with a test code', () => {
  assert.deepEqual(serverSendMode({}), { ok: false, reason: 'no_dataset' });
  assert.deepEqual(serverSendMode({ NEXT_PUBLIC_META_PIXEL_ID: '123456789' }), { ok: false, reason: 'no_token' });
  assert.deepEqual(serverSendMode({ ...PROD, VERCEL_ENV: 'preview' }), { ok: false, reason: 'not_production' });
  const preview = serverSendMode({ ...PROD, VERCEL_ENV: 'preview', META_TEST_EVENT_CODE: 'TEST12345' });
  assert.equal(preview.ok, true);
  assert.equal(preview.ok && preview.testCode, 'TEST12345');
  const live = serverSendMode(PROD);
  assert.equal(live.ok && live.testCode, null);
});

test('a malformed test code is ignored', () => {
  assert.equal(testEventCode({ META_TEST_EVENT_CODE: 'TEST 1' }), null);
  assert.equal(testEventCode({ META_TEST_EVENT_CODE: 'TEST12345' }), 'TEST12345');
});

test('the status box says yes or no, never a value', () => {
  const status = metaStatus({ ...PROD, META_TEST_EVENT_CODE: 'TEST12345' });
  assert.equal(status.tokenSet, true);
  assert.equal(status.testMode, true);
  const text = JSON.stringify(status);
  assert.ok(!text.includes('EAAsecret-token'));
  assert.ok(!text.includes('123456789012345'));
  assert.ok(!text.includes('TEST12345'));
});
