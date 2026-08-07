# Tasks: AI UI Overhaul

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 420 - 480 lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Markup/i18n) -> PR 2 (Grid/Default) -> PR 3 (Modal) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | i18n Dictionaries & UI Layout Markup/CSS | PR 1 | `npm test` | Serve `public/admin.html` | Revert `public/admin.html` markup/CSS |
| 2 | JS State, Grid Rendering, Toggle & 1-Click Default | PR 2 | `npm test` | Admin dashboard AI tab interaction | Revert JS controller grid/toggle functions |
| 3 | Modal Editor, Key Masking, Verify & Save Model | PR 3 | `npm test` | Admin dashboard Modal drawer flows | Revert JS modal handlers |

## Phase 1: i18n & Layout Structure (PR 1)

- [x] 1.1 RED: Write DOM/dictionary test verifying AI tab markup containers and 5-language `ai.*` i18n keys in `public/admin.html`.
- [x] 1.2 GREEN: Add 5-language (`es`, `en`, `pt`, `fr`, `de`) `ai.*` dictionary keys, CSS styles, Summary Header, 6 Provider Cards Grid, and Modal Drawer markup in `public/admin.html`.
- [x] 1.3 REFACTOR: Clean up CSS classes and ensure CSP compliance without external assets in `public/admin.html`.

## Phase 2: JS State, Summary Header & Provider Grid (PR 2)

- [x] 2.1 RED: Write JS test for `llmState` management, Summary Header toggle, 6 provider grid render, and `PUT /api/admin/llm/default` 1-click switch.
- [x] 2.2 GREEN: Implement `loadLlmSettings`, `renderProviderCards`, global AI toggle switch, and 1-click `setDefaultProvider` in `public/admin.html` JS controller.
- [x] 2.3 REFACTOR: Optimize DOM updates to re-render grid efficiently on state changes in `public/admin.html`.

## Phase 3: Provider Editor Modal & API Integration (PR 3)

- [x] 3.1 RED: Write JS test for Modal drawer opening with masked key (`...1234`), dynamic model dropdown, "Verificar y Guardar API Key", and "Guardar Modelo".
- [x] 3.2 GREEN: Implement `openProviderModal`, key masking logic, `handleVerifyAndSaveKey` (`POST /verify-key` + `PUT /providers/:name`), and `handleSaveModel` (`PUT /providers/:name` without verify).
- [x] 3.3 REFACTOR: Unify error handling and toast notifications across key verification and model save in `public/admin.html`.

## Phase 4: End-to-End Verification & i18n Audit

- [x] 4.1 VERIFY: Execute 5-language i18n audit across `es`, `en`, `pt`, `fr`, `de` on all AI tab UI elements in `public/admin.html`.
- [x] 4.2 VERIFY: Perform full end-to-end verification of initial load, 1-click default switch, key verification, model save, and global toggle.
