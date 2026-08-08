# Proposal: Env Quote Hygiene — normalize all `.env` reads (setup.js JSON-quote fix)

## Intent

setup.js writes every `.env` value JSON-quoted (documented at .env.example L13-14), but only a few reads strip quotes. 13 scoped vars + 2 same-class bugs read raw `process.env`, so quoted values silently break or invert behavior: CORS dies, widget embeds and uploads reject, features get forced ON (translation/geolocation), REDIS_ENABLED flips. Fix: reuse existing `stripEnvQuotes()` (src/config/index.js L39-41) plus a new `parseEnvBoolean()` at the single normalization point `createConfig()`, and in the 3 nested consumers. setup.js stays untouched (ADR-10).

## Scope

### In Scope
- Normalize every raw env read in `src/config/index.js` (strip / boolean-parse / csv per-item)
- New `parseEnvBoolean(value, fallback)` helper; `parseCsv` per-item quote strip
- Nested consumers: settings.js `SETTINGS_KEY`, translator.js 3 vars, server.js aiBot legacy block → `config.aiBot`
- .env.example wording polish only (convention already documented)
- 3 stacked slices (auto-chain; each well under 400 lines)

### Out of Scope
- `DB_PATH` (db.js test-only override, never setup-written)
- setup.js / .env.example key changes (ADR-10: legacy `BOT_*/OPENAI_*/WIDGET_*` stay absent)
- Dual-key SETTINGS_KEY backward compat (unless user opts in, decision a)
- Windows-specific behavior beyond REDIS_ENABLED default

## Capabilities

### New
- `env-normalization`: quote/whitespace stripping, CSV per-item strip, and boolean parsing contract for every `process.env` read in `src/` (config core + nested consumers)

### Modified
- `admin-settings`: delta requirement — `SETTINGS_KEY` quote-strip changes AES key derivation once; document boot warning + one-time LLM-secret re-entry
- Not modified: `tooling-hygiene` (setup.js/.env.example untouched; guardrail test stays green)

## Approach

Centralize in `createConfig()` (exploration approach 1): `parseEnvBoolean('"false"', fallback)` → false, `''` → fallback, `'true'/'1'/'yes'` → true. REDIS_ENABLED fallback encodes platform default `process.platform !== 'win32'` — do NOT flatten to false. Consolidate BOT_NOTIFY_ADMIN (currently read raw in config L143 AND server.js L97) into `config.features.botNotifyAdmin` → `aiBot.notifyAdmin`; keep `|| 'disabled'` for BOT_MODE. Move aiBot env into a testable `config.aiBot` block. Slices: (1) config core + config.test.js; (2) nested consumers + settings/translator tests; (3) .env.example polish + fully-quoted-env boot E2E.

## Target variables

| Category | Vars | Fix |
|---|---|---|
| string-strip (8) | WIDGET_API_KEY, ADMIN_LANGUAGE, WIDGET_BUTTON_STYLE, WIDGET_PRIMARY_COLOR, WIDGET_WELCOME_MESSAGE, REDIS_URL, REDIS_KEY_PREFIX, COOKIE_SAME_SITE (bonus) | `stripEnvQuotes` before use |
| path-strip (1) | UPLOAD_DIR | `stripEnvQuotes` (uploads land in `"data/uploads"` today) |
| boolean-parse (6) | REDIS_ENABLED, FEATURE_TRANSLATION, FEATURE_SENTIMENT, FEATURE_GHOST_TYPING, FEATURE_GEOLOCATION, BOT_NOTIFY_ADMIN | `parseEnvBoolean(value, fallback)` |
| csv-strip (2) | ALLOWED_ORIGINS, ALLOWED_IMAGE_TYPES (bonus) | per-item strip in `parseCsv` |
| nested-consumer (3 sites) | SETTINGS_KEY; TRANSLATION_PROVIDER, TRANSLATION_API_KEY, DEEPL_API_URL; aiBot block (BOT_MODE, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MAX_TOKENS, BOT_SYSTEM_PROMPT, BOT_CONFIDENCE_THRESHOLD, BOT_CONTEXT_MESSAGES, BOT_NOTIFY_ADMIN) | import `stripEnvQuotes` / `config.aiBot` |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| src/config/index.js | Modified | strips + parseEnvBoolean + parseCsv per-item + `aiBot` block |
| src/services/settings.js | Modified | SETTINGS_KEY strip before regex/sha256 |
| src/services/translator.js | Modified | strip 3 env reads |
| server.js | Modified | `aiBot.init(config.aiBot)`; notifyAdmin from config |
| tests/config.test.js, settings.test.js, translator-adapters.test.js | Modified | quoted-value cases |
| tests/e2e boot test | New | fully-quoted .env → health/config-public/socket/uploads clean |
| .env.example | Modified | wording polish only |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| SETTINGS_KEY breaking: quoted deployments lose decrypt (key = sha256 of quoted string today) | High | Boot warn exists (server.js L542-553); document one-time re-entry; no dual-key (decision a) |
| REDIS_ENABLED default flip (unset ≠ false) | Med | fallback encodes platform default; test quoted true/false + unset |
| BOT_MODE empty string enables bot | Low | keep `\|\| 'disabled'` |
| Legacy vars re-added to setup/.env.example | Low | normalize reads only; setup-installer.test.js guardrail |
| parseCsv strip leaks to other consumers | Low | only 2 consumers; fallback semantics preserved |

## Rollback Plan

Revert slices in reverse order; each slice is self-contained and lands separately. No DB migration and no re-encryption ever happens — reverting settings.js/config restores the old key derivation, so previously encrypted settings decrypt again. Docs change is cosmetic.

## Dependencies

None external. `stripEnvQuotes` already exists; no circular imports (config requires only dotenv/fs/path).

## Decisions for Plan Review

1. **(a) SETTINGS_KEY breaking-change handling** — recommended: strip + document one-time secret re-entry, NO dual-key compat. Simplest and most secure; dual-key "try both" adds code and a key-confusion surface for a minority (setup.js-generated quoted) configs.
2. **(b) WIDGET_* visual legacy vars** — keep normalized-read-only (yes per ADR-10 guardrail); never re-add to setup/.env.example.
3. **(c) Include 2 bonus vars** — recommended YES: same bug class; ALLOWED_IMAGE_TYPES quoted list → 415 on ALL uploads (actively broken), COOKIE_SAME_SITE quoted "strict" silently downgrades to lax.

## Success Criteria

- [ ] Fully-quoted .env (setup.js output): `/health` features `false` stay false; `/config-public` visuals clean; widget socket auth + uploads OK
- [ ] ALLOWED_ORIGINS quoted → CORS works; WIDGET_API_KEY quoted → embeds validate (repair)
- [ ] REDIS_ENABLED: quoted "false" → disabled; unset → true non-Win / false Win
- [ ] SETTINGS_KEY quoted 64-hex → hex buffer; migration warning documented
- [ ] aiBot legacy vars (quoted) parsed correctly; setup-installer.test.js still green
