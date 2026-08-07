# Design: Auto-Activate LLM Provider on Initial Setup

## Technical Approach

This design implements automatic activation of newly configured LLM providers when no default provider is present, dynamic first-configured provider fallback for GET settings, and provider-specific catalog default model resolution when setting default providers. All changes are contained in `src/routes/admin.js` and verified by tests in `tests/admin-llm-routes.test.js`.

## Architecture Decisions

### ADR-1: Automatic Default Provider Assignment on Key Save in `handlePutLlmProvider`

| Aspect | Detail |
|--------|--------|
| **Choice** | When `apiKey` is provided in `handlePutLlmProvider`, query `llm.default_provider`. If null or empty, save `normProvider` as `llm.default_provider`. |
| **Alternatives** | A) Always overwrite `llm.default_provider` on key save (rejected: overwrites existing user default).<br>B) Require explicit `makeDefault` flag in request body (rejected: breaks single-step setup workflow). |
| **Rationale** | Ensures single-step configuration for new setups while strictly preserving explicit user choices when `llm.default_provider` is already set. |

### ADR-2: First-Configured Provider Fallback in `handleGetLlmSettings`

| Aspect | Detail |
|--------|--------|
| **Choice** | Track `firstConfiguredProvider` during iteration over supported providers. If `rawDefaultProvider` is absent in DB, fall back to `firstConfiguredProvider || null`. |
| **Alternatives** | A) Keep hardcoded `'openai'` fallback (rejected: returns an unconfigured provider as default when another is configured).<br>B) Return `null` when DB default is unset (rejected: hides configured state in UI). |
| **Rationale** | Ensures `defaultProvider` dynamically reflects configured providers in system state without hardcoding provider names. |

### ADR-3: Dynamic Catalog Default Model Resolution in `handlePutLlmDefault`

| Aspect | Detail |
|--------|--------|
| **Choice** | Resolve catalog default via `llmService.getProviderModels(provider)[0] || 'gpt-4o-mini'`. Pass `activeRaw?.model || catalogDefault` to `aiBot.configure`. |
| **Alternatives** | A) Retain hardcoded `'gpt-4o-mini'` fallback (rejected: sends OpenAI model names to non-OpenAI provider APIs).<br>B) Error out if model is missing (rejected: breaks default selection for key-only configurations). |
| **Rationale** | Guarantees model parameter validity for all providers (DeepSeek, Anthropic, OpenRouter, Kimi, Qwen, OpenAI) using their provider catalog definitions. |

## Data Flow

### Key Verification & Auto-Activation Flow

```
Admin Client        handlePutLlmProvider        llmService       settingsService         aiBot
     │                       │                      │                   │                  │
     ├─ PUT /providers/:name ┼─────────────────────>│                   │                  │
     │  { apiKey, model }    │                      │                   │                  │
     │                       ├─ verifyConnection ──>│                   │                  │
     │                       │<─ { ok: true } ──────┤                   │                  │
     │                       │                      │                   │                  │
     │                       ├─ encrypt & setJSON ─────────────────────>│                  │
     │                       ├─ get('llm.default_provider') ───────────>│                  │
     │                       │<─ (null / empty) ────────────────────────┤                  │
     │                       ├─ set('llm.default_provider', norm) ─────>│                  │
     │                       │                                          │                  │
     │                       ├─ configure({ provider, apiKey, model }) ───────────────────>│
     │                       │                                                             │
     │<─ 200 { ok: true } ───┤                                                             │
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/routes/admin.js` | Modify | Update `handleGetLlmSettings` for first-configured fallback, `handlePutLlmProvider` for auto-activation on save, and `handlePutLlmDefault` for catalog model resolution. |
| `tests/admin-llm-routes.test.js` | Modify | Add tests for provider key save auto-activation, GET fallback, and PUT default catalog model resolution. |

## Interfaces / Contracts

### `PUT /api/admin/llm/providers/:name` (and `/settings/llm/providers/:name`)

- **Behavior**: Verifies key, encrypts & stores provider settings. If `llm.default_provider` is unset in DB and `apiKey` is provided, sets `llm.default_provider = normProvider`.
- **Response**: `{ ok: true, provider: string, configured: true, maskedKey: string, model: string }`

### `GET /api/admin/settings/llm` (and `/llm`)

- **Behavior**: Returns `defaultProvider`. If DB value is missing, evaluates first configured provider in `providers`; returns `null` if none configured.
- **Response**: `{ ok: true, enabled: boolean, defaultProvider: string | null, providers: Record<string, ProviderConfig> }`

### `PUT /api/admin/llm/default`

- **Behavior**: Persists `llm.default_provider`. Configures `aiBot` with model from `activeRaw.model` or provider catalog default `llmService.getProviderModels(provider)[0]`.
- **Response**: `{ ok: true, defaultProvider: string }`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration | Auto-activate default provider | Save API key for DeepSeek when no default is set; verify `llm.default_provider` is set to `deepseek`. |
| Integration | Preserve existing default | Save API key for Anthropic when `llm.default_provider` is `openai`; verify default remains `openai`. |
| Integration | GET settings dynamic fallback | Unset `llm.default_provider`, configure Anthropic key; verify `GET` returns `defaultProvider: "anthropic"`. |
| Integration | PUT default model resolution | Call `PUT /api/admin/llm/default` for DeepSeek without preset model; verify `aiBot` receives DeepSeek's catalog default model. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Schema changes not applicable.

## Open Questions

None.
