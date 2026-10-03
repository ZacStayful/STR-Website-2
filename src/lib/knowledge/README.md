# Stayful Intelligence knowledge (Batch 24)

The one source of what Stayful Intelligence may say about the service: on the
chips in the Stayful Intelligence view, on calls, and (Batch 26) in the chat.
Every answer is approved by Zac before any member can get it, and every
figure in it is a `{placeholder}` read from the settings when it is shown.

## The rules

- **Only approved answers reach members.** Members' code reads the view
  `si_knowledge_live` (live columns only), through the functions below. A
  draft (`si_knowledge.draft`, pending or rejected) is never read outside
  admin. Never select from `si_knowledge` in member-facing code.
- **No typed figures.** A price, count, hours, days or percentage is a
  placeholder (`placeholders.ts`). Approval refuses a typed figure
  (`figures.ts`), an unknown placeholder, one that doesn't resolve now, and a
  member's own value on an answer allowed on calls.
- **A change to a feature, price, limit or rule** adds or updates the
  matching drafts in `seed.ts` (see `CLAUDE.md`), and `service-facts.ts`
  when the nightly job should know.
- **Facts about a member are saved only after they say yes**, never on a
  sensitive topic (`facts-rules.ts`), and the member can see and delete them
  in Account.
- **Every number** is in `config.ts` or a `billing_settings` row
  (`settings.ts`, edited on `/admin/intelligence/knowledge` and `/gaps`).

## For Batches 25 and 26

Server-only unless marked pure. `channel` is `'view' | 'call' | 'chat'`.

| Function | File | What it does |
|---|---|---|
| `liveEntries(channel?)` | `store-server.ts` | The approved, live entries (templates, not rendered), optionally only those allowed on a channel. `null` when they can't be read: show nothing. |
| `renderLive(channel, member)` | `store-server.ts` | Every live entry on a channel, rendered for this member (`MemberValues`, or `null` for anyone). Entries that don't apply, need a member value you didn't give, or no longer resolve are left out. Writes nothing. |
| `answerBySlug(slug, { channel, member })` | `store-server.ts` | One approved answer, rendered now, or `null`. |
| `matchKnowledge(entries, question, { answerMin, lowMin, channel, limit })` | `match.ts` (pure) | The best live entries for a typed or spoken question, each with a confidence (0–1) and the phrasing that matched, and an outcome: `answered` (at or above `answerMin` and clearly ahead of the next), `low_confidence` (from `lowMin`), or `could_not_answer`. Pass `liveEntries(channel)` and the thresholds from `readKnowledgeSettings()` (`answerMinConfidence`, `lowConfidenceMin`). Render the match with `renderEntry` before showing it. |
| `rememberFact({ userId, fact, asked, confirmed: true, channel, confirmedVia, conversationId })` | `facts-server.ts` | Saves a fact the member said yes to. Refuses `not_confirmed`, `sensitive`, `personal_details`, `too_long`, `duplicate` and `cap` (`si_facts_max`); say so to the member and save nothing. Records `si_fact_confirmed` (record-only). |
| `rememberedFactsFor(userId)` | `facts-server.ts` | The member's own facts, newest first. Never another member's. |

Log every question the chat answers, or can't, to `si_conversation_questions`
with the slug used as `knowledge_ref` and the outcome: that is what Coverage
counts and what the nightly job learns from. (The `'chat'` question source is
R2-87's.)

## What runs when

- **Approve / retire on admin** puts the change live at once; a call answer
  re-syncs the phone agent's prompt in the background (`agent-server.ts`).
  Figures on calls are ElevenLabs variables (`{{k_<name>}}`), sent with every
  call, so a price change reaches the next call with no sync.
- **The nightly job** (`gap/run.ts`, `/api/internal/si-knowledge`, 02:50
  UTC; off until `SI_GAP_JOB_ENABLED=true`; `?dry=1` always works): marks
  answers that no longer resolve as stale (hidden until re-approved),
  re-syncs the agent if it is behind, groups the questions it couldn't answer
  (Haiku 4.5), drafts answers (Sonnet 5.5) for Zac, sends the Monday email
  and deletes questions past retention. House spend, inside
  `si_gap_monthly_cap_pence`.
