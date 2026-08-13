# Network SSRF Ingestion Specification

## Purpose

Define Cluster 2 controls for **H-02 (High)** and **H-07 (Medium)** across URL ingestion, RAG limits, and logging.

## Requirements

### Requirement: Destination validation [H-02 — High]

URL ingestion MUST reject unsupported schemes, loopback, private, link-local, and equivalent prohibited IPv4/IPv6 destinations. Hostnames MUST be checked through DNS resolution, and every redirect destination MUST be revalidated before connection.

#### Scenario: Public destination is accepted

- GIVEN a supported URL whose resolved addresses are permitted
- WHEN ingestion begins
- THEN the request MAY proceed subject to all other bounds

#### Scenario: Literal or DNS-resolved prohibited address

- GIVEN a URL using a prohibited IP literal, localhost name, or hostname resolving to any prohibited address
- WHEN ingestion is requested
- THEN it MUST fail before content is accepted

#### Scenario: Redirect or DNS rebinding reaches a prohibited target

- GIVEN an initially permitted URL whose redirect target or connection-time resolution becomes prohibited
- WHEN the next network hop is evaluated
- THEN that hop MUST be rejected
- AND no response bytes from the prohibited target MUST be ingested

### Requirement: Bounded redirect and streaming ingestion [H-02 — High]

Ingestion MUST enforce configured time, redirect-count, and response-size limits while streaming. It MUST stop reading and reject the operation when any limit is exceeded, including absent or misleading content-length metadata.

#### Scenario: Stream remains within bounds

- GIVEN a permitted response within every configured limit
- WHEN its body streams
- THEN only received bytes within the limit MUST be accepted

#### Scenario: Stream, redirect, or time limit is exceeded

- GIVEN a response exceeds any configured bound
- WHEN the boundary is crossed
- THEN ingestion MUST abort and report a bounded-ingestion failure
- AND partial content MUST NOT become an accepted RAG source

### Requirement: Service-level RAG bounds [H-07 — Medium]

RAG service operations MUST enforce domain limits regardless of caller and MUST process pending promotion in bounded units rather than one unbounded operation.

#### Scenario: Caller submits excessive RAG work

- GIVEN input exceeds a service-level source or promotion bound
- WHEN any route or internal caller invokes the service
- THEN excess work MUST be rejected or deferred without bypassing the bound

#### Scenario: Promotion contains more than one unit

- GIVEN pending work exceeds one configured promotion unit
- WHEN promotion runs
- THEN each unit MUST remain within the bound
- AND failure MUST leave unpromoted work eligible for a later run

### Requirement: Sensitive URL parameter redaction

Request logs MUST redact sensitive query-parameter values, including attachment tokens, while retaining non-secret diagnostic context.

#### Scenario: Logged URL contains a token

- GIVEN a request URL containing a sensitive token and ordinary parameters
- WHEN it is logged
- THEN the token value MUST NOT appear in any log output
- AND non-sensitive context SHOULD remain diagnosable
