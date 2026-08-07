# Tasks: LLM RAG Overhaul

Execution mode: auto · delivery_strategy: auto-chain (chain_strategy pending — slices are strategy-agnostic) · review_budget: 400 changed lines/PR.

Conventions for every group:
- **TDD (config: apply.tdd=true, test_command=`npm test`)**: write the named RED tests first, watch them fail, then implement to GREEN.
- Verification for each group: `npm test` (all files) + `npx biome check .` (after Group 1 lands Biome).
- Each task is completable in one session. Hierarchical numbering, grouped by design phase (design.md §Migration/Rollout).

Gate notes (carried from prior phases — apply MUST honor):
- **HELP_TOPICS gate**: before deleting `HELP_TOPICS` (`src/sockets/index.js` ~L32/L227), grep the test suite (`rg -n "HELP_TOPICS" tests/`) and confirm no test asserts on it. If one does, update the test in the same commit.
- **Resolver gate**: before removing the duplicated `resolveTelegramReplySessionId` (server.js:484-490), check `tests/telegram-routing.test.js` imports; keep a re-export from `src/telegram/bot.js` only if the test needs the symbol.
- **Theme emit gate**: verify in `src/sockets/index.js` which namespace/rooms widgets actually join (default namespace, `session:{id}` rooms) before wiring `theme:update` — use a namespace-level emit, not room-scoped (ADR-7 note).

---

## Phase 1 — Tooling hygiene (lands first, de-risks everything)

### 1.1 Full test suite in `npm test`
**Objective**: all 11 test files run under `npm test`; the run fails if a file is dropped.
- [x] 1.1.1 RED: add/extend a meta-check (or script assertion) proving `tests/telegram-routing.test.js` and `tests/translation-cache.test.js` are included — e.g. `tests/test-script.test.js` asserting the npm `test` script enumerates all `tests/*.test.js` files.
- [x] 1.1.2 GREEN: update `package.json` `test` script to run all 11 files; fix any newly-exposed failures in the two added files without weakening assertions.
Files: `package.json`, `tests/test-script.test.js` (new), possibly the two re-included test files.
Tests first: `tests/test-script.test.js`.
Verify: `npm test` — 11 files green.
Rollback boundary: revert `package.json` script + delete `tests/test-script.test.js`; no other group depends on it.

### 1.2 Node version alignment
**Objective**: engines/CI/Docker tell one story — engines `>=22`, CI matrix `[22, 24]`, Docker `node:24`.
- [x] 1.2.1 Set `package.json` engines to `node >=22`.
- [x] 1.2.2 Update CI workflow matrix to `[22, 24]`.
- [x] 1.2.3 Confirm Dockerfile base image is `node:24` (change only if drifted).
Files: `package.json`, CI workflow file(s), `Dockerfile`.
Tests first: extend `tests/test-script.test.js` to assert engines `>=22` (parses package.json).
Verify: `npm test` on Node 22; CI green on both matrix legs.
Rollback boundary: three files only; independent.

### 1.3 Biome lint/format
**Objective**: Biome as the single linter/formatter with `lint`/`format` scripts.
- [x] 1.3.1 Add `@biomejs/biome` devDependency + committed `biome.json` (CommonJS/no-build friendly; disable rules that fight the codebase style).
- [x] 1.3.2 Add `lint` and `format` npm scripts.
- [x] 1.3.3 RED→GREEN: run `npx biome check .`; fix violations in minimal, behavior-preserving edits (or add scoped `biome-ignore` with justification comments). Run `npm test` after every fix batch.
Files: `package.json`, `biome.json` (new), any files with lint fixes.
Tests first: N/A (tooling); gate is `npx biome check .` exit code + full `npm test`.
Verify: `npx biome check .` clean; `npm test` green.
Rollback boundary: `biome.json` + package.json scripts/devDep; lint fixes are independent no-op edits.
**Risk note**: lint-fix line count is the wildcard of this slice — if initial `biome check` reports >~60 violating files, stop and re-forecast before fixing.

### 1.4 Installer minimization (setup.js + .env.example)
**Objective**: drop obsolete env keys (`OPENAI_*`, `BOT_*`, widget-visual keys, dead `knowledge-base.json.example` block, `BOT_NOTIFY_ADMIN`), keep bootstrap secrets; legacy re-runs stay safe.
- [x] 1.4.1 RED: `tests/setup-installer.test.js` (new) — run setup.js non-interactively against a legacy `.env` containing `OPENAI_API_KEY`/`BOT_MODE`; assert it completes, does not re-ask obsolete keys, preserves valid values.
- [x] 1.4.2 GREEN: remove `botSec` entirely, `widgetSec` visual keys (keep `WIDGET_API_KEY` per ADR-10), the setup.js:1044-1052 dead copy block; add optional `SETTINGS_KEY`.
- [x] 1.4.3 Update `.env.example`: remove Smart-Bot/kb-trainer/widget-visual sections; document `SETTINGS_KEY`.
Files: `setup.js`, `.env.example`, `tests/setup-installer.test.js` (new).
Tests first: `tests/setup-installer.test.js`.
Verify: `npm test`; manual `npm run setup` smoke on a legacy `.env` copy in a temp dir.
Rollback boundary: `setup.js` + `.env.example` + new test; no runtime path depends on it.

---

## Phase 2 — Settings foundation + LLM providers

### 2.1 Settings KV table + AES-256-GCM secrets
**Objective**: `settings` table (idempotent CREATE pattern), KV read/write service, `v1.<iv>.<tag>.<ct>` encryption helpers, `SETTINGS_KEY` env with `data/.settings-key` (0600) fallback (ADR-1).
- [x] 2.1.1 RED: `tests/settings.test.js` (new) — set/get round-trip, restart persistence (reopen DB), encrypt/decrypt round-trip, wrong-key decryption failure, masked output `…last4`, key never written to logs.
- [x] 2.1.2 GREEN: migration in `db.js` (settings table per design §Data Model); `src/services/settings.js` (`get/set/getJSON/setJSON`, `encryptSecret/decryptSecret`, `maskSecret`).
- [x] 2.1.3 Settings survive restart: load-on-boot path wired in service factory.
Files: `db.js`, `src/services/settings.js` (new), `tests/settings.test.js` (new).
Tests first: `tests/settings.test.js`.
Verify: `npm test`.
Rollback boundary: new service + test + one additive migration; nothing consumes it yet — pure addition.

### 2.2 Boot without TELEGRAM_TOKEN + persisted admin signing secret (ADR-3)
**Objective**: soft token validation; `resolveAdminSigningSecret()` = telegram token else persisted 32-byte hex at `data/.admin-secret` (0600).
- [x] 2.2.1 RED: `tests/boot-without-token.test.js` (new) — server boots with no `TELEGRAM_TOKEN`, serves chat/admin, telegram reports not-configured; cookies survive restart without token; adding a token later invalidates old cookies once (documented behavior).
- [x] 2.2.2 GREEN: downgrade missing-token hard-fail to warning in `src/config/index.js` (admin-ID numeric check only when token present); implement `resolveAdminSigningSecret()` in `src/security/admin-auth.js`.
Files: `src/config/index.js`, `src/security/admin-auth.js`, `tests/boot-without-token.test.js` (new).
Tests first: `tests/boot-without-token.test.js`.
Verify: `npm test`; manual boot with token unset.
Rollback boundary: two modified source files + test; token-present deployments are byte-identical (ADR-3).

### 2.3 text-match extraction (ADR-9 step 1)
**Objective**: extract stem/normalize/Dice from `src/services/ai-bot.js` into `src/services/text-match.js` — pure refactor, zero behavior change.
- [x] 2.3.1 RED: `tests/text-match.test.js` (new) — characterize current stemming/Dice behavior with cases copied from existing ai-bot expectations (including multilingual stems).
- [x] 2.3.2 GREEN: move functions to `text-match.js`; ai-bot imports from it; existing `tests/ai-bot.test.js` stays green untouched.
Files: `src/services/text-match.js` (new), `src/services/ai-bot.js`, `tests/text-match.test.js` (new).
Tests first: `tests/text-match.test.js` + existing `tests/ai-bot.test.js` as regression net.
Verify: `npm test`.
Rollback boundary: single refactor commit; revert restores inline functions.

### 2.4 LLM adapter registry (6 providers)
**Objective**: `src/services/llm/` — registry + shared OpenAI-protocol adapter (OpenAI/OpenRouter/DeepSeek/Kimi/Qwen via `openai` pkg + baseURL) + native Anthropic adapter **ported from `kb-trainer/ai-client.js` lines 183–200 BEFORE any kb-trainer deletion** (ADR-2: `x-api-key`, `anthropic-version: 2023-06-01`, top-level `system`, mandatory `max_tokens`, reply at `data.content[0].text`).
- [x] 2.4.1 RED: `tests/llm-adapters.test.js` (new) — registry rejects unknown provider; each adapter builds correct request (headers/baseURL/body shape) via mock fetch; Anthropic request shape matches the kb-trainer protocol verbatim; error paths fail open (no throw).
- [x] 2.4.2 GREEN: `src/services/llm/{index,openai-compatible,anthropic}.js`; clients cached per provider, rebuilt on `configure()` (ADR-6).
Files: `src/services/llm/index.js`, `openai-compatible.js`, `anthropic.js` (new), `tests/llm-adapters.test.js` (new), `package.json` (openai dep).
Tests first: `tests/llm-adapters.test.js`.
Verify: `npm test`.
Rollback boundary: new `src/services/llm/` dir + test; not yet consumed by ai-bot.
**Note**: this slice may exceed 400 lines with tests — adapters are cohesive and cannot split mid-protocol; flagged in forecast.

### 2.5 AiBot orchestrator + runtime reconfigure
**Objective**: `AiBot` becomes thin orchestrator: master prompt + RAG context → active LLM adapter; atomic `configure()` snapshot swaps (ADR-6); `isEnabled()` reads snapshot (`ai.enabled` && default provider ready), not boot env; stable `getReply(session, text)` → `{reply, confidence, escalate}`; fail-open on provider error; sentiment high-priority bypass preserved.
- [ ] 2.5.1 RED: extend `tests/ai-bot.test.js` — runtime provider switch applies to next `getReply` without restart; `isEnabled()` flips with global switch; provider failure returns escalating/no-reply without crashing; high-priority bypass untouched (dedicated test per proposal risk table).
- [ ] 2.5.2 GREEN: rewire `src/services/ai-bot.js` to llm registry + settings snapshots (RAG context hook present but no-op until Phase 3); keep signatures.
Files: `src/services/ai-bot.js`, `tests/ai-bot.test.js`.
Tests first: extended `tests/ai-bot.test.js`.
Verify: `npm test`; socket flow contract unchanged (regression: `tests/api.test.js`, `tests/telegram-routing.test.js`).
Rollback boundary: ai-bot.js rewiring; `BOT_MODE=knowledge-base` path still present as fallback until Phase 5 (proposal rollback plan).

### 2.6 LLM admin endpoints + AI tab
**Objective**: endpoint inventory rows for AI (GET `/api/admin/llm`, PUT providers/:name with verify-then-save, PUT default, PUT enabled) + AI tab in admin.html.
- [ ] 2.6.1 RED: `tests/admin-llm.test.js` (new) — 401 without admin cookie, 403 without CSRF on mutations; verify→encrypt→save happy path (mock provider 1-token call); 401 from provider leaves config unchanged; unknown provider rejected; masked key only in responses; global on/off honored by `isEnabled()`.
- [ ] 2.6.2 GREEN: routes in `src/routes/admin.js` under `requireAdmin`+`requireCsrf`; AI tab in `public/admin.html` with `data-i18n` keys added to all 5 dictionaries (English fallback), CSP-inline.
Files: `src/routes/admin.js`, `public/admin.html`, `tests/admin-llm.test.js` (new).
Tests first: `tests/admin-llm.test.js`.
Verify: `npm test`.
Rollback boundary: additive routes + tab; disabling AI via switch restores pre-change behavior.

---

## Phase 3 — RAG knowledge + KB migration

### 3.1 RAG core: chunker, url-fetcher port, pdf wrapper, lexical retrieve
**Objective**: `src/services/rag/{index,chunker,url-fetcher,pdf}.js` — chunking ~900 chars/150 overlap on paragraph-sentence boundaries; `fetcher/stripHtml` **ported from kb-trainer** (ADR-9 step 3); `pdfjs-dist@^3.11` legacy CJS wrapper `extractText(buffer)` (ADR-4); lexical retrieve top-4, min score 0.2, ≤1800 chars context, async embeddings-ready interface (ADR-5).
- [ ] 3.1.1 RED: `tests/rag.test.js` (new) — chunker boundaries/overlap; retrieval ranks refund-policy chunks for a refund query (spec scenario); below-threshold returns []; ingest→retrieve round-trip; pdf wrapper extracts text from a small fixture buffer; interface is async (v2-swap-safe).
- [ ] 3.1.2 GREEN: implement the four modules; wire RAG context into AiBot `getReply` (Phase 2 hook) — empty result means master prompt alone, no fabricated citations.
- [ ] 3.1.3 Migration: `rag_documents`/`rag_chunks` tables + index in `db.js` (design §Data Model, `content_hash` UNIQUE, ON DELETE CASCADE).
Files: `src/services/rag/*` (new), `src/services/ai-bot.js`, `db.js`, `tests/rag.test.js` (new), `package.json` (pdfjs-dist pin), small PDF test fixture.
Tests first: `tests/rag.test.js`.
Verify: `npm test`.
Rollback boundary: new rag dir + ai-bot context hook (no-op when no documents); tables additive.

### 3.2 RAG admin endpoints + Knowledge tab
**Objective**: GET/DELETE documents (cascade), POST ingest-url (10s timeout, non-2xx rejected), POST ingest-pdf (multer memory, `%PDF-` magic bytes, 5 MB) — all `requireAdmin`+`requireCsrf`; visitor image-only allowlist untouched.
- [ ] 3.2.1 RED: `tests/admin-rag.test.js` (new) — auth/CSRF negatives; unreachable URL → descriptive error, no partial document; non-PDF bytes rejected regardless of extension/MIME; 6 MB PDF rejected; valid PDF ingested; visitor attachment endpoint still rejects PDFs (regression).
- [ ] 3.2.2 GREEN: routes in `src/routes/admin.js`; Knowledge tab in `public/admin.html` (data-i18n, 5 dictionaries).
Files: `src/routes/admin.js`, `public/admin.html`, `tests/admin-rag.test.js` (new).
Tests first: `tests/admin-rag.test.js`.
Verify: `npm test`.
Rollback boundary: additive routes/tab; documents deletable via endpoint.

### 3.3 KB migration script
**Objective**: `scripts/migrate-kb-to-rag.js` — timestamped backup before import; `content_hash = sha256(kb:id:lang)` idempotent re-run; missing file → "nothing to migrate", exit 0 (ADR-9 step 5, design sequence diagram).
- [ ] 3.3.1 RED: `tests/migrate-kb.test.js` (new) — fixture KB imports fully; backup file created; second run does not increase document counts; missing file exits 0 with message.
- [ ] 3.3.2 GREEN: implement script (CommonJS, run via `node scripts/migrate-kb-to-rag.js`).
Files: `scripts/migrate-kb-to-rag.js` (new), `tests/migrate-kb.test.js` (new), fixture JSON.
Tests first: `tests/migrate-kb.test.js`.
Verify: `npm test`; run script against a copy of production-shaped `data/knowledge-base.json`.
Rollback boundary: script + test only; DB rows removable via DELETE endpoint; `.bak` file preserves source.

---

## Phase 4 — Prompt / Telegram / Themes UI

### 4.1 Master prompt module (ADR-9 step 4)
**Objective**: `src/services/master-prompt.js` — editable prompt persisted in settings (`master_prompt.text`), safe built-in default when unset, **identity answers ported from kb-trainer `fixed-entries.js` (condensed, 6 langs)**; GET/PUT endpoints; Prompt tab; injected as system prompt combined with RAG context.
- [ ] 4.1.1 RED: `tests/master-prompt.test.js` (new) — default fallback on fresh install; edit applies to next `getReply` without restart; 401/403 negatives; identity question ("who are you?", supported langs) answered from ported content with no kb-trainer dependency.
- [ ] 4.1.2 GREEN: service + routes (`requireAdmin`+`requireCsrf` on PUT) + Prompt tab (data-i18n, 5 dictionaries); AiBot consumes prompt service.
Files: `src/services/master-prompt.js` (new), `src/routes/admin.js`, `public/admin.html`, `src/services/ai-bot.js`, `tests/master-prompt.test.js` (new).
Tests first: `tests/master-prompt.test.js`.
Verify: `npm test`.
Rollback boundary: prompt service additive; unset key falls back to built-in default.

### 4.2 Telegram admin module
**Objective**: status/start/stop/admin-id endpoints (token stays env-bootstrap, never displayed — proposal decision d); Telegram tab; runtime control without restart; reply routing + Spanish translation + auto-silence preserved.
- [ ] 4.2.1 RED: `tests/telegram-admin.test.js` (new) — status transitions running/stopped/not-configured; start/stop at runtime with sockets+admin panel unaffected; non-numeric admin ID rejected; token absent from every response body; existing `tests/telegram-routing.test.js` + `tests/translation-cache.test.js` green unchanged.
- [ ] 4.2.2 GREEN: runtime start/stop + settings-driven admin ID in `src/telegram/bot.js`; routes; Telegram tab (data-i18n).
Files: `src/telegram/bot.js`, `src/routes/admin.js`, `public/admin.html`, `tests/telegram-admin.test.js` (new).
Tests first: `tests/telegram-admin.test.js`.
Verify: `npm test`.
Rollback boundary: additive control surface; bot defaults to env-driven behavior.

### 4.3 Theme catalog + live push (ADR-7)
**Objective**: `src/services/themes.js` catalog (`auto`, `classic`, `light-aurora`, `light-mint`, `dark-midnight`, `dark-ember`, full 13-var maps); `theme.active` in settings; GET catalog + PUT active endpoints; `/config-public` gains `theme: {name, vars|null}`; namespace-level `theme:update` emit (**verify widget namespace/room first — gate note**); widget listener applies vars live or re-runs `readSiteTheme()` for `auto`; Appearance tab.
- [ ] 4.3.1 RED: `tests/themes.test.js` (new) — catalog includes ≥1 light + ≥1 dark + auto, each full var map; selection persists across restart; PUT emits `theme:update` on the correct namespace (no-op with zero widgets); `/config-public` shape; auto behavior unchanged (`tests/widget-responsive.test.js` green).
- [ ] 4.3.2 GREEN: service + routes + `/config-public` + emit + `widget.js` `socket.on('theme:update', …)` + Appearance tab (data-i18n).
Files: `src/services/themes.js` (new), `src/routes/admin.js` (+ public config route), `src/sockets/index.js` (wiring only), `widget.js`, `public/admin.html`, `tests/themes.test.js` (new).
Tests first: `tests/themes.test.js`.
Verify: `npm test`; manual two-browser live re-theme smoke (recorded as runtime harness evidence).
Rollback boundary: default `theme.active=auto` reproduces current behavior; additive otherwise.
**Note**: exact var values for the 4 creative themes are a design open question — resolve at apply time and record the tokens in the commit.

---

## Phase 5 — Dead-code audit sweep + kb-trainer deletion

### 5.1 Dead-code audit sweep (own group, near the end)
**Objective**: remove `scratch/`, `HELP_TOPICS` personal content (**grep-gate first**), collapse duplicated `resolveTelegramReplySessionId` to the canonical `src/telegram/bot.js` implementation (**import-gate first**), strip remaining KB code paths from `ai-bot.js` (matchKnowledge/disambiguation/`BOT_MODE=knowledge-base`).
- [ ] 5.1.1 GATE: `rg -n "HELP_TOPICS" tests/` → confirm no assertions; `rg -n "resolveTelegramReplySessionId" tests/ src/` → decide re-export need.
- [ ] 5.1.2 RED: `tests/dead-code.test.js` (new, lightweight) — assert no `require`/`import` of `kb-trainer` or `scratch/` remains in `src/`/`server.js` (static scan); single canonical resolver (exactly one definition).
- [ ] 5.1.3 GREEN: deletions + ai-bot KB-path removal + resolver dedupe (server.js:484-490 removed; re-export from telegram module only if the gate proved it necessary).
Files: `src/sockets/index.js`, `server.js`, `src/telegram/bot.js`, `src/services/ai-bot.js`, `scratch/` (delete), `tests/dead-code.test.js` (new).
Tests first: `tests/dead-code.test.js` + full suite as regression.
Verify: `npm test`; server boots clean.
Rollback boundary: `git revert` of the sweep commit restores all removed code; ai-bot LLM path already proven in Phase 2-4.

### 5.2 kb-trainer deletion (final code step — extraction already done in 2.3/2.4/3.1/4.1/3.3)
**Objective**: delete `kb-trainer/`, `tests/kb-trainer.test.js`, `data/knowledge-base.json` (post-migration, backup exists), setup.js bot remnants if any, Dockerfile `COPY kb-trainer`.
- [ ] 5.2.1 Pre-flight: confirm migration script ran (or run it) and `knowledge-base.<ts>.bak` exists; confirm `rg -n "kb-trainer" src/ server.js setup.js Dockerfile package.json` returns nothing outside deletion targets.
- [ ] 5.2.2 Delete; remove kb-trainer references from `package.json` scripts/deps if present.
- [ ] 5.2.3 Full suite green with kb-trainer.test.js gone (npm test now runs 11+ new files minus kb-trainer).
Files: `kb-trainer/` (delete), `tests/kb-trainer.test.js` (delete), `data/knowledge-base.json` (delete, backed up), `Dockerfile`, `package.json`.
Tests first: N/A (removal); gate is full `npm test` + boot.
Verify: `npm test`; server boots; identity question answered via master prompt (spec scenario).
Rollback boundary: pure deletion commit — `git revert` restores everything; KB content lives in rag tables + `.bak`.

---

## Phase 6 — Docker rebuild (LAST — after everything above)

### 6.1 Dockerfile + docker-compose rebuild and validation
**Objective**: image builds without kb-trainer references, `node:24`, minimized env; container boots with only bootstrap secrets; compose env examples refreshed.
- [ ] 6.1.1 Rebuild Dockerfile/compose per final state.
- [ ] 6.1.2 Validate: `docker build` + `docker compose up` smoke (boot, admin login, widget loads).
- [ ] 6.1.3 **Environment dependency**: Docker daemon is currently unavailable on this machine — this task CANNOT be verified locally. Flag to user; validate on a machine with a daemon or in CI before archive.
Files: `Dockerfile`, `docker-compose.yml`, `.env.example` (final sync).
Tests first: static assertions (no `kb-trainer` string in Dockerfile; base image `node:24`) can ride in `tests/test-script.test.js`.
Verify: `docker build .` succeeds; container boots with bootstrap env only (deferred — daemon).
Rollback boundary: Dockerfile/compose edits only; runtime unaffected.

---

## Review Workload Forecast

Estimated authored changed lines (additions + deletions, lockfile/goldens excluded):

| Slice | Content | Est. lines |
|---|---|---|
| 1 | Tooling hygiene (1.1–1.4) | ~230 (+ lint-fix wildcard, see 1.3) |
| 2 | Settings + crypto + ADR-3 boot (2.1–2.2) | ~420 |
| 3 | text-match + LLM adapters (2.3–2.4) | ~560 |
| 4 | AiBot orchestrator (2.5) | ~300 |
| 5 | LLM endpoints + AI tab (2.6) | ~480 |
| 6 | RAG core (3.1) | ~520 |
| 7 | RAG endpoints + Knowledge tab (3.2) | ~430 |
| 8 | KB migration script (3.3) | ~240 |
| 9 | Master prompt (4.1) | ~400 |
| 10 | Telegram admin (4.2) | ~380 |
| 11 | Themes (4.3) | ~470 |
| 12 | Dead-code sweep (5.1) | ~330 |
| 13 | kb-trainer deletion (5.2) | ~430 (mostly deletions) |
| 14 | Docker rebuild (6.1) | ~60 |
| **Total** | | **~5,250** |

**400-line budget risk: HIGH — Chained PRs recommended: Yes.**

### Chained slice plan (strategy-agnostic — works for stacked-to-main or feature-branch-chain)

14 slices as tabled above; each has clear start/finish, independent verification (`npm test` + `npx biome check .`), and a stated rollback boundary. Merge order = slice order (extraction-before-deletion is load-bearing).

Slices explicitly over budget and why they cannot split cleanly:
- **Slice 3 (~560)**: adapters + their protocol-shape tests are one cohesive unit; splitting mid-adapter would land dead code. Could shave by moving text-match (2.3, ~150) into Slice 2 if reviewer prefers — both stay under 450 either way.
- **Slice 6 (~520)**: chunker+retrieval+pdf must land together for a meaningful RED→GREEN cycle; the pdfjs fixture is small. Acceptable slight overage or request `size:exception`.
- **Slice 13 (~430)**: pure deletions — reviewer load is far lower than the number suggests; recommend keeping as one deletion PR with `size:exception` rationale if challenged.

Dependencies: 2→3→4→5 (settings before adapters before orchestrator before endpoints); 3→6→7 (text-match feeds RAG scoring); 8 after 7 (migration needs rag tables/endpoints); 9–11 independent of each other, all after 2; 12 after 9–11; 13 after 12; 14 last.
