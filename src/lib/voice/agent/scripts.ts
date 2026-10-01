/**
 * Batch 23: what Stayful Intelligence says first on each kind of call, and
 * the call-specific script it follows. The persona (who it is, how it
 * speaks, what it never says) is src/lib/persona — never repeated here.
 *
 * {{first_name}} and the other {{…}} are ElevenLabs dynamic variables, filled
 * per call (src/lib/voice/agent/variables.ts).
 *
 * Pure.
 */

/** The intro call, verbatim from the brief (about 40 seconds). The card is texted before the line that says so. */
export const INTRO_SCRIPT =
  "Hi {{first_name}}, it's Stayful Intelligence, your AI property assistant from Stayful. I'm the one searching thousands of short-let deals for you every day. Quick heads-up on what to expect: I'll only call when there's something worth your time. I'll give you the headline, and I'll text you the link. You can ring me back on this number any time. I've just texted you my contact card — tap it to save me, so you know it's me when I call. Speak soon.";

/** The intro's opener (the first message); the rest of the script follows from the prompt. */
export const INTRO_OPENER = "Hi {{first_name}}, it's Stayful Intelligence, your AI property assistant from Stayful.";

/** The low-credit call: one goal, switch on auto top-up (under 30 seconds). */
export const LOW_CREDIT_SCRIPT =
  "Hi {{first_name}}, it's Stayful Intelligence, your AI property assistant from Stayful. Quick one: your credit's running low, so your daily picks could stop soon. Would you like me to switch on auto top-up? It adds {{topup_amount}} whenever you drop below {{topup_threshold}}, so I never stop searching for you. I can text you a one-tap link now.";

export const LOW_CREDIT_OPENER = "Hi {{first_name}}, it's Stayful Intelligence, your AI property assistant from Stayful. Quick one: your credit's running low, so your daily picks could stop soon.";

export const LOW_CREDIT_YES = "Done — it's on its way. Speak soon.";
export const LOW_CREDIT_NO = 'No problem, you can top up any time in the app. Speak soon.';

/** Callback openers. */
export const CALLBACK_MEMBER_OPENER = 'Hi {{first_name}}, how can I help?';
export const CALLBACK_MISSED_INTRO_OPENER = "Hi {{first_name}}, thanks for ringing back — it's Stayful Intelligence, your AI property assistant from Stayful. I tried to call earlier to introduce myself.";
export const CALLBACK_MISSED_LOW_CREDIT_OPENER = "Hi {{first_name}}, thanks for ringing back — it's Stayful Intelligence from Stayful. I called because your credit's running low.";
export const CALLBACK_UNKNOWN_OPENER = "Hello, you've reached Stayful Intelligence, the AI property assistant from Stayful. How can I help?";

/** Handing off: what the agent says before handoff_to_team. */
export const HANDOFF_LINE = "I'll pass that to the team, they'll email you.";
