# Delta for admin-settings

## ADDED Requirements

### Requirement: Settings Key Derivation Normalizes SETTINGS_KEY

The system MUST strip surrounding `"`/`'` quotes and whitespace from `SETTINGS_KEY` before key derivation in `resolveSettingsKey()`. A quoted 64-hex value SHALL be used as the hex key directly; a quoted non-hex value SHALL be sha256-hashed from the stripped value. This is a BREAKING change for quoted deployments: previously the key derived from the quoted string, so encrypted secrets no longer decrypt. The system MUST document a one-time secret re-entry and MUST NOT implement dual-key "try both" compatibility.

#### Scenario: Quoted 64-hex SETTINGS_KEY derives the intended key

- GIVEN `SETTINGS_KEY="<64 hex chars>"` (JSON-quoted by setup.js)
- WHEN `resolveSettingsKey()` derives the key
- THEN the key SHALL be the hex-decoded buffer WITHOUT quotes

#### Scenario: Quoted non-hex SETTINGS_KEY hashes the stripped value

- GIVEN `SETTINGS_KEY="my-secret"` (quoted, non-hex)
- WHEN `resolveSettingsKey()` derives the key
- THEN it SHALL be `sha256(my-secret)` without quotes

#### Scenario: Breaking change — one-time re-entry, no dual-key

- GIVEN a deployment whose `SETTINGS_KEY` was previously read quoted
- WHEN the server boots after this change
- THEN previously encrypted secrets SHALL fail to decrypt
- AND the operator SHALL re-enter LLM secrets once via the admin panel
- AND the system MUST NOT attempt dual-key "try both" compatibility

#### Scenario: Boot warning surfaces the migration need

- GIVEN a decrypt failure caused by the key-derivation change
- WHEN the server boots
- THEN a warning SHALL be logged instructing one-time secret re-entry
- AND boot SHALL continue without crashing
