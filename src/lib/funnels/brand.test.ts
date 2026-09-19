import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBrand, parseHexColour, parseLogoUrl, parseEmail, logoRejectionReason, brandCssVars, brandIsEmpty, brandName, readableOn, EMPTY_BRAND, activationBlockers, canActivate, parseHttpsUrl, consentText,
} from './brand.ts';

test('an unusable stored value falls back to no branding, not a broken page', () => {
  for (const bad of [null, undefined, 'nonsense', 42, []]) {
    const b = parseBrand(bad);
    assert.equal(brandIsEmpty(b), true, `expected empty brand for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(parseBrand({}), EMPTY_BRAND);
});

test('a full brand round-trips, normalised', () => {
  const b = parseBrand({
    companyName: '  Northern Lets  ',
    logoUrl: 'https://cdn.example.com/Logo.PNG',
    primary: '#1A73E8',
    background: '#FFFFFF',
    replyToEmail: '  Hello@Example.COM ',
  });
  assert.equal(b.companyName, 'Northern Lets');
  assert.equal(b.primary, '#1a73e8');
  assert.equal(b.replyToEmail, 'hello@example.com');
  assert.equal(b.logoUrl, 'https://cdn.example.com/Logo.PNG');
});

test('colours must be six-digit hex', () => {
  assert.equal(parseHexColour('#abc'), null, 'shorthand hex is not accepted');
  assert.equal(parseHexColour('red'), null);
  assert.equal(parseHexColour('#1a73e8'), '#1a73e8');
  assert.equal(parseHexColour('#GGGGGG'), null);
  assert.equal(parseHexColour(123), null);
});

// ─── Logos: only what renders on BOTH the page and the PDF ────────────

test('PNG and JPEG over https are accepted', () => {
  for (const u of [
    'https://cdn.example.com/logo.png',
    'https://cdn.example.com/logo.jpg',
    'https://cdn.example.com/logo.jpeg',
    'https://cdn.example.com/path/logo.PNG?v=2',
  ]) {
    assert.ok(parseLogoUrl(u), `expected ${u} to be accepted`);
  }
});

test('a PDF logo is refused, because it renders on neither surface', () => {
  assert.equal(parseLogoUrl('https://cdn.example.com/logo.pdf'), null);
  assert.match(logoRejectionReason('https://cdn.example.com/logo.pdf') ?? '', /PDF cannot be used as a logo/);
});

test('an SVG logo is refused, because the PDF report cannot render it', () => {
  assert.equal(parseLogoUrl('https://cdn.example.com/logo.svg'), null);
  assert.match(logoRejectionReason('https://cdn.example.com/logo.svg') ?? '', /do not render in the PDF/);
});

test('http is refused — a browser blocks mixed content anyway', () => {
  assert.equal(parseLogoUrl('http://cdn.example.com/logo.png'), null);
  assert.match(logoRejectionReason('http://cdn.example.com/logo.png') ?? '', /has to be served over https/);
});

test('a non-URL gets a reason a customer can act on', () => {
  assert.match(logoRejectionReason('cdn.example.com/logo.png') ?? '', /should start with https/);
  assert.equal(logoRejectionReason(''), null, 'no logo set is not a rejection');
  assert.equal(logoRejectionReason('https://cdn.example.com/logo.png'), null);
});

test('javascript: and data: URLs are refused', () => {
  assert.equal(parseLogoUrl('javascript:alert(1)'), null);
  assert.equal(parseLogoUrl('data:image/png;base64,AAAA'), null);
});

// ─── Email ────────────────────────────────────────────────────────────

test('reply-to must look like an address', () => {
  assert.equal(parseEmail('hello@example.com'), 'hello@example.com');
  assert.equal(parseEmail('nope'), null);
  assert.equal(parseEmail('a@b'), null, 'needs a tld');
});

// ─── CSS variables ────────────────────────────────────────────────────

test('only the slots a customer set are emitted', () => {
  assert.deepEqual(brandCssVars(EMPTY_BRAND), {});
  const vars = brandCssVars(parseBrand({ primary: '#1a73e8' }));
  assert.equal(vars['--primary'], '#1a73e8');
  assert.equal(vars['--ring'], '#1a73e8');
  assert.equal(vars['--background'], undefined, 'an unset slot must inherit, not be forced');
});

test('button text colour is derived, so a brand colour cannot make it unreadable', () => {
  // A customer picks the button colour; we pick what goes on top of it.
  assert.equal(brandCssVars(parseBrand({ primary: '#111111' }))['--primary-foreground'], '#ffffff');
  assert.equal(brandCssVars(parseBrand({ primary: '#ffff00' }))['--primary-foreground'], '#111111');
});

test('readableOn uses luminance, not a naive average', () => {
  // Pure green averages mid-grey but is bright enough to need dark text.
  assert.equal(readableOn('#00ff00'), '#111111');
  // Pure blue averages the same but is dark enough to need light text.
  assert.equal(readableOn('#0000ff'), '#ffffff');
});

test('an unnamed funnel still has something to call itself', () => {
  assert.equal(brandName(EMPTY_BRAND), 'Property income analysis');
  assert.equal(brandName(parseBrand({ companyName: 'Northern Lets' })), 'Northern Lets');
});

// ─── Privacy policy and activation ────────────────────────────────────

test('a funnel cannot go live without a privacy policy and a company name', () => {
  assert.deepEqual(activationBlockers(EMPTY_BRAND), ['a link to your privacy policy', 'your company name']);
  assert.equal(canActivate(EMPTY_BRAND), false);

  const nameOnly = parseBrand({ companyName: 'Northern Lets' });
  assert.deepEqual(activationBlockers(nameOnly), ['a link to your privacy policy']);
  assert.equal(canActivate(nameOnly), false);

  const ready = parseBrand({ companyName: 'Northern Lets', privacyUrl: 'https://example.com/privacy' });
  assert.deepEqual(activationBlockers(ready), []);
  assert.equal(canActivate(ready), true);
});

test('the privacy link must be https', () => {
  assert.equal(parseHttpsUrl('https://example.com/privacy'), 'https://example.com/privacy');
  assert.equal(parseHttpsUrl('http://example.com/privacy'), null);
  assert.equal(parseHttpsUrl('example.com/privacy'), null);
  assert.equal(parseHttpsUrl('javascript:alert(1)'), null);
  assert.equal(parseHttpsUrl(''), null);
});

test('the privacy link is not restricted to image extensions', () => {
  // parseLogoUrl is deliberately narrow; a policy page is just a page.
  assert.ok(parseHttpsUrl('https://example.com/legal/privacy-policy'));
  assert.equal(parseLogoUrl('https://example.com/legal/privacy-policy'), null);
});

test('the consent line names the customer, not Stayful', () => {
  const t = consentText(parseBrand({ companyName: 'Northern Lets' }));
  assert.match(t, /Northern Lets may store my details/);
  assert.doesNotMatch(t, /Stayful/);
  // With no company name it still reads as a sentence rather than "undefined".
  assert.match(consentText(EMPTY_BRAND), /the company running this form/);
});
