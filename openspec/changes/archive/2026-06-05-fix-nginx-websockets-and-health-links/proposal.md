# Proposal: Fix Nginx WebSockets and Health Links

## Intent
Resolve administrator redirection loop upon login caused by Socket.io WebSocket connection failures, and fix hardcoded absolute health/demo links that break under subpath configurations.

## Scope
- **In-scope**:
  - Add dedicated `/chat/socket.io/` WebSocket location block to Nginx configuration (`nginx/livechat.conf`).
  - Convert absolute links (`/admin`, `/health`, `/`) to relative (`./admin`, `./health`, `./`) in `public/index.html` and `public/admin.html`.
  - Update dynamic `querySelector` mappings in `public/admin.html` boot script to match relative selectors.
- **Out-of-scope**:
  - Altering CORS configurations or modifying underlying Socket.io server options.

## Capabilities
None.

## Approach
Implement a dedicated Nginx WebSocket block forcing upgrade headers for Socket.io, and shift to relative HTML paths paired with JavaScript-based path resolution (`getBasePath()`) in the admin boot sequence.

## Affected Areas
- `nginx/livechat.conf`
- `public/index.html`
- `public/admin.html`

## Risks
- Custom deploy environments using different upstream names for the Nginx proxy.
  - *Mitigation*: Specify upstream configurations clearly or use standard backend bindings.

## Rollback Plan
- Revert the files to their original states using Git.
- Restore Nginx configuration from backup and reload Nginx.

## Dependencies
None.

## Success Criteria
- Admin panel remains logged in successfully (Socket.io WebSocket upgrades connect).
- Health and demo links in `public/index.html` and `public/admin.html` dynamically point to `/chat/health` and `/chat/` subpaths respectively.
