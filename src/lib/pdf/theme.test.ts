import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfBrand, readableOnPdf, DEFAULT_PDF_BRAND, PDF_COLORS } from './theme.ts';

test('no brand means the members-only report is untouched', () => {
  assert.deepEqual(pdfBrand(null), DEFAULT_PDF_BRAND);
  assert.deepEqual(pdfBrand(undefined), DEFAULT_PDF_BRAND);
  assert.equal(DEFAULT_PDF_BRAND.companyName, 'STAYFUL');
  assert.equal(DEFAULT_PDF_BRAND.primary, PDF_COLORS.DARK_GREEN);
});

test('a partial brand fills the gaps rather than rendering blanks', () => {
  const b = pdfBrand({ companyName: 'Northern Lets' });
  assert.equal(b.companyName, 'Northern Lets');
  assert.equal(b.primary, DEFAULT_PDF_BRAND.primary, 'an unset colour keeps the default');
  assert.equal(b.contactLine, '', 'we never invent contact details for someone else');
});

test('an empty or whitespace name falls back rather than printing nothing', () => {
  assert.equal(pdfBrand({ companyName: '   ' }).companyName, 'STAYFUL');
  assert.equal(pdfBrand({ companyName: '' }).companyName, 'STAYFUL');
});

test('header text is derived so a brand colour cannot hide it', () => {
  assert.equal(pdfBrand({ primary: '#111111' }).onPrimary, PDF_COLORS.WHITE);
  assert.equal(pdfBrand({ primary: '#ffff00' }).onPrimary, '#111111');
  // Luminance, not a channel average: these two average the same grey.
  assert.equal(readableOnPdf('#00ff00'), '#111111');
  assert.equal(readableOnPdf('#0000ff'), PDF_COLORS.WHITE);
});

test('a malformed colour does not produce an unreadable header', () => {
  assert.equal(readableOnPdf('#abc'), PDF_COLORS.WHITE);
  assert.equal(readableOnPdf('nonsense'), PDF_COLORS.WHITE);
});

test('an explicit onPrimary is respected over the derived one', () => {
  assert.equal(pdfBrand({ primary: '#ffff00', onPrimary: '#ff0000' }).onPrimary, '#ff0000');
});
