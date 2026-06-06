Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

# Tasks: Fix Nginx WebSockets and Health Links

## Phase 1: Foundation/Config
- [x] **Configure local Nginx template**: Add a location block for `/chat/socket.io/` in `nginx/livechat.conf` with upgrade headers (`Connection "upgrade"`, `Upgrade $http_upgrade`).
- [x] **Deploy Nginx configuration to host system**: Copy the `/chat/socket.io/` block to the system file `/etc/nginx/sites-available/wilkinbarban` pointing it to `http://127.0.0.1:8080/socket.io/`.

## Phase 2: Implementation
- [x] **Relative links in index.html**: Edit `public/index.html` to convert hardcoded links from `/admin` to `./admin` and `/health` to `./health`.
- [x] **Relative links and script query selectors in admin.html**: Edit `public/admin.html` to update links from `/` to `./` and `/health` to `./health`. Also update selectors in the page boot script to match the new relative paths (`a[href="./"]` and `a[href="./health"]`).

## Phase 3: Verification
- [x] **Test WebSocket connection**: Verify that the admin panel (`admin.html`) successfully upgrades to WebSocket connections without entering a fallback redirection loop.
- [x] **Verify navigation links**: Click health and demo/admin links on both `index.html` and `admin.html` to confirm they load correct relative subpaths.
- [x] **Run test suite**: Execute the existing project test suite using `npm test` to ensure there are no regressions.

## Phase 4: Cleanup
- [x] **Nginx configuration test**: Run `sudo nginx -t` on the host to verify the syntactical correctness of the newly added location block.
- [x] **Reload Nginx service**: Apply the updated configurations safely using `sudo systemctl reload nginx`.
