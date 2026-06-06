# Proposal: Fix Nginx and Admin Routing

## Intent
Resolve application routing, admin path mismatches, and widget Socket.io connection failures when hosted under Nginx subpaths (e.g. `/chat`).

## Scope
- **In-Scope**:
  - Dynamically resolve subpath prefixes in `public/admin.html`.
  - Parse Socket.io `SERVER_URL` in `widget.js` to isolate the base path from the connection origin.
  - Implement `/demo` to `/` fallback redirect in Express and Nginx locations for `/chat/demo` and `/demo`.
- **Out-of-Scope**:
  - Modifying private API CORS configurations.

## Capabilities
- **New Capabilities**: None.
- **Modified Capabilities**: None.

## Approach
Implement dynamic client-side subpath resolution:
1. **Admin Routing**:
   - Extract the base subpath dynamically from `window.location.pathname`.
   - Update `api()`, `uploadApi()`, and `refreshCsrfToken()` request URLs.
   - Load `socket.io.js` dynamically using the parsed subpath.
   - Configure admin socket connection with explicit `path` and namespace settings.
2. **Widget Socket.io**:
   - Parse `SERVER_URL` into origin and pathname.
   - Initialize `io` on the origin with the custom subpath prefix specified in `options.path`, avoiding namespace mismatch.
3. **Nginx & Backend Routing**:
   - Add Nginx location blocks for `/chat/` (proxy_pass with trailing slash) and redirects for `/chat/demo` and `/demo`.
   - Add Express `/demo` to `./` redirect in `server.js` to support relative links locally and on proxy.

## Affected Areas
- `public/admin.html`
- `widget.js`
- `server.js`
- `nginx/livechat.conf`

## Risks
- **Old widget caching**: Clients using old cached `widget.js` versions may fail to connect.
- **Trailing slash redirects**: Routing errors for `/chat/admin` without trailing slash.

## Rollback Plan
- Revert application file changes using Git (`git checkout -- public/admin.html widget.js server.js`).
- Restore the original Nginx config from a backup file (`.bak` or `git checkout`) and reload Nginx.

## Dependencies
- Socket.io connection uses the same port/base path mapping.
- Standard Nginx permissions to reload the server.

## Success Criteria
- The admin dashboard is fully functional at `https://<domain>/chat/admin`.
- The widget connects and registers correctly when served under a subpath domain.
- Backend routing redirects `/chat/demo` to `/chat/` and handles `/chat/health` properly.
