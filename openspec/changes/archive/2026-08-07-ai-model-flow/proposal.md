# Proposal: AI Model Flow (ai-model-flow)

## Intent

Two problems: (1) the LLM admin modal combines verify+save+auto-close in one click and lists only a static catalog; the admin needs two explicit steps — paste key → "Comprobar conexión" (verify key, list models **verified by the provider's API**) → "Guardar y Cerrar" (explicit save). (2) `aiBot` is env-configured at boot only; a settings-backed provider is lost after container rebuild until an admin action re-triggers configure.

## Scope

### In Scope
- `listModels()` on both LLM adapters; verify-key returns live API models, static catalog as fallback.
- Two-step modal UX in `public/admin.html` + new i18n keys (es/en/pt/fr/de).
- Boot-time aiBot rehydration in `server.js start()` after `initDb` (provider, decrypted key, model, plus masterPrompt/rag service wiring).
- `{rag_context}` substitution fix in `ai-bot.js` (RAG into formatted prompt, not appended after).
- Verification: visitor-language reply, master-prompt module, RAG learning, admin Chat visibility.

### Out of Scope
- Runtime failover to backup providers; multi-default; persisting fetched model lists; provider removal UI; RAG/Chat changes beyond the placeholder fix; catalog removal.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `llm-providers`: verify-key SHALL return API-verified models (`{ok, models}` kept; catalog demoted to fallback); two-step modal replaces combined verify+save; `#llm-model` populated from verified models.
- `admin-settings`: boot-time rehydration SHALL load `llm.default_provider` + `llm.provider.*` + model into aiBot at startup (satisfies "Setting survives restart", currently unmet).

## Approach

| Option | Description | Verdict |
|--------|-------------|---------|
| **A (rec.)** | `listModels(provider, apiKey, {fetchImpl, baseURL})`: OpenAI-compatible `GET {base}/models`; Anthropic `GET /v1/models` + `anthropic-version`; fallback to `PROVIDER_MODELS` on 404/405/network error. `verifyConnection` keeps its 1-token probe then calls `listModels`. Contract unchanged. | Chosen — one path, `fetchImpl`-testable, graceful |
| B | Separate `/models` route | Rejected — extra surface, breaks contract |
| C | Static catalog only | Rejected — fails API-verified requirement |

UI: `#btn-verify-llm` → "Comprobar conexión" (verify only, populates `#llm-model`); `#btn-modal-save-model` → "Guardar y Cerrar" (explicit `PUT` + close). OpenRouter list ordered + capped in UI.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/services/llm/index.js` | Modified | `listModels()` dispatch + fallback |
| `src/services/llm/openai-compatible.js` | Modified | `GET {base}/models` |
| `src/services/llm/anthropic.js` | Modified | `GET /v1/models` |
| `src/routes/admin.js` | Modified | verify-key returns live models; auto-activate + first-configured kept |
| `src/services/ai-bot.js` | Modified | `{rag_context}` into `getFormattedPrompt` |
| `server.js` | Modified | rehydration after `initDb` |
| `public/admin.html` | Modified | Two-step modal + 5 i18n dicts |
| `tests/*.test.js` | Modified | llm-adapters, admin-llm-routes, admin-ai-tab |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Anthropic `/v1/models` unavailable | Med | Catalog fallback; live-verify during impl |
| OpenRouter ~200+ models overloads dropdown | High | Order + cap in UI |
| Two-step UX breaks tests + i18n keys | Med | Update tests in same change |
| Rehydration clobbers runtime state / runs before DB ready | Med | Wire in `start()` after `initDb`; run once |
| Catalog removal breaks llm-adapters tests | Med | Keep catalog as fallback |

## Rollback Plan

Revert `server.js start()` block (env-only init); restore combined verify+save handler; `listModels` behind try/catch returning catalog is a no-op. Additive/reversible; no migration.

## Dependencies

Node ≥24 global `fetch`. No new packages.

## Success Criteria

- [ ] Verify-key returns provider-verified models; catalog returned on failure (tests green).
- [ ] "Comprobar conexión" never persists; "Guardar y Cerrar" persists key+model and closes.
- [ ] After `docker compose up --build` with existing `livechat_data`, configured provider/model active without admin action.
- [ ] Custom master prompt with `{rag_context}` receives RAG content.
- [ ] Bot replies in visitor language; master prompt honored; RAG content used; bot messages visible in admin Chat.

## Decisions for plan review

1. Keep static `PROVIDER_MODELS` as fallback? (Recommended: yes.)
2. Cap OpenRouter list in UI (e.g. top 50)? (Recommended: yes.)
3. Anthropic `/v1/models` fallback acceptable? (Recommended: yes.)
4. Rehydration also wires `masterPromptService`/`ragService` into aiBot? (Recommended: yes — RAG currently unwired at boot.)
