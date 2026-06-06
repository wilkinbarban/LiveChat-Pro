# Tasks: Fix Nginx Websockets and Health Links v2

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation / Config
- [x] Verify that `public/admin.html`, `public/index.html`, and `src/services/health.js` exist.

## Phase 2: Core Implementation
- [x] Modify `public/admin.html` to add `resolvePath(path)` helper logic.
- [x] Wrap target API requests in `public/admin.html` (specifically `api()` and `uploadApi()`) with `resolvePath(path)`.
- [x] Revert manual prepended `getBasePath()` callers back to starting with `/api/admin/` (e.g., boot() for `/api/admin/me`, `/api/admin/login`, `/api/admin/logout`) in `public/admin.html`.
- [x] Modify `public/index.html` to add `getBasePath()` helper.
- [x] Update config public fetch in `public/index.html` to use `getBasePath()`.
- [x] Update widget script src and data-server attributes in `public/index.html` to use `getBasePath()`.
- [x] Update the dynamic snippet script text in `public/index.html` to include the subpath context.
- [x] Modify `src/services/health.js` to change quick links from absolute (`/`, `/admin`, `/health?format=json`) to relative.

## Phase 3: Verification
- [x] Verify that `public/admin.html` connects over WebSocket and refreshSessions does not fail.
- [x] Verify that the demo page (/chat/) loads the widget successfully and is interactive.
- [x] Verify that navigation links on the health page resolve correctly under the subpath context.
- [x] Run the project test suite with `npm test`.

## Phase 4: Cleanup
- [x] Remove any temporary files, debug logging, or commented-out draft code.
