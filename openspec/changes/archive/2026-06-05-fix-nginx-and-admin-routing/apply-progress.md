# Progress Log: fix-nginx-and-admin-routing

## Status
All phases (Phase 1, Phase 2, Phase 3, Phase 4) have been successfully implemented, verified, and cleaned up.

## Executive Summary
Resolved system routing, admin panel path mismatches, and widget Socket.io connection failures when hosted under Nginx subpath prefixes (specifically `/chat`).
1. **server.js**: Added GET `/demo` redirect to `./` for supporting relative local and proxy resolution.
2. **public/admin.html**:
   - Added `getBasePath()` helper.
   - Prefixed all REST API calls and Socket.io client initialization with `getBasePath()`.
   - Replaced the static Socket.io script tag with a dynamic script loader in the `boot()` function.
   - Updated the Demo and Health link anchors dynamically at boot to remain relative to the dynamic base path.
3. **widget.js**:
   - Cleaned up and parsed the `SERVER_URL` using standard `URL` parsing to separate the origin from potential subpath prefixes.
   - Initialized Socket.io client on the parsed origin with a custom `path` option targeting `subpath + '/socket.io'`, ensuring it connects to the default `/` namespace without routing namespace mismatches.
4. **Nginx Deployment**:
   - Updated the `nginx/livechat.conf` template to draft subpath configurations.
   - Modified the active `/etc/nginx/sites-available/wilkinbarban` configuration to enable WebSocket upgrades, long timeouts, custom socket.io routing, and demo redirects.
   - Verified config syntax with `nginx -t` and reloaded the service.

## Implementation Progress
- [x] GET `/demo` redirection rule in `server.js`
- [x] Workspace draft configuration in `nginx/livechat.conf`
- [x] Dynamic subpath resolution via `getBasePath()` in `public/admin.html`
- [x] Prepending dynamic base path to admin API and upload requests
- [x] Dynamic loading of `socket.io.js` script in the `boot()` function of `public/admin.html`
- [x] Configured admin socket path and namespace to use dynamic prefix
- [x] Dynamically rewrote "Demo" and "Health" anchor links at admin boot
- [x] Cleaned duplicate click listeners from admin script
- [x] Standard `URL` parsing of `SERVER_URL` in `widget.js`
- [x] Configured widget socket initialization with origin and custom path option
- [x] Regression testing suite validation (`tests/api.test.js` updated and executed)
- [x] Copied and deployed configuration to active Nginx path
- [x] Validated Nginx syntax and successfully reloaded Nginx service

## Risks & Mitigations
- **Old Cached widget.js**: Visited sites with cached versions of `widget.js` may still target root. Cache headers on the server should be kept low to force updates.
- **Root-level Socket.io collision**: Mitigated by mapping specific subpaths explicitly in Nginx so other applications (e.g. Medflow or Engram) remain unaffected.
