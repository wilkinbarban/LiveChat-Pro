# Delta for master-prompt

Admin-editable master prompt that defines the bot's response matrix and behavior, injected as the LLM system prompt. Replaces env `BOT_SYSTEM_PROMPT` and the kb-trainer fixed entries.

## ADDED Requirements

### Requirement: Editable Master Prompt

The system MUST persist an admin-editable master prompt containing the response matrix and model behavior instructions. The master prompt SHALL be injected as the system prompt on every LLM call, combined with retrieved RAG context. Updates MUST take effect at runtime without restart.

#### Scenario: Edit applies to next reply

- GIVEN an authenticated admin
- WHEN the admin edits the master prompt to add "always answer in the visitor's language" and saves
- THEN the next `getReply` call SHALL include the updated text as the system prompt
- AND no process restart SHALL be required

#### Scenario: Unauthenticated edit rejected

- GIVEN a request without a valid admin session
- WHEN it attempts to update the master prompt
- THEN the system MUST reject it with 401/403

### Requirement: Identity Answers Ported from Fixed Entries

The identity answers currently served by kb-trainer `fixed-entries.js` (protected `lcp-bot-*` entries in 6 languages) MUST be ported into the master prompt module so identity questions keep working after kb-trainer removal.

#### Scenario: Identity question answered after kb-trainer removal

- GIVEN kb-trainer and `data/knowledge-base.json` removed and migration completed
- WHEN a visitor asks "who are you?" (or the equivalent in a supported language)
- THEN the bot SHALL answer with the ported identity content
- AND the answer MUST NOT depend on any kb-trainer file

### Requirement: Safe Default Prompt

If no master prompt has been saved, the system MUST fall back to a safe built-in default system prompt rather than failing or sending an empty system message.

#### Scenario: Boot with no saved prompt

- GIVEN a fresh install with an empty settings store
- WHEN the first visitor message triggers `getReply`
- THEN the LLM call SHALL use the built-in default system prompt
