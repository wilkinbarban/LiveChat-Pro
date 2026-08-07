# Proposal: Auto-Activate LLM Provider on Initial Setup

## Intent

Currently, when an admin configures an API key for an LLM provider (such as DeepSeek), the system does not automatically set it as the `defaultProvider` if no default exists. Users must take a second manual step ("Establecer como Principal") to activate it. Furthermore, settings endpoints and default selection routes fall back to hardcoded `'openai'` or `'gpt-4o-mini'`. This change ensures that saving a provider's key automatically activates it when no default is set, GET settings resolves the first configured provider as default fallback, and default switching uses catalog-specific default models.

## Scope

### In Scope
- **Auto-Assign Default Provider on Save**: Automatically save `llm.default_provider` to `normProvider` in `handlePutLlmProvider` if `llm.default_provider` is not currently set in settings.
- **First-Configured Provider Fallback in GET Settings**: Update `handleGetLlmSettings` to dynamically fall back to the first configured provider when `rawDefaultProvider` is not set in DB, instead of hardcoding `'openai'` or returning `null` when a provider is configured.
- **Catalog Model Fallback in Default Selection**: Replace hardcoded `'gpt-4o-mini'` fallback in `handlePutLlmDefault` with `catalogDefault` (`getProviderModels(provider)[0]`).
- **Regression Tests**: Add test cases covering auto-activation, GET settings fallback, and default PUT catalog model resolution.

### Out of Scope
- Frontend UI visual redesign or changes to provider card layout.
- Modifications to LLM provider verification logic or encryption services.
- Multi-tenant or per-user provider assignments.

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `llm-providers`: Auto-activate provider on key save when no default provider is set, resolve first configured provider as default fallback in GET settings, and use provider catalog model fallback in default provider PUT endpoint.

## Approach

1. **`handlePutLlmProvider` (`src/routes/admin.js`)**:
   - When a valid API key is saved (`apiKey` present), query `settingsService.get('llm.default_provider')`.
   - If no default provider is set in DB (`!currentDefault`), persist `normProvider` as `llm.default_provider`.

2. **`handleGetLlmSettings` (`src/routes/admin.js`)**:
   - Check `rawDefaultProvider`. If missing/empty, find the first provider entry in `providers` where `configured === true`.
   - Set `defaultProvider` to that first configured provider key, or `null` if none are configured.

3. **`handlePutLlmDefault` (`src/routes/admin.js`)**:
   - Determine `catalogDefault` via `llmService.getProviderModels(provider)[0] || 'gpt-4o-mini'`.
   - Use `activeRaw?.model || catalogDefault` when calling `aiBot.configure`.

4. **Testing (`tests/admin-llm-routes.test.js`)**:
   - Add test scenarios verifying single-step auto-activation on save, first-configured provider resolution on GET, and correct model fallback when setting default provider.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/routes/admin.js` | Modified | Auto-assign default provider on save, dynamic GET fallback, catalog default model on PUT |
| `tests/admin-llm-routes.test.js` | Modified | Add unit/integration tests for auto-activation and fallbacks |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Overwriting explicit user default provider selection | Low | Only set `llm.default_provider` on provider save if `llm.default_provider` is not currently set in settings |
| Provider configured without catalog models available | Low | Fall back to `'gpt-4o-mini'` if `getProviderModels(provider)` returns empty array |

## Rollback Plan

Revert changes in `src/routes/admin.js` and `tests/admin-llm-routes.test.js` via git commit revert. The database settings stored under `llm.default_provider` remain valid strings and do not require schema migration revert.

## Dependencies

None.

## Success Criteria

- [ ] Saving an API key for any provider (e.g. DeepSeek) when no default provider is set automatically sets `llm.default_provider` to that provider.
- [ ] `GET /api/admin/settings/llm` returns the first configured provider as `defaultProvider` when no explicit default provider is set in DB.
- [ ] `PUT /api/admin/llm/default` configures `aiBot` using the provider's first catalog model instead of hardcoded `'gpt-4o-mini'` when model is unspecified.
- [ ] All existing and new automated tests in `tests/admin-llm-routes.test.js` pass.
