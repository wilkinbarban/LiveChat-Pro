# Proposal: Document Configuration Scenarios

## Intent
Document the two main deployment and configuration scenarios—reverse proxy subpath with domain, and direct execution via localhost/public IP—in the project's READMEs (English, Spanish, Portuguese) to prevent confusion and provide clear practical examples.

## Scope
- **In-Scope:** Adding a "Configuration Scenarios" (or language equivalent) section to `README.md`, `README_ES.md`, and `README_BR.md` with concrete configuration blocks (`.env`, Nginx, HTML widget script snippets).
- **Out-of-Scope:** Modifying application source code or changing project logic.

## Capabilities
- **New/Modified:** None.

## Approach
Insert standard, localized configuration sections at the end of the Nginx/deployment section of each README. The content will include:
1. **Scenario A (Subpath/Nginx):** Environment variables, Nginx reverse proxy configuration block supporting WebSockets, and HTML script tags for embedding.
2. **Scenario B (Direct/Localhost):** Environment variables and direct HTML script tags (localhost/IP).

## Affected Areas
- `README.md`
- `README_ES.md`
- `README_BR.md`

## Risks
None. The change is documentation-only and code-compatible.

## Rollback Plan
Revert changes using standard Git version control: `git checkout -- README.md README_ES.md README_BR.md`.

## Dependencies
None.

## Success Criteria
- Each README contains correct, fully localized examples of both deployment scenarios.
- Markdown and code block syntax is valid and clean.
