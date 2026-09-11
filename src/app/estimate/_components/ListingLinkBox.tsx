'use client';

import { useState } from 'react';
import { Link2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { detectListingUrl, SOURCE_LABELS } from '@/lib/listing/detect';
import type { ResolvedListing } from './listing-client-types';

/** The route always answers JSON; anything else is the platform (a gateway timeout, a proxy error page). */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * "Paste a listing link" box on the analyser form. Resolves the link through
 * /api/listing/resolve (free, never a report run) and hands the parsed listing
 * to the form so every field is prefilled.
 */
export function ListingLinkBox({ onResolved, initialUrl, compact }: { onResolved: (r: ResolvedListing) => void; initialUrl?: string; compact?: boolean }) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = detectListingUrl(url);

  async function run() {
    if (!detected) {
      setError('Paste a link to a Rightmove, OnTheMarket or Airbnb listing page.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/listing/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await readJson(res);
      if (!data) {
        setError(res.status === 504 || res.status === 502 ? 'Stayful took too long reading that listing. Please try again in a moment.' : `Something went wrong on our side (HTTP ${res.status}). Please try again.`);
        return;
      }
      if (!res.ok || data.error) {
        setError(typeof data.error === 'string' ? data.error : 'Could not read that listing.');
        return;
      }
      onResolved(data as unknown as ResolvedListing);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3'}>
      <Label htmlFor="listing-url" className="flex items-center gap-2">
        <Link2 className="h-4 w-4" aria-hidden="true" />
        Paste a listing link
        <span className="text-xs font-normal text-muted-foreground">Rightmove · OnTheMarket · Airbnb</span>
      </Label>
      <div className="flex gap-2">
        <Input
          id="listing-url"
          inputMode="url"
          placeholder="https://www.rightmove.co.uk/properties/…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
          disabled={busy}
        />
        <Button type="button" onClick={run} disabled={busy || !url.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Check listing'}
        </Button>
      </div>
      {detected && !error && !busy && (
        <p className="text-xs text-muted-foreground">
          {SOURCE_LABELS[detected.source]} listing {detected.id}. We fill in the details and show a free quick view; the full report still uses one of your runs.
        </p>
      )}
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
