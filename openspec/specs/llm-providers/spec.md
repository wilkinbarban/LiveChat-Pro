# Spec for llm-providers

Multi-provider LLM configuration managed at runtime from the admin panel, replacing the OpenAI-only, env-configured bot.

## Requirements

### Requirement: Multi-Provider Registry

The system MUST support six LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Kimi, and Qwen, rendered as a visual Provider Cards Grid in the AI Management Dashboard. Each card MUST display provider status (`Configurado` / `Sin configurar`), `Proveedor Principal` badge for the active provider, current model name, 1-click default selection button, and modal editor trigger. Exactly one provider+model SHALL be the active default when at least one provider has `configured: true`. Saving an API key for a provider MUST automatically set that provider as `defaultProvider` if no default provider is set in DB. `GET /api/admin/settings/llm` MUST fall back to the first configured provider if no `llm.default_provider` is set in DB, and MUST return `defaultProvider: null` only when no provider is configured. `PUT /api/admin/llm/default` MUST use the target provider's own catalog default model (`getProviderModels(provider)[0]`) if `model` is not set in `activeRaw`. OpenAI-compatible providers (OpenAI, OpenRouter, DeepSeek, Kimi, Qwen) SHALL be served through a shared OpenAI-protocol adapter with configurable base URL; Anthropic SHALL be served through a native `/v1/messages` adapter.

#### Scenario: Select a default provider

- GIVEN an authenticated admin on the LLM settings module
- WHEN the admin configures "DeepSeek" with a valid key and model and saves
- THEN DeepSeek becomes the active default
- AND subsequent bot replies are generated via the DeepSeek adapter

#### Scenario: Auto-activate provider on key save when no default set

- GIVEN an authenticated admin saving a valid API key for "DeepSeek"
- AND no `llm.default_provider` is set in DB
- WHEN `PUT /api/admin/llm/providers/deepseek` is executed
- THEN the system MUST automatically set "deepseek" as `llm.default_provider` in DB
- AND DeepSeek MUST become the active default provider

#### Scenario: Preserve existing default provider on key save

- GIVEN `llm.default_provider` is already set to "openai"
- WHEN an admin saves a valid API key for "anthropic"
- THEN the system MUST NOT overwrite `llm.default_provider`
- AND "openai" MUST remain the active default provider

#### Scenario: GET settings falls back to first configured provider

- GIVEN no `llm.default_provider` is set in DB
- AND "anthropic" is the first configured provider in the provider registry
- WHEN `GET /api/admin/settings/llm` is called
- THEN the response MUST return `defaultProvider: "anthropic"`

#### Scenario: Keyless default provider detection

- GIVEN an authenticated admin loading the AI Management Dashboard when no provider has a configured API key
- WHEN `GET /api/admin/settings/llm` is called
- THEN the response MUST return `defaultProvider: null`
- AND no provider card MUST display the `Proveedor Principal` badge
- AND each unconfigured provider MUST return its catalog default model from `getProviderModels(provider)[0]`

#### Scenario: PUT default uses provider catalog default model

- GIVEN an authenticated admin calling `PUT /api/admin/llm/default` for "deepseek"
- AND `activeRaw.model` is not set for deepseek
- WHEN default provider selection is processed
- THEN the system MUST resolve the model to DeepSeek's catalog default (`getProviderModels('deepseek')[0]`)
- AND MUST NOT fall back to hardcoded global default models like `gpt-4o-mini`

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

### Requirement: API Key Management with Connection Verification

The system MUST verify an API key with a live test call to the provider before activating it, managed via a dedicated Provider Editor Modal/Drawer. A key that fails verification MUST NOT become active. When the verification model parameter is empty or omitted, the system MUST resolve the default test model to `getProviderModels(provider)[0]` for the target provider and MUST NOT pass `gpt-4o-mini` to non-OpenAI providers. On successful verification (`POST /api/admin/settings/llm/verify-key`), the response MUST include `{ ok: true, models: [...] }` containing the supported model catalog. The Provider Editor Modal MUST display masked API keys (`...1234`) and support both "Verificar y Guardar API Key" and "Guardar Modelo" (`PUT /api/admin/llm/providers/:name`). Active configuration endpoints (`GET /api/admin/settings/llm`) MUST also return the supported model catalog. Keys SHALL be persisted in the settings store and MUST NOT be exposed in plain text.

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

### Requirement: Global AI On/Off Without Restart

The system MUST provide a global AI enable/disable switch in the admin panel that takes effect at runtime without a process restart. When disabled, the bot MUST NOT reply to any session.

#### Scenario: AI turned off mid-session

- GIVEN an active visitor session that previously received bot replies
- WHEN the admin disables AI globally
- THEN the next visitor message MUST NOT trigger a bot reply
- AND human admin flow (Telegram notification, manual reply) SHALL continue normally

#### Scenario: AI re-enabled at runtime

- GIVEN AI globally disabled
- WHEN the admin re-enables AI
- THEN subsequent visitor messages SHALL be handled by the bot again without a restart

### Requirement: Stable Bot Service Contract

The bot service MUST keep the existing `isEnabled()` and `getReply(session, text)` signatures. `getReply` SHALL return an object containing at least `reply`, `confidence`, and `escalate`. `isEnabled()` MUST reflect the global runtime switch, not only boot-time env config.

#### Scenario: Socket flow consumes unchanged contract

- GIVEN the multi-provider service active
- WHEN a visitor message arrives and `isEnabled()` is true and the session is bot-handled
- THEN `getReply(session, text)` SHALL resolve `{reply, confidence, escalate}`
- AND the reply SHALL be persisted with `from_role='bot'` and emitted to the session room as before

#### Scenario: Provider call failure fails open

- GIVEN the active provider is unreachable or returns an error
- WHEN `getReply` is invoked
- THEN the system SHALL NOT crash the socket handler
- AND SHALL return an escalating/no-reply result so the visitor flow degrades gracefully

### Requirement: Sentiment High-Priority Bypass Preserved

Sessions flagged high-priority by sentiment analysis MUST bypass the bot entirely, exactly as before this change.

#### Scenario: High-priority message skips the bot

- GIVEN AI globally enabled and a valid default provider
- WHEN a visitor message is classified `isHighPriority`
- THEN the system MUST NOT call `getReply`
- AND the session SHALL be marked priority and routed to the human admin path