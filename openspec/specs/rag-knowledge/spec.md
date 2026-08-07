# Spec for rag-knowledge

Admin-managed RAG knowledge base: URL and PDF ingestion, lexical retrieval feeding LLM context, and one-time migration of the legacy JSON knowledge base. Replaces kb-trainer training.

## Requirements

### Requirement: URL Ingestion (Admin-Only)

The system MUST provide an admin-only endpoint to ingest a public URL as a knowledge document. The system SHALL fetch the page, strip HTML to text, chunk the content, and store document + chunks for retrieval.

#### Scenario: Ingest a documentation page

- GIVEN an authenticated admin with CSRF token
- WHEN the admin submits a reachable URL to the RAG ingestion endpoint
- THEN the system SHALL store the document and its chunks
- AND the content SHALL be retrievable for subsequent bot answers

#### Scenario: Unreachable URL

- GIVEN an authenticated admin
- WHEN the submitted URL times out or returns a non-2xx status
- THEN the system MUST reject the ingestion with a descriptive error
- AND MUST NOT persist a partial document

### Requirement: PDF Ingestion (Admin-Only)

The system MUST provide an admin-only PDF upload endpoint that accepts only files with `%PDF-` magic bytes and a maximum size of 5 MB. Text SHALL be extracted, chunked, and stored. The visitor attachment allowlist (images only) MUST remain unchanged.

#### Scenario: Valid PDF ingested

- GIVEN an authenticated admin uploading a 2 MB file starting with `%PDF-`
- WHEN the upload is processed
- THEN the system SHALL extract text and store the document and chunks

#### Scenario: Non-PDF upload rejected

- GIVEN an authenticated admin uploading a file whose first bytes are not `%PDF-`
- WHEN the upload is validated
- THEN the system MUST reject it with a "not a PDF" error regardless of file extension or MIME claim

#### Scenario: PDF over 5 MB rejected

- GIVEN an authenticated admin uploading a 6 MB valid PDF
- WHEN the upload is validated
- THEN the system MUST reject it with a size-limit error

#### Scenario: Visitor upload unchanged

- GIVEN a visitor (non-admin) session
- WHEN a PDF is posted to the visitor attachment endpoint
- THEN the system MUST reject it as before (images-only allowlist)

### Requirement: Lexical Retrieval with Embeddings-Ready Interface

Retrieval SHALL use lexical matching (token/stem similarity reusing existing stemming machinery) over stored chunks, returning the top relevant chunks for LLM context injection. The retrieval interface MUST be defined so an embeddings-based implementation can replace it without changing callers. v1 MUST NOT make external embedding API calls.

#### Scenario: RAG context injected into reply

- GIVEN ingested documents about "refund policy"
- WHEN a visitor asks "how do I get a refund?"
- THEN retrieval SHALL surface the refund-policy chunks
- AND the LLM prompt SHALL include them as context for the reply

#### Scenario: No relevant chunks

- GIVEN an empty or unrelated knowledge base
- WHEN retrieval finds no chunk above the relevance threshold
- THEN the LLM SHALL answer from the master prompt alone without fabricated citations

### Requirement: Knowledge Base JSON Migration

The system MUST provide a one-time migration importing existing `data/knowledge-base.json` entries as RAG documents. A backup copy of the original file MUST be created before import. Migration SHALL be idempotent: re-running MUST NOT duplicate documents.

#### Scenario: Successful migration

- GIVEN a production `data/knowledge-base.json` with entries
- WHEN the migration script runs
- THEN a timestamped backup SHALL exist
- AND every entry SHALL appear as a RAG document/chunk set

#### Scenario: Missing KB file

- GIVEN `data/knowledge-base.json` does not exist
- WHEN the migration script runs
- THEN it SHALL report "nothing to migrate" and exit successfully without error

#### Scenario: Re-run is idempotent

- GIVEN migration already completed
- WHEN the script runs again
- THEN document counts MUST NOT increase
