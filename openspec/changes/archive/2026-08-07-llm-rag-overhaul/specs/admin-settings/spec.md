# Delta for admin-settings

Settings persistence layer and security/i18n conventions shared by all new admin modules (LLM, RAG, master prompt, Telegram, themes).

## ADDED Requirements

### Requirement: Settings KV Persistence

The system MUST persist runtime configuration in a `settings` key-value table created with the existing idempotent CREATE/ALTER migration pattern. Settings MUST survive restarts. Secrets (API keys) SHALL be stored only in this table and MUST NOT be written to logs or returned in full by any endpoint.

#### Scenario: Setting survives restart

- GIVEN the admin saved an LLM provider configuration
- WHEN the server restarts
- THEN the configuration SHALL be loaded from the settings table
- AND the provider SHALL be active without re-entry

### Requirement: Runtime Reconfigure Without Restart

Services consuming settings (bot, Telegram, themes) MUST support runtime re-configuration when settings change, without process restart.

#### Scenario: Provider switch applies live

- GIVEN the bot running on OpenAI
- WHEN the admin switches the default to Kimi and saves
- THEN the next `getReply` SHALL use Kimi
- AND the process SHALL NOT restart

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

### Requirement: Admin Panel i18n Convention

New admin UI modules MUST follow the established `data-i18n` attribute + dictionary convention of `admin.html`, covering the existing dictionary languages. Modules SHALL remain same-origin and CSP-compliant (no external scripts/styles).

#### Scenario: Module renders in Spanish

- GIVEN the admin panel language set to Spanish
- WHEN the admin opens the LLM settings module
- THEN all module labels with `data-i18n` keys SHALL render from the Spanish dictionary
- AND missing keys MUST fall back to English
