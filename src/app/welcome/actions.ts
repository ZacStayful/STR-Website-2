'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { answerQuestion, markFinishLater, previewMatchCount, sampleMatches, type AnswerOutcome, type SampleDeal } from '@/lib/profile/server';
import type { WhereAnswer } from '@/lib/profile/questions';

/**
 * The profile quiz's server actions. Whose profile is always the session's:
 * nothing is taken from the request but the question and the answer. Every
 * answer saves at once (src/lib/profile/server.ts answerQuestion); the count
 * and the samples are reads that never charge.
 */

async function currentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function answerQuestionAction(input: { questionId: string; value: unknown; notSure: boolean; editing: boolean }): Promise<AnswerOutcome> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  return answerQuestion({ userId: user.id, email: user.email ?? null, supabase, questionId: String(input.questionId), value: input.value, notSure: input.notSure === true, editing: input.editing === true });
}

export async function previewMatchCountAction(where: WhereAnswer): Promise<number | null> {
  const { user } = await currentUser();
  if (!user) return null;
  return previewMatchCount({ userId: user.id, email: user.email ?? null, where });
}

export async function sampleMatchesAction(): Promise<SampleDeal[]> {
  const { user } = await currentUser();
  if (!user) return [];
  return sampleMatches({ userId: user.id, email: user.email ?? null, limit: 2 });
}

export async function finishLaterAction(question: string | null): Promise<void> {
  const { user } = await currentUser();
  if (!user) return;
  await markFinishLater(user.id, question);
}
