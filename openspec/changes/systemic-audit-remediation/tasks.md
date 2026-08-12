# Tasks: Systemic Audit Remediation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1400 total (~200-380 per slice) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (State) -> PR 2 (Network) -> PR 3 (Infra) -> PR 4A (Hygiene/GC) -> PR 4B (Routers) |
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
| 2 | Cluster 2: Centralized SSRF & bounded ingestion | PR 2 | `node --test tests/fetch-ssrf.test.js tests/rag-bounds.test.js tests/logger-redact.test.js` | Isolated HTTP test double server with DNS rebinding/redirects | `src/utils/fetch.js`, `src/services/rag.js`, `src/routes/admin-rag.js`, `src/utils/logger.js` |
| 3 | Cluster 3: Shutdown coordinator & infra lifecycle | PR 3 | `node --test tests/shutdown.test.js tests/auth-secret.test.js tests/presence.test.js` | Isolated temp env SIGTERM harness & `docker compose config` | `src/services/shutdown.js`, `server.js`, `cluster-state.js`, `src/security/admin-auth.js`, `docker-compose.yml` |
| 4A | Cluster 4A: Hygiene, attachment GC & test runner | PR 4A | `node --test tests/hygiene.test.js tests/test-script.test.js` | `node scripts/run-tests.js` against temp fixture tree | `src/services/attachments.js`, `src/services/sessions.js`, `db.js`, `scripts/run-tests.js`, `package.json` |
| 4B | Cluster 4B: Admin sub-routers & alias telemetry | PR 4B | `node --test tests/admin-routes.test.js tests/alias-telemetry.test.js` | Isolated Express router integration test harness | `src/routes/admin.js`, `src/routes/admin-sessions.js`, `src/routes/admin-settings.js`, `src/routes/admin-rag.js` |

## Phase 1: Session State Sync (Cluster 1)

- [x] 1.1 RED: Write `tests/session-sync.test.js` covering write-ahead commit/abort in `sessions.js` & `admin-chat.js`, `getMessagesBySessions` SQL count, and greeting race. Verify: `node --test tests/session-sync.test.js`. Rollback: revert `tests/session-sync.test.js`.
- [x] 1.2 GREEN: Update `src/services/sessions.js`, `src/services/admin-chat.js` & `db.js` with batch `getMessagesBySessions` using `json_each(?)` and write-ahead SQLite commits before socket emits. Verify: write failure prevents emit. Scope: `src/services/sessions.js`, `src/services/admin-chat.js`, `db.js`. Rollback: revert session/admin-chat/db files.
- [x] 1.3 GREEN: Update `src/sockets/index.js` with `BEGIN IMMEDIATE` greeting check, preserving user edits in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js`. Verify: `node --test tests/widget-responsive.test.js`. Scope: `src/sockets/index.js`. Rollback: revert `src/sockets/index.js`.

## Phase 2: Network & SSRF Ingestion (Cluster 2)

- [ ] 2.1 RED: Write `tests/fetch-ssrf.test.js`, `tests/rag-bounds.test.js`, `tests/logger-redact.test.js` for IP/DNS rebinding blocks, 5MB/10s stream aborts, 3MB/10-doc RAG limits, and URL token redaction. Verify: test suite runs RED. Scope: `tests/fetch-ssrf.test.js`, `tests/rag-bounds.test.js`, `tests/logger-redact.test.js`. Rollback: revert new tests.
- [ ] 2.2 GREEN: Create `src/utils/fetch.js` enforcing DNS pinning, IP checks, redirect re-validation, 10s timeout, 3 max redirects, and 5 MiB stream limits. Verify: `node --test tests/fetch-ssrf.test.js`. Scope: `src/utils/fetch.js`. Rollback: remove `src/utils/fetch.js`.
- [ ] 2.3 GREEN: Wire `src/services/rag.js` and `src/routes/admin-rag.js` to `safeFetch`, enforcing 3 MiB `stageText` UTF-8 limit and 10-doc transaction chunking in `promotePending`. Verify: `node --test tests/rag-bounds.test.js`. Scope: `src/services/rag.js`, `src/routes/admin-rag.js`. Rollback: revert RAG changes.
- [ ] 2.4 GREEN: Update `src/utils/logger.js` to redact case-insensitive `token`, `access_token`, `api_key`, `key`, `signature` query parameters and URL tokens. Verify: `node --test tests/logger-redact.test.js`. Scope: `src/utils/logger.js`. Rollback: revert `src/utils/logger.js`.

## Phase 3: Infrastructure Lifecycle (Cluster 3)

- [ ] 3.1 RED: Write `tests/shutdown.test.js`, `tests/auth-secret.test.js`, `tests/presence.test.js` asserting 3-stage shutdown, side-effect-free auth import, quoted `PORT` healthcheck, and Redis presence crash recovery. Verify: tests run RED. Scope: `tests/shutdown.test.js`, `tests/auth-secret.test.js`, `tests/presence.test.js`. Rollback: revert tests.
- [ ] 3.2 GREEN: Create `src/services/shutdown.js` and wire `server.js` for idempotent 3-stage shutdown: (1) HTTP/sockets stop, (2) Redis/Socket.IO/timers close, (3) SQLite close. Verify: `node --test tests/shutdown.test.js`. Scope: `src/services/shutdown.js`, `server.js`. Rollback: remove `shutdown.js`, revert `server.js`.
- [ ] 3.3 GREEN: Refactor `src/security/admin-auth.js` to eliminate disk I/O on module import, deferring secret creation to explicit initialization. Verify: `node --test tests/auth-secret.test.js`. Scope: `src/security/admin-auth.js`. Rollback: revert `src/security/admin-auth.js`.
- [ ] 3.4 GREEN: Update `cluster-state.js` with 60s lease TTL / 20s renewal loop and crash reconciliation; update `docker-compose.yml` healthcheck regex for quoted `PORT="3000"` parity. Verify: `node --test tests/presence.test.js`. Scope: `cluster-state.js`, `docker-compose.yml`. Rollback: revert `cluster-state.js`, `docker-compose.yml`.

## Phase 4: Tooling Hygiene & Routers (Cluster 4)

- [ ] 4.1 RED: Write `tests/hygiene.test.js`, `tests/test-script.test.js`, `tests/admin-routes.test.js`, `tests/alias-telemetry.test.js` asserting dead export removal, orphan GC, migration details, test discovery, sub-router contracts, and alias headers. Verify: tests run RED. Scope: `tests/hygiene.test.js`, `tests/test-script.test.js`, `tests/admin-routes.test.js`, `tests/alias-telemetry.test.js`. Rollback: revert tests.
- [ ] 4.2 GREEN (PR 4A): Remove dead exports `serializeMessage` & `listMessageAttachments` from `src/services/sessions.js` & `src/services/attachments.js`. Verify: retained imports load cleanly. Scope: `src/services/sessions.js`, `src/services/attachments.js`. Rollback: restore exports.
- [ ] 4.3 GREEN (PR 4A): Implement conservative orphan attachment GC (>1h unreferenced snapshot cleanup) in `src/services/attachments.js` and detailed statement/version/cause logging on migration failure in `db.js`. Verify: `node --test tests/hygiene.test.js`. Scope: `src/services/attachments.js`, `db.js`. Rollback: revert GC & migration changes.
- [ ] 4.4 GREEN (PR 4A): Create `scripts/run-tests.js` using `git ls-files -z` to discover tracked `tests/**/*.test.js` files and pass to `node --test`; update `package.json` `test` script. Verify: `npm test` runs full suite. Scope: `scripts/run-tests.js`, `package.json`. Rollback: remove `scripts/run-tests.js`, revert `package.json`.
- [ ] 4.5 GREEN (PR 4B): Split `src/routes/admin.js` into sub-routers (`admin-sessions.js`, `admin-settings.js`, `admin-rag.js`) and add alias telemetry logging plus deprecation headers (`Deprecation`, `Link`, `Warning: 299`). Verify: `node --test tests/admin-routes.test.js tests/alias-telemetry.test.js`. Scope: `src/routes/admin*`. Rollback: revert admin router split.
