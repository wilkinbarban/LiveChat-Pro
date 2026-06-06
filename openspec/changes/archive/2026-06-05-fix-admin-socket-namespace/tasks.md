Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

# Tasks: Fix Admin Socket Namespace

## Phase 1: Foundation / Config
- [x] Verify that `public/admin.html` exists in the repository.

## Phase 2: Core Implementation
- [x] Modify `public/admin.html` inside `connectRealtime()`:
  Update the socket connection initialization to use the literal namespace `'/admin'` rather than prepending `getBasePath()`.
  Target line:
  `state.socket = io(getBasePath() + '/admin', { path: getBasePath() + '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });`
  Replacement:
  `state.socket = io('/admin', { path: getBasePath() + '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });`

## Phase 3: Verification
- [x] Verify that the admin panel successfully connects over WebSocket to the `'/admin'` namespace and remains logged in without receiving "Invalid namespace" errors.
- [x] Run the project test suite using `npm test` to ensure no regressions are introduced.

## Phase 4: Cleanup
- [x] Update `tasks.md` checkmarks and status to complete.
