# Proposal: Dynamic LLM Models Selection in Admin UI

## Intent

Replace the free-text `#llm-model` input in the Admin UI with a disabled `<select>` dropdown populated dynamically with valid models only after API key verification or when loading an already-configured provider.

## Scope

### In Scope
- Convert `#llm-model` field in `public/admin.html` from `<input type="text">` to `<select id="llm-model">`, disabled by default.
- Define model catalog per supported provider (`openai`, `anthropic`, `openrouter`, `deepseek`, `kimi`, `qwen`) in backend LLM service.
- Update `POST /api/admin/settings/llm/verify-key` to return `{ ok: true, models: [...] }` on success.
- Update `GET /api/admin/settings/llm` / `GET /api/admin/llm` to return supported model lists for configured providers.
- Enable and populate `<select id="llm-model">` dynamically upon successful key verification or loading active configuration.

### Out of Scope
- Free-text custom model entries in the Admin UI.
- Network scraping of remote model lists dynamically during verification.

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `llm-providers`: Default model input changes from free-text to a disabled dropdown enabled only after successful API key verification or loading valid provider settings, populated dynamically from server catalog.

## Approach

- Add `MODEL_CATALOG` to `src/services/llm/index.js` mapping supported providers to model choice arrays.
- Include `models` array in `llmService.verifyConnection` output, `verify-key` endpoint, and LLM settings GET endpoints in `src/routes/admin.js`.
- Update `public/admin.html` element structure and JS state handlers to toggle disabled state, populate `<option>` elements, and set selected model.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/services/llm/index.js` | Modified | Add `MODEL_CATALOG` and return supported models in verification result |
| `src/routes/admin.js` | Modified | Include `models` array in `/verify-key` and settings GET responses |
| `public/admin.html` | Modified | Convert `#llm-model` to `<select>`, manage dynamic option rendering and disabled state |
| `tests/admin-llm-routes.test.js` | Modified | Assert `models` array is returned in `/verify-key` and settings responses |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Static model catalog misses new model releases | Med | Centralize catalog in backend service for single-point catalog updates |
| Existing configured model omitted from default catalog | Low | Include all existing system model defaults (`gpt-4o-mini`, `claude-3-5-sonnet-20241022`, etc.) in catalog |

## Rollback Plan

Revert `public/admin.html`, `src/routes/admin.js`, `src/services/llm/index.js`, and tests via Git commit revert to restore text input for default model.

## Dependencies

- `llm-providers` specification and runtime settings service.

## Success Criteria

- [ ] `#llm-model` field in Admin UI is a `<select>` dropdown disabled by default for unverified providers.
- [ ] `POST /api/admin/settings/llm/verify-key` returns `{ ok: true, models: [...] }` on successful verification.
- [ ] `<select id="llm-model">` enables and populates valid choices after successful key verification or when loading configured providers.
- [ ] Free-text typing into default model field is completely prevented.
