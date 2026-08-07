# Tasks: Auto-Activate LLM Provider on Initial Setup

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 110-170 lines |
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
| 1 | Auto-activate default provider on save & dynamic GET settings fallback | PR 1 | `node --test tests/admin-llm-routes.test.js` | N/A (unit/integration test suite) | Revert `src/routes/admin.js` and test diffs |
| 2 | Catalog default model resolution on PUT default endpoint | PR 1 | `node --test tests/admin-llm-routes.test.js` | N/A (unit/integration test suite) | Revert `src/routes/admin.js` and test diffs |

## Phase 1: Auto-Activate Default Provider on Save

- [x] 1.1 [RED] Add unit tests in `tests/admin-llm-routes.test.js` for auto-activation when `llm.default_provider` is unset, and preservation when set.
- [x] 1.2 [GREEN] Update `handlePutLlmProvider` in `src/routes/admin.js` to set `llm.default_provider` to `normProvider` when `apiKey` is provided and no default is set.
- [x] 1.3 [REFACTOR/VERIFY] Run `node --test tests/admin-llm-routes.test.js` to confirm provider save auto-activation tests pass.

## Phase 2: Dynamic GET Settings Fallback

- [x] 2.1 [RED] Add unit test in `tests/admin-llm-routes.test.js` asserting `GET /api/admin/settings/llm` returns first configured provider when DB default is unset.
- [x] 2.2 [GREEN] Modify `handleGetLlmSettings` in `src/routes/admin.js` to track `firstConfiguredProvider` and use it as `defaultProvider` fallback (or `null` if none configured).
- [x] 2.3 [REFACTOR/VERIFY] Run `node --test tests/admin-llm-routes.test.js` to verify GET settings fallback scenarios.

## Phase 3: Dynamic Catalog Default Model Resolution

- [x] 3.1 [RED] Add unit test in `tests/admin-llm-routes.test.js` asserting `PUT /api/admin/llm/default` resolves model to `getProviderModels(provider)[0]`.
- [x] 3.2 [GREEN] Update `handlePutLlmDefault` in `src/routes/admin.js` to resolve model using `llmService.getProviderModels(provider)[0] || 'gpt-4o-mini'`.
- [x] 3.3 [REFACTOR/VERIFY] Run `node --test tests/admin-llm-routes.test.js` to ensure default model resolution tests pass.

## Phase 4: Integration Verification

- [x] 4.1 Execute full test suite `node --test tests/admin-llm-routes.test.js` and verify zero failures across all route behaviors.
