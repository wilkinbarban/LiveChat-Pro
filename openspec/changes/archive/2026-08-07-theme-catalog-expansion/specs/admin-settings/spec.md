# Delta for admin-settings

## MODIFIED Requirements

### Requirement: Admin Panel i18n Convention

New admin UI modules MUST follow the established `data-i18n` attribute + dictionary convention of `admin.html`, fully covering 5 supported languages: Spanish (`es`), English (`en`), Portuguese (`pt`), French (`fr`), and German (`de`). Modules SHALL remain same-origin and CSP-compliant (no external scripts/styles). The Telegram tab's new controls (token input, identity display, admin username field) and the `telegram.saved` confirmation key SHALL be covered by all five dictionaries. The expanded theme catalog SHALL define a `theme.<name>` key for each of the 16 presets plus any new UI keys (e.g. `theme.preview`) in all five dictionaries; a missing key MUST fall back to a safe value (preset name or English) without rendering the raw key.
(Previously: the convention covered the Telegram tab's `telegram.saved` key; theme labels existed for only the original 6 presets, with no required fallback beyond English.)

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

#### Scenario: Theme preset labels render across 5 supported languages

- GIVEN the admin switches panel language between `es`, `en`, `pt`, `fr`, and `de`
- WHEN viewing the Appearance tab with the expanded catalog
- THEN each of the 16 presets' `theme.<name>` labels SHALL render in the selected language

#### Scenario: Missing theme key falls back gracefully

- GIVEN a `theme.<name>` key absent from the active dictionary
- WHEN the Appearance tab renders that preset card
- THEN the label SHALL fall back to the preset name or English
- AND SHALL NOT display the raw key string
