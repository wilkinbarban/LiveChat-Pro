# Proposal: Fix Admin Socket Namespace

## Intent
Fix Socket.io client connection namespace mismatch in `public/admin.html` when served under a subpath prefix (e.g., `/chat/admin`).

## Scope
- **In-Scope**: Modifying the socket connection logic in `public/admin.html` to pass `/admin` as the first argument to `io()`, while maintaining the base path prefix in the `path` configuration option.
- **Out-of-Scope**: Modifying server-side CORS configurations, server namespaces, or routing.

## Capabilities
- **New/Modified Capabilities**: None.

## Approach
Decouple the Socket.io namespace from the subpath prefix routing.
Instead of passing the full subpath prefix to the first argument of `io()` (which incorrectly changes the requested namespace to `/subpath/admin`), we pass the literal namespace `/admin` and keep the subpath routing prefix contained in the connection `path` parameter.

```javascript
state.socket = io('/admin', {
  path: getBasePath() + '/socket.io',
  ...
});
```

## Affected Areas
- `public/admin.html`

## Risks
- **None**: This change resolves client-side routing logic and uses standard Socket.io configuration to separate namespace path from routing path.

## Rollback Plan
- Revert the changes to `public/admin.html` using Git.

## Dependencies
- None.

## Success Criteria
- The admin panel successfully establishes a WebSocket connection using the `/admin` namespace when served under a subpath prefix.
- The admin interface remains functional without triggering "Invalid namespace" errors or forced logouts.
