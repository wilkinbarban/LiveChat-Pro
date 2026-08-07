# Delta for llm-providers

## ADDED Requirements

### Requirement: Runtime Provider Rehydration at Boot

After database initialization, the system MUST load the persisted LLM settings (`llm.default_provider`, `llm.provider.*` with the API key decrypted, and the active model) and apply them to the bot service on boot. Exactly one provider SHALL be active; others SHALL remain backups with no auto-failover. Rehydration SHALL run once at startup and MUST NOT clobber runtime state applied later. Settings MUST survive container rebuilds via the volume-persisted database.

#### Scenario: Boot rehydration applies persisted default and model

- GIVEN a configured provider, key, and model persisted in settings
- WHEN the server boots after database initialization
- THEN the bot SHALL be active with the persisted default provider, decrypted key, and model
- AND no admin action SHALL be required

#### Scenario: Default-only, no auto-failover

- GIVEN multiple configured providers
- WHEN the bot is rehydrated at boot
- THEN the bot SHALL use only the default provider
- AND MUST NOT automatically switch to a backup provider

#### Scenario: Rehydrated bot fully operational

- GIVEN a custom master prompt, a populated RAG knowledge base, and the bot rehydrated at boot
- WHEN a visitor sends a message
- THEN the bot SHALL reply in the visitor's language, honoring the master prompt and RAG context
- AND the reply SHALL be visible in the admin Chat view

### Requirement: RAG Context Substitution in Formatted Master Prompt

The system MUST substitute retrieved RAG context into the `{rag_context}` placeholder inside the formatted master prompt, never appended after it. With no chunks retrieved, the placeholder SHALL be replaced with empty content.

#### Scenario: RAG context placed inside the placeholder

- GIVEN a master prompt containing `{rag_context}` and relevant chunks retrieved
- WHEN the bot formats a reply
- THEN the retrieved context SHALL replace the `{rag_context}` placeholder
- AND MUST NOT be appended after the prompt

#### Scenario: Empty retrieval yields empty placeholder

- GIVEN no chunks above the relevance threshold
- WHEN the bot formats a reply
- THEN `{rag_context}` SHALL be replaced with empty content
- AND the master prompt SHALL be answered as-is

## MODIFIED Requirements

### Requirement: API Key Management with Connection Verification

The system MUST verify an API key with a live test call before activating it, in a dedicated Provider Editor Modal/Drawer using a two-step flow: "Comprobar conexión" MUST verify the key with a 1-token probe and list models fetched from the provider API, persisting nothing; "Guardar y Cerrar" MUST persist the key and selected model and close the modal. A key that fails verification MUST NOT become active. When the verification model parameter is empty or omitted, the system MUST resolve the default test model to `getProviderModels(provider)[0]` and MUST NOT pass `gpt-4o-mini` to non-OpenAI providers. On successful verification (`POST /api/admin/settings/llm/verify-key`), the response MUST include `{ ok: true, models: [...] }` with models fetched live from the provider API (`GET {base}/models` for OpenAI-compatible providers; `GET /v1/models` with the `anthropic-version` header for Anthropic). If the model-listing call fails with 404, 405, or a network error, the system MUST fall back to the static `PROVIDER_MODELS` catalog (kept as fallback, never removed) and MUST still return `{ ok: true, models: [...] }`. The admin UI MUST order returned models and MUST cap the OpenRouter list to approximately 50 entries. The Modal MUST display masked API keys (`...1234`) and support "Guardar y Cerrar" plus "Guardar Modelo" (`PUT /api/admin/llm/providers/:name`). Active configuration endpoints (`GET /api/admin/settings/llm`) MUST also return the supported model catalog. Keys SHALL be persisted in the settings store and MUST NOT be exposed in plain text.
(Previously: "Verificar y Guardar API Key" combined verification, save, and close in one click; models came from the static catalog.)

#### Scenario: Key verified then saved in two steps

- GIVEN an admin entering a new OpenRouter API key
- WHEN the admin clicks "Comprobar conexión"
- THEN the system SHALL return `{ ok: true, models: [...] }` from the provider API without persisting
- AND "Guardar y Cerrar" SHALL persist the key and selected model and close the modal

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

#### Scenario: Model-listing API down falls back to static catalog

- GIVEN the provider model endpoint returns 404, 405, or a network error
- WHEN key verification otherwise succeeds
- THEN the response SHALL return `{ ok: true, models: [...] }` from the static catalog
- AND verification SHALL remain successful

#### Scenario: OpenRouter list capped in the UI

- GIVEN the OpenRouter provider returns more than 50 models
- WHEN the model dropdown is populated after verification
- THEN the UI SHALL display the ordered top approximately 50 models
