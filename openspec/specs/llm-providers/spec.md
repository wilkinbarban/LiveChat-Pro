# Spec for llm-providers

Multi-provider LLM configuration managed at runtime from the admin panel, replacing the OpenAI-only, env-configured bot.

## Requirements

### Requirement: Multi-Provider Registry

The system MUST support six LLM providers: OpenAI, Anthropic, OpenRouter, DeepSeek, Kimi, and Qwen. Exactly one provider+model SHALL be the active default at any time; the others MAY be configured but inactive. OpenAI-compatible providers (OpenAI, OpenRouter, DeepSeek, Kimi, Qwen) SHALL be served through a shared OpenAI-protocol adapter with configurable base URL; Anthropic SHALL be served through a native `/v1/messages` adapter.

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

### Requirement: API Key Management with Connection Verification

The system MUST verify an API key with a live test call to the provider before activating it. A key that fails verification MUST NOT become active. On successful verification (`POST /api/admin/settings/llm/verify-key`), the response MUST include `{ ok: true, models: [...] }` containing the supported model catalog for the provider. Active configuration endpoints (`GET /api/admin/settings/llm`) MUST also return the supported model catalog. Keys SHALL be persisted in the settings store and MUST NOT be exposed in API responses or admin HTML (masked display only).

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
