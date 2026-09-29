import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseListing } from './index.ts';
import { parseAirbnbSummary } from './airbnb.ts';
import { rightmovePageModel } from './rightmove.ts';
import { addProjectFacts, baseSnapshot, floorAreaSqftFrom, leaseYearsFrom, SNAPSHOT_PHOTO_LIMIT } from './shared.ts';
import { projectPhotosFrom } from './photos.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '..', '__fixtures__', name), 'utf8');
const NOW = '2026-09-06T12:00:00.000Z';

test('rightmove sale page', () => {
  const s = parseListing('rightmove', fixture('rightmove-sale.html'), { id: '91877934', canonicalUrl: 'https://www.rightmove.co.uk/properties/91877934', now: NOW })!;
  assert.ok(s);
  assert.equal(s.kind, 'sale');
  assert.equal(s.title, '2 bedroom apartment for sale in Labrador Quay, Salford, Lancashire, M50');
  assert.equal(s.displayAddress, 'Labrador Quay, Salford, Lancashire, M50');
  assert.equal(s.postcode, 'M50 3YH');
  assert.equal(s.outcode, 'M50');
  assert.equal(s.lat, 53.473318);
  assert.equal(s.lng, -2.287067);
  assert.equal(s.bedrooms, 2);
  assert.equal(s.bathrooms, 1);
  assert.equal(s.rawType, 'Apartment');
  assert.deepEqual(s.price, { amount: 220000, period: 'total' });
  assert.equal(s.tenure, 'leasehold');
  assert.equal(s.sharedOwnership, false);
  assert.equal(s.shortLetsPermitted, null);
  assert.equal(s.councilTaxBand, 'D');
  assert.ok(s.features.includes('Residents Parking'));
  assert.ok(s.photos[0]?.startsWith('https://media.rightmove.co.uk/'));
  assert.equal(s.status, 'available');
  assert.equal(s.locationConfidence, 'exact');
  assert.equal(s.fetchedAt, NOW);
  assert.equal(s.parserVersion, 3);
  // Agent details never make it into the snapshot.
  assert.ok(!JSON.stringify(s).includes('REDACTED'));
  // When the seller started, from Rightmove's own clock rather than our first sighting.
  assert.equal(s.listedDate, '2026-08-11');
  assert.deepEqual(s.listingUpdate, { reason: 'added', on: '2026-08-11' });
  // A leasehold with no years stated must not read as a lease about to run out.
  assert.equal(s.yearsRemainingOnLease, undefined);
  // Batch 17: Rightmove's own listed-building flag, and the project facts (keys only, never words).
  assert.equal(s.listedBuilding, false);
  assert.deepEqual(s.needsWork, { flag: false, score: 0, phrases: [] });
  assert.equal(s.projectExclusion, null);
  assert.equal(s.floorAreaSqft, undefined, 'no size stated');
});

test('rightmove rental page', () => {
  const s = parseListing('rightmove', fixture('rightmove-rent.html'), { id: '92783205', canonicalUrl: 'https://www.rightmove.co.uk/properties/92783205', now: NOW })!;
  assert.equal(s.kind, 'rent');
  assert.equal(s.postcode, 'M4 5AE');
  assert.deepEqual(s.price, { amount: 1195, period: 'pcm' });
  assert.equal(s.bathrooms, 2);
  assert.equal(s.councilTaxBand, 'C');
  assert.equal(s.tenure, undefined);
  assert.ok(s.features.includes('Furnished'));
  // "Added yesterday" resolves against the fetch date, not today's clock.
  assert.equal(s.listedDate, '2026-09-05');
  assert.deepEqual(s.listingUpdate, { reason: 'added', on: '2026-09-05' });
  // The landlord side: when it is free, and the shortest term they will take.
  assert.equal(s.letAvailableDate, '2026-09-30');
  assert.equal(s.minimumTermInMonths, 1);
});

test('rightmove page model decodes the flattened data string', () => {
  const p = rightmovePageModel(fixture('rightmove-sale.html'))!;
  assert.equal(p.id, '91877934');
  assert.equal(p.transactionType, 'BUY');
});

test('rightmove falls back to meta tags when PAGE_MODEL is missing', () => {
  const html = '<html><head><title>3 bedroom semi-detached house for sale in Some Road, Leeds, LS6</title><meta property="og:image" content="https://x/y.jpg"></head><body></body></html>';
  const s = parseListing('rightmove', html, { id: '1', canonicalUrl: 'https://www.rightmove.co.uk/properties/1', now: NOW })!;
  assert.equal(s.kind, 'sale');
  assert.equal(s.outcode, 'LS6');
  assert.equal(s.locationConfidence, 'outcode');
  assert.deepEqual(s.photos, ['https://x/y.jpg']);
});

test('onthemarket sale page', () => {
  const s = parseListing('onthemarket', fixture('onthemarket-sale.html'), { id: '19535441', canonicalUrl: 'https://www.onthemarket.com/details/19535441/', now: NOW })!;
  assert.equal(s.kind, 'sale');
  assert.equal(s.postcode, 'NG1 1GH');
  assert.equal(s.displayAddress, 'Woolpack Lane, Nottingham');
  assert.equal(s.lat, 52.953246);
  assert.equal(s.bedrooms, 2);
  assert.equal(s.bathrooms, 2);
  assert.equal(s.rawType, 'Flat');
  assert.deepEqual(s.price, { amount: 120000, period: 'total' });
  assert.equal(s.tenure, 'leasehold');
  assert.equal(s.councilTaxBand, 'D');
  assert.ok(s.features.includes('Two double bedrooms'));
  assert.equal(s.status, 'available');
  assert.ok(!JSON.stringify(s).includes('Example Agent'));
  // Batch 17 (bug 3): "Leasehold | 976 yrs left" keeps its years.
  assert.equal(s.yearsRemainingOnLease, 976);
  assert.equal(s.parserVersion, 2);
  assert.equal(s.needsWork?.flag, false);
});

test('Batch 17: lease years and floor area from the portals’ wording', () => {
  assert.equal(leaseYearsFrom('Leasehold  |  976 yrs left'), 976);
  assert.equal(leaseYearsFrom('Tenure: Leasehold (975 years remaining)'), 975);
  assert.equal(leaseYearsFrom('90 years remaining on the lease'), 90);
  assert.equal(leaseYearsFrom('A 125 year lease from 1990'), null, 'the original term is not what is left');
  assert.equal(leaseYearsFrom(null, 'Freehold'), null);
  assert.equal(floorAreaSqftFrom('Approx. 818 sq ft'), 818);
  assert.equal(floorAreaSqftFrom('1,050 sq. ft.'), 1050);
  assert.equal(floorAreaSqftFrom('76 sq m'), 818);
  assert.equal(floorAreaSqftFrom('Garden 40 sq ft'), null, 'too small to be a home: not a floor area');
  assert.equal(floorAreaSqftFrom('No size given'), null);
});

test('Batch 17: a sale’s project facts come from its own words, a rental gets none', () => {
  const sale = { ...baseSnapshot('rightmove', { id: '1', canonicalUrl: 'x', now: NOW }, 3), kind: 'sale' as const, title: '3 bed terrace', features: ['Chain free'] };
  addProjectFacts(sale, 'A three bedroom house in need of full modernisation. Cash buyers only.');
  assert.equal(sale.needsWork?.flag, true);
  assert.ok(sale.needsWork!.phrases.includes('in_need_of_works'));
  assert.ok(!JSON.stringify(sale.needsWork).includes('modernisation'), 'our keys, never the listing’s words');
  const bisf = { ...sale, needsWork: undefined, projectExclusion: undefined };
  addProjectFacts(bisf, 'A BISF house needing updating.');
  assert.equal(bisf.projectExclusion, 'non_standard');
  const short = { ...sale, yearsRemainingOnLease: 62 };
  addProjectFacts(short, '');
  assert.equal(short.projectExclusion, 'short_lease');
  const rent = { ...sale, kind: 'rent' as const, needsWork: undefined };
  addProjectFacts(rent, 'In need of modernisation');
  assert.equal(rent.needsWork, undefined);
});

test('onthemarket rental page (student let, pcm with pw in brackets)', () => {
  const s = parseListing('onthemarket', fixture('onthemarket-rent.html'), { id: '16664769', canonicalUrl: 'https://www.onthemarket.com/details/16664769/', now: NOW })!;
  assert.equal(s.kind, 'rent');
  assert.equal(s.postcode, 'NG1 5JS');
  assert.deepEqual(s.price, { amount: 2054, period: 'pcm' });
  assert.equal(s.bedrooms, 3);
  assert.equal(s.councilTaxBand, 'B');
  assert.ok(s.features.includes('Student let'));
});

test('airbnb entire home page', () => {
  const s = parseListing('airbnb', fixture('airbnb-entire-home.html'), { id: '1115704756752582530', canonicalUrl: 'https://www.airbnb.co.uk/rooms/1115704756752582530', now: NOW })!;
  assert.equal(s.kind, 'str');
  assert.ok(s.title.includes('Cosy House for 8'));
  assert.equal(s.displayAddress, 'Greater Manchester');
  assert.equal(s.lat, 53.4539);
  assert.equal(s.lng, -2.15971);
  assert.equal(s.bedrooms, 4);
  assert.equal(s.bathrooms, 2);
  assert.equal(s.guests, 8);
  assert.equal(s.rawType, 'Entire home/apt');
  assert.equal(s.str?.rating, 4.91);
  assert.equal(s.str?.reviewCount, 74);
  assert.equal(s.str?.isSuperhost, true);
  assert.equal(s.postcode, undefined);
  assert.equal(s.locationConfidence, 'none');
  assert.ok(s.photos[0]?.includes('muscache'));
});

test('airbnb summary parser handles studio and shared baths', () => {
  assert.deepEqual(parseAirbnbSummary('Flat in Leeds · ★4.6 · Studio · 1 bed · 1 shared bathroom'), { place: 'Leeds', rating: 4.6, bedrooms: 0, beds: 1, bathrooms: 1 });
  assert.deepEqual(parseAirbnbSummary(null), {});
});

test('zoopla page via __NEXT_DATA__', () => {
  const s = parseListing('zoopla', fixture('zoopla-sale.html'), { id: '70123456', canonicalUrl: 'https://www.zoopla.co.uk/for-sale/details/70123456/', now: NOW })!;
  assert.equal(s.kind, 'sale');
  assert.equal(s.postcode, 'NG1 1GH');
  assert.equal(s.bedrooms, 2);
  assert.equal(s.lat, 52.9532);
  assert.deepEqual(s.price, { amount: 125000, period: 'total' });
  assert.equal(s.status, 'under_offer');
  assert.equal(s.tenure, 'leasehold');
  assert.ok(s.features.includes('Allocated parking'));
});

test('booking.com page via JSON-LD', () => {
  const s = parseListing('booking', fixture('booking-hotel.html'), { id: 'gb/example-apartments', canonicalUrl: 'https://www.booking.com/hotel/gb/example-apartments.html', now: NOW })!;
  assert.equal(s.kind, 'str');
  assert.equal(s.title, 'Example Apartments');
  assert.equal(s.postcode, 'NG1 1GH');
  assert.equal(s.lat, 52.9536);
  assert.equal(s.str?.rating, 4.3);
  assert.equal(s.str?.reviewCount, 412);
  assert.deepEqual(s.price, { amount: 95, period: 'night' });
});

test('unreadable pages yield null rather than throwing', () => {
  assert.equal(parseListing('rightmove', '', { id: '1', canonicalUrl: 'x', now: NOW }), null);
  assert.equal(parseListing('airbnb', '<html></html>', { id: '1', canonicalUrl: 'x', now: NOW }), null);
});

test('Rightmove: the auctionOnly flag marks an auction lot; the ordinary sale is not one', () => {
  const html = fixture('rightmove-sale.html');
  const ctx = { id: '91877934', canonicalUrl: 'https://www.rightmove.co.uk/properties/91877934', now: NOW };
  assert.equal(parseListing('rightmove', html, ctx)!.auction, false);
  // In the flattened page model index 6 is true and 7 false (status.published = 6 on a live listing).
  const flagged = html.replace('auctionOnly\\":7', 'auctionOnly\\":6');
  assert.notEqual(flagged, html, 'the fixture carries the flag');
  assert.equal(parseListing('rightmove', flagged, ctx)!.auction, true);
});

test('Batch 17: the photo check reads up to ten photos and the floorplans from the page; the snapshot keeps six', () => {
  const html = fixture('rightmove-sale.html');
  const rm = projectPhotosFrom('rightmove', html, 10);
  assert.equal(rm.photos.length, 10, 'twelve on the page, ten read');
  assert.ok(rm.photos.every((u) => u.startsWith('https://media.rightmove.co.uk/')));
  assert.equal(rm.floorplans.length, 1);
  const snap = parseListing('rightmove', html, { id: '91877934', canonicalUrl: 'https://www.rightmove.co.uk/properties/91877934', now: NOW })!;
  assert.equal(snap.photos.length, SNAPSHOT_PHOTO_LIMIT);
  assert.equal(rm.photos[0], snap.photos[0], 'the same lead photo');
  const otm = projectPhotosFrom('onthemarket', fixture('onthemarket-sale.html'), 10);
  assert.equal(otm.photos.length, 2);
  assert.deepEqual(otm.floorplans, []);
  assert.deepEqual(projectPhotosFrom('zoopla', fixture('zoopla-sale.html'), 10), { photos: [], floorplans: [] }, 'a Zoopla page is never photo-checked');
});
