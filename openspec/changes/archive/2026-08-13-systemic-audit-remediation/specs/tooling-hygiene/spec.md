# Delta for Tooling Hygiene

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Complete Test Suite in npm test

`npm test` MUST discover and execute every committed existing and newly added test suite for this change, including concurrency, network bounds, lifecycle, cleanup, migration, alias, and router compatibility coverage.

(Previously: `npm test` was required to run a fixed set of 11 test files.)

#### Scenario: Full verification is green

- GIVEN a clean checkout on a supported Node version
- WHEN `npm test` runs
- THEN every existing and new suite MUST execute and pass
- AND the run MUST fail if a committed suite is omitted or any assertion fails
