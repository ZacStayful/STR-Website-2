/**
 * Ticketmaster Discovery API — fetches upcoming events near a location.
 * Uses lat/lng instead of postcode because Ticketmaster doesn't resolve UK postcodes well.
 */

import type { NearbyEvent } from '../types';

export async function getNearbyEvents(
  lat: number,
  lng: number,
): Promise<{ events: NearbyEvent[]; totalEvents: number }> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new Error('TICKETMASTER_API_KEY is not set in environment variables.');
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('latlong', `${lat},${lng}`);
  url.searchParams.set('radius', '20');
  url.searchParams.set('unit', 'miles');
  url.searchParams.set('size', '20');
  url.searchParams.set('sort', 'date,asc');
  url.searchParams.set('countryCode', 'GB');
  url.searchParams.set('startDateTime', now);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Ticketmaster API returned HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = await response.json();

  const totalEvents: number = data.page?.totalElements ?? 0;

  const rawEvents: Record<string, unknown>[] =
    data._embedded?.events ?? [];

  const events: NearbyEvent[] = rawEvents.map((event) => {
    const dates = event.dates as Record<string, unknown> | undefined;
    const start = dates?.start as Record<string, unknown> | undefined;

    const classifications = Array.isArray(event.classifications)
      ? (event.classifications[0] as Record<string, unknown>)
      : undefined;

    const venueList = (event._embedded as Record<string, unknown[]> | undefined)
      ?.venues;
    const venue = Array.isArray(venueList)
      ? (venueList[0] as Record<string, unknown>)
      : undefined;

    const distanceValue = event.distance != null ? Number(event.distance) : null;

    return {
      name: String(event.name ?? ''),
      date: String(start?.localDate ?? ''),
      time: String(start?.localTime ?? ''),
      venue: String(venue?.name ?? ''),
      category: String(
        (classifications?.segment as Record<string, unknown>)?.name ?? '',
      ),
      genre: String(
        (classifications?.genre as Record<string, unknown>)?.name ?? '',
      ),
      distance: distanceValue,
      url: String(event.url ?? ''),
    };
  });

  return { events, totalEvents };
}
