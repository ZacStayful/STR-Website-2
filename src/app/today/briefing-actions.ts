"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isFeedback, markDismissed, markPlayed, markShownInApp, recordFeedback } from "@/lib/briefing/marks-server";

// Batch 23b: the briefing card's marks. Each checks the session and touches
// only the member's own row (the row's user_id is matched on every write).

const ID = /^[0-9a-f-]{36}$/i;

async function member(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function briefingShownAction(briefingId: string): Promise<void> {
  const userId = await member();
  if (userId && ID.test(briefingId)) await markShownInApp(userId, briefingId);
}

export async function dismissBriefingAction(briefingId: string): Promise<void> {
  const userId = await member();
  if (userId && ID.test(briefingId)) await markDismissed(userId, briefingId);
}

export async function briefingPlayedAction(briefingId: string): Promise<void> {
  const userId = await member();
  if (userId && ID.test(briefingId)) await markPlayed(userId, briefingId);
}

export async function briefingFeedbackAction(briefingId: string, answer: string): Promise<boolean> {
  const userId = await member();
  if (!userId || !ID.test(briefingId) || !isFeedback(answer)) return false;
  return recordFeedback(briefingId, answer, new Date(), userId);
}
