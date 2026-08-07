# Archive Report: telegram-control

**Change**: telegram-control — Token & Admin Fields in the Admin UI, 404 Fix
**Archived to**: `openspec/changes/archive/2026-08-07-telegram-control/`
**Archive date**: 2026-08-07
**Project**: livechat-pro (repo `/home/wilkin/proyectos/Chat`)
**Artifact store mode**: hybrid (`both`) — delta specs synced into `openspec/specs/`, change folder moved to archive, Engram mirror persisted.

## Final Verification Status

**VERDICT: PASS** (per `verify-report.md`, persisted 2026-08-07)

| Metric | Value |
|--------|-------|
| Requirements | 5/5 compliant |
| Scenarios | 16/16 compliant |
| Tests | 370 passed / 0 failed / 30 suites / 0 skipped (`npm test`, exit 0) |
| Build/lint | `npx biome check .` exit 0 (25 warnings / 54 infos = documented pre-existing baseline; admin.html out of biome scope) |
| Coverage | Not available — no coverage tool configured (informational, not a failure) |
| CRITICAL issues | None |
| WARNING issues | None |
| ADR conformance | 10/10 ADRs followed (ADR-1 … ADR-10) |

## Task Completion

**25/25 tasks complete** (`tasks.md` 1.1–7.3 + 4.4, all `[x]`). No unchecked implementation tasks; no stale checkboxes required reconciliation. Strict-TDD evidence: 6/6 checks passed (RED tests verified on disk, GREEN 370/370 fresh run, per-slice RED→GREEN→REFACTOR cycles recorded in apply-progress obs #305).

## Specs Synced into Source of Truth

Delta specs merged BEFORE the archive move (Step 2 → Step 3 order per sdd-archive skill).

| Domain | Action | Details |
|--------|--------|---------|
| `telegram-admin` | Updated | 2 MODIFIED (Telegram Status and Control Module, Boot Without Telegram Token), 1 ADDED (Settings-Backed Token Storage and Verification). Untouched requirement "Reply Routing and Translation Preserved" preserved byte-identical (intentionally not delta'd). |
| `admin-settings` | Updated | 2 MODIFIED (Runtime Reconfigure Without Restart, Admin Panel i18n Convention). Other 3 requirements untouched. |

Merged files:
- `openspec/specs/telegram-admin/spec.md` — 4 requirements (was 3)
- `openspec/specs/admin-settings/spec.md` — 5 requirements (was 5, 2 replaced)

Note: the `telegram-admin` spec intro paragraph was updated (documentation-only) from "token stays env-bootstrap and is NOT managed in the UI" to "token is settings-backed (UI-managed, encrypted) with env bootstrap/fallback" — required so the source-of-truth spec does not contradict the newly merged requirements. No source code or tests were modified; the archive commit contains openspec/ changes only.

## Implementation Summary

Delivered as a stacked-to-main chain of 7 chained PR slices (#17 → #23), per the tasks.md Review Workload Forecast (400-line budget risk High → auto-chain, stacked-to-main).

| Slice | PR | Scope | Key changes |
|-------|----|-------|-------------|
| 1 | #17 | Config quote fix | `stripEnvQuotes()` exported from `src/config/index.js`, applied to `TELEGRAM_TOKEN` read (L80); `ADMIN_PANEL_PASSWORD` read refactored to reuse it; fixes Telegram API 404 on JSON-quoted env token |
| 2 | #18 | HMAC decoupling | `resolveAdminSigningSecret` always uses persisted `data/.admin-secret` (0600, create on first boot); `telegramToken` branch and `createAdminAuth` param dropped — token rotation no longer invalidates admin sessions (one-time re-login on first deploy documented) |
| 3 | #19 | Bot core | `verifyTelegramToken`, `reconfigureTelegramBot` (stop→setup→launch), `resolveTelegramToken` (settings > env > none, decrypt-failure → env fallback + warn), lazy `refreshTelegramIdentity` (5-min cache, never at boot/launch — FakeTelegraf-safe); `getTelegramStatus` gains `botUsername`/`botFirstName`/`maskedToken`/`tokenSource`; `startTelegramBot` always re-setups from `_deps` |
| 4 | #20 | Server wiring | `server.js start()` resolves token via `resolveTelegramToken` after `initDb` (non-fatal try/catch — boot never hard-fails); health `telegramReady` becomes a live getter over `getTelegramStatus().status === 'running'`; stale `telegramReady` module var removed |
| 5 | #21 | Admin routes | `handlePutTelegram` shared dispatcher (token → adminId/admin_id → adminUsername → 400) bound on both PUT aliases behind `requireAdmin` + `requireCsrf`; token flow mirrors LLM verify→encryptSecret→setJSON→reconfigure launch:true; GET status enriched (identity + masked token + source + adminUsername), never `token`/`botToken` |
| 6 | #22 | Admin UI + i18n | `admin.html` Telegram tab: token input + save/verify, identity display, admin username field; `telegram.saved` + new keys added to all 5 dictionaries (es/en/pt/fr/de); existing 12 `telegram.*` keys and DOM ids kept |
| 7 | #23 | Docs + verify | `.env.example` token note (UI-managed bootstrap/fallback); README env table + Telegram tab note + one-time re-login note; final verification (370/370, biome exit 0) |

Final state: `npm test` 370/370 green; `npx biome check .` exit 0; git tree clean before archive.

## Engram Audit Trail

| Artifact | Engram obs ID |
|----------|---------------|
| explore | #300 (`obs-7f5d5510c3c33f88`) |
| proposal | #301 (`obs-376aff2cd6349f5c`) |
| spec (delta) | #302 (`obs-eda8af2ff436bc68`) |
| design | #303 (`obs-f34f50b89c3f3b9c`) |
| tasks | #304 (`obs-ee91182a5972ea98`) |
| apply-progress (slices 1-7 ALL COMPLETE) | #305 (`obs-04209f518a5c4a0c`) — marked ARCHIVED in Engram |
| verify-report | #308 (`obs-9c6cebfb06a756f5`) |
| archive-report (this file) | Engram topic `sdd/telegram-control/archive-report` (mirror persisted at archive time) |

Supporting discoveries: #306 (slice 2 sdd-attempt ledger terminal-state blocker, resolved — HMAC decoupling landed in PR #18), #307 (independent slice 6 phase-contract validation PASS).

**Native review gate**: no formal `reviewGate` structured status or review transaction/ledger/receipt/gate-context topics exist for this change — review delivery is `unmanaged` (kill switch off, no review governs this change). Archive proceeded per the explicit orchestrator launch with the PASS verify-report (obs #308) as the delivery authority.

## Rollback / Migration Notes (recorded, no action taken)

- Rollback = revert stacked commits; env-token fallback preserved by precedence (installs that never saved a UI token keep working).
- To remove a UI-saved token: save empty in the UI (or delete the `telegram.token` settings row) → bot falls back to env or stops.
- No schema migration; settings KV rows only. One-time admin re-login expected on first deploy after HMAC decoupling.

## SDD Cycle Complete

The `telegram-control` change has been fully planned (proposal + delta specs), designed (ADR-1..ADR-10), implemented (7 PR slices #17–#23), verified (PASS, 5/5 req, 16/16 scenarios, 370/370 tests), and archived. Ready for container rebuild + E2E.
