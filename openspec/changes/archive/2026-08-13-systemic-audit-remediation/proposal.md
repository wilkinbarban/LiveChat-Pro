# Proposal: Systemic Audit Remediation

## Intent

Systemically resolve audit findings H-01 through H-08 and associated technical debt across 4 root-cause clusters while preserving pre-existing user modifications, enforcing write-ahead persistence integrity, centralizing network ingestion policies, and keeping review boundaries within budget.

## Scope

### In Scope
- **Cluster 1 (Durable State)**: H-01 (High), N+1 query elimination, write-ahead DB update before broadcast, race-free single-greeting persistence.
- **Cluster 2 (Network & Ingestion)**: H-02 (High), H-07 (Medium), SSRF network protection (IP/DNS filtering, redirect re-validation), bounded streaming response ingestion, service-level RAG domain bounds, logger token redaction.
- **Cluster 3 (Infrastructure & Lifecycle)**: H-03 (Medium), H-04 (Medium), H-05 (Medium), H-06 (Medium), deterministic 3-step process shutdown coordinator, `PORT` quote normalization parity in Compose healthcheck, side-effect-free secrets resolution, crash-safe Redis presence expiration and reconciliation.
- **Cluster 4 (Hygiene & Modularity)**: H-08 (Low-Medium), removal of confirmed no-caller exports (`serializeMessage`, `listMessageAttachments`), disk orphan attachment cleanup, detailed SQLite migration errors, telemetry/compatibility-led API alias policy, modular admin sub-router split as enabling refactor.

### Out of Scope
- Complete admin UI frontend rewrite.
- Migration away from SQLite or Redis.
- Modifying core vector/LLM search algorithms.
- Removing API aliases solely based on static code search without runtime telemetry evidence.

## Capabilities

### New Capabilities
- `session-state-sync`: Atomic multi-store session persistence, N+1 query elimination, single source of truth for presence and greeting state.
- `network-ssrf-ingestion`: Centralized SSRF filtering, bounded streaming ingestion, RAG domain limits, request log parameter token redaction.
- `infrastructure-lifecycle`: Deterministic graceful process shutdown, lazy secret creation, crash-safe Redis presence expiration and reconciliation.

### Modified Capabilities
- `tooling-hygiene`: Dead export pruning (`serializeMessage`, `listMessageAttachments`), disk orphan attachment GC, structured migration error context, admin router modular split.

## Approach

Address systemic issues by grouping findings by audited severity (H-01/02 High; H-03/04/05/06/07 Medium; H-08 Low-Medium) into 4 candidate remediation clusters:

1. **Phase 1 (State & Persistence)**: Enforce write-ahead DB transaction integrity before socket emission (failed DB write aborts broadcast). Batch session retrieval queries. Preserve user greeting persistence in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js` without adding parallel truth flags.
2. **Phase 2 (Network & Ingestion)**: Implement centralized fetch wrapper enforcing SSRF defenses (blocking loopback/private IPs, validating redirect targets, bounding streaming payload size). Enforce RAG domain bounds and chunked promotion. Sanitize sensitive URL tokens in request logs. (Exact numerical thresholds deferred to design).
3. **Phase 3 (Lifecycle & Infra)**: Build `ShutdownCoordinator` in `server.js` executing deterministic sequence (stop HTTP/socket traffic -> close Redis/sockets -> close SQLite DB). Defer `resolveAdminSigningSecret` disk writes until explicit invocation. Implement Redis presence expiration and auto-reconciliation for abrupt node crashes. Align `docker-compose.yml` healthcheck regex with `Dockerfile`.
4. **Phase 4 (Hygiene & Router)**: Prune confirmed no-caller exports (`serializeMessage`, `listMessageAttachments`). Implement disk orphan attachment GC and structured SQLite migration error context. Require runtime telemetry before deprecating API aliases. Split `src/routes/admin.js` into sub-routers as an enabling refactor.

Candidate PR slicing targets the 400 changed-line review budget across the 4 clusters; concrete task sizing and line bounds are owned by `sdd-tasks`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/sockets/index.js`, `widget.js` | Modified | Preserve user greeting logic; eliminate race conditions & parallel state flags |
| `src/services/sessions.js`, `attachments.js` | Modified | N+1 query batching; prune confirmed dead exports; add orphan attachment GC |
| `src/utils/fetch.js` | New | Centralized network fetch security with SSRF protection & bounded streaming |
| `src/services/rag.js`, `src/utils/logger.js` | Modified | Bounded promotion batching & log parameter token redaction |
| `server.js`, `cluster-state.js`, `admin-auth.js` | Modified | Graceful shutdown sequence, presence expiration/reconciliation, lazy secret creation |
| `docker-compose.yml`, `db.js` | Modified | Healthcheck `PORT` normalization parity; precise migration error logging |
| `src/routes/admin.js` | Modified | Enabling modular split into sub-routers |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Test suite network dependency blocking | Med | Test harness injects DNS/transport test doubles without adding runtime bypass flags |
| Presence key expiration on network jitter | Low | Node presence heartbeat loop prior to TTL expiration (mechanisms defined in design) |
| Admin router split breaks route injection | Low | Sub-router integration tests validating middleware propagation |

## Rollback Plan

Each cluster PR is independently deployable and rollable back via standard git revert. Database migrations use backward-compatible schema changes.

## Dependencies

- Existing SQLite (`node:sqlite`) and Redis client infrastructure.
- Pre-existing user greeting work in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js`.

## Success Criteria

- [ ] **Cluster 1**: Database write-ahead failure prevents socket broadcast; concurrent socket joins persist exactly 1 greeting without duplicates; session queries use batched SQL without N+1 overhead.
- [ ] **Cluster 2**: SSRF filter blocks loopback, private IP, and DNS rebinding redirect targets; streaming payloads exceeding bounds are rejected; service-level RAG domain bounds enforced; sensitive URL query tokens redacted in logs.
- [ ] **Cluster 3**: Process SIGTERM triggers clean shutdown sequence without unhandled promises or open handles; `docker-compose.yml` healthcheck succeeds with quoted `PORT="3000"`; module import causes zero secret file disk writes; abrupt node termination results in presence expiration and cluster state reconciliation.
- [ ] **Cluster 4**: Confirmed no-caller exports (`serializeMessage`, `listMessageAttachments`) removed with zero import failures; API alias deprecations backed by runtime telemetry evidence; failed DB migrations log exact failing statement/version; orphan attachment files deleted from disk; modular admin sub-routers pass all existing route tests.
- [ ] **Suite**: `npm test` passes 100% green across all existing and new test suites.
