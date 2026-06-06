# Proposal: Fix Nginx Websockets and Health Links v2

## Intent
Address client-side API requests and link resolutions that bypass the subpath deployment and resolve to the absolute root domain (`/`), breaking admin functionality, websockets, and health links.

## Scope
- **In-Scope**:
  - Centralized path resolution helper in `public/admin.html` inside `api()` and `uploadApi()` to prevent missing base paths on all requests.
  - Dynamic `getBasePath()` resolution in `public/index.html` for public config fetch and widget script injection.
  - Relative path conversion for navigation buttons in `src/services/health.js`.
- **Out-of-Scope**:
  - Modifying CORS configurations.

## Capabilities
- **New/Modified Capabilities**: None.

## Approach
- **Centralized Path Resolution**: Introduce a `resolvePath` helper in `public/admin.html` to automatically prepend the base path. This guards against double-prefixing and reduces complexity at caller sites.
- **Dynamic Base Path Extraction**: Implement path resolution in `public/index.html` to detect the subpath and resolve the script injection.
- **Relative Path Conversion**: Change hardcoded absolute links to relative paths in `src/services/health.js`.

## Affected Areas
- `public/admin.html`
- `public/index.html`
- `src/services/health.js`

## Risks
- **Caching on Custom Deployments**: Aggressive client caching could delay updates. Mitigation: prompt cache clearing or rely on standard client headers.
- **Double Prefixing**: Already-prefixed paths could be duplicated. Mitigation: the path resolver helper checks if the base path is already prepended.

## Rollback Plan
- Revert the changes using git.

## Dependencies
- None.

## Success Criteria
- The admin panel remains logged in (all API calls succeed).
- The demo widget loads and connects successfully under `/chat/`.
- The health page links navigate correctly under the subpath context.
