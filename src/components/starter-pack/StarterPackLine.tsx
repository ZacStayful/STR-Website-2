'use client';

import { useState } from 'react';
import type { PackCopy } from '@/lib/starter-pack/rules';
import { StarterPackOffer } from './StarterPackOffer';

/**
 * The starter pack as one line (Batch 20): Account → Billing's "Pay as you
 * go" card. The button opens the buy box with its tickbox in place.
 */
export function StarterPackLine({ copy, returnTo }: { copy: PackCopy; returnTo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-sm font-medium text-foreground">{copy.accountLine}</p>
      {open ? (
        <div className="mt-3">
          <StarterPackOffer copy={copy} returnTo={returnTo} variant="compact" heading={false} />
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
          {copy.accountCta}
        </button>
      )}
    </div>
  );
}
