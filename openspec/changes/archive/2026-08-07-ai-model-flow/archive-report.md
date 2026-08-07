# Archive Report: ai-model-flow

**Change**: ai-model-flow — API-verified model listing + two-step provider config, boot rehydration, RAG placeholder fix
**Archived to**: `openspec/changes/archive/2026-08-07-ai-model-flow/`
**Archive date**: 2026-08-07
**Project**: livechat-pro (repo `/home/wilkin/proyectos/Chat`)
**Artifact store mode**: hybrid (`both`) — delta specs synced into `openspec/specs/`, change folder moved to archive, Engram mirror persisted.

## Final Verification Status

**VERDICT: PASS** (per `verify-report.md`, persisted 2026-08-07, Engram obs #327)

| Metric | Value |
|--------|-------|
| Requirements | 5/5 compliant |
| Scenarios | 19/19 compliant |
| Tests | 403 passed / 0 failed / 21 suites / 0 skipped (`SETTINGS_KEY=… npm test`, exit 0 — run in fresh worktree `/home/wilkin/proyectos/Chat-worktrees/verify-ai-model-flow` with writable `data/`) |
| Build/lint | `npx biome check .` exit 0 (25 warnings / 55 infos = documented pre-existing baseline; `public/admin.html` out of biome scope) |
| Host-checkout run | 356 tests / 352 pass / 4 fail — the 4 failures are the KNOWN EACCES environmental baseline (`data/.admin-secret` owned by uid 1000, shell uid 1001) in api.test.js, dead-code-audit.test.js, telegram-routing.test.js, translation-cache.test.js; byte-identical to main's baseline, proven non-regressive by the 403/403 fresh-worktree run. `data/` NOT chowned. |
| Coverage | Not available — no coverage tool configured (informational, not a failure) |
| CRITICAL issues | None |
| WARNING issues | None (host 4 × EACCES are environmental baseline, not warnings on the change) |
| ADR conformance | 8/8 ADRs followed (ADR 1 … ADR 8) |

## Task Completion

**25/25 tasks complete** (`tasks.md` 1.1–4.3, all `[x]`). No unchecked implementation tasks; no stale checkboxes required reconciliation. Strict-TDD evidence: per-slice RED→GREEN→REFACTOR cycles recorded in apply-progress obs #323 (slices A + B + C complete), phase-4 full verification green in verify-report obs #327.

## Specs Synced into Source of Truth

Delta specs merged BEFORE the archive move (Step 2 → Step 3 order per sdd-archive skill). MODIFIED blocks replace the entire requirement verbatim, including the `(Previously: ...)` annotation (repo precedent from `telegram-control` archive, commit `2c23c96`).

| Domain | Action | Details |
|--------|--------|---------|
| `llm-providers` | Updated | 2 ADDED (Runtime Provider Rehydration at Boot, RAG Context Substitution in Formatted Master Prompt), 1 MODIFIED (API Key Management with Connection Verification — two-step flow, live API models, static-catalog fallback, OpenRouter cap 50). Other 6 requirements untouched. |
| `admin-settings` | Updated | 2 MODIFIED (Runtime Reconfigure Without Restart — boot rehydration no-clobber; Admin Panel i18n Convention — two-step modal keys + U+2019). Other 3 requirements untouched. |

Merged files:
- `openspec/specs/llm-providers/spec.md` — 9 requirements (was 7; 2 appended at end of Requirements, 1 replaced)
- `openspec/specs/admin-settings/spec.md` — 5 requirements (was 5; 2 replaced)

All three MODIFIED blocks verified byte-faithful against the delta specs (scripted diff check). Both main-spec intros were reviewed for staleness: the `llm-providers` intro ("Multi-provider LLM configuration managed at runtime from the admin panel…") and the `admin-settings` intro are consistent with the merged requirements — **no intro fix was needed** (unlike the telegram-control precedent, where the intro still said "token env-only"). No source code or tests were modified; the archive commit contains `openspec/` changes only.

## Implementation Summary

Delivered as a stacked-to-main chain of 3 chained PR slices (#24 → #26), per the tasks.md Review Workload Forecast (400-line budget risk Medium → auto-chain, stacked-to-main, split PR1 listModels+route / PR2 modal+i18n / PR3 boot+rag_context).

| Slice | PR | Scope | Key changes |
|-------|----|-------|-------------|
| 1 | #24 | listModels + verify-key | `listOpenAiCompatibleModels` (GET `{base}/models`, Bearer) and `listAnthropicModels` (GET `/v1/models`, `x-api-key` + `anthropic-version`) exported from adapters; `LlmService.listModels(provider, apiKey, {fetchImpl, baseURL})` dispatch, `[]` on 404/405/network/unknown; `verify-key` route returns `models = apiModels.length ? apiModels : catalogModels` → `{ok:true, models}` (catalog kept as fallback, never removed) |
| 2 | #25 | Two-step modal UX + i18n | `#btn-verify-llm` → "Comprobar conexión" (verify-only, populates `#llm-model`, `modalVerified` gate, never persists/closes); NEW `#btn-modal-save-close` "Guardar y Cerrar" (PUT `/providers/:name` → close → reload); `populateModelDropdown` sorts + caps OpenRouter ~50; i18n keys ×5 (es/en/pt/fr/de, fr uses U+2019); masked key display `...1234`; "Guardar Modelo" kept without re-verify |
| 3 | #26 | Boot rehydration + {rag_context} | Exported `resolveLlmBootConfig({settingsService, logger})` (settings-backed wins, decrypt-fail → warn → env init stays, default-only no failover); `server.js start()` wires rehydration after `initDb` (once-only, try/catch non-fatal) with shared `masterPromptService` + `ragService` instances; `getReply` fetches RAG FIRST and passes `{rag_context}` into `getFormattedPrompt` (placeholder substituted in place, append block removed, empty → `''`) |

Final state: `npm test` 403/403 green in fresh worktree (host 356/352/4 EACCES environmental baseline unchanged); `npx biome check .` exit 0; PRs #24 #25 #26 merged to main (`65a504c`, `9111299`, `e60790b`).

## Engram Audit Trail

| Artifact | Engram obs ID |
|----------|---------------|
| explore | #318 (`obs-2178b47cd48033fb`) |
| proposal | #319 (`obs-6d8a3d4b35f4cbb8`) |
| spec (delta) | #320 (`obs-eb1ef42c3e7101d8`) |
| design | #321 (`obs-64e05b0340f61707`) |
| tasks | #322 (`obs-61d4f0a434b5efc5`) |
| apply-progress (slices A+B+C COMPLETE) | #323 (`obs-680291a8cb158f63`) — marked ARCHIVED in Engram at archive time |
| verify-report | #327 (`obs-d2725162559dc504`) |
| archive-report (this file) | #328 (`obs-0e8053de42d94dcd`) — Engram topic `sdd/ai-model-flow/archive-report` (mirror persisted at archive time) |

**Native review gate**: no formal `reviewGate` structured status and no review transaction/ledger/receipt/gate-context topics exist for this change (confirmed via Engram search) — review delivery is `unmanaged` (kill switch off, no review governs this change). Archive proceeded per the explicit orchestrator launch with the PASS verify-report (obs #327) as the delivery authority. Same resolution as the `telegram-control` archive precedent.

## Rollback / Migration Notes (recorded, no action taken)

- Rollback = revert the 3 stacked PR slices (reverse order `6131d7a 8f6a95e b802e01`); removing the `server.js` rehydration block restores env-only init; restoring the combined verify+save handler reverts the modal.
- `listModels` may stay after rollback (returns `[]` → catalog fallback is a no-op); `verifyConnection` untouched either way.
- No DB migration; settings rows `llm.*` / `ai.enabled` remain valid and are read at boot by `resolveLlmBootConfig`.
- Settings survive container rebuilds via the volume-persisted database (proposal success criterion — requires container rebuild to confirm E2E).

## Deviations

- **Host test run** (356/352/4): 4 EACCES failures are the pre-existing environmental baseline (uid mismatch on `data/`), not regressions — documented in verify-report and apply-progress; proven non-regressive by the 403/403 all-green fresh-worktree run.
- **No stale main-spec intro** found (see Specs Synced note) — no documentation-only intro fix needed this cycle.
- **No `state.yaml`** existed in the change folder (consistent with the `telegram-control` archive); the archived folder contains proposal, delta specs, design, tasks, verify-report, and this archive report.
- **tasks.md was tracked-but-uncommitted** at archive time: sdd-apply marked tasks `[x]` in the working tree without committing (commit convention keeps source-only commits); the archive commit captures the final `[x]` state.

## SDD Cycle Complete

The `ai-model-flow` change has been fully planned (exploration + proposal + delta specs), designed (ADR 1..ADR 8), implemented (3 PR slices #24–#26), verified (PASS, 5/5 req, 19/19 scenarios, 403/403 tests fresh-worktree, biome exit 0), and archived. Ready for container rebuild + E2E.
