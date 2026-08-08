# Tasks: Env Quote Hygiene — normalize all `.env` reads

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450–580 total (Slice 1: ~200–260 · Slice 2: ~80–120 · Slice 3: ~150–200) |
| 400-line budget risk | Low (per review slice — chain keeps each PR under budget) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (config core) → PR 2 (nested consumers) → PR 3 (docs + E2E) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Config core: env-utils.js + createConfig normalization + config.test.js | PR 1 | `node --test tests/config.test.js` | N/A — pure unit (createConfig is synchronous) | Revert env-utils.js + index.js + config.test.js; re-export keeps admin.js API stable |
| 2 | Nested consumers: settings.js, translator.js, server.js aiBot wiring | PR 2 | `node --test tests/settings.test.js tests/translator-adapters.test.js tests/config.test.js` | Real boot via existing api.test.js + boot-without-token.test.js (server.js wiring) | Revert 3 files; old SETTINGS_KEY derivation restored — no disk re-encryption ever |
| 3 | Docs polish + quoted-env boot E2E + package.json entry | PR 3 | `node --test tests/quoted-env-boot.test.js` | Real server boot on PORT 3100 with fully-quoted env (api.test.js pattern, telegraf mock, DB_PATH `:memory:`) | Delete test file + package.json line; .env.example revert is cosmetic |

## Phase 1 — Slice 1: Config Core (PR 1)

- [x] 1.1 **RED** `tests/config.test.js` — parseEnvBoolean unit cases (quoted `"false"`/`"true"`, `'1'`/`'yes'`, empty→fallback, unknown→fallback) + quoted createConfig cases: COOKIE_SAME_SITE `"strict"`, ADMIN_LANGUAGE `"en"`, WIDGET_* visuals, WIDGET_API_KEY, REDIS_URL/PREFIX, UPLOAD_DIR, ALLOWED_ORIGINS + ALLOWED_IMAGE_TYPES (CSV), REDIS_ENABLED `"false"` + unset platform default, FEATURE_* `"false"`, BOT_NOTIFY_ADMIN `"true"`, OPENAI_MAX_TOKENS `"300"` / BOT_CONFIDENCE_THRESHOLD `"0.6"` (spec R1-S1..S4, R2-S5/S6, R3-S7..S10, R4-S11/S12, R6-S15) — verify `node --test tests/config.test.js` (RED) — rollback: revert test additions only
- [x] 1.2 **GREEN** `src/config/env-utils.js` (NEW) + `src/config/index.js` — create env-utils.js: moved stripEnvQuotes (index.js L39-41), new parseEnvBoolean, parseCsv per-item strip, moved parseInteger; zero requires (ADR-4); normalize ~14 items in createConfig(): string/path strip (COOKIE_SAME_SITE L80/L117, ADMIN_LANGUAGE L88, WIDGET_* L107-110, REDIS_URL/PREFIX L121-122, UPLOAD_DIR L134), CSV per-item (ALLOWED_ORIGINS L81-84, ALLOWED_IMAGE_TYPES L136), parseEnvBoolean (features L139-143 w/ legacy fallback, REDIS_ENABLED L123 platform default — NOT flattened, BOT_NOTIFY_ADMIN single read); new config.aiBot block (BOT_MODE `|| 'disabled'` KEPT, openaiKey, model, maxTokens parseInteger, systemPrompt, confidenceThreshold parseFloat, contextMessages parseInteger); re-export stripEnvQuotes (admin.js L14 + config.test.js L6 unchanged) — verify `node --test tests/config.test.js` (GREEN) — rollback: revert index.js + delete env-utils.js
- [x] 1.3 **VERIFY** — keep existing 7 stripEnvQuotes + 3 createConfig tests green; `npm test` (explicit list — package.json untouched for slice 1) + `npx biome check .` — rollback: none — slice 1 self-contained

## Phase 2 — Slice 2: Nested Consumers (PR 2)

- [x] 2.1 **RED** `tests/settings.test.js` + `tests/translator-adapters.test.js` — resolveSettingsKey quoted cases: quoted 64-hex → hex buffer WITHOUT quotes (A1), quoted non-hex `"my-secret"` → sha256(stripped) (A2); translator quoted cases: TRANSLATION_PROVIDER `"deepl"` honored + TRANSLATION_API_KEY `"k123"` + DEEPL_API_URL quoted (R5-S13) — verify `node --test tests/settings.test.js tests/translator-adapters.test.js` (RED) — rollback: revert test additions only
- [x] 2.2 **GREEN** `src/services/settings.js` + `src/services/translator.js` + `server.js` — resolveSettingsKey L10-17: strip SETTINGS_KEY (env or opts) via stripEnvQuotes before trim/hex/sha256, no dual-key path (ADR-2); translator.js L20/L23/L52: import stripEnvQuotes from `../config/env-utils` (no cycle — ADR-4); server.js L89-100: `aiBot.init({ ...config.aiBot, notifyAdmin: config.features.botNotifyAdmin, kbPath, logger })`, remove raw BOT_NOTIFY_ADMIN read (L97) — verify `node --test tests/settings.test.js tests/translator-adapters.test.js` (GREEN) — rollback: revert 3 files — restores old derivation, no re-encryption
- [x] 2.3 **REFACTOR/VERIFY** `server.js` L551-553 + full suite — enhance boot warning to instruct one-time LLM-secret re-entry (A4: warn, boot continues, never throws); `npm test` + `npx biome check .` — rollback: revert warning text only

## Phase 3 — Slice 3: Docs + E2E (PR 3)

- [x] 3.1 **RED** `tests/quoted-env-boot.test.js` (NEW) + `package.json` — boot server with fully-quoted env (api.test.js pattern, telegraf mock, DB_PATH `:memory:`, PORT 3100 — api.test.js uses 3099); assert `/health` features false, CORS ok, config-normalized values, upload 200, REDIS_ENABLED false → redis disabled; if SETTINGS_KEY present in `.env`, use fresh temp data dir / env override; add 1 line to package.json explicit test list — verify `node --test tests/quoted-env-boot.test.js` (RED — no entry yet) — rollback: delete test file + package.json line
- [x] 3.2 **GREEN** — fix any boot wiring surfaced by the E2E (expect green from slices 1-2; proves full quoted-env path end-to-end: CORS, widget auth, uploads, features, aiBot) — verify `node --test tests/quoted-env-boot.test.js` (GREEN) — rollback: revert wiring fixes
- [x] 3.3 **DOCS** `.env.example` — polish L13-14 quote-convention wording only (values may be quoted/unquoted, surrounding quotes/whitespace stripped at load); do NOT re-add legacy BOT_*/OPENAI_*/visual WIDGET_* (ADR-10; setup-installer.test.js L119-135 guardrail enforces absence, L137-142 keeps bootstrap keys) — verify `node --test tests/setup-installer.test.js` + `npm test && npx biome check .` — rollback: revert .env.example wording (cosmetic)
