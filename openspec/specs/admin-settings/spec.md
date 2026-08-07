# Spec for admin-settings

Settings persistence layer and security/i18n conventions shared by all new admin modules (LLM, RAG, master prompt, Telegram, themes).

## Requirements

### Requirement: Settings KV Persistence

The system MUST persist runtime configuration in a `settings` key-value table created with the existing idempotent CREATE/ALTER migration pattern. Settings MUST survive restarts. Secrets (API keys) SHALL be stored only in this table and MUST NOT be written to logs or returned in full by any endpoint.

#### Scenario: Setting survives restart

- GIVEN the admin saved an LLM provider configuration
- WHEN the server restarts
- THEN the configuration SHALL be loaded from the settings table
- AND the provider SHALL be active without re-entry

### Requirement: Runtime Reconfigure Without Restart

Services consuming settings (bot, Telegram, themes) MUST support runtime re-configuration when settings change, without process restart. Saving a new Telegram token or admin ID while the bot is running MUST stop the old bot instance and restart it with the new credentials. `/health` `telegramReady` MUST reflect the reconfigured state.
(Previously: runtime reconfiguration was required of settings consumers in general; Telegram token reconfigure was not covered.)

#### Scenario: Provider switch applies live

- GIVEN the bot running on OpenAI
- WHEN the admin switches the default to Kimi and saves
- THEN the next `getReply` SHALL use Kimi
- AND the process SHALL NOT restart

#### Scenario: Telegram token reconfigure applies live

- GIVEN the bot running with a stored token
- WHEN the admin saves a new Telegram token
- THEN the running bot instance SHALL stop and a new instance SHALL start with the new token
- AND `/health` SHALL report `telegramReady` reflecting the reconfigured state

### Requirement: Admin Auth and CSRF on All New Endpoints

Every new admin endpoint introduced by this change MUST require both `requireAdmin` and `requireCsrf` middleware, matching the existing admin route security model.

#### Scenario: Missing admin session rejected

- GIVEN a request without a valid `lcp_admin` cookie
- WHEN it calls any new settings/LLM/RAG/theme/Telegram endpoint
- THEN the system MUST respond 401

#### Scenario: Missing CSRF token rejected

- GIVEN an authenticated admin session without a matching `x-csrf-token` header
- WHEN it posts to a new mutating endpoint
- THEN the system MUST respond 403

### Requirement: AI Dashboard Summary Header and Global Toggle

The system MUST render an AI Summary Header at the top of the AI administration tab in `public/admin.html`. The header MUST display global AI operational status (`Bot AI Activado / Desactivado`), active default provider and model badge (e.g. `OpenAI - gpt-4o-mini`), and a quick global AI toggle switch that updates runtime state without full page reload.

#### Scenario: Summary header renders current AI status and active provider badge

- GIVEN an authenticated admin viewing the AI tab
- WHEN global AI is enabled with OpenAI `gpt-4o-mini` set as default
- THEN the summary header MUST show global status as `Bot AI Activado`
- AND the active provider badge MUST display `OpenAI - gpt-4o-mini`

#### Scenario: Quick toggle updates global AI status instantly

- GIVEN global AI is currently enabled
- WHEN the admin toggles the global AI switch in the summary header
- THEN the system MUST submit a settings update request
- AND the header status badge MUST immediately update to `Bot AI Desactivado` without reloading the page

### Requirement: Admin Panel i18n Convention

New admin UI modules MUST follow the established `data-i18n` attribute + dictionary convention of `admin.html`, fully covering 5 supported languages: Spanish (`es`), English (`en`), Portuguese (`pt`), French (`fr`), and German (`de`). Modules SHALL remain same-origin and CSP-compliant (no external scripts/styles). The Telegram tab's new controls (token input, identity display, admin username field) and the `telegram.saved` confirmation key SHALL be covered by all five dictionaries.
(Previously: convention defined, but the Telegram tab's `telegram.saved` key was missing from all dictionaries.)

#### Scenario: Module renders in Spanish

- GIVEN the admin panel language set to Spanish
- WHEN the admin opens the LLM settings module
- THEN all module labels with `data-i18n` keys SHALL render from the Spanish dictionary
- AND missing keys MUST fall back to English

#### Scenario: AI Dashboard renders across 5 supported languages

- GIVEN the admin switches panel language between `es`, `en`, `pt`, `fr`, and `de`
- WHEN viewing the AI Management Dashboard summary header, provider cards, and editor modal
- THEN all AI tab text elements with `data-i18n` attributes MUST update to the selected language

#### Scenario: Telegram tab renders across 5 supported languages

- GIVEN the admin switches panel language between `es`, `en`, `pt`, `fr`, and `de`
- WHEN viewing the Telegram tab with the token input, identity display, and admin username field
- THEN the new controls and the `telegram.saved` confirmation SHALL render in the selected language
