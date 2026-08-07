# Delta for admin-settings

## MODIFIED Requirements

### Requirement: Runtime Reconfigure Without Restart

Services consuming settings (bot, Telegram, themes) MUST support runtime re-configuration when settings change, without process restart. Saving a new Telegram token or admin ID while the bot is running MUST stop the old bot instance and restart it with the new credentials. `/health` `telegramReady` MUST reflect the reconfigured state. Boot-time provider rehydration SHALL run once at startup after database initialization and MUST NOT clobber runtime state applied afterwards.
(Previously: runtime reconfiguration was required of settings consumers in general; Telegram token reconfigure was not covered; boot rehydration did not exist.)

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

#### Scenario: Boot rehydration does not clobber runtime state

- GIVEN the server booted and rehydrated the bot from persisted settings
- WHEN the admin later changes the default provider at runtime
- THEN the runtime change SHALL take effect immediately
- AND rehydration MUST NOT overwrite it because it runs only once at startup

### Requirement: Admin Panel i18n Convention

New admin UI modules MUST follow the established `data-i18n` attribute + dictionary convention of `admin.html`, fully covering 5 supported languages: Spanish (`es`), English (`en`), Portuguese (`pt`), French (`fr`), and German (`de`). Modules SHALL remain same-origin and CSP-compliant (no external scripts/styles). The LLM provider editor modal SHALL cover its two-step controls in all five dictionaries: "Comprobar conexión", "Guardar y Cerrar", the model list title, and the "no models found" empty state. The Telegram tab's new controls (token input, identity display, admin username field) and the `telegram.saved` confirmation key SHALL be covered by all five dictionaries. French dictionary entries SHALL use the U+2019 apostrophe (') per existing convention.
(Previously: convention defined, but the Telegram tab's `telegram.saved` key was missing from all dictionaries; the two-step LLM modal keys were absent.)

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

#### Scenario: Two-step modal renders across 5 supported languages

- GIVEN the admin switches panel language between `es`, `en`, `pt`, `fr`, and `de`
- WHEN viewing the LLM provider editor modal
- THEN "Comprobar conexión", "Guardar y Cerrar", the model list title, and the "no models found" state SHALL render in the selected language
