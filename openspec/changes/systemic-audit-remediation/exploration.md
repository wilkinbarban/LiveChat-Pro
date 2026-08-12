# Exploration: Systemic Audit Remediation

## Executive Summary
This exploration organizes all 8 high-severity audit findings (H-01 through H-08) and additional architectural debt into 4 coherent, root-cause remediation clusters. The plan avoids single-symptom patching, eliminates dead code, enforces strict verification boundaries, and explicitly preserves pre-existing user modifications in socket and widget files.

---

## Pre-existing User Work Inventory
The following files contain active user changes that MUST be preserved and isolated from automated refactoring:
- `src/sockets/index.js`: Persistence of initial bot welcome greeting in SQLite before emitting socket events, preventing repeated client greetings on reconnect.
- `widget.js`: Tracking `bootstrappedSessionId` to ignore duplicate history events on socket re-connections.
- `tests/widget-responsive.test.js`: Test cases verifying single welcome greeting persistence and widget history handling.

---

## Audit Findings to Root-Cause Cluster Mapping

| Audit Finding / Improvement | Symptom Description | Root Cause Subsystem | Planned Remediation Cluster |
| :--- | :--- | :--- | :--- |
| **H-01** | Concurrent duplicate welcome greetings & non-atomic session updates | Non-atomic state transitions across SQLite, in-memory `sessions` Map, Redis, and Socket.IO | **Cluster 1**: Durable Session State & Persistence Synchronization |
| **N+1 Session Loading** | Slow session list and detail queries due to per-session queries | Lack of batched SQLite retrieval for messages and attachments | **Cluster 1**: Durable Session State & Persistence Synchronization |
| **H-02** | Authenticated SSRF and unbounded URL response ingestion | Direct `fetchUrl` execution on arbitrary URLs without IP filtering, timeouts, or size limits | **Cluster 2**: Centralized Network, SSRF & Ingestion Policy |
| **H-07** | Inconsistent RAG domain limits & unbounded pending promotion | `promotePending` processes all queued items in a single un-chunked transaction; unconstrained RAG sources | **Cluster 2**: Centralized Network, SSRF & Ingestion Policy |
| **Log Attachment Redaction** | Query tokens logged in plaintext during attachment downloads | Request logger lacks parameter redaction filters for sensitive tokens | **Cluster 2**: Centralized Network, SSRF & Ingestion Policy |
| **H-03** | Incomplete HTTP / Socket.IO / SQLite shutdown on process termination | Missing deterministic shutdown sequence coordinator in `server.js` | **Cluster 3**: Infrastructure Lifecycle, Environment Hygiene & Container Health |
| **H-04** | Quoted `PORT` normalization mismatch in Compose healthcheck | `docker-compose.yml` healthcheck script omits string quote strip regex present in `Dockerfile` | **Cluster 3**: Infrastructure Lifecycle, Environment Hygiene & Container Health |
| **H-05** | Secrets file UID ownership and import-time side-effects | `resolveAdminSigningSecret` writes `.admin-secret` file eagerly on module `require()` | **Cluster 3**: Infrastructure Lifecycle, Environment Hygiene & Container Health |
| **H-06** | Stale Redis presence counters after abrupt node death | Redis presence relies on manual socket INCR/DECR without heartbeats or TTL renewal | **Cluster 3**: Infrastructure Lifecycle, Environment Hygiene & Container Health |
| **H-08** | Confirmed unused exports (`serializeMessage`, `listMessageAttachments`) | Dead code left behind from past refactoring | **Cluster 4**: Codebase Hygiene, Router Modularity & Maintenance |
| **Admin Router Split** | Oversized `src/routes/admin.js` (~1160 lines) | Monolithic router mixing session management, RAG, settings, and metrics | **Cluster 4**: Codebase Hygiene, Router Modularity & Maintenance |
| **Precise Migration Errors** | Opaque error messages when SQLite schema migrations fail | Lack of structured migration wrapper and context reporting | **Cluster 4**: Codebase Hygiene, Router Modularity & Maintenance |
| **Orphan Attachment Cleanup** | Deleted messages/sessions leave orphaned attachment files on disk | Absence of disk-to-database attachment garbage collection | **Cluster 4**: Codebase Hygiene, Router Modularity & Maintenance |

---

## Detailed Root-Cause Remediation Clusters

### Cluster 1: Durable Session State & Persistence Synchronization
- **Primary Scope**: `src/sockets/index.js`, `src/services/sessions.js`, `src/services/admin-chat.js`, `widget.js`.
- **Root Cause**: Session mutations (connecting, message sending, presence tracking, admin reads) execute as multi-step non-atomic operations across memory, SQLite, Redis, and Socket.IO.
- **Remediation Plan**:
  1. Centralize session state updates in `src/services/sessions.js` with atomic helper operations.
  2. Preserve pre-existing user greeting persistence in `src/sockets/index.js` while ensuring initial welcome state check is guarded inside transaction/atomic update.
  3. Replace N+1 queries in `listSessionsForAdmin` and session history retrieval with SQL `IN (...)` batched queries.
- **Verification Boundary**:
  - `tests/widget-responsive.test.js` (Verify existing greeting tests pass).
  - New integration test `tests/session-concurrency.test.js` driving concurrent socket joins and checking exact SQLite query counts.

### Cluster 2: Centralized Network, SSRF & Ingestion Policy
- **Primary Scope**: `src/utils/fetch.js` (NEW), `src/routes/admin.js`, `src/services/rag.js`, `src/utils/logger.js`.
- **Root Cause**: Unsafe network requests in admin RAG URL ingestion without SSRF protection, timeout, or body size limits; unbounded `promotePending` transactions in RAG service.
- **Remediation Plan**:
  1. Build centralized `safeFetch` in `src/utils/fetch.js` enforcing:
     - IP filtering: reject loopback (127.0.0.0/8), private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16), and IPv6 equivalents.
     - Hard timeout (default 10s) and maximum response payload limit (default 5MB).
     - Maximum redirect depth (max 3 redirects, re-validating IP on each hop).
   2. Refactor `promotePending` in `src/services/rag.js` to process pending documents in bounded batches of 10 per transaction.
  3. Update request logger to sanitize attachment query tokens (`?token=...`) from log lines.
- **Verification Boundary**:
  - New unit test `tests/safe-fetch.test.js` verifying IP blocking for `127.0.0.1`, `169.254.169.254`, `localhost`, and internal range IPs.
  - New integration test `tests/rag-batching.test.js` asserting chunked promotion behavior.

### Cluster 3: Infrastructure Lifecycle, Environment Hygiene & Container Health
- **Primary Scope**: `server.js`, `docker-compose.yml`, `src/security/admin-auth.js`, `cluster-state.js`.
- **Root Cause**: Process exit omits graceful cleanup of HTTP server, Socket.IO, Redis, and SQLite; healthchecks mismatch quoted environment variables; secret file creation occurs at module import time; Redis presence counters leak on SIGKILL.
- **Remediation Plan**:
  1. Implement explicit `ShutdownCoordinator` in `server.js`:
     - Step 1: Stop accepting HTTP & Socket.IO traffic.
     - Step 2: Disconnect Socket.IO sockets & close Redis pub/sub (`clusterState.close()`).
     - Step 3: Close SQLite database connection cleanly (`closeDb()`).
  2. Standardize `docker-compose.yml` healthcheck command to sanitize `process.env.PORT` using `.replace(/[\"']/g, '')` identically to `Dockerfile`.
  3. Remove top-level side effects from `src/security/admin-auth.js` by lazily evaluating `resolveAdminSigningSecret` only during explicit `createAdminAuth` invocation.
  4. Add automatic node heartbeats and 60s TTL auto-refresh to Redis presence keys in `cluster-state.js` so presence naturally expires when a node crashes.
- **Verification Boundary**:
  - New test `tests/shutdown-lifecycle.test.js` validating signal handler sequence.
  - Verification of `docker-compose.yml` syntax and healthcheck behavior with quoted `PORT="3000"`.

### Cluster 4: Codebase Hygiene, Router Modularity & Maintenance
- **Primary Scope**: `src/services/sessions.js`, `src/services/attachments.js`, `src/routes/admin.js`, `db.js`.
- **Root Cause**: Unused exported methods (`serializeMessage`, `listMessageAttachments`), monolithic 1160-line admin router, uncleaned orphan attachments, vague migration error context.
- **Remediation Plan**:
  1. Safely remove unused exports `serializeMessage` from `src/services/sessions.js` and `listMessageAttachments` from `src/services/attachments.js`.
  2. Implement `cleanupOrphanAttachments` in `src/services/attachments.js` to scan disk storage against DB `message_attachments` table.
  3. Enhance DB migration error handlers to log migration version, failing statement, and error cause clearly.
  4. Modularize `src/routes/admin.js` into focused sub-routers (`src/routes/admin-sessions.js`, `src/routes/admin-rag.js`, `src/routes/admin-settings.js`) injected into the main admin router.
- **Verification Boundary**:
  - `npm test` passing cleanly with zero missing export errors.
  - New unit test `tests/orphan-attachments.test.js` verifying orphaned attachment file deletion.

---

## Approaches Comparison

| Approach | Pros | Cons | Complexity |
| :--- | :--- | :--- | :--- |
| **Option A: Single-symptom Patching** (Patch individual findings independently) | Quick to draft initial PRs | High risk of state fragmentation, duplicate fixes, and introducing new parallel truth | Low |
| **Option B: Systemic Root-Class Remediation** (Group into 4 architectural clusters with clear boundaries) | Eliminates root causes, deletes dead code, prevents future regressions, maintains clear test boundaries | Requires structured phase-by-phase planning | Medium |
| **Option C: Total Framework/Architecture Rewrite** | Clean slate | Extremely high risk, destroys user's pre-existing socket/widget work, high cost | High |

---

## Recommendation
**Option B (Systemic Root-Class Remediation)** is recommended. It addresses all 8 audit findings (H-01 through H-08) and additional improvements by fixing systemic root causes in 4 focused phases, while preserving all existing user work in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js`.

---

## Risks & Tradeoffs
1. **Redis Presence Schema TTL Change**: Switching Redis presence to short TTL with heartbeat require active sockets to send periodic pings or node heartbeat loops. Failure to configure interval properly could result in temporary presence drop.
2. **Admin Router Modularization**: Splitting `src/routes/admin.js` into sub-routers requires careful dependency injection wiring to ensure all helpers (`requireAdmin`, `requireCsrf`, `stmts`, `logger`) remain consistently available.
3. **SSRF Blocking Local Testing**: `safeFetch` will block `127.0.0.1` and `localhost` by default. Local dev test suites calling RAG URL ingestion on local stubs must use an allowed test hook or explicit mock.

---

## Ready for Proposal
**Yes**. The systemic exploration is complete, root-cause clusters are defined with explicit verification boundaries, and pre-existing user work is isolated.
