# Delta Spec for llm-providers

## MODIFIED Requirements

### Requirement: Multi-Provider Registry

The system MUST support six LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Kimi, and Qwen, rendered as a visual Provider Cards Grid in the AI Management Dashboard. Each card MUST display provider status (`Configurado` / `Sin configurar`), `Proveedor Principal` badge for the active provider, current model name, 1-click default selection button, and modal editor trigger. Exactly one provider+model SHALL be the active default when at least one provider has `configured: true`. Saving an API key for a provider MUST automatically set that provider as `defaultProvider` if no default provider is set in DB. `GET /api/admin/settings/llm` MUST fall back to the first configured provider if no `llm.default_provider` is set in DB, and MUST return `defaultProvider: null` only when no provider is configured. `PUT /api/admin/llm/default` MUST use the target provider's own catalog default model (`getProviderModels(provider)[0]`) if `model` is not set in `activeRaw`. OpenAI-compatible providers (OpenAI, OpenRouter, DeepSeek, Kimi, Qwen) SHALL be served through a shared OpenAI-protocol adapter with configurable base URL; Anthropic SHALL be served through a native `/v1/messages` adapter.
(Previously: Provider key save did not auto-set defaultProvider when empty, GET settings did not fall back to the first configured provider dynamically, and PUT default fell back to hardcoded 'gpt-4o-mini'.)

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
