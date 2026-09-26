import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postAuthPath, welcomeReturnPath, HOME_PATH, WELCOME_PATH } from './landing.ts';

test('no destination lands on the welcome screen', () => {
  assert.equal(postAuthPath(null), WELCOME_PATH);
  assert.equal(postAuthPath(undefined), WELCOME_PATH);
  assert.equal(postAuthPath(''), WELCOME_PATH);
  assert.equal(postAuthPath('   '), WELCOME_PATH);
});

test('an explicit destination goes through the welcome screen', () => {
  assert.equal(postAuthPath('/markets'), '/welcome?next=%2Fmarkets');
  assert.equal(postAuthPath('/reports?q=ng2'), '/welcome?next=%2Freports%3Fq%3Dng2');
  assert.equal(postAuthPath(HOME_PATH), '/welcome?next=%2Ftoday');
});

test('team invites and password resets are never interrupted', () => {
  assert.equal(postAuthPath('/team/join?token=abc'), '/team/join?token=abc');
  assert.equal(postAuthPath('/team/join'), '/team/join');
  assert.equal(postAuthPath('/reset-password'), '/reset-password');
  assert.equal(postAuthPath('/reset-password?x=1'), '/reset-password?x=1');
});

test('auth pages and the welcome screen itself never double-wrap', () => {
  assert.equal(postAuthPath('/welcome'), WELCOME_PATH);
  assert.equal(postAuthPath('/welcome?next=%2Fdeals'), WELCOME_PATH);
  assert.equal(postAuthPath('/login'), WELCOME_PATH);
  assert.equal(postAuthPath('/signup?next=/markets'), WELCOME_PATH);
});

test('open redirects are refused', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'javascript:alert(1)', 'deals']) {
    assert.equal(postAuthPath(bad), WELCOME_PATH, bad);
    assert.equal(welcomeReturnPath(bad), HOME_PATH, bad);
  }
});

test('welcome returns the member to their destination, else home', () => {
  assert.equal(HOME_PATH, '/today', 'home is the Today screen');
  assert.equal(welcomeReturnPath(null), HOME_PATH);
  assert.equal(welcomeReturnPath('/markets'), '/markets');
  assert.equal(welcomeReturnPath('/team/join?token=abc'), '/team/join?token=abc');
  assert.equal(welcomeReturnPath('/welcome'), HOME_PATH);
  assert.equal(welcomeReturnPath('/login?redirect=/deals'), HOME_PATH);
  assert.equal(welcomeReturnPath('/signup'), HOME_PATH);
});
