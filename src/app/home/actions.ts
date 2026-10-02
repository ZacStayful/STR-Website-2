"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity/log";

/** What a Home tap may name: a tile (`tile:<name>`) or a "This week" line (`feed:<kind>`). Anything else is dropped. */
const TARGET = /^(tile|feed):[a-z_]{1,24}$/;

/**
 * Batch 22e: a tap on a Home tile or a "This week" line. Record only (it
 * never counts towards weekly active): the page it opens logs its own view.
 * Whose tap is always the session's.
 */
export async function logHomeTapAction(target: string): Promise<void> {
  if (typeof target !== "string" || !TARGET.test(target)) return;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  logActivity(user.id, target.startsWith("feed:") ? "home_feed_tap" : "home_tile_tap", { extras: { target } });
}
