'use client';

import { useState } from 'react';
import type { PackCopy } from '@/lib/starter-pack/rules';
import { StarterPackOffer } from './StarterPackOffer';
import { snoozePackAction } from './actions';

/**
 * The starter pack on Today (Batch 20): at the very top until the member
 * buys it or starts a plan. "Not now" hides it for the snooze days
 * (billing_settings.starter_pack_snooze_days).
 */
export function StarterPackCard({ copy }: { copy: PackCopy }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section aria-label="Starter pack" className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <StarterPackOffer
        copy={copy}
        returnTo="/today"
        variant="card"
        onNotNow={() => {
          setHidden(true);
          snoozePackAction().catch(() => {});
        }}
      />
    </section>
  );
}
