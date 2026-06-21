import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client for trusted server-side writes that must
// bypass RLS — e.g. the Stripe webhook flipping a profile to Pro, where
// there is no logged-in user session. Requires SUPABASE_SERVICE_ROLE_KEY.
// NEVER import this into client components.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
