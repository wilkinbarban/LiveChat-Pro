# Proposal: AI DeepSeek Key Verification & Default Provider Fixes

## Intent

Fix AI configuration bugs in `livechat-pro` that prevent non-OpenAI key verification (DeepSeek, Kimi, Qwen, OpenRouter), incorrectly present OpenAI as active when no API key exists, keep the model dropdown disabled prior to verification, and fail verification requests when `model` is left empty.

## Scope

### In Scope
- **Provider-Specific Default Model Resolution**: Update `src/routes/admin.js` (`/verify-key` and `handlePutLlmProvider`) so an omitted or empty `model` defaults to the provider's first model from `llmService.getProviderModels(normProvider)` instead of hardcoded `gpt-4o-mini`.
- **Keyless Default Provider Correction**: Update `GET /api/admin/settings/llm` in `src/routes/admin.js` to return `defaultProvider: null` when no provider is configured, eliminating false default active badges.
- **Model Dropdown Enablement in Modal**: Update `public/admin.html` JS so opening the provider modal or entering an API key populates `#llm-model` with provider catalog models and enables it before verification.
- **Key Verification Payload Formatting**: Update `btnVerifyLlm` click handler in `public/admin.html` to pass the provider's catalog default model if `model` is empty.

### Out of Scope
- Adding new LLM providers beyond the existing six.
- Changes to AI bot message streaming or RAG database schemas.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `llm-providers`: Provider-specific default model resolution, keyless default provider detection, pre-verification model dropdown enablement, and fallback payload formatting for key verification.

## Approach

1. **Backend Default Resolution**: Update `/verify-key` and `handlePutLlmProvider` in `src/routes/admin.js` to inspect `llmService.getProviderModels(normProvider)` and fall back to the first catalog model when `model` is empty or missing.
2. **Keyless Default Detection**: In `handleGetLlmSettings`, check if `llm.default_provider` is set; if not set and no providers have `configured: true`, set `defaultProvider` to `null`.
3. **Frontend UI Dropdown Logic**: In `public/admin.html`, update `updateProviderFields(provider)` to populate `#llm-model` with `pInfo.models` and enable `#llm-model` when catalog models exist. In `btnVerifyLlm`, resolve empty `model` to `verifyRes.models[0]` or provider catalog default before payload dispatch.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/routes/admin.js` | Modified | Update provider-specific default model fallbacks and keyless default provider calculation. |
| `public/admin.html` | Modified | Update modal initialization to populate and enable model dropdown before verification, and fallback empty verify payloads. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UI regression on setting default provider when none configured | Low | Unit tests ensuring `defaultProvider` handles `null` gracefully in API response and frontend rendering. |
| Verification failure for invalid model name | Low | Fallback strictly to valid models returned by `getProviderModels(provider)`. |

## Rollback Plan

Revert git commits modifying `src/routes/admin.js` and `public/admin.html`. Previous behavior hardcoding `gpt-4o-mini` and defaulting unconfigured state to `openai` will be restored.

## Dependencies

- None

## Success Criteria

- [ ] Non-OpenAI API key verification requests for DeepSeek, Kimi, Qwen, and OpenRouter succeed without requiring manual model entry.
- [ ] `GET /api/admin/settings/llm` returns `defaultProvider: null` when no keys are configured.
- [ ] Modal model dropdown is populated with target provider models and enabled before clicking verify.
- [ ] Verification payload dispatches valid provider-specific default model when dropdown selection is blank.
