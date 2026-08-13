# Tasks: Systemic Audit Remediation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1400 total, split into autonomous slices capped at 400 authored lines each |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (State) -> PR 2A (RAG bounds + secret-safe logging) -> PR 2B (Network safety) -> PR 3 (Infra) -> PR 4A (Hygiene/GC) -> PR 4B (Routers) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Cluster 1: Write-ahead session & admin-chat sync | PR 1 | `node --test tests/session-sync.test.js tests/widget-responsive.test.js` | Isolated `DATA_DIR=$(mktemp -d)` socket join test | `src/sockets/index.js`, `src/services/sessions.js`, `src/services/admin-chat.js`, `db.js` |
| 2A | RAG service bounds and secret-safe request logging | PR 2A | `node --test tests/rag-bounds.test.js tests/logger-redact.test.js tests/rag-core.test.js` | Exact request-logging middleware seam used by `server.js`, exercised without server bootstrap or secret-file reads; RAG transaction seams | Both OpenSpec planning files plus `src/services/rag.js`, `src/utils/logger.js`, `server.js`, `tests/rag-bounds.test.js`, and `tests/logger-redact.test.js`; no PR 2B files |
| 2B | Registry-aligned SSRF and bounded network ingestion | PR 2B, depends on PR 2A | `node --test tests/fetch-ssrf.test.js tests/admin-rag-routes.test.js` | Deterministic injected DNS/transport/stream harness covering connection pinning, redirects, literals, lookup timeout, and body aborts | `src/utils/fetch.js`, `src/routes/admin.js`, `tests/fetch-ssrf.test.js`, relevant route tests |
| 3 | Cluster 3: Shutdown coordinator & infra lifecycle | PR 3 | `node --test tests/shutdown.test.js tests/auth-secret.test.js tests/presence.test.js` | Isolated temp env SIGTERM harness & `docker compose config` | `src/services/shutdown.js`, `server.js`, `cluster-state.js`, `src/security/admin-auth.js`, `docker-compose.yml` |
| 4A | Cluster 4A: Hygiene, attachment GC & test runner | PR 4A | `node --test tests/hygiene.test.js tests/test-script.test.js` | `node scripts/run-tests.js` against temp fixture tree | `src/services/attachments.js`, `src/services/sessions.js`, `db.js`, `scripts/run-tests.js`, `package.json` |
| 4B | Cluster 4B: Admin sub-routers & alias telemetry | PR 4B | `node --test tests/admin-routes.test.js tests/alias-telemetry.test.js` | Isolated Express router integration test harness | `src/routes/admin.js`, `src/routes/admin-sessions.js`, `src/routes/admin-settings.js`, `src/routes/admin-rag.js` |

## Phase 1: Session State Sync (Cluster 1)

- [x] 1.1 RED: Write `tests/session-sync.test.js` covering write-ahead commit/abort in `sessions.js` & `admin-chat.js`, `getMessagesBySessions` SQL count, and greeting race. Verify: `node --test tests/session-sync.test.js`. Rollback: revert `tests/session-sync.test.js`.
- [x] 1.2 GREEN: Update `src/services/sessions.js`, `src/services/admin-chat.js` & `db.js` with batch `getMessagesBySessions` using `json_each(?)` and write-ahead SQLite commits before socket emits. Verify: write failure prevents emit. Scope: `src/services/sessions.js`, `src/services/admin-chat.js`, `db.js`. Rollback: revert session/admin-chat/db files.
- [x] 1.3 GREEN: Update `src/sockets/index.js` with `BEGIN IMMEDIATE` greeting check, preserving user edits in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js`. Verify: `node --test tests/widget-responsive.test.js`. Scope: `src/sockets/index.js`. Rollback: revert `src/sockets/index.js`.

## Phase 2: Bounded Ingestion (Cluster 2, two autonomous slices)

- [x] 2.1A TESTS (PR 2A): Retain `tests/rag-bounds.test.js` and helper-level logger-redaction coverage for the 3 MiB/10-document RAG limits and case-insensitive URL secret redaction. Historical RED output for this retained work is unavailable and MUST NOT be reconstructed. The corrective rerun adds separate fresh RED→GREEN behavior proof through the exact request-logging middleware seam used by `server.js`. Scope: the two test files. Rollback: remove the two tests and restore both OpenSpec planning files; no PR 2B files.
- [x] 2.1B RED (PR 2B, depends on PR 2A): Add a fresh `tests/fetch-ssrf.test.js` threat matrix before network production code. It MUST prove registry-aligned IPv4/IPv6 global-routability semantics, including non-global `100:0:0:1::1` and `2001:100::1`, globally reachable exceptions `192.0.0.9` and `192.0.0.10`, mapped IPv4, bracketed valid/global IPv6 URL literals, per-hop DNS pinning/revalidation, misleading/absent content length, redirect limits, and a 10 s bound that includes unresolved DNS lookup. Verify RED against the absent boundary. Scope: `tests/fetch-ssrf.test.js`. Rollback: remove the test file.
- [x] 2.2 GREEN (PR 2B, depends on 2.1B): Create `src/utils/fetch.js` and wire the current composition root `src/routes/admin.js` to it. Use a comprehensive registry-aligned global-routability source rather than a divergent hand-maintained exclusion table; normalize bracketed IPv6 literals before classification while preserving valid URL syntax; pin every accepted A/AAAA result; revalidate redirects; and enforce the timeout across DNS, transport, redirects, and bounded 5 MiB streaming. Verify: `node --test tests/fetch-ssrf.test.js tests/admin-rag-routes.test.js`. Scope: `src/utils/fetch.js`, `src/routes/admin.js`, network-specific route tests. Rollback: remove `src/utils/fetch.js` and restore the route fetch dependency.
- [x] 2.3 GREEN (PR 2A): Update `src/services/rag.js` to enforce the 3 MiB UTF-8 `stageText` limit and process at most 10 oldest pending documents, one transaction per document, leaving later/unpromoted work retryable after failure. Behavioral proof also asserts the executed selection SQL contains ascending creation ordering and `LIMIT 10`; historical RED output remains unavailable. Verify: `node --test tests/rag-bounds.test.js tests/rag-core.test.js`. Scope: `src/services/rag.js`. Rollback: restore both OpenSpec planning files, revert the RAG service changes, and remove `tests/rag-bounds.test.js`; no PR 2B files.
- [x] 2.4 GREEN (PR 2A): Update `src/utils/logger.js` and integrate its injectable request-logging middleware seam in `server.js` to redact case-insensitive `token`, `access_token`, `api_key`, `key`, `signature` query parameters and URL tokens. Fresh corrective RED failed because the middleware export was absent; GREEN executes the exact seam used by `server.js` without booting the environment or reading `data/.admin-secret`. Verify: `node --test tests/logger-redact.test.js`. Scope: `src/utils/logger.js`, `server.js`. Rollback: restore both OpenSpec planning files, revert `src/utils/logger.js`, `server.js`, and `tests/logger-redact.test.js`; no PR 2B files.

PR 2A starts from committed PR 1 (`b48f25f`) and ends with bounded RAG service work plus secret-safe request logging. Rollback restores `design.md` and `tasks.md` plus the current PR 2A code/tests (`src/services/rag.js`, `src/utils/logger.js`, `server.js`, `tests/rag-bounds.test.js`, `tests/logger-redact.test.js`) and touches no PR 2B files. PR 2B starts only after PR 2A and owns the entire network boundary. Updating `package.json` and complete test discovery remains deferred to task 4.4; focused explicit commands are authoritative until then, and no full-suite-green claim is permitted.

## Phase 3: Infrastructure Lifecycle (Cluster 3)

- [x] 3.1 RED: Write behavior-first lifecycle tests covering three-stage shutdown, composition-root ownership, explicit auth initialization, quoted/invalid PORT, lease expiry, and transient Redis cleanup recovery. Verify: tests run RED. Scope: `tests/shutdown.test.js`, `tests/auth-secret.test.js`, `tests/presence.test.js`. Rollback: revert tests.
- [x] 3.2 GREEN: Create `src/services/shutdown.js` and wire `server.js` for idempotent ordered shutdown whose independently failing transport cleanups are all attempted and reported. Verify: `node --test tests/shutdown.test.js`. Scope: `src/services/shutdown.js`, `server.js`. Rollback: remove `shutdown.js`, revert `server.js`.
- [x] 3.3 GREEN: Refactor `src/security/admin-auth.js` so construction and pre-initialization token APIs cannot create the secret; explicitly initialize the composed auth instance during startup. Verify: `node --test tests/auth-secret.test.js tests/boot-without-token.test.js`. Scope: `src/security/admin-auth.js`, `server.js`, compatibility test. Rollback: revert these auth lifecycle changes.
- [x] 3.4 GREEN: Update `cluster-state.js` with 60s/20s per-node leases and authoritative renewal snapshots that remove stale fields after transient deletion failure; normalize and reject invalid Compose PORT values. Verify: `node --test tests/presence.test.js`. Scope: `cluster-state.js`, `docker-compose.yml`. Rollback: revert those files.

## Phase 4: Tooling Hygiene & Routers (Cluster 4)

- [ ] 4.1 RED: PR 4A coverage is complete in `tests/hygiene.test.js` and `tests/test-script.test.js`, with captured RED failures for dead exports, GC, migration diagnostics, and tracked test discovery. PR 4B still requires `tests/admin-routes.test.js` and `tests/alias-telemetry.test.js`, so this aggregate task remains open. Scope: all four test files. Rollback: revert the applicable tests.
- [x] 4.2 GREEN (PR 4A): Remove dead exports `serializeMessage` & `listMessageAttachments` from `src/services/sessions.js` & `src/services/attachments.js`. Verify: retained imports load cleanly. Scope: `src/services/sessions.js`, `src/services/attachments.js`. Rollback: restore exports.
- [x] 4.3 GREEN (PR 4A): Implement conservative orphan attachment GC (>1h unreferenced snapshot cleanup) in `src/services/attachments.js` and detailed statement/version/cause logging on migration failure in `db.js`. Verify: `node --test tests/hygiene.test.js`. Scope: `src/services/attachments.js`, `db.js`. Rollback: revert GC & migration changes.
- [x] 4.4 GREEN (PR 4A): Create `scripts/run-tests.js` using `git ls-files -z` to discover tracked `tests/**/*.test.js` files and pass to `node --test`; update `package.json` `test` script. Verify: `npm test` runs full suite. Scope: `scripts/run-tests.js`, `package.json`. Rollback: remove `scripts/run-tests.js`, revert `package.json`.
- [ ] 4.5 GREEN (PR 4B): Split `src/routes/admin.js` into sub-routers (`admin-sessions.js`, `admin-settings.js`, `admin-rag.js`) and add alias telemetry logging plus deprecation headers (`Deprecation`, `Link`, `Warning: 299`). Verify: `node --test tests/admin-routes.test.js tests/alias-telemetry.test.js`. Scope: `src/routes/admin*`. Rollback: revert admin router split.
