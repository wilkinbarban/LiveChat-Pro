# Delta Spec for llm-providers

## ADDED Requirements

### Requirement: Dynamic Model Selection Input

The Admin UI MUST render `#llm-model` as a `<select>` dropdown element instead of a free-text text input, preventing manual free-text model entry. The `#llm-model` dropdown MUST remain disabled on initial render when no verified API key is available. Upon successful API key verification or when loading saved provider settings with a verified key, the system MUST enable `#llm-model` and populate its options dynamically from the provider model catalog. If key verification fails or returns an error, `#llm-model` MUST remain disabled and surface the verification error to the admin.

#### Scenario: Initial render without verified key

- GIVEN an admin opening the LLM settings panel without a verified API key
- WHEN the panel renders
- THEN the `#llm-model` element MUST be a disabled `<select>` dropdown with no selectable model options

#### Scenario: Dynamic population upon API key verification

- GIVEN an admin entering an API key for a selected provider
- WHEN the admin initiates verification and `POST /api/admin/settings/llm/verify-key` returns `{ ok: true, models: [...] }`
- THEN the system MUST enable the `#llm-model` `<select>` element
- AND MUST populate the dropdown options with the returned `models` list

#### Scenario: Free-text typing prevented

- GIVEN the Admin UI LLM settings panel
- WHEN interacting with the `#llm-model` field
- THEN manual text input MUST NOT be permitted because the field is an HTML `<select>` element

#### Scenario: Automatic enablement on page load for saved verified configuration

- GIVEN a saved provider configuration with a verified API key
- WHEN the admin loads the LLM settings panel
- THEN the system MUST fetch provider settings and supported model lists from the server
- AND MUST automatically enable the `#llm-model` dropdown with the configured model selected

#### Scenario: Invalid key verification keeps dropdown disabled

- GIVEN an admin entering an unverified or invalid API key
- WHEN key verification fails or returns an error response
- THEN the system MUST display the verification error message
- AND MUST keep the `#llm-model` `<select>` dropdown disabled

## MODIFIED Requirements

### Requirement: API Key Management with Connection Verification

The system MUST verify an API key with a live test call to the provider before activating it. A key that fails verification MUST NOT become active. On successful verification (`POST /api/admin/settings/llm/verify-key`), the response MUST include `{ ok: true, models: [...] }` containing the supported model catalog for the provider. Active configuration endpoints (`GET /api/admin/settings/llm`) MUST also return the supported model catalog. Keys SHALL be persisted in the settings store and MUST NOT be exposed in API responses or admin HTML (masked display only).
(Previously: Key verification only validated provider connectivity without returning the supported model catalog in the API response.)

#### Scenario: Valid key verified and saved

- GIVEN an admin entering a new OpenRouter API key
- WHEN the admin clicks "Verify and save"
- THEN the system SHALL perform a test call against OpenRouter returning `{ ok: true, models: [...] }`
- AND on success persist the key, mark the provider ready, and return the available model list

#### Scenario: Invalid API key

- GIVEN an admin entering an incorrect Anthropic API key
- WHEN verification runs and the provider returns 401
- THEN the system MUST surface an "invalid API key" error
- AND MUST NOT activate the key, return model options, or change the current default
