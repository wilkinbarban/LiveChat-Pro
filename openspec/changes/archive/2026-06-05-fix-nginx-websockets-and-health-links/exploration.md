# Exploration: Fix Nginx WebSockets and Health Links

This exploration details the changes required to resolve admin panel websocket reconnection errors and incorrect health/demo links when running LiveChat Pro under a subpath like `/chat/`.

---

## 1. Current State and Problem Analysis

### A. Admin Panel WebSocket Reconnection Loop
- **Files Involved**: `nginx/livechat.conf`, `public/admin.html`
- **Issue**: Under the subpath routing configuration, the Socket.io client connects to `/chat/socket.io/` on the proxy. The general Nginx configuration `nginx/livechat.conf` lacks a specific `location /chat/socket.io/` block. The request falls back to the catch-all `location /chat/` proxy route, which forwards connections using the dynamic `$connection_upgrade` map. Due to how Socket.io transitions from polling to websocket transport, or Nginx map evaluations, WebSocket upgrade handshakes fail/timeout under this catch-all block, emitting `connect_error` on the client.
- **Consequence**: Upon receiving `connect_error`, the client triggers `showLogin()`, redirecting the administrator back to the login screen immediately after logging in.

### B. Hardcoded Absolute Links for Health and Demo
- **Files Involved**: `public/index.html`, `public/admin.html`
- **Issue**:
  - `public/index.html` has hardcoded absolute links to `/admin` and `/health`.
  - `public/admin.html` has hardcoded absolute links to `/` and `/health`, and attempts to dynamically rewrite them using `querySelector` matching `a[href="/"]` and `a[href="/health"]`.
- **Consequence**: When served under a subpath like `/chat/`, clicking "Demo" or "Health" redirects the user to the root domain (`/` or `/health`), which either serves different apps (e.g. Engram health) or returns 404, bypassing the chat endpoints (`/chat/` and `/chat/health`).

---

## 2. Proposed Approaches

### Approach 1: Dedicated WebSocket Location Block & Relative Links with JS Upgrades (Recommended)
This approach adds an explicit location block in the Nginx template to force WebSocket upgrades, and converts the HTML links to relative paths while updating the boot JavaScript to correctly resolve them.

#### 1. Nginx Configuration (`nginx/livechat.conf`)
Add a dedicated websocket location block for `/chat/socket.io/` inside the server block:
```nginx
    # ── LiveChat Pro WebSockets under /chat subpath ──
    location /chat/socket.io/ {
        proxy_pass http://livechat_backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
```
*Note: In `nginx/wilkinbarban`, this block is already present, pointing directly to `http://127.0.0.1:8080/socket.io/` which is equivalent and correct.*

#### 2. Demo Page Links (`public/index.html`)
Change the hardcoded links to be relative so they resolve under `/chat/` or any other subpath:
```diff
-        <a class="btn primary" href="/admin" data-i18n="admin">Abrir panel admin</a>
-        <a class="btn" href="/health" data-i18n="health">Ver salud del sistema</a>
+        <a class="btn primary" href="./admin" data-i18n="admin">Abrir panel admin</a>
+        <a class="btn" href="./health" data-i18n="health">Ver salud del sistema</a>
```

#### 3. Admin Page Links & Dynamic Boot Rewrite (`public/admin.html`)
Update the HTML to relative paths:
```diff
-        <div class="top-actions"><a href="/">Demo</a><a href="/health">Health</a><button id="logoutBtn" class="btn-soft" type="button" data-i18n="logout">Salir</button></div>
+        <div class="top-actions"><a href="./">Demo</a><a href="./health">Health</a><button id="logoutBtn" class="btn-soft" type="button" data-i18n="logout">Salir</button></div>
```
And update the boot script selectors to match the new relative href values while preserving absolute subpath resolution (robust against trailing slashes):
```diff
-        const demoLink = document.querySelector('.top-actions a[href="/"]');
+        const demoLink = document.querySelector('.top-actions a[href="./"]');
         if (demoLink) demoLink.href = getBasePath() + '/';
-        const healthLink = document.querySelector('.top-actions a[href="/health"]');
+        const healthLink = document.querySelector('.top-actions a[href="./health"]');
         if (healthLink) healthLink.href = getBasePath() + '/health';
```

---

## 3. Comparison and Trade-offs

| Option | Pros | Cons |
| :--- | :--- | :--- |
| **Approach 1 (Recommended)** | - Direct relative resolution works out of the box.<br>- Dynamic JS rewriting prevents browser trailing slash interpretation issues.<br>- Forced WebSocket upgrade resolves Socket.io handshake failures. | - Requires updating both HTML and JS matching selectors. |
| **Alternative (Only HTML changes)** | - Simple to implement. | - Fails if admin page is accessed with trailing slash (e.g. `/chat/admin/`), as relative links resolve incorrectly. |

---

## 4. Recommendation
Adopt **Approach 1**. It fixes the immediate Nginx WebSocket handshake failure by adding the dedicated location rule, and provides a robust client-side relative link resolution that handles path variations gracefully.

---

## 5. Risks and Mitigation
- **Risk**: Existing custom deployments might have different upstream block names.
- **Mitigation**: Document the Nginx addition indicating that `livechat_backend` is the upstream name defined in the config, and can be replaced with `127.0.0.1:8080` or container names if necessary.
