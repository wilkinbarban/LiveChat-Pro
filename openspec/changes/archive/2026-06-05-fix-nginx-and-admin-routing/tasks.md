Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

# Task List: Fix Nginx and Admin Routing

## Phase 1 (Foundation/Config)
- [x] Add backend redirect rule: Modify `server.js` to add `GET /demo` redirect to `./` for supporting relative local and proxy resolution.
- [x] Prepare Nginx configuration draft: Create or update a draft location config to proxy `/chat/` and handle redirects for `/chat/demo` and `/demo`.

## Phase 2 (Implementation)
- [x] Update admin HTML utility: Add `getBasePath()` to `public/admin.html` to dynamically extract the subpath prefix from `window.location.pathname`.
- [x] Prepend dynamic base path to admin API calls: Modify `api()`, `uploadApi()`, and `refreshCsrfToken()` request URLs to use `getBasePath()`.
- [x] Dynamically load `socket.io.js`: Replace static `<script>` tag in `public/admin.html` with a dynamic loader helper using `getBasePath()`.
- [x] Configure admin socket path: Update socket initiation in `public/admin.html` to pass `path: getBasePath() + '/socket.io'` and namespace `/admin`.
- [x] Modify widget setup: Parse `SERVER_URL` in `widget.js` to extract its origin and subpath, then clean trailing slashes.
- [x] Update widget socket initialization: Use `parsedUrl.origin` and `path: subpath + '/socket.io'` in `widget.js` to keep the namespace as `/`.

## Phase 3 (Verification)
- [x] Verify admin page access: Build/run the app and load the dashboard at `/chat/admin` with and without a trailing slash.
- [x] Validate widget connection: Embed the widget and confirm it successfully connects to socket.io under a path prefix.
- [x] Run test suite: Execute the native project test runner or run `npm test` to ensure no regressions are introduced.

## Phase 4 (Cleanup)
- [x] Deploy Nginx configuration: Copy the drafted configuration to `/etc/nginx/sites-available/wilkinbarban`.
- [x] Validate Nginx syntax: Run `nginx -t` to verify the configuration syntax is correct.
- [x] Reload Nginx service: Perform `systemctl reload nginx` to apply changes, then clean up any temporary draft files.
