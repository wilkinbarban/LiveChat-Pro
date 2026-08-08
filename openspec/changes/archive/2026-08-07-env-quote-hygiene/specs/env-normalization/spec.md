# Env Normalization Specification

## Purpose

Normalization contract for every `process.env` read in `src/`: quote/whitespace stripping, CSV per-item stripping, boolean parsing with fallbacks. `setup.js` writes `.env` values JSON-quoted, so raw reads silently break or invert behavior (CORS, widget auth, uploads, features, Redis).

## Requirements

### Requirement: String Env Values Quote-Normalized

The system MUST strip surrounding `"`/`'` quotes and whitespace from every string-typed env read before use: `WIDGET_API_KEY`, `ADMIN_LANGUAGE`, `WIDGET_BUTTON_STYLE`, `WIDGET_PRIMARY_COLOR`, `WIDGET_WELCOME_MESSAGE`, `COOKIE_SAME_SITE`, `REDIS_URL`, `REDIS_KEY_PREFIX`, `UPLOAD_DIR`. Stripping MUST reuse `stripEnvQuotes`.

#### Scenario: Quoted WIDGET_API_KEY enables embed auth

- GIVEN `WIDGET_API_KEY="lcp_widget_key_123"`
- WHEN `createConfig()` builds `config.widget.apiKey`
- THEN the value SHALL be `lcp_widget_key_123`
- AND embed auth SHALL succeed

#### Scenario: Quoted ADMIN_LANGUAGE resolves to a valid locale

- GIVEN `ADMIN_LANGUAGE="en"`
- WHEN `createConfig()` normalizes `config.admin.language`
- THEN it SHALL be `en` (not default `es`)

#### Scenario: Quoted COOKIE_SAME_SITE stays strict

- GIVEN `COOKIE_SAME_SITE="strict"`
- WHEN `createConfig()` builds `config.admin.cookieSameSite`
- THEN it SHALL be `strict` (not downgraded to `lax`)

#### Scenario: Quoted UPLOAD_DIR resolves correctly

- GIVEN `UPLOAD_DIR="/data/uploads"`
- WHEN `createConfig()` builds `config.uploads.dir`
- THEN it SHALL be `/data/uploads` without quotes

### Requirement: CSV Env Values Per-Item Normalized

The system MUST split `ALLOWED_ORIGINS` and `ALLOWED_IMAGE_TYPES` on commas AND strip quotes/whitespace from each item.

#### Scenario: Quoted ALLOWED_ORIGINS restores CORS

- GIVEN `ALLOWED_ORIGINS='["https://chat.example.com"]'`
- WHEN `createConfig()` builds `config.server.corsOptions`
- THEN the origin list SHALL contain `https://chat.example.com` unquoted
- AND CORS SHALL allow that origin

#### Scenario: Quoted ALLOWED_IMAGE_TYPES accepts uploads

- GIVEN `ALLOWED_IMAGE_TYPES='["image/jpeg","image/png"]'`
- WHEN an upload of type `image/png` is validated
- THEN it SHALL be accepted (no 415)

### Requirement: Boolean Env Values Parsed with Fallback

The system MUST parse booleans via `parseEnvBoolean(value, fallback)`: `'true'/'1'/'yes'` → true, `'false'/'0'/'no'` → false, empty → fallback. Applies to `REDIS_ENABLED`, `FEATURE_TRANSLATION`, `FEATURE_SENTIMENT`, `FEATURE_GHOST_TYPING`, `FEATURE_GEOLOCATION`, `BOT_NOTIFY_ADMIN`. `REDIS_ENABLED` fallback MUST keep the platform default.

#### Scenario: Quoted REDIS_ENABLED "false" disables Redis

- GIVEN `REDIS_ENABLED="false"` on non-Windows
- WHEN `createConfig()` builds `config.redis.enabled`
- THEN it SHALL be `false` (not inverted to enabled)

#### Scenario: Unset REDIS_ENABLED uses the platform default

- GIVEN `REDIS_ENABLED` unset
- WHEN `createConfig()` builds `config.redis.enabled`
- THEN it SHALL be `true` non-Windows, `false` Windows

#### Scenario: Quoted FEATURE_TRANSLATION "false" keeps the feature off

- GIVEN `FEATURE_TRANSLATION="false"`
- WHEN `createConfig()` builds `config.features.translation`
- THEN it SHALL be `false` (not forced on)

#### Scenario: Quoted BOT_NOTIFY_ADMIN "true" enables notifications

- GIVEN `BOT_NOTIFY_ADMIN="true"`
- WHEN `createConfig()` builds `config.features.botNotifyAdmin`
- THEN it SHALL be `true` (inverted-failure fixed)

### Requirement: aiBot Legacy Env Consolidated in config.aiBot

The system MUST expose a normalized `config.aiBot` block from legacy env vars (`BOT_MODE`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_TOKENS`, `BOT_SYSTEM_PROMPT`, `BOT_CONFIDENCE_THRESHOLD`, `BOT_CONTEXT_MESSAGES`). `server.js` MUST call `aiBot.init(config.aiBot)` instead of reading `process.env`. `BOT_MODE` MUST keep `|| 'disabled'` semantics. `BOT_NOTIFY_ADMIN` MUST be read once from `config.features.botNotifyAdmin` → `aiBot.notifyAdmin`.

#### Scenario: BOT_MODE semantics preserved

- GIVEN `BOT_MODE` unset or empty
- WHEN `aiBot.init(config.aiBot)` runs
- THEN `mode` SHALL be `'disabled'`

#### Scenario: Quoted aiBot numeric vars parse correctly

- GIVEN `OPENAI_MAX_TOKENS="300"` and `BOT_CONFIDENCE_THRESHOLD="0.6"`
- WHEN `config.aiBot` is built
- THEN `maxTokens` SHALL be `300` and `confidenceThreshold` SHALL be `0.6`

### Requirement: Nested Consumer Env Reads Normalized

`src/services/translator.js` MUST strip quotes from `TRANSLATION_PROVIDER`, `TRANSLATION_API_KEY`, `DEEPL_API_URL` before use, without circular dependencies.

#### Scenario: Quoted TRANSLATION_PROVIDER is honored

- GIVEN `TRANSLATION_PROVIDER="deepl"` and `TRANSLATION_API_KEY="k123"`
- WHEN the translation service selects a provider
- THEN `deepl` SHALL be honored (not falling back to `google_free`)
- AND the key SHALL be `k123`

### Requirement: Normalization Is Read-Only for Legacy Vars

The system MUST normalize legacy `WIDGET_*` reads (`WIDGET_BUTTON_STYLE`, `WIDGET_PRIMARY_COLOR`, `WIDGET_WELCOME_MESSAGE`) at read time ONLY. `setup.js` and `.env.example` MUST NOT be re-extended with legacy `BOT_*`, `OPENAI_*`, or visual `WIDGET_*` keys (ADR-10 guardrail).

#### Scenario: Installer guardrail stays green

- GIVEN the normalization change is implemented
- WHEN `tests/setup-installer.test.js` runs
- THEN legacy vars SHALL remain absent from the generated `.env` and `.env.example`

#### Scenario: Quoted WIDGET_* visuals render clean

- GIVEN `WIDGET_BUTTON_STYLE="hidden"`, `WIDGET_PRIMARY_COLOR="#112233"`
- WHEN `createConfig()` builds `config.widget`
- THEN values SHALL be unquoted (`hidden`, `#112233`)
