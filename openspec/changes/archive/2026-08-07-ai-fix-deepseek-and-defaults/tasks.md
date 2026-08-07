# Tasks: AI DeepSeek Key Verification & Default Provider Fixes

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120 - 170 lines |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (PR 1) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Fix provider default model fallbacks, keyless default provider detection, pre-verification model dropdown enablement, and empty verify payload handling | PR 1 | `node --test tests/admin-llm-routes.test.js tests/admin-ai-tab.test.js` | N/A (Node.js unit test suite for admin routes and HTML script structure) | Revert changes in `src/routes/admin.js`, `public/admin.html`, and tests |

## Phase 1: Backend Fallbacks & Keyless Settings

- [x] 1.1 RED: Add tests in `tests/admin-llm-routes.test.js` asserting `GET /api/admin/settings/llm` returns `defaultProvider: null` when keyless, and empty `model` in `/verify-key` and `handlePutLlmProvider` falls back to catalog defaults.
- [x] 1.2 GREEN: Update `handleGetLlmSettings` in `src/routes/admin.js` to set `defaultProvider: null` when no keys are configured, and return provider catalog default models for unconfigured providers.
- [x] 1.3 GREEN: Update `/verify-key` and `handlePutLlmProvider` in `src/routes/admin.js` to resolve omitted/empty `model` parameters to `llmService.getProviderModels(normProvider)[0]`.
- [x] 1.4 REFACTOR/VERIFY: Run `node --test tests/admin-llm-routes.test.js` and ensure all backend route tests pass.

## Phase 2: Frontend Modal & Dropdown Enablement

- [x] 2.1 RED: Add DOM and script structure tests in `tests/admin-ai-tab.test.js` for pre-verification model dropdown enablement and verify payload fallback.
- [x] 2.2 GREEN: Update `updateProviderFields(provider)` in `public/admin.html` to populate `#llm-model` options and enable `#llm-model` before verification whenever catalog models exist.
- [x] 2.3 GREEN: Update `btnVerifyLlm` click handler in `public/admin.html` to fall back empty model selections to provider catalog defaults prior to dispatching `/verify-key`.
- [x] 2.4 REFACTOR/VERIFY: Run `node --test tests/admin-ai-tab.test.js` to confirm frontend rendering and script assertions pass.

## Phase 3: Integration Verification

- [x] 3.1 REFACTOR/VERIFY: Run `node --test tests/*.test.js` to verify zero regressions across all admin and LLM test suites.
