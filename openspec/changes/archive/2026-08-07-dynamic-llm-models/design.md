# Design: Dynamic LLM Models Selection

## Technical Approach

Replace the free-text `#llm-model` input in the Admin UI with a dynamic HTML `<select>` dropdown element. The dropdown options are populated from a static provider model catalog maintained in `src/services/llm/index.js` (`PROVIDER_MODELS`).

Backend endpoints (`POST /api/admin/settings/llm/verify-key`, `GET /api/admin/settings/llm`, `GET /api/admin/llm`) are updated to return `{ ok: true, models: [...] }` containing the supported model list for each provider. The frontend manages dropdown state transitions (disabled, loading, enabled) based on provider configuration and API key verification status.

## Architecture Decisions

### Decision: Static Model Catalog vs. Remote API Model Fetching

| Option | Tradeoffs | Decision |
|--------|-----------|----------|
| **1. Static Catalog (`PROVIDER_MODELS`)** | Requires backend updates on new model releases; 0 latency, predictable, offline-resilient, no dynamic quota usage. | **Selected**. Simplifies verification, avoids rate limits and remote API format discrepancies. |
| **2. Dynamic Remote Fetching** | Detects remote model updates automatically; high latency, failure-prone during provider outages, requires extra credentials/permissions. | Rejected. High operational risk and extra network overhead. |
| **3. Free-text Input (Status Quo)** | Maximum flexibility; error-prone, allows typos, poor user experience. | Rejected. Defeats requirement to validate supported models. |

**Rationale**: Maintaining a centralized `PROVIDER_MODELS` mapping in `src/services/llm/index.js` guarantees fast, reliable model rendering without network latency or dynamic API key permission issues.

### Catalog Mapping (`PROVIDER_MODELS`)
```javascript
const PROVIDER_MODELS = Object.freeze({
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
});
```

## Data Flow & Sequence Diagram

### API Key Verification & Dropdown Population Sequence

```
  Admin UI                      Admin Router                 LLM Service
     │                               │                            │
     ├─── 1. Click "Verify & Save" ─→│                            │
     │    (provider, apiKey, model)  ├─── 2. verifyConnection ───→│ (Chat 1-token test call)
     │                               │    (provider, key, model)  │
     │                               │←── 3. { ok: true } ────────┤
     │                               │                            │
     │                               ├─── 4. Lookup catalog ─────→│ PROVIDER_MODELS[provider]
     │                               │←── 5. models array ────────┤
     │                               │                            │
     │←── 6. { ok: true, models } ───┤                            │
     │                               │                            │
     ├─── 7. Enable `<select>` ──────┤                            │
     │    & populate `<option>`s     │                            │
```

## UI State Transitions for `<select id="llm-model">`

```
  ┌────────────────────────────────────────────────────────┐
  │                   Initial Render                       │
  │     (Unconfigured / Unverified / No API Key)           │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
                  ┌────────────────────┐
                  │   Disabled State   │
                  │ disabled: true     │
                  │ options: []        │
                  └──────────┬─────────┘
                             │
            ┌────────────────┴────────────────┐
            │ Trigger: Verification or Load   │
            ▼                                 ▼
  ┌──────────────────┐               ┌──────────────────┐
  │  Loading State   │               │  Disabled State  │
  │ disabled: true   │               │  (Verification   │
  │ options: [...]   │               │   Failed)        │
  └────────┬─────────┘               └──────────────────┘
           │ (Success)
           ▼
  ┌──────────────────┐
  │  Enabled State   │
  │ disabled: false  │
  │ options: [...]   │
  │ selected: model  │
  └──────────────────┘
```

| State | Dropdown Attributes | Option Content | Trigger Event |
|-------|---------------------|----------------|---------------|
| **Disabled** | `disabled="disabled"` | Empty or default placeholder | Initial page load without key, or verification error |
| **Loading** | `disabled="disabled"` | Current model option or "Cargando..." | Active API request (`loadAiSettings` / `verify-key`) |
| **Enabled** | `disabled=false` | Populated `<option>` list for provider | Successful `verify-key` response or loading active config |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/services/llm/index.js` | Modify | Define `PROVIDER_MODELS`, export `getProviderModels(provider)`, return `models` array in `verifyConnection` & service. |
| `src/routes/admin.js` | Modify | Include `models` array in `POST /verify-key`, `GET /api/admin/settings/llm`, and `GET /api/admin/llm` responses. |
| `public/admin.html` | Modify | Replace `<input id="llm-model">` with `<select id="llm-model" disabled>`, update `updateProviderFields()`, `loadAiSettings()`, and `btnVerifyLlm` listener. |
| `tests/admin-llm-routes.test.js` | Modify | Add assertions verifying `models` array is returned in verification and settings responses. |

## Interfaces / Contracts

### 1. Verification Response (`POST /api/admin/settings/llm/verify-key`)
```json
{
  "ok": true,
  "models": ["gpt-4o", "gpt-4o-mini", "o1-mini"]
}
```

### 2. Settings Response (`GET /api/admin/settings/llm` / `GET /api/admin/llm`)
```json
{
  "ok": true,
  "enabled": true,
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "configured": true,
      "maskedKey": "…9999",
      "model": "gpt-4o-mini",
      "models": ["gpt-4o", "gpt-4o-mini", "o1-mini"]
    }
  }
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `llmService.getProviderModels` & `verifyConnection` | Assert model catalog returned for each supported provider. |
| Integration | `POST /verify-key` and `GET /settings/llm` endpoints | Verify responses include `models` array matching provider catalog. |
| UI State | Admin UI `<select id="llm-model">` rendering | Assert dynamic option population, disabled toggle, and model selection. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No data migration required. Existing stored provider model settings remain intact. The `<select>` element will automatically pre-select the configured model if present in the catalog.

## Open Questions

None.
