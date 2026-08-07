# Tasks: Dynamic LLM Models Selection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120 - 180 lines |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Backend model catalog & API responses | PR 1 | `node --test tests/admin-llm-routes.test.js` | N/A (unit/API test) | Revert `src/services/llm/index.js` & `src/routes/admin.js` |
| 2 | Admin UI dynamic select dropdown & state transitions | PR 1 | `node --test tests/admin-ai-tab.test.js` | Admin UI load | Revert `public/admin.html` |

## Phase 1: Backend Model Catalog & Service Integration

- [x] 1.1 RED: Write unit test in `tests/admin-llm-routes.test.js` asserting `llmService.getProviderModels(provider)` returns the model list and `verifyConnection()` payload includes `models`.
- [x] 1.2 GREEN: Define `PROVIDER_MODELS` catalog and `getProviderModels()` in `src/services/llm/index.js`, returning `models` array in `verifyConnection()`.
- [x] 1.3 REFACTOR/VERIFY: Run `node --test tests/admin-llm-routes.test.js` to ensure model catalog service functions pass.

## Phase 2: Admin API Endpoints Update

- [x] 2.1 RED: Add endpoint unit tests in `tests/admin-llm-routes.test.js` asserting `POST /api/admin/settings/llm/verify-key` and `GET /api/admin/settings/llm` return `models` list for configured providers.
- [x] 2.2 GREEN: Update `/verify-key` and LLM settings GET endpoints in `src/routes/admin.js` to return provider `models` in response payloads.
- [x] 2.3 REFACTOR/VERIFY: Execute `node --test tests/admin-llm-routes.test.js` to verify endpoint contracts.

## Phase 3: Admin UI Select Dropdown & State Management

- [x] 3.1 RED: Add UI tests in `tests/admin-ai-tab.test.js` asserting `#llm-model` renders as `<select disabled>` initially and populates `<option>` elements on key verification.
- [x] 3.2 GREEN: Convert `#llm-model` to `<select disabled>` in `public/admin.html`, updating `updateProviderFields()`, `loadAiSettings()`, and `btnVerifyLlm` listener for dynamic option rendering and disabled state toggles.
- [x] 3.3 REFACTOR/VERIFY: Run `node --test tests/admin-ai-tab.test.js` to verify dynamic option populating and UI state transitions.

## Phase 4: Full Verification & Cleanup

- [x] 4.1 REFACTOR/VERIFY: Run full test suite `npm test` to verify all dynamic LLM model selection scenarios pass without regressions.
