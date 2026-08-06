# Proposal: LLM RAG Overhaul

## Why

The AI bot is OpenAI-only, env-configured (restart-required), and trained via a CLI JSON workflow (kb-trainer). The admin panel has no settings persistence, no Telegram/theme management, and widgets can't be re-themed live. Tooling has real risks: two test files excluded from `npm test`, a contradictory Node version story, and no linter. This change makes AI provider, knowledge, prompt, Telegram, and themes admin-managed at runtime — and fixes the tooling risks first.

## Decisions (recommended — pending user confirmation at plan review)

| # | Decision | Recommendation | Rationale |
|---|----------|----------------|-----------|
| a | RAG retrieval | **Hybrid**: lexical now (reuse ai-bot stemmer/Dice), embeddings-ready interface | Zero new external calls/deps; ships fast; interface allows embeddings later |
| b | Node versions | **engines `>=22`, CI `[22, 24]`**, Docker stays `node:24` | Matches verified env (v22.23.1, 98/98 green); `node:sqlite` present in 22 |
| c | KB migration | **Import** `data/knowledge-base.json` entries as RAG documents via one-time script; port `fixed-entries.js` identity answers into master prompt module | Preserves 474KB production KB; keeps identity answers working |
| d | Telegram token | **Keep env-bootstrap**; UI manages status/start/stop/admin-id, not the token | Token is the admin-cookie HMAC secret; UI rotation would invalidate sessions and boot hard-fails without it |
| e | Linter | **Biome** (single tool) | One dependency, no eslint/prettier config conflicts, CommonJS/no-build friendly |

## What Changes

- **Risk fixes**: add `telegram-routing` + `translation-cache` tests to `npm test`; align Node versions (decision b); add Biome lint/format.
- **Settings persistence**: new `settings` KV table + `rag_documents`/`rag_chunks` (existing CREATE/ALTER pattern); runtime `configure()` re-init — no restarts.
- **Multi-provider LLM**: `src/services/llm/` adapter registry — `openai` pkg + `baseURL` covers OpenAI/OpenRouter/DeepSeek/Kimi/Qwen; native fetch adapter for Anthropic (protocol code from kb-trainer). One default model; others selectable. Admin UI: API key with connection verification; global AI on/off switch.
- **RAG knowledge**: admin module ingests URLs (reuse fetcher/stripHtml) + PDFs (new admin-only endpoint, `%PDF-` magic bytes, 5 MB, new PDF dep). Retrieval (decision a) feeds the LLM context. **Replaces kb-trainer JSON training entirely.**
- **Master prompt**: admin module storing response matrix + model behavior, injected as system prompt.
- **Telegram admin module**: UI for status/config/start-stop (decision d); replies + Spanish translation unchanged.
- **Themes**: server catalog (light + dark variants) as CSS-var maps; admin selects; live push via new socket event to loaded widgets; keep `auto` host-sampling.
- **Installer/hygiene**: strip obsolete env keys (OPENAI_*, BOT_*, WIDGET_*) from setup.js keeping old-.env re-runs safe; remove dead code (scratch/, kb-trainer, HELP_TOPICS, duplicated resolver); rebuild Dockerfile/compose (daemon unavailable — plan task).

## Non-Goals

- Visitor attachment allowlist unchanged (no PDF for visitors).
- No multi-admin accounts or roles.
- No embedding-based retrieval in v1 (interface only).
- Regression boundary untouched: Telegram translation, visitor-language delivery, image attachments, script installer, sentiment/geo/sessions/cluster-state/widget responsiveness.

## Capabilities

### New
- `llm-providers`, `rag-knowledge`, `master-prompt`, `telegram-admin`, `theme-catalog`, `admin-settings`

### Modified
- None (`openspec/specs/` is empty)

## Impact

| Area | Impact |
|------|--------|
| `src/services/ai-bot.js` | Modified — stable `isEnabled()`/`getReply()` contract; LLM+RAG wiring |
| `src/services/llm/`, `src/services/rag/` | New |
| `src/routes/admin.js`, `public/admin.html` | Modified — new modules, `requireAdmin`+`requireCsrf`, data-i18n |
| `src/telegram/bot.js`, `widget.js` | Modified — admin control; theme socket listener |
| `kb-trainer/`, `data/knowledge-base.json` | Removed (after migration) |
| `package.json`, CI, `setup.js`, `Dockerfile` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking bot contract used by sockets+telegram | Med | Keep signatures; extend tests |
| Losing production KB content | Med | Migration script + backup before drop |
| High-priority sentiment bypass regression | Low | Dedicated test |

## Rollback Plan

All behavior behind settings DB rows: revert = disable AI globally (admin switch) or restore env `BOT_MODE=knowledge-base` path kept until archive. kb-trainer removal is the final task — `git revert` restores it; `data/knowledge-base.json` backed up before migration. Theme/LLM/RAG features are additive and independently toggleable.

## Success Criteria

- [ ] `npm test` runs all 11 files green; lint clean; engines/CI/Docker consistent
- [ ] 6 providers configurable with key verification; AI on/off works without restart
- [ ] RAG answers from ingested URL+PDF content; kb-trainer deleted; KB migrated
- [ ] Master prompt editable; themes apply live; Telegram manageable from UI
- [ ] All regression-boundary behaviors pass existing tests
