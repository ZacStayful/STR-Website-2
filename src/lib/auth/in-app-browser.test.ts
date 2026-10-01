import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInAppBrowser } from './in-app-browser.ts';

test('the Facebook and Instagram in-app browsers are recognised', () => {
  assert.equal(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.108;FBBV/...;FBDV/iPhone15,2]'), true);
  assert.equal(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.37.102;]'), true);
  assert.equal(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone15,2; iOS 17_5; en_GB)'), true);
});

test('real browsers are not', () => {
  assert.equal(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'), false);
  assert.equal(isInAppBrowser(''), false);
  assert.equal(isInAppBrowser(null), false);
});
