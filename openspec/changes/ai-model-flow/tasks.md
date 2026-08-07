# Tasks: AI Model Flow (ai-model-flow)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~460–520 (PR1≈240, PR2≈90, PR3≈140) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 listModels+route; PR2 modal+i18n; PR3 boot+rag_context |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Work Units

| Unit | Focused test | Rollback |
|------|--------------|----------|
| 1 listModels+verify-key | `node --test tests/llm-adapters.test.js tests/admin-llm-routes.test.js` | Revert admin.js 2 lines |
| 2 Modal UX+i18n | `node --test tests/admin-ai-tab.test.js` | Revert admin.html modal + i18n keys |
| 3 Boot rehydration+rag_context | `node --test tests/ai-bot.test.js tests/boot-without-token.test.js` | Remove server.js block; revert ai-bot 4 lines |

## Phase 1: Slice A — listModels + verify-key (PR 1)
Verify: llm-adapters + admin-llm-routes tests + biome

- [x] 1.1 [RED] llm-adapters.test.js: listOpenAiCompatibleModels GET {base}/models; Bearer; data[].id; 404/405/net/unknown→[]
- [x] 1.2 [RED] llm-adapters.test.js: listAnthropicModels GET api.anthropic.com/v1/models; x-api-key+anthropic-version; 404/405/net→[]
- [x] 1.3 [RED] admin-llm-routes.test.js: add listModels to mock; verify-key returns API models; []→catalog
- [x] 1.4 [GREEN] llm/openai-compatible.js: export listOpenAiCompatibleModels({provider, apiKey, baseURL, fetchImpl})
- [x] 1.5 [GREEN] llm/anthropic.js: export listAnthropicModels({apiKey, fetchImpl})
- [x] 1.6 [GREEN] llm/index.js: listModels(provider, apiKey, {fetchImpl, baseURL}) dispatch; [] unknown; verifyConnection untouched
- [x] 1.7 [GREEN] routes/admin.js verify-key L354-379: apiModels = fn? await listModels : []; models = apiModels.length? apiModels : catalogModels
- [x] 1.8 [REFACTOR] run phase verify; 401/403 tests untouched

## Phase 2: Slice B — Two-step modal UX + i18n (PR 2)
Verify: admin-ai-tab test + biome

- [ ] 2.1 [RED] admin-ai-tab.test.js L131: verify_save_key→verify_connection; add 3 keys ×5 (fr U+2019)
- [ ] 2.2 [GREEN] admin.html L245: relabel #btn-verify-llm → ai.modal.verify_connection
- [ ] 2.3 [GREEN] admin.html: add #btn-modal-save-close ai.modal.save_and_close
- [ ] 2.4 [GREEN] admin.html JS L1048-1108: verify-only (populate #llm-model, modalVerified, no save); save-close PUT providers/:name → close → loadLlmSettings
- [ ] 2.5 [GREEN] admin.html populateModelDropdown L938: sort + cap 50 openrouter
- [ ] 2.6 [GREEN] admin.html i18n ×5 L465-469: rename + 3 keys (fr U+2019)
- [ ] 2.7 [REFACTOR] run phase verify; save-model kept

## Phase 3: Slice C — Boot rehydration + {rag_context} (PR 3)
Verify: ai-bot + boot-without-token tests + biome

- [ ] 3.1 [RED] ai-bot.test.js: resolveLlmBootConfig precedence, decrypt-fail→null, no default→null
- [ ] 3.2 [RED] ai-bot.test.js: getReply rag_context inside getFormattedPrompt vars; empty→''
- [ ] 3.3 [GREEN] ai-bot.js: export resolveLlmBootConfig({settingsService, logger}) → {provider, model, defaultProvider, enabled, masterPromptService, ragService} | null
- [ ] 3.4 [GREEN] ai-bot.js getReply L224-228: RAG first; pass {rag_context}; remove append
- [ ] 3.5 [GREEN] ai-bot.js getSystemPrompt L285: extra forwards rag_context
- [ ] 3.6 [GREEN] server.js: masterPromptService+ragService near L439, admin deps L453; start() after initDb L527 once-only try/catch → aiBot.configure; env init untouched
- [ ] 3.7 [REFACTOR] run phase verify; env-only init not clobbered

## Phase 4: Full verification

- [ ] 4.1 `npm test` — all green
- [ ] 4.2 `npx biome check .` clean
- [ ] 4.3 No new test file; suites registered in package.json scripts.test
