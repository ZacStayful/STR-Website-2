import { briefingCardFor } from "@/lib/briefing/today-server";
import { eyeLevelFor } from "@/lib/home/eye-server";
import { profileSummaryFor } from "@/lib/profile/server";
import { BriefingCard } from "./BriefingCard";

/** Batch 23b: today's briefing at the top of Today, when they did not come in from the email. */
export async function TodayBriefing({ userId, fullName, now, viaEmail }: { userId: string; fullName: string | null; now: Date; viaEmail: boolean }) {
  const card = await briefingCardFor(userId, fullName, now, viaEmail);
  if (!card) return null;
  const level = await eyeLevelFor(await profileSummaryFor(userId)).catch(() => 3 as const);
  return <BriefingCard {...card} eyeLevel={level} />;
}
