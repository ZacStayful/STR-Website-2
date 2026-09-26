import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealReturnPath, returnLabel, withParam, myDealsFocusPath } from './return-path.ts';

const ID = '0b6c2f0e-5a8e-4a57-9c1e-1f4c2d3e4f5a';

test('dealReturnPath accepts a deal page or My deals, nothing else', () => {
  assert.equal(dealReturnPath(`/deals/${ID}`), `/deals/${ID}`);
  assert.equal(dealReturnPath(`/deals/${ID}?msg=opened`), `/deals/${ID}?msg=opened`);
  assert.equal(dealReturnPath('/my-deals'), '/my-deals');
  assert.equal(dealReturnPath('/my-deals?focus=d-1'), '/my-deals?focus=d-1');
  for (const bad of ['https://evil.example/deals/x', '//evil.example', '/\\evil', '/deals', '/deals/opened', '/my-dealsX', '/account', '', null, undefined, 42, `/deals/${ID}\nSet-Cookie: x`]) {
    assert.equal(dealReturnPath(bad), null, String(bad));
  }
  assert.equal(dealReturnPath(`/my-deals?${'x'.repeat(400)}`), null);
});

test('returnLabel and paths', () => {
  assert.equal(returnLabel(`/deals/${ID}`), 'Back to this deal');
  assert.equal(returnLabel('/my-deals?focus=d-1'), 'Back to My deals');
  assert.equal(withParam('/my-deals?focus=d-1', 'msg', 'opened'), '/my-deals?focus=d-1&msg=opened');
  assert.equal(withParam(`/deals/${ID}`, 'msg', 'opened'), `/deals/${ID}?msg=opened`);
  assert.equal(withParam('/my-deals?msg=x#item', 'msg', 'opened'), '/my-deals?msg=opened#item');
  assert.equal(myDealsFocusPath('l-abc'), '/my-deals?focus=l-abc');
});
