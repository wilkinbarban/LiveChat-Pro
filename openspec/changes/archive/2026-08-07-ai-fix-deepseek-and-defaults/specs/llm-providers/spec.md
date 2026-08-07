# Delta for llm-providers

## MODIFIED Requirements

### Requirement: Multi-Provider Registry

The system MUST support six LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Kimi, and Qwen, rendered as a visual Provider Cards Grid in the AI Management Dashboard. Each card MUST display provider status (`Configurado` / `Sin configurar`), `Proveedor Principal` badge for the active provider, current model name, 1-click default selection button, and modal editor trigger. Exactly one provider+model SHALL be the active default when at least one provider has `configured: true`. When no provider is configured, `GET /api/admin/settings/llm` MUST return `defaultProvider: null` (or empty string), and unconfigured providers MUST return their own default catalog model from `getProviderModels(provider)[0]`. OpenAI-compatible providers (OpenAI, OpenRouter, DeepSeek, Kimi, Qwen) SHALL be served through a shared OpenAI-protocol adapter with configurable base URL; Anthropic SHALL be served through a native `/v1/messages` adapter.
(Previously: Default provider defaulted to OpenAI even when no API keys were configured, causing false active provider badges.)

#### Scenario: Select a default provider

- GIVEN an authenticated admin on the LLM settings module
- WHEN the admin configures "DeepSeek" with a valid key and model and saves
- THEN DeepSeek becomes the active default
- AND subsequent bot replies are generated via the DeepSeek adapter

#### Scenario: Keyless default provider detection

- GIVEN an authenticated admin loading the AI Management Dashboard when no provider has a configured API key
- WHEN `GET /api/admin/settings/llm` is called
- THEN the response MUST return `defaultProvider: null`
- AND no provider card MUST display the `Proveedor Principal` badge
- AND each unconfigured provider MUST return its catalog default model from `getProviderModels(provider)[0]`

#### Scenario: Unknown provider rejected

- GIVEN an authenticated admin
- WHEN the admin submits a provider name outside the six supported providers
- THEN the system MUST reject the request with a validation error
- AND the active configuration MUST remain unchanged

#### Scenario: Render 6 provider cards grid with status badges

- GIVEN an authenticated admin loading the AI Management Dashboard
- WHEN the dashboard loads provider configurations
- THEN the UI MUST render 6 provider cards (OpenAI, Anthropic, OpenRouter, DeepSeek, Kimi, Qwen)
- AND each card MUST display `Configurado` if API key is present or `Sin configurar` if missing
- AND the active provider card MUST display the `Proveedor Principal` badge

### Requirement: API Key Management with Connection Verification

The system MUST verify an API key with a live test call to the provider before activating it, managed via a dedicated Provider Editor Modal/Drawer. A key that fails verification MUST NOT become active. When the verification model parameter is empty or omitted, the system MUST resolve the default test model to `getProviderModels(provider)[0]` for the target provider and MUST NOT pass `gpt-4o-mini` to non-OpenAI providers. On successful verification (`POST /api/admin/settings/llm/verify-key`), the response MUST include `{ ok: true, models: [...] }` containing the supported model catalog. The Provider Editor Modal MUST display masked API keys (`...1234`) and support both "Verificar y Guardar API Key" and "Guardar Modelo" (`PUT /api/admin/llm/providers/:name`). Active configuration endpoints (`GET /api/admin/settings/llm`) MUST also return the supported model catalog. Keys SHALL be persisted in the settings store and MUST NOT be exposed in plain text.
(Previously: Verification default model defaulted to `gpt-4o-mini` regardless of provider, causing non-OpenAI verification failures when model was empty.)

#### Scenario: Valid key verified and saved

- GIVEN an admin entering a new OpenRouter API key
- WHEN the admin clicks "Verify and save"
- THEN the system SHALL perform a test call against OpenRouter returning `{ ok: true, models: [...] }`
- AND on success persist the key, mark the provider ready, and return the available model list

#### Scenario: Empty model parameter resolves to provider catalog default

- GIVEN an admin verifying an API key for a non-OpenAI provider (e.g., DeepSeek) with an empty or omitted model field
- WHEN `POST /api/admin/settings/llm/verify-key` is called
- THEN the system MUST use `getProviderModels('deepseek')[0]` as the verification model
- AND MUST NOT pass `gpt-4o-mini` to the provider verification request
- AND on success MUST return `{ ok: true, models: [...] }`

#### Scenario: Invalid API key

- GIVEN an admin entering an incorrect Anthropic API key
- WHEN verification runs and the provider returns 401
- THEN the system MUST surface an "invalid API key" error
- AND MUST NOT activate the key, return model options, or change the current default

#### Scenario: Masked API key display in editor modal

- GIVEN a provider with an existing saved API key
- WHEN the admin opens the Provider Editor Modal for that provider
- THEN the API key input field MUST display the masked value ending in the last 4 characters (e.g. `...1234`)

#### Scenario: Model update without key re-verification

- GIVEN a configured provider with a verified API key and enabled model dropdown
- WHEN the admin selects a different model and clicks "Guardar Modelo"
- THEN the system MUST update the active model via `PUT /api/admin/llm/providers/:name` without running a key verification test
- AND MUST refresh the card grid and summary header display

### Requirement: Dynamic Model Selection Input

The Admin UI MUST render `#llm-model` as a `<select>` dropdown element instead of a free-text input, preventing manual model entry. When opening the Provider Editor Modal or entering an API key, the system MUST enable `#llm-model` and populate its options with provider catalog models from `getProviderModels(provider)` BEFORE key verification is executed. Upon API key verification or when loading saved provider settings, the system MUST preserve or update selectable options dynamically from the provider model catalog. If key verification fails or returns an error, pre-populated catalog options MAY remain in `#llm-model`, but verification errors MUST be displayed to the admin.
(Previously: `#llm-model` remained disabled until key verification succeeded or saved settings were loaded.)

#### Scenario: Pre-verification model dropdown population and enablement

- GIVEN an admin opening the Provider Editor Modal or entering an API key for a selected provider (e.g., DeepSeek)
- WHEN the modal opens or input changes BEFORE clicking verify
- THEN the system MUST populate `#llm-model` with catalog options from `getProviderModels('deepseek')`
- AND MUST enable `#llm-model` before verification is executed

#### Scenario: Initial render without verified key

- GIVEN an admin opening the LLM settings panel without a verified API key
- WHEN the panel renders
- THEN the `#llm-model` element MUST be a `<select>` dropdown populated with target provider catalog models and enabled for selection

#### Scenario: Dynamic population upon API key verification

- GIVEN an admin entering an API key for a selected provider
- WHEN the admin initiates verification and `POST /api/admin/settings/llm/verify-key` returns `{ ok: true, models: [...] }`
- THEN the system MUST ensure `#llm-model` is enabled
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

#### Scenario: Invalid key verification error handling

- GIVEN an admin entering an invalid API key with pre-populated model dropdown
- WHEN key verification fails or returns an error response
- THEN the system MUST display the verification error message
- AND MUST NOT activate the key or persist the provider configuration
