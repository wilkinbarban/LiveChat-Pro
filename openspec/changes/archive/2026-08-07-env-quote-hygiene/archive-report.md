# Archive Report: env-quote-hygiene

- **Archived**: 2026-08-07
- **Archive commit**: `31dba46` (`docs(sdd): archive change env-quote-hygiene and sync main specs`)
- **Merged to main**: 5d04b1f (PRs #30 config core, #31 nested consumers, #32 docs + E2E — implementation + verify complete at close)
- **Source of truth synced**: `openspec/specs/env-normalization/spec.md` (NEW capability), `openspec/specs/admin-settings/spec.md` (APPENDED 1 requirement / 4 scenarios)
- **Delivery**: unmanaged (no `reviewGate` topics exist for this change; native review gate not governing — `disabled/unmanaged` relaxation applies)

## Final Verification Status

**PASS** — per `verify-report.md` (and Engram obs #342, written at close 21:29):

| Metric | Value |
|--------|-------|
| Verdict | pass |
| Requirements | 7/7 (19/19 scenarios compliant — 15 env-normalization + 4 admin-settings) |
| Tests | 443 passed / 0 failed / 0 skipped / 0 todo (33 suites) — exit 0 (`SETTINGS_KEY=0123456789abcdef0123456789abcdef npm test`, fresh worktree `Chat-worktrees/env-quote-hygiene/verify-5d04b1f` @ 5d04b1f) |
| Build | `npx biome check .` exit 0 (25 warnings / 55 infos, all pre-existing baseline; 0 errors) |
| CRITICAL findings | 0 |
| WARNING findings | 0 |

The 4 EACCES failures observed on the host checkout are environmental (host `data/.admin-secret` owned by uid-1000 vs shell uid-1001) and are NOT regressions; the 443/443 run was executed in the verification worktree with symlinked `node_modules`. `data/` was not chowned, per scope.

## Task Completion

**9/9 implementation tasks complete** — verified in the persisted tasks artifact (`tasks.md`, all `- [x]`: 1.1–1.3, 2.1–2.3, 3.1–3.3). Task Completion Gate passed before spec sync and archive move. No stale unchecked implementation tasks remain in the archived audit trail.

## Spec Updates (delta → main source of truth)

### `openspec/specs/env-normalization/spec.md` (NEW capability)
| Action | Details |
|--------|---------|
| CREATED | New capability dir + full spec copied verbatim from the change delta: 6 requirements (String Env Values Quote-Normalized, CSV Env Values Per-Item Normalized, Boolean Env Values Parsed with Fallback, aiBot Legacy Env Consolidated in config.aiBot, Nested Consumer Env Reads Normalized, Normalization Is Read-Only for Legacy Vars) / 15 scenarios. Byte-identical to the archived delta (verified with `diff`). |

### `openspec/specs/admin-settings/spec.md`
| Action | Requirement | Details |
|--------|-------------|---------|
| ADDED | Settings Key Derivation Normalizes SETTINGS_KEY | Appended at end of Requirements section: quote/whitespace strip of `SETTINGS_KEY` before key derivation in `resolveSettingsKey()`; quoted 64-hex used as hex key, quoted non-hex sha256-hashed from stripped value; BREAKING change documented (one-time secret re-entry, MUST NOT dual-key "try both"); 4 scenarios (quoted 64-hex, quoted non-hex, breaking-change re-entry, boot warning). |

Untouched requirements (Settings KV Persistence, Runtime Reconfigure Without Restart, Admin Auth and CSRF on All New Endpoints, AI Dashboard Summary Header and Global Toggle, Admin Panel i18n Convention) survive byte-identical — merge is a pure append (31 insertions / 0 deletions in `git diff --stat`).

**Delta-vs-main cross-check (themes archive precedent)**: the admin-settings delta was authored 2026-08-07 20:35, AFTER the last change to the main spec (archive commit a1e8a34, 19:27). The change was authored and verified against current main, so a verbatim append carries no union-merge risk. Intro paragraph checked: no stale text — no deviation needed.

## Engram Audit Trail (project `livechat-pro`)

| Artifact | Observation ID |
|----------|----------------|
| explore | #335 |
| proposal | #336 |
| spec | #337 |
| design | #338 |
| apply-progress (slice-3 validation) | #341 — marked ARCHIVED (superseded by this report) |
| tasks | #340 |
| verify-report | #342 |
| archive-report (this mirror) | saved as topic `sdd/env-quote-hygiene/archive-report` |

## Superseded Intermediate Claims (Final-State Authority)

Per the Final-State Authority hierarchy, `apply-progress` (obs #341) is an intermediate snapshot written at slice-3 validation time (21:05) and is NOT the final state of the change. The final state at close:

- All 3 PR slices (PR #30 slice-1 config core, PR #31 slice-2 nested consumers, PR #32 slice-3 docs + E2E) are **merged to main** (5d04b1f merge commit).
- All 9/9 tasks complete; 443/443 tests pass; biome clean (25w/55i pre-existing baseline); 7/7 requirements / 19/19 scenarios compliant (see verify-report / obs #342).
- Any pending/blocked claims in obs #341 refer only to that snapshot's moment and are resolved by the final verification evidence.

## Review Gate Note

No `sdd/env-quote-hygiene/review/{transaction,ledger,receipt,gate-context}` topics exist (Engram search returned none). Per the Native Review Receipt Gate, delivery is `unmanaged` — the only relaxation allowed, since the kill switch is off and no review governs this change. Archive proceeds on that basis.

## Deviations and Notes

- **Git tracking state vs launch prompt**: the launch prompt expected `proposal.md`, `design.md`, `specs/` to be git-tracked; actual repo state had only `tasks.md` tracked (proposal/design/specs/verify-report untracked). Handled with `git mv` for the tracked `tasks.md` and `git add` for the untracked files — all archive contents identical, no content change.
- **Stale main-spec intros**: none found. Grep across `openspec/specs/` for "raw"/"never normalized" claims returned only legitimate usages ("render the raw key", historical `(Previously: env-only token used raw.)` annotations). No documentation contradictions to fix.
- No source code or tests touched; no `data/` chown; no `npm test` re-run (verify already proved 443/443 in a fresh worktree).

## Archive Contents

- proposal.md ✅
- specs/ (env-normalization, admin-settings) ✅
- design.md ✅
- tasks.md ✅ (9/9)
- verify-report.md ✅
- archive-report.md ✅ (this file)

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Ready for the next change.
