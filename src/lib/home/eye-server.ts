import 'server-only';

/**
 * The eye's level for a member (Batch 22: their match accuracy; a team
 * member's eye is full). One helper for the header (AppShell) and Home.
 */
import { accuracySettings, accuracyView, type ProfileSummary } from '../profile/server';
import type { EyeLevel } from '@/components/StayfulEye';

export async function eyeLevelFor(profile: ProfileSummary | null): Promise<EyeLevel> {
  if (!profile || profile.teamMember) return 3;
  try {
    return accuracyView(profile.progress, await accuracySettings()).level;
  } catch (err) {
    console.error('[eye] accuracy level failed:', err);
    return 3;
  }
}
