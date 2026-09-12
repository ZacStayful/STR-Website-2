/**
 * Lazy access to the service-role Supabase client for the credit modules.
 * `server-only` is a bundler alias that does not exist under the plain node
 * test runner, so the modules the provider clients import (meter, ledger,
 * unit costs) reach the admin client through a dynamic import instead of a
 * top-level one. Nothing here runs unless a metered call actually happens.
 */

export function hasServiceRole(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

type AdminClient = ReturnType<typeof import('../supabase/admin.ts').createAdminClient>;

let clientPromise: Promise<AdminClient> | null = null;

export function adminClient(): Promise<AdminClient> {
  if (!clientPromise) {
    clientPromise = import('../supabase/admin.ts').then((m) => m.createAdminClient());
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}
