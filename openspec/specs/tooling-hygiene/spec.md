# Spec for tooling-hygiene

Test coverage completeness, Node version alignment, lint/format tooling, installer minimization, and dead-code removal. This capability lands FIRST to de-risk the rest of the change.

## Requirements

### Requirement: Complete Test Suite in npm test

`npm test` MUST discover and execute every committed existing and newly added test suite for this change, including concurrency, network bounds, lifecycle, cleanup, migration, alias, and router compatibility coverage.

(Previously: `npm test` was required to run a fixed set of 11 test files.)

#### Scenario: Full verification is green

- GIVEN a clean checkout on a supported Node version
- WHEN `npm test` runs
- THEN every existing and new suite MUST execute and pass
- AND the run MUST fail if a committed suite is omitted or any assertion fails

### Requirement: Consistent Node Version Story

`package.json` engines MUST declare `node >=22`; CI MUST test the matrix `[22, 24]`; the Dockerfile MUST use `node:24`. These three MUST NOT contradict each other.

#### Scenario: Engine check passes on Node 22

- GIVEN Node v22.x installed
- WHEN `npm install` runs
- THEN no EBADENGINE error SHALL occur
- AND `npm test` SHALL pass (including `node:sqlite` usage)

### Requirement: Biome Lint and Format

The project MUST use Biome as the single linter/formatter, with `lint` and `format` npm scripts and a committed configuration compatible with the CommonJS/no-build codebase.

#### Scenario: Lint gate

- GIVEN a source file with a lint violation
- WHEN the lint script runs
- THEN it MUST report the violation and exit non-zero
- AND `format` SHALL auto-fix formatting without changing semantics

### Requirement: Installer Minimization

`setup.js` and `.env.example` MUST remove obsolete env keys (`OPENAI_*`, `BOT_*`, `WIDGET_*` moved to admin settings) while keeping bootstrap secrets (Telegram token/admin ID, admin password, server/security/Redis keys). Re-running the installer on an old `.env` MUST remain safe.

#### Scenario: Re-run on legacy .env

- GIVEN an existing `.env` containing obsolete `OPENAI_API_KEY` and `BOT_MODE`
- WHEN `setup.js` re-runs
- THEN it SHALL complete without error
- AND MUST NOT resurrect obsolete keys as required questions
- AND MUST preserve still-valid existing values

### Requirement: Dead-Code Removal

The change MUST remove: `kb-trainer/` (after KB migration), `scratch/`, `HELP_TOPICS` personal content, the duplicated `resolveTelegramReplySessionId` resolver (one canonical implementation), and the dead `knowledge-base.json.example` reference in `setup.js`.

#### Scenario: No references to removed code

- GIVEN the removal is complete
- WHEN the test suite and server boot run
- THEN no import/require of `kb-trainer`, `scratch/`, or the duplicate resolver SHALL remain
- AND all tests MUST pass

### Requirement: Docker Rebuild as Final Task

The Dockerfile and docker-compose MUST be rebuilt to reflect the final state (no `kb-trainer` COPY, node:24, minimized env). This task SHALL be executed LAST, after all other tasks complete.

#### Scenario: Image builds clean

- GIVEN all other tasks done
- WHEN the Docker image is built
- THEN the build SHALL succeed without kb-trainer references
- AND the container SHALL boot with only bootstrap env secrets

### Requirement: Audited dead export removal [H-08 — Low-Medium]

The confirmed no-caller exports `serializeMessage` and `listMessageAttachments` MUST be removed without breaking retained consumers.

#### Scenario: Retained modules load

- GIVEN both exports are absent
- WHEN the server and full test suite load retained modules
- THEN no missing-export or import failure MUST occur

### Requirement: Crash-safe orphan attachment cleanup

Cleanup MUST delete disk attachment files with no database record, MUST preserve referenced files, and MUST tolerate already-missing files. Cleanup failure MUST be reported without deleting uncertain or referenced data.

#### Scenario: Mixed attachment directory

- GIVEN referenced, orphaned, and already-missing attachment paths
- WHEN cleanup runs
- THEN orphaned files MUST be deleted
- AND referenced files MUST remain available

#### Scenario: Database or filesystem inspection fails

- GIVEN cleanup cannot establish orphan status safely
- WHEN reconciliation runs
- THEN uncertain files MUST NOT be deleted
- AND the failure MUST be diagnosable and safe to retry

### Requirement: Actionable migration diagnostics

A failed SQLite migration MUST report the exact migration version, failing statement or unambiguous statement identity, and underlying cause without exposing secrets. No later migration MUST be reported as applied.

#### Scenario: Migration statement fails

- GIVEN a versioned migration containing a failing statement
- WHEN migration runs
- THEN diagnostics MUST identify that version and statement
- AND MUST retain the underlying failure cause

### Requirement: Telemetry-led alias lifecycle

API aliases MUST remain compatible unless runtime telemetry demonstrates deprecation safety. Static no-caller evidence alone MUST NOT authorize removal; any migration diagnostic MUST identify the alias, observed compatibility status, and required consumer action.

#### Scenario: Alias lacks runtime evidence

- GIVEN static search finds no caller but telemetry is absent or inconclusive
- WHEN alias disposition is evaluated
- THEN the alias MUST remain compatible

#### Scenario: Telemetry supports deprecation

- GIVEN representative runtime telemetry establishes usage status
- WHEN deprecation is announced or enforced
- THEN diagnostics MUST name the replacement and consumer migration action

### Requirement: Admin router compatibility

Admin route modularization MUST preserve existing paths, methods, status codes, response contracts, middleware protections, and supported dependency injection behavior.

#### Scenario: Existing admin route is exercised

- GIVEN the same authentication, CSRF state, and injected dependencies as before
- WHEN any retained admin route is called
- THEN its externally observable contract MUST remain compatible

#### Scenario: Required dependency or authorization is absent

- GIVEN a route lacks required authorization or injected capability
- WHEN it is invoked
- THEN it MUST fail through the existing compatible error contract
- AND MUST NOT bypass middleware
