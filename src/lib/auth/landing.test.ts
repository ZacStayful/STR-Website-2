import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postAuthPath, welcomeReturnPath, quizPathFor, HOME_PATH, WELCOME_PATH } from './landing.ts';

test('no destination lands on Today', () => {
  assert.equal(postAuthPath(null), HOME_PATH);
  assert.equal(postAuthPath(undefined), HOME_PATH);
  assert.equal(postAuthPath(''), HOME_PATH);
  assert.equal(postAuthPath('   '), HOME_PATH);
});

test('an explicit destination is honoured: the quiz gates the page itself, not the sign-in', () => {
  assert.equal(postAuthPath('/markets'), '/markets');
  assert.equal(postAuthPath('/reports?q=ng2'), '/reports?q=ng2');
  assert.equal(postAuthPath(HOME_PATH), HOME_PATH);
});

test('team invites and password resets are never interrupted', () => {
  assert.equal(postAuthPath('/team/join?token=abc'), '/team/join?token=abc');
  assert.equal(postAuthPath('/team/join'), '/team/join');
  assert.equal(postAuthPath('/reset-password'), '/reset-password');
  assert.equal(postAuthPath('/reset-password?x=1'), '/reset-password?x=1');
});

test('auth pages and the quiz itself never loop', () => {
  assert.equal(postAuthPath('/welcome'), HOME_PATH);
  assert.equal(postAuthPath('/welcome?next=%2Fdeals'), HOME_PATH);
  assert.equal(postAuthPath('/login'), HOME_PATH);
  assert.equal(postAuthPath('/signup?next=/markets'), HOME_PATH);
});

test('open redirects are refused', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'javascript:alert(1)', 'deals']) {
    assert.equal(postAuthPath(bad), HOME_PATH, bad);
    assert.equal(welcomeReturnPath(bad), HOME_PATH, bad);
    assert.equal(quizPathFor(bad), WELCOME_PATH, bad);
  }
});

test('the quiz returns the member to their destination, else home', () => {
  assert.equal(HOME_PATH, '/today', 'home is the Today screen');
  assert.equal(welcomeReturnPath(null), HOME_PATH);
  assert.equal(welcomeReturnPath('/markets'), '/markets');
  assert.equal(welcomeReturnPath('/team/join?token=abc'), '/team/join?token=abc');
  assert.equal(welcomeReturnPath('/welcome'), HOME_PATH);
  assert.equal(welcomeReturnPath('/login?redirect=/deals'), HOME_PATH);
  assert.equal(welcomeReturnPath('/signup'), HOME_PATH);
});

test('the gate sends a member to the quiz with the page they wanted as the way back', () => {
  assert.equal(quizPathFor('/deals?kind=rent'), '/welcome?next=%2Fdeals%3Fkind%3Drent');
  assert.equal(quizPathFor('/today'), '/welcome?next=%2Ftoday');
  assert.equal(quizPathFor(null), WELCOME_PATH);
  assert.equal(quizPathFor('/welcome'), WELCOME_PATH);
  assert.equal(quizPathFor('/login'), WELCOME_PATH);
  assert.equal(quizPathFor('/team/join?token=abc'), WELCOME_PATH, 'a join page is never a way back into the quiz');
});
