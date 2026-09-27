import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSendRequest, ERROR_OPTED_OUT, isFailedStatus, messageUrl, messagesUrl, parseMessagePrice, parseSendResponse, signatureValid, statusAdvances, twilioSignature,
} from './twilio.ts';

// Twilio's own published test vectors (twilio-node's validation tests and the
// original webhook-security docs): same token, URL and fields, known result.
const TOKEN = '12345';
const URL_ = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
const SIGNATURE = 'RSOYDt4T1cUTdK1PDd93/VVr8B8=';

test('the signature matches Twilio\'s published test vectors', () => {
  assert.equal(twilioSignature(TOKEN, URL_, PARAMS), SIGNATURE);
  const older = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  assert.equal(twilioSignature(TOKEN, URL_, older), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
});

test('field order in the body does not matter; names are sorted', () => {
  const shuffled: [string, string][] = [['To', PARAMS.To], ['Digits', PARAMS.Digits], ['CallSid', PARAMS.CallSid], ['From', PARAMS.From], ['Caller', PARAMS.Caller]];
  assert.equal(twilioSignature(TOKEN, URL_, shuffled), SIGNATURE);
  assert.equal(twilioSignature(TOKEN, URL_, new URLSearchParams(shuffled)), SIGNATURE);
});

test('a valid signature verifies; anything tampered does not', () => {
  assert.equal(signatureValid(TOKEN, SIGNATURE, [URL_], PARAMS), true);
  assert.equal(signatureValid(TOKEN, SIGNATURE, [URL_], { ...PARAMS, Digits: '9999' }), false); // body changed
  assert.equal(signatureValid(TOKEN, SIGNATURE, [URL_], { ...PARAMS, Extra: 'x' }), false); // field added
  assert.equal(signatureValid(TOKEN, SIGNATURE, ['https://mycompany.com/myapp.php?foo=1&bar=3'], PARAMS), false); // URL changed
  assert.equal(signatureValid('54321', SIGNATURE, [URL_], PARAMS), false); // wrong token
  assert.equal(signatureValid(TOKEN, SIGNATURE.replace('R', 'r'), [URL_], PARAMS), false);
});

test('unsigned, unconfigured or URL-less requests are refused', () => {
  assert.equal(signatureValid(TOKEN, null, [URL_], PARAMS), false);
  assert.equal(signatureValid(TOKEN, '', [URL_], PARAMS), false);
  assert.equal(signatureValid(null, SIGNATURE, [URL_], PARAMS), false);
  assert.equal(signatureValid(TOKEN, SIGNATURE, [], PARAMS), false);
  assert.equal(signatureValid(TOKEN, SIGNATURE, [''], PARAMS), false);
});

test('any one of the candidate URLs may match', () => {
  assert.equal(signatureValid(TOKEN, SIGNATURE, ['https://wrong.example/x', URL_], PARAMS), true);
});

test('the send request is a form POST with Basic auth and the Messaging Service', () => {
  const { url, init } = buildSendRequest({ accountSid: 'AC123', authToken: 'tok', to: '+447700900123', body: 'Hello £5', messagingServiceSid: 'MG1', from: '+447700900999', statusCallback: 'https://x.test/api/twilio/status?m=1' });
  assert.equal(url, messagesUrl('AC123'));
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from('AC123:tok').toString('base64')}`);
  const form = new URLSearchParams(init.body);
  assert.equal(form.get('To'), '+447700900123');
  assert.equal(form.get('Body'), 'Hello £5');
  assert.equal(form.get('MessagingServiceSid'), 'MG1');
  assert.equal(form.get('From'), null); // the service wins
  assert.equal(form.get('StatusCallback'), 'https://x.test/api/twilio/status?m=1');
});

test('without a Messaging Service the From number is used', () => {
  const form = new URLSearchParams(buildSendRequest({ accountSid: 'AC1', authToken: 't', to: '+447700900123', body: 'x', from: '+447700900999' }).init.body);
  assert.equal(form.get('From'), '+447700900999');
  assert.equal(form.get('MessagingServiceSid'), null);
});

test('a 201 with a message sid is accepted', () => {
  const r = parseSendResponse(201, { sid: 'SM0123456789abcdef0123456789abcdef', status: 'queued', num_segments: '1' });
  assert.deepEqual(r, { ok: true, sid: 'SM0123456789abcdef0123456789abcdef', status: 'queued', segments: 1 });
});

test('refusals carry Twilio\'s code, and STOP and bad numbers are recognised', () => {
  const stopped = parseSendResponse(400, { code: ERROR_OPTED_OUT, message: 'Attempt to send to unsubscribed recipient', status: 400 });
  assert.equal(stopped.ok, false);
  if (!stopped.ok) {
    assert.equal(stopped.optedOut, true);
    assert.equal(stopped.invalidNumber, false);
  }
  const bad = parseSendResponse(400, { code: 21614, message: "'To' number is not a valid mobile number" });
  assert.equal(!bad.ok && bad.invalidNumber, true);
  const auth = parseSendResponse(401, { code: 20003, message: 'Authenticate' });
  assert.equal(!auth.ok && auth.code, 20003);
});

test('a success status without a real sid, or a server error, is not "sent"', () => {
  assert.equal(parseSendResponse(201, {}).ok, false);
  assert.equal(parseSendResponse(201, { sid: 'nope' }).ok, false);
  assert.equal(parseSendResponse(500, null).ok, false);
  const r = parseSendResponse(503, 'Service Unavailable');
  assert.equal(!r.ok && r.message, 'HTTP 503');
});

test('status only moves forward, so a late callback cannot undo delivered', () => {
  assert.equal(statusAdvances(null, 'queued'), true);
  assert.equal(statusAdvances('queued', 'sent'), true);
  assert.equal(statusAdvances('sent', 'delivered'), true);
  assert.equal(statusAdvances('delivered', 'sent'), false);
  assert.equal(statusAdvances('delivered', 'undelivered'), false);
  assert.equal(statusAdvances('sent', 'made-up'), false);
});

test('failed, undelivered and canceled mean the text never arrived', () => {
  assert.equal(isFailedStatus('failed'), true);
  assert.equal(isFailedStatus('undelivered'), true);
  assert.equal(isFailedStatus('delivered'), false);
  assert.equal(isFailedStatus(null), false);
});

test('a message\'s price is read as a positive number once Twilio knows it', () => {
  assert.deepEqual(parseMessagePrice({ price: '-0.05600', price_unit: 'USD', num_segments: '1' }), { price: 0.056, priceUnit: 'USD', segments: 1 });
  assert.deepEqual(parseMessagePrice({ price: null, price_unit: 'USD' }), { price: null, priceUnit: 'USD', segments: null });
  assert.equal(messageUrl('AC1', 'SM2'), 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM2.json');
});
