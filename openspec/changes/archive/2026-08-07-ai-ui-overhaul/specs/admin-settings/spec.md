# Delta Spec for admin-settings

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Admin Panel i18n Convention

New admin UI modules MUST follow the established `data-i18n` attribute + dictionary convention of `admin.html`, fully covering 5 supported languages: Spanish (`es`), English (`en`), Portuguese (`pt`), French (`fr`), and German (`de`). Modules SHALL remain same-origin and CSP-compliant (no external scripts/styles).
(Previously: Dictionary convention supported basic existing dictionary languages without explicit 5-language requirement across all AI dashboard UI strings)

#### Scenario: Module renders in Spanish

- GIVEN the admin panel language set to Spanish
- WHEN the admin opens the LLM settings module
- THEN all module labels with `data-i18n` keys SHALL render from the Spanish dictionary
- AND missing keys MUST fall back to English

#### Scenario: AI Dashboard renders across 5 supported languages

- GIVEN the admin switches panel language between `es`, `en`, `pt`, `fr`, and `de`
- WHEN viewing the AI Management Dashboard summary header, provider cards, and editor modal
- THEN all AI tab text elements with `data-i18n` attributes MUST update to the selected language
