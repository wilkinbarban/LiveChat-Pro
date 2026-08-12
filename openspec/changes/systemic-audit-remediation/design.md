# Design: Systemic Audit Remediation

## Technical Approach

Keep SQLite authoritative, Redis ephemeral, and transports publication-only. Add durable mutations, safe fetch, explicit ownership, and compatibility hygiene. Preserve edits in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js`; add no bypass or parallel-truth flags.

## Architecture Decisions

| Decision | Choice and rationale | Rejected alternative |
|---|---|---|
| Durable ordering | Persist, update memory/Redis, then emit. Greeting uses `BEGIN IMMEDIATE` plus conditional `INSERT ... WHERE NOT EXISTS(messages)`; callers reload the winner. | Catch-and-continue; mutexes; new truth. |
| Bounded retrieval | Add `getMessagesBySessions(json_each(?))`, then one attachment query for all message IDs. | Per-session queries or SQL interpolation. |
| Safe network boundary | A dedicated post-PR-2A slice creates `src/utils/fetch.js`, using registry-aligned IPv4/IPv6 global-routability semantics and a timeout spanning DNS through body consumption. Require every A/AAAA answer globally routable; normalize bracketed IPv6 URL literals and revalidate every hop. | Divergent hand-maintained CIDR exclusions, DNS preflight, automatic redirects, bypass flags. |
| Lifecycle/presence | One memoized shutdown promise owns three stages. Aggregate per-node leases only after pruning expiry. | 48-hour global counter; duplicate handlers. |
| Compatibility hygiene | Remove two confirmed dead exports; instrument one alias registry; split routers without contract changes. | Static-only deletion; behavior rewrite. |
| Complete test discovery | `scripts/run-tests.js` gets sorted tracked `tests/**/*.test.js` via `git ls-files -z`, rejects empty/missing/duplicate entries, passes that exact array to `node --test`, and propagates its exit. `npm test` only invokes it. | Fixed lists or shell globs. |

## Policies and Data Flow

| Boundary | Concrete policy |
|---|---|
| Generic URL | HTTP(S), no credentials; 10 s across unresolved DNS, transport, redirects, and streaming; 3 redirects; 5 MiB. Apply current registry-aligned global-routability semantics to IPv4, IPv6, and mapped IPv4, preserving globally reachable exceptions and valid bracketed IPv6 literals. |
| GitHub ingestion | Preserve 30 s, 5-way concurrency, 200 files, 128 KiB/file, 3 MiB aggregate; all requests still traverse safe fetch. |
| RAG service | `stageText`: 3 MiB UTF-8 maximum. `promotePending`: 10 oldest documents, one transaction each; unpromoted work survives failure. |
| Presence | Random `nodeId`; 60 s leases renewed every 20 s. Redis scripts update/prune contributions and derive `connected/socketCount`; reconnect rewrites local counts. |
| Orphans | Startup/daily DB snapshot versus regular upload files; delete only unreferenced files older than 1 hour. Scan failure deletes nothing. |
| Aliases | Registry fields: `method`, `aliasPath`, `canonicalMethod`, `canonicalPath`, `compatibilityStatus`, `consumerAction`. Middleware logs them plus status/request ID. When deprecated, send `Deprecation`, successor `Link`, and `Warning: 299` naming replacement and action; send `Sunset` only once scheduled. Deprecate after 30 representative zero-use days; remove in a later change after one release or 30 days. |

```text
request -> validate/resolve+pin -> fetch hop -> count stream -> stageText -> DB
signal -> stop HTTP acceptance -> close Socket.IO/Redis/timers -> close SQLite
mutation -> SQLite commit -> memory -> Redis snapshot -> socket/admin emission
```

## Components, Interfaces, and Files

| Files | Design |
|---|---|
| `src/services/sessions.js`, `db.js`, `src/sockets/index.js`, `src/services/admin-chat.js` | Inject mutation/greeting and batch-query seams; fail before publication. |
| `src/services/rag.js`, `tests/rag-bounds.test.js` (PR 2A) | Enforce 3 MiB UTF-8 staging and ten oldest promotions with one transaction per document; no network dependency. |
| `src/utils/fetch.js` (new), `src/routes/admin.js`, `tests/fetch-ssrf.test.js` (PR 2B) | Inject lookup, transport/dispatcher, clock/timers, and policies; normalize literal hosts; use registry-aligned routability; routes use `safeFetch` only after the dedicated network slice is green. |
| `src/utils/logger.js`, `server.js`, `tests/logger-redact.test.js` (PR 2A) | Redact case-insensitive `token`, `access_token`, `api_key`, `key`, and `signature`. Export an injectable request-logging middleware factory and wire that exact seam in `server.js`, allowing behavior-first execution without full bootstrap or admin-secret reads. |
| `src/services/shutdown.js` (new), `cluster-state.js`, `src/security/admin-auth.js`, `docker-compose.yml` | Inject closers/timers/Redis/node ID/fs/randomness. Auth import/factory has no I/O; startup resolves secrets. Normalize/validate `PORT`. |
| `src/services/attachments.js`, `db.js` | Inject fs/clock; add all-path query and conservative GC. Transactions report migration/statement IDs and `cause`; remove blanket catches. |
| `src/routes/admin.js`, new `admin-sessions.js`, `admin-settings.js`, `admin-rag.js` | Keep composition root; move families with identical dependencies and middleware order. |
| `package.json`, new `scripts/run-tests.js`, `tests/test-script.test.js` | Replace fixed list with tracked discovery. Inject inventory/spawn seams; RED tests prove omitted/missing suites and child failures fail the launcher. |

## Testing and Observability

Fresh corrective RED→GREEN evidence covers the exact PR 2A request-logging middleware integration. Historical RED transcripts for the already-retained RAG and helper-level logger work are unavailable and must not be reconstructed; their focused GREEN results remain authoritative. RAG behavioral proof inspects the executed selection SQL for ascending creation order and `LIMIT 10`. Future RED tests cover DNS rebinding/overflow, signal races/handles, PORT, import I/O, leases, exports, GC, migrations, alias headers/logs, routes, and test discovery. Emit structured events without secrets/raw queries.

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no executable classification. |
| Git repository selection | N/A — remote GitHub content ingestion does not select a local repository or invoke Git. |
| Commit state | N/A — no VCS mutation. |
| Push state | N/A — no push operation. |
| PR commands | N/A — no PR automation. |

## Migration, Rollout, and Rollback

Sequence: durable state (PR 1), RAG bounds and logging (PR 2A), safe fetch and route wiring (PR 2B), shutdown/auth/PORT, presence, diagnostics/GC/exports, test discovery, then routers/aliases. Every slice is independently tested and capped at 400 authored changed lines. PR 2A rollback restores both OpenSpec planning files and reverts only `src/services/rag.js`, `src/utils/logger.js`, `server.js`, `tests/rag-bounds.test.js`, and `tests/logger-redact.test.js`; it includes no PR 2B files. PR 2B owns all fetch and route integration bytes. Presence needs drained all-node restart; rollback cluster-wide and purge ephemeral keys. SQLite changes are additive/idempotent; other slices revert independently.

## Risks

The deferred PR 2B must replace the rejected hand-maintained CIDR approach and prove registry exceptions, IPv6 literal handling, and DNS-inclusive timeout through deterministic lookup/transport/stream seams. Redis loss can briefly under-report presence. Alias evidence requires logs from every production instance. Complete `npm test` discovery is deferred to task 4.4 and assumes committed suites follow `tests/**/*.test.js`. No unresolved questions remain.
