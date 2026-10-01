'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { CHIP_ORDER } from '@/lib/intelligence/config';

const SURFACES = ['header', 'reveal', 'today'] as const;
const STEPS = ['open', 'question', 'show_me', 'deep_line'] as const;

/**
 * Batch 22: a look at Stayful Intelligence — the view opened from the header,
 * a question chip answered, a what-if previewed, the deep-search line shown.
 * Recorded only: it never counts towards weekly active. Only known values are
 * stored (never free text).
 */
export async function recordSiViewAction(input: { surface: unknown; step: unknown; chip?: unknown }): Promise<void> {
  const surface = SURFACES.find((x) => x === input.surface);
  const step = STEPS.find((x) => x === input.step);
  if (!surface || !step) return;
  const chip = CHIP_ORDER.find((x) => x === input.chip) ?? null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  logActivity(user.id, 'si_view', { extras: { surface, step, ...(chip ? { chip } : {}) } });
}
