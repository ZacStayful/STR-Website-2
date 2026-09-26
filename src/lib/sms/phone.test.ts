import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUkMobile, maskPhone, ukMobile } from './phone.ts';

test('UK mobiles in every common shape become +447…', () => {
  assert.equal(ukMobile('07700 900123'), '+447700900123');
  assert.equal(ukMobile('+44 (0)7700-900123'), '+447700900123');
  assert.equal(ukMobile('00447700900123'), '+447700900123');
  assert.equal(ukMobile('447700900123'), '+447700900123');
  assert.equal(ukMobile('+447700900123'), '+447700900123');
});

test('landlines, short numbers, foreign numbers and junk are not texted', () => {
  assert.equal(ukMobile('0113 496 0000'), null); // Leeds landline
  assert.equal(ukMobile('020 7946 0000'), null);
  assert.equal(ukMobile('12345678'), null); // normaliseMobile would make this +4412345678
  assert.equal(ukMobile('+1 415 555 2671'), null);
  assert.equal(ukMobile('+33 6 12 34 56 78'), null);
  assert.equal(ukMobile('077009001234'), null); // one digit too many
  assert.equal(ukMobile(''), null);
  assert.equal(ukMobile(null), null);
});

test('isUkMobile only accepts the E.164 form', () => {
  assert.equal(isUkMobile('+447700900123'), true);
  assert.equal(isUkMobile('07700900123'), false);
  assert.equal(isUkMobile(undefined), false);
});

test('maskPhone keeps the last three digits only', () => {
  assert.equal(maskPhone('+447700900123'), '+44 7••• •••123');
  assert.equal(maskPhone('+14155552671'), '+14 ••• •••671');
  assert.equal(maskPhone(null), '');
  assert.ok(!maskPhone('+447700900123').includes('7700900'));
});
