# Delta Spec for llm-providers

## ADDED Requirements

### Requirement: 1-Click Default Provider Selection

The system MUST provide a 1-click "Establecer como Principal" button on each configured provider card that is not currently set as default. Clicking the button MUST send a `PUT /api/admin/llm/default` request to set the selected provider as active default and immediately update the card grid badges and summary header without a page refresh.

#### Scenario: 1-click default switch for configured provider

- GIVEN Anthropic is configured with a valid key and model but is not default
- WHEN the admin clicks "Establecer como Principal" on the Anthropic provider card
- THEN the system MUST issue `PUT /api/admin/llm/default` with provider `anthropic`
- AND upon success, the Anthropic card MUST display the `Proveedor Principal` badge
- AND the summary header MUST update to display `Anthropic` and its selected model

#### Scenario: Disabled 1-click action for unconfigured provider

- GIVEN a provider card with status `Sin configurar`
- WHEN rendered in the provider grid
- THEN the 1-click default selection button MUST be disabled or hidden
- AND clicking it MUST NOT send a default update request

## MODIFIED Requirements

### Requirement: Multi-Provider Registry

The system MUST support six LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Kimi, and Qwen, rendered as a visual Provider Cards Grid in the AI Management Dashboard. Each card MUST display provider status (`Configurado` / `Sin configurar`), `Proveedor Principal` badge for the active provider, current model name, 1-click default selection button, and modal editor trigger. Exactly one provider+model SHALL be the active default at any time; the others MAY be configured but inactive. OpenAI-compatible providers (OpenAI, OpenRouter, DeepSeek, Kimi, Qwen) SHALL be served through a shared OpenAI-protocol adapter with configurable base URL; Anthropic SHALL be served through a native `/v1/messages` adapter.
(Previously: Multi-provider registry was supported but lacked visual provider card grid rendering 6 cards with status badges and explicit provider card UI controls)

#### Scenario: Select a default provider

- GIVEN an authenticated admin on the LLM settings module
- WHEN the admin configures "DeepSeek" with a valid key and model and saves
- THEN DeepSeek becomes the active default
- AND subsequent bot replies are generated via the DeepSeek adapter

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

The system MUST verify an API key with a live test call to the provider before activating it, managed via a dedicated Provider Editor Modal/Drawer. A key that fails verification MUST NOT become active. On successful verification (`POST /api/admin/settings/llm/verify-key`), the response MUST include `{ ok: true, models: [...] }` containing the supported model catalog for the provider. The Provider Editor Modal MUST display masked API keys (`...1234`) and support both "Verificar y Guardar API Key" (key test & save) and "Guardar Modelo" (`PUT /api/admin/llm/providers/:name` for updating active model without key re-verification). Active configuration endpoints (`GET /api/admin/settings/llm`) MUST also return the supported model catalog. Keys SHALL be persisted in the settings store and MUST NOT be exposed in API responses or admin HTML in plain text.
(Previously: Key verification was supported but editor modal details, masked display format `...1234`, and distinct "Guardar Modelo" updates without re-verifying keys were not explicitly specified)

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

#### Scenario: Masked API key display in editor modal

- GIVEN a provider with an existing saved API key
- WHEN the admin opens the Provider Editor Modal for that provider
- THEN the API key input field MUST display the masked value ending in the last 4 characters (e.g. `...1234`)

#### Scenario: Model update without key re-verification

- GIVEN a configured provider with a verified API key and enabled model dropdown
- WHEN the admin selects a different model and clicks "Guardar Modelo"
- THEN the system MUST update the active model via `PUT /api/admin/llm/providers/:name` without running a key verification test
- AND MUST refresh the card grid and summary header display
