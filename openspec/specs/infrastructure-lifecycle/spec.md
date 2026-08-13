# Infrastructure Lifecycle Specification

## Purpose

Define Cluster 3 behavior for **H-03, H-04, H-05, and H-06 (Medium)**.

## Requirements

### Requirement: Deterministic three-stage shutdown [H-03 — Medium]

On a supported termination signal, the process MUST complete shutdown in this order: stop new HTTP/socket traffic; close active sockets and Redis resources; close SQLite. Shutdown MUST be idempotent and MUST settle asynchronous failures without unhandled rejections or lingering owned handles.

#### Scenario: Graceful SIGTERM

- GIVEN a running process with open HTTP, socket, Redis, and SQLite resources
- WHEN SIGTERM is received
- THEN all three stages MUST execute in the specified order
- AND the process MUST terminate without owned open handles

#### Scenario: Concurrent signals or close failure

- GIVEN shutdown is underway
- WHEN another signal arrives or one close operation fails
- THEN no stage MUST execute more than once
- AND remaining safe cleanup MUST be attempted with the failure reported

### Requirement: Quoted PORT health parity [H-04 — Medium]

Container health evaluation MUST normalize matching single or double quotes around `PORT` consistently across Compose and image healthchecks.

#### Scenario: Double-quoted port

- GIVEN the environment contains `PORT="3000"`
- WHEN the Compose healthcheck runs
- THEN it MUST probe the same numeric port as unquoted `PORT=3000`

#### Scenario: Invalid normalized port

- GIVEN `PORT` remains invalid after quote normalization
- WHEN health is evaluated
- THEN the check MUST fail rather than probe an unintended endpoint

### Requirement: Side-effect-free secret module import [H-05 — Medium]

Importing the admin authentication module MUST NOT create, modify, or resolve a secret file. Secret material MAY be created only by an explicit authentication initialization action.

#### Scenario: Module is imported

- GIVEN no admin secret file exists
- WHEN the authentication module is imported without initialization
- THEN zero secret-file writes MUST occur

#### Scenario: Explicit initialization

- GIVEN authentication initialization requires a persisted secret
- WHEN initialization is explicitly invoked
- THEN the secret MUST be resolved with failures surfaced to the caller

### Requirement: Crash-safe presence [H-06 — Medium]

Cluster presence MUST expire stale node contribution after abrupt termination and MUST reconcile aggregate state from live contributions. Active presence MUST remain renewable, and transient renewal failure MUST NOT create permanently stale counts.

#### Scenario: Node crashes without disconnect

- GIVEN a node contributed active presence and terminates abruptly
- WHEN its liveness bound expires
- THEN its contribution MUST disappear
- AND cluster presence MUST reconcile to live nodes

#### Scenario: Active node renews or temporarily loses Redis

- GIVEN a node remains active
- WHEN liveness is renewed, or renewal temporarily fails and later recovers
- THEN valid presence MUST remain or be restored through reconciliation
- AND stale duplicate contribution MUST NOT persist
