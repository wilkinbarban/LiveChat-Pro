# Session State Sync Specification

## Purpose

Define durable session behavior for Cluster 1, preserving the audited **H-01 (High)** scope and existing greeting behavior.

## Requirements

### Requirement: Write-ahead session publication [H-01 — High]

Every externally observable session mutation MUST be committed to SQLite before related socket events are emitted. A failed write MUST leave clients without a success event and MUST NOT establish a conflicting in-memory or Redis truth.

#### Scenario: Successful mutation is published

- GIVEN a valid session mutation
- WHEN durable persistence succeeds
- THEN the corresponding socket event MUST be emitted after the commit

#### Scenario: Persistence fails before publication

- GIVEN a valid session mutation whose database write fails
- WHEN the mutation is attempted
- THEN no corresponding socket event MUST be emitted
- AND no secondary store MUST represent the failed mutation as committed

### Requirement: Exactly one durable initial greeting [H-01 — High]

The system MUST use durable greeting state as the single authority and MUST preserve the existing widget reconnection behavior without introducing a parallel truth flag.

#### Scenario: Concurrent first joins

- GIVEN one session with no persisted greeting
- WHEN two or more socket joins race to initialize it
- THEN exactly one greeting MUST be persisted
- AND clients MUST NOT observe duplicate initial greetings

#### Scenario: Reconnection after greeting persistence

- GIVEN a session whose greeting is already persisted
- WHEN its widget reconnects or receives repeated history
- THEN no new greeting MUST be persisted or displayed

### Requirement: Bounded session retrieval queries

Session list and history retrieval MUST fetch related messages and attachments in batched queries whose count does not grow once per returned session or message.

#### Scenario: Multi-session admin listing

- GIVEN multiple sessions with messages and attachments
- WHEN an administrator lists or retrieves them
- THEN the result MUST preserve the expected session relationships
- AND query count MUST remain bounded independently of result count

#### Scenario: Empty retrieval

- GIVEN no matching sessions
- WHEN retrieval runs
- THEN it MUST return an empty result without issuing per-record queries
