import { mondayProvider } from './monday.ts';
import { webhookProvider } from './webhook.ts';
import type { CrmProvider, CrmProviderId } from '../types.ts';

const PROVIDERS: Record<CrmProviderId, CrmProvider> = {
  monday: mondayProvider,
  webhook: webhookProvider,
};

/** Null for an unknown id, so a stored row from a future version cannot throw. */
export function providerFor(id: string): CrmProvider | null {
  return (PROVIDERS as Record<string, CrmProvider>)[id] ?? null;
}

export function isProviderId(id: string): id is CrmProviderId {
  return id in PROVIDERS;
}

export const ALL_PROVIDERS: CrmProvider[] = [mondayProvider, webhookProvider];
