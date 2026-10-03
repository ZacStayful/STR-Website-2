/**
 * Batch 23: the whole ElevenLabs agent as one object — prompt (persona +
 * call task + knowledge), opener, the one SI voice, limits, the built-in
 * tools (end call; voicemail: hang up, no message), data collection for an
 * unhappy member, the opener override, and transcript retention.
 *
 * Pure: the server half (sync-server.ts) fetches the live figures and sends it.
 */
import { VOICE } from '../../persona/stayful-intelligence.ts';
import { agentPrompt } from './prompt.ts';
import { CALLBACK_UNKNOWN_OPENER } from './scripts.ts';

export interface AgentConfigInput {
  knowledge: string;
  voiceId: string;
  toolIds: string[];
  maxCallSeconds: number;
  retentionDays: number;
}

export function agentConfig(i: AgentConfigInput): Record<string, unknown> {
  return {
    name: 'Stayful Intelligence',
    conversation_config: {
      agent: {
        first_message: CALLBACK_UNKNOWN_OPENER,
        language: 'en',
        prompt: {
          prompt: agentPrompt(i.knowledge),
          tool_ids: i.toolIds,
          built_in_tools: {
            end_call: { type: 'system', name: 'end_call', description: 'End the call when it is finished.', params: { system_tool_type: 'end_call' } },
            voicemail_detection: { type: 'system', name: 'voicemail_detection', description: 'If a voicemail or answering machine answers, end the call at once without leaving a message.', params: { system_tool_type: 'voicemail_detection', voicemail_message: '' } },
          },
        },
      },
      tts: { voice_id: i.voiceId, model_id: VOICE.agentModelId, stability: VOICE.stability, similarity_boost: VOICE.similarityBoost },
      conversation: { max_duration_seconds: i.maxCallSeconds },
    },
    platform_settings: {
      overrides: { conversation_config_override: { agent: { first_message: true } } },
      data_collection: {
        member_unhappy: { type: 'boolean', description: 'True if the caller seemed unhappy with an answer: said it was not what they asked, or asked the same question twice.' },
      },
      privacy: { retention_days: i.retentionDays },
    },
  };
}
