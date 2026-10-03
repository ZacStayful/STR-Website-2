import 'server-only';

/**
 * Batch 24: keeping the phone agent in step with the knowledge base.
 *
 *   knowledgeCallValues()   the k_* figures for a call about to start (every
 *                           call sends all of them; see ./agent.ts)
 *   agentKnowledgeNow()     the agent's knowledge as it should be now
 *   syncAgentKnowledge()    push it to ElevenLabs (the prompt only: tools are
 *                           created from /admin/calls → Sync), refused while a
 *                           required answer has no live entry; re-checks after
 *                           it writes, so two approvals close together end
 *                           with the newer text
 *   afterKnowledgeChange()  the background sync after an approval, an edit
 *                           going live, a retirement or a stale entry
 */
import { after } from 'next/server';
import { createAdminClient } from '../supabase/admin';
import { updateBillingSetting } from '../credit/unit-costs';
import { syncAgent, type SyncResult } from '../voice/agent/sync-server';
import { voiceConfig } from '../voice/config';
import { agentKnowledge, knowledgeVariables, type AgentKnowledge } from './agent';
import { checkStale, liveEntries, readGlobalSnapshot, type Admin } from './store-server';

const SYNCED_HASH_KEY = 'si_agent_knowledge_hash';
const SYNC_ERROR_KEY = 'si_agent_knowledge_sync_error';

/**
 * The knowledge figures for a call starting now. Never throws: a figure that
 * can't be read goes out as "shown in the app" (callVariables fills it). If
 * the settings were read but a figure no longer resolves, the entries using
 * it are marked stale and the agent re-synced without them, in the background.
 */
export async function knowledgeCallValues(admin: Admin = createAdminClient()): Promise<Record<string, string>> {
  try {
    const g = await readGlobalSnapshot(admin);
    const { values, unresolved } = knowledgeVariables(g);
    if (g && unresolved.length) {
      console.warn(`[knowledge] call figures not resolving: ${unresolved.join(', ')}`);
      afterKnowledgeChange('a call figure no longer resolves', { checkStaleFirst: true });
    }
    return values;
  } catch (err) {
    console.error('[knowledge] call figures failed:', err);
    return {};
  }
}

/** The agent's knowledge as it should be now; null when the knowledge base or the settings can't be read. */
export async function agentKnowledgeNow(admin: Admin = createAdminClient()): Promise<AgentKnowledge | null> {
  const [entries, g] = await Promise.all([liveEntries('call', admin), readGlobalSnapshot(admin)]);
  if (!entries || !g) return null;
  return agentKnowledge(entries, g);
}

export interface AgentKnowledgeState {
  knowledge: AgentKnowledge | null;
  syncedHash: string | null;
  lastError: string | null;
  inStep: boolean;
}

/** For admin: what the agent should know, and whether the last sync matches it. */
export async function agentKnowledgeState(admin: Admin = createAdminClient()): Promise<AgentKnowledgeState> {
  const [knowledge, { data }] = await Promise.all([agentKnowledgeNow(admin), admin.from('billing_settings').select('key, value').in('key', [SYNCED_HASH_KEY, SYNC_ERROR_KEY])]);
  const kv = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const syncedHash = typeof kv.get(SYNCED_HASH_KEY) === 'string' ? (kv.get(SYNCED_HASH_KEY) as string) : null;
  const lastError = typeof kv.get(SYNC_ERROR_KEY) === 'string' && kv.get(SYNC_ERROR_KEY) ? (kv.get(SYNC_ERROR_KEY) as string) : null;
  return { knowledge, syncedHash, lastError, inStep: Boolean(knowledge && syncedHash === knowledge.hash) };
}

/**
 * Push the knowledge to the agent. `toolsToo` (the /admin/calls button) also
 * creates or updates the agent's tools; a sync after an approval sends the
 * prompt only, so two at once can never create a tool twice. With `dry`,
 * reports what would change.
 *
 * The first sync from the knowledge base (the cut-over) is refused while a
 * required call answer is missing, so the agent never goes out knowing
 * nothing. After that it always syncs: an answer retired or gone stale
 * leaves the agent at once (the agent says it doesn't know), and the
 * message names the required answers that are missing.
 */
export async function syncAgentKnowledge(o: { dry: boolean; toolsToo: boolean; reason: string }): Promise<SyncResult> {
  if (!voiceConfig()) return { ok: false, dry: o.dry, message: 'Calls are not configured (ELEVENLABS_*), so there is no agent to sync.', changes: [] };
  const admin = createAdminClient();
  const state = await agentKnowledgeState(admin);
  const cutOver = state.syncedHash !== null;
  let last: SyncResult | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const k = await agentKnowledgeNow(admin);
    if (!k) return { ok: false, dry: o.dry, message: "The knowledge base or the settings couldn't be read; the agent was left as it is.", changes: [] };
    const missing = k.missingRequired.length ? `These call answers aren't live, so the agent won't give them: ${k.missingRequired.join(', ')}.` : '';
    if (missing && !cutOver) {
      const message = `Not synced: approve these call answers first (the agent keeps what it has until then): ${k.missingRequired.join(', ')}.`;
      if (!o.dry) await updateBillingSetting(SYNC_ERROR_KEY, message).catch(() => undefined);
      return { ok: false, dry: o.dry, message, changes: [] };
    }
    last = await syncAgent({ apply: !o.dry, knowledge: k.text, toolsToo: o.toolsToo });
    if (missing) last = { ...last, message: `${last.message} ${missing}` };
    if (o.dry || !last.ok) {
      if (!o.dry) await updateBillingSetting(SYNC_ERROR_KEY, last.message).catch(() => undefined);
      return last;
    }
    await updateBillingSetting(SYNCED_HASH_KEY, k.hash);
    // A missing required answer stays on the Knowledge page's banner until it is approved again.
    await updateBillingSetting(SYNC_ERROR_KEY, missing).catch(() => undefined);
    // Something approved while this one was writing? Then once more, with the newer text.
    const again = await agentKnowledgeNow(admin);
    if (!again || again.hash === k.hash) break;
  }
  console.log(`[knowledge] agent synced (${o.reason})`);
  return last ?? { ok: false, dry: o.dry, message: 'Nothing synced.', changes: [] };
}

/**
 * After a change that can alter what the agent knows: re-sync in the
 * background (after the response). Never blocks or throws. With
 * `checkStaleFirst`, entries whose figures no longer resolve are marked
 * stale first, so they leave the agent too.
 */
export function afterKnowledgeChange(reason: string, o: { checkStaleFirst?: boolean } = {}): void {
  const run = async () => {
    try {
      if (o.checkStaleFirst) await checkStale({ dry: false, actor: 'system' });
      const state = await agentKnowledgeState();
      if (state.inStep) return;
      await syncAgentKnowledge({ dry: false, toolsToo: false, reason });
    } catch (err) {
      console.error('[knowledge] background agent sync failed:', err);
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request (a script): run it now, unawaited.
    void run();
  }
}
