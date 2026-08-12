# Design: Systemic Audit Remediation

## Technical Approach

Keep SQLite authoritative, Redis ephemeral, and transports publication-only. Add durable mutations, safe fetch, explicit ownership, and compatibility hygiene. Preserve edits in `src/sockets/index.js`, `widget.js`, and `tests/widget-responsive.test.js`; add no bypass or parallel-truth flags.

## Architecture Decisions

| Decision | Choice and rationale | Rejected alternative |
|---|---|---|
| Durable ordering | Persist, update memory/Redis, then emit. Greeting uses `BEGIN IMMEDIATE` plus conditional `INSERT ... WHERE NOT EXISTS(messages)`; callers reload the winner. | Catch-and-continue; mutexes; new truth. |
| Bounded retrieval | Add `getMessagesBySessions(json_each(?))`, then one attachment query for all message IDs. | Per-session queries or SQL interpolation. |
| Safe network boundary | `src/utils/fetch.js` owns connection-time DNS, IP checks/pinning, redirects, timeout, and byte counting. Require every A/AAAA answer globally routable; revalidate each hop. | DNS preflight, automatic redirects, bypass flags. |
| Lifecycle/presence | One memoized shutdown promise owns three stages. Aggregate per-node leases only after pruning expiry. | 48-hour global counter; duplicate handlers. |
| Compatibility hygiene | Remove two confirmed dead exports; instrument one alias registry; split routers without contract changes. | Static-only deletion; behavior rewrite. |
| Complete test discovery | `scripts/run-tests.js` gets sorted tracked `tests/**/*.test.js` via `git ls-files -z`, rejects empty/missing/duplicate entries, passes that exact array to `node --test`, and propagates its exit. `npm test` only invokes it. | Fixed lists or shell globs. |

## Policies and Data Flow

| Boundary | Concrete policy |
|---|---|
| Generic URL | HTTP(S), no credentials; 10 s, 3 redirects, 5 MiB. Reject loopback/private/link-local/unspecified/multicast/reserved IPv4/IPv6, including mapped IPv4. |
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
| `src/utils/fetch.js` (new), `src/routes/admin-rag.js` (new), `src/services/rag.js`, `server.js` | Inject `lookup`, transport/dispatcher, clock, timers, policies; routes use `safeFetch` only. |
| `src/utils/logger.js`, `server.js` | Redact case-insensitive `token`, `access_token`, `api_key`, `key`, and `signature`; never log safe-fetch query strings. |
| `src/services/shutdown.js` (new), `cluster-state.js`, `src/security/admin-auth.js`, `docker-compose.yml` | Inject closers/timers/Redis/node ID/fs/randomness. Auth import/factory has no I/O; startup resolves secrets. Normalize/validate `PORT`. |
| `src/services/attachments.js`, `db.js` | Inject fs/clock; add all-path query and conservative GC. Transactions report migration/statement IDs and `cause`; remove blanket catches. |
| `src/routes/admin.js`, new `admin-sessions.js`, `admin-settings.js`, `admin-rag.js` | Keep composition root; move families with identical dependencies and middleware order. |
| `package.json`, new `scripts/run-tests.js`, `tests/test-script.test.js` | Replace fixed list with tracked discovery. Inject inventory/spawn seams; RED tests prove omitted/missing suites and child failures fail the launcher. |

## Testing and Observability

RED tests cover greeting races/write/query counts; DNS rebinding/overflow; RAG bounds/failure; signal races/handles; PORT, import I/O, leases, exports, GC, migrations, alias headers/logs, routes, and test discovery. Emit structured write, fetch, RAG, shutdown, lease, orphan, migration, and alias events without secrets/raw queries.

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no executable classification. |
| Git repository selection | N/A — remote GitHub content ingestion does not select a local repository or invoke Git. |
| Commit state | N/A — no VCS mutation. |
| Push state | N/A — no push operation. |
| PR commands | N/A — no PR automation. |

## Migration, Rollout, and Rollback

Sequence: durable helpers, call sites, safe fetch, RAG/logging, shutdown/auth/PORT, presence, diagnostics/GC/exports, test discovery, then routers/aliases. Prefer independently tested ≤400-line slices; `sdd-tasks` owns sizing. Presence needs drained all-node restart; rollback cluster-wide and purge ephemeral keys. SQLite changes are additive/idempotent; other slices revert independently.

## Risks

Undici DNS pinning needs integration proof. Redis loss can briefly under-report presence. Alias evidence requires logs from every production instance. Test discovery assumes committed suites follow `tests/**/*.test.js`. No unresolved questions remain.
