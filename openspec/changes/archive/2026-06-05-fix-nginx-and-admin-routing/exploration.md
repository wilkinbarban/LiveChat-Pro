# Exploration: Nginx and Admin Routing Fixes

This exploration details the changes required to ensure LiveChat Pro works seamlessly under a subpath prefix (e.g. `/chat`), addresses admin client absolute fetches, socket connection namespace issues in the widget, and Nginx/Express routing for `/health` and `/demo`.

---

## 1. Current State and Problem Analysis

### A. Admin Client Routing and Fetch Path Issues
- **Files Involved**: `public/admin.html`
- **Issue**: The admin interface uses absolute paths (e.g. `/api/admin/me`, `/api/admin/login`, and `/socket.io/socket.io.js`) for API requests and resource loading.
- **Consequence**: When served under a subpath like `/chat`, the browser requests resource paths relative to the domain root (e.g. `https://domain.com/api/admin/...`), bypassing the Nginx location block for `/chat` and routing to the root application instead.

### B. Widget Socket.io Namespace Issue
- **Files Involved**: `widget.js`
- **Issue**: In the widget, `io(SERVER_URL)` is called where `SERVER_URL` can contain a path prefix (e.g. `https://wilkinbarban.duckdns.org/chat`). Socket.io client interprets a trailing path in the URL argument as a *namespace* (connecting to namespace `/chat` on the root socket server) instead of using it as the HTTP request *path*.
- **Consequence**: The socket server is initialized on the default namespace `/`. The connection fails because namespace `/chat` is unrecognized.

### C. Health Check and Demo Route Mappings
- **Files Involved**: `server.js`, `nginx/livechat.conf`
- **Issue**:
  - The chat backend hosts its health endpoint at `/health` and its demo page at the root `/`.
  - Nginx currently routes `/health` to Engram (port 18080) and has no route for `/demo`.
- **Consequence**: The chat health check and demo endpoints cannot be accessed directly under the `/chat` prefix without proper Nginx location rules and redirect overrides.

---

## 2. Proposed Approaches

### Approach 1: Dynamic Subpath Resolution (Recommended)
This approach resolves the subpath prefix dynamically on the client-side, making the frontend code independent of the specific subpath configuration.

#### 1. Admin Client API & Links (`public/admin.html`)
- **Base Path Resolver**: Add a utility to extract the subpath prefix from `window.location.pathname`:
  ```javascript
  const getBasePath = () => {
    const path = window.location.pathname;
    return path.replace(/\/admin(\.html)?\/?$/, '');
  };
  ```
- **Fetch & Wrapper Prefixing**: Modify `api()`, `uploadApi()`, and `refreshCsrfToken()` to prepend `getBasePath()` to all requests.
- **Dynamic Script Loading**: Replace the static `<script src="/socket.io/socket.io.js">` tag with dynamic loading within the boot phase:
  ```javascript
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // Inside boot():
  await loadScript(getBasePath() + '/socket.io/socket.io.js');
  ```
- **Socket.io Configuration**: Initialize the admin socket using the correct namespace and path:
  ```javascript
  state.socket = io(getBasePath() + '/admin', {
    path: getBasePath() + '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling']
  });
  ```
- **Dynamic Links**: Update `Demo` and `Health` links at boot:
  ```javascript
  $('demoLink').href = getBasePath() + '/' || '/';
  $('healthLink').href = getBasePath() + '/health';
  ```

#### 2. Widget Socket.io Setup (`widget.js`)
- Normalize `SERVER_URL` by removing trailing slashes:
  ```javascript
  let serverUrlClean = SERVER_URL.replace(/\/+$/, '');
  ```
- Parse the URL to separate origin and path prefix:
  ```javascript
  let parsedUrl;
  try {
    parsedUrl = new URL(serverUrlClean);
  } catch (e) {
    parsedUrl = new URL(serverUrlClean, window.location.origin);
  }
  const baseSubpath = parsedUrl.pathname.replace(/\/+$/, '');
  ```
- Instantiate `io` using the domain origin as host and `path` for routing, ensuring connection to the default namespace `/`:
  ```javascript
  const socket = io(parsedUrl.origin, {
    path: (baseSubpath ? baseSubpath : '') + '/socket.io',
    auth: { sessionId, apiKey: API_KEY, lang: WIDGET_LOCALE },
    autoConnect: false,
    transports: ['websocket', 'polling'],
  });
  ```

#### 3. Routing & Nginx Configuration (`server.js`, Nginx)
- **Express Backend Route**: Add a fallback redirect for `/demo` to `./` to support local development and proxy path relative resolution:
  ```javascript
  app.get('/demo', (req, res) => {
    res.redirect('./');
  });
  ```
- **Nginx Subpath & Redirects**:
  Update Nginx server block to map `/chat/` to backend with trailing slash (stripping prefix) and define explicit redirect locations for demo and health check:
  ```nginx
  location /chat/ {
      proxy_pass http://livechat_backend/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /chat/demo {
      return 302 /chat/;
  }

  location = /demo {
      return 302 /chat/;
  }
  ```

### Approach 2: Hardcoded Subpath Configuration
- Configure the subpath suffix (e.g. `/chat`) in the `.env` configuration file on the server.
- The server injects the configured base path into index/admin HTML files at load time or exposes it through `/config-public`.
- **Trade-off**: Requires configuration file modifications, breaks out-of-the-box support for multiple proxy subfolders, and complicates installation.

---

## 3. Comparison and Trade-offs

| Criterion | Approach 1 (Dynamic Client-Side) | Approach 2 (Hardcoded Config) |
| :--- | :--- | :--- |
| **Complexity** | Low (changes localized to client-side scripts) | Medium (requires server templating or config API) |
| **Flexibility** | High (works under any subpath prefix automatically) | Low (must be configured manually per deploy) |
| **Reverse Proxy Impact** | Independent of domain name or prefix path | Tied directly to configuration updates |
| **Local Dev Compatibility** | Preserves `/admin` and `/` behavior | Requires mimicking the subpath config locally |

---

## 4. Recommendation
**Approach 1 (Dynamic Client-Side)** is recommended. It handles subpaths cleanly without introducing environment variables or build-step configurations, while maintaining compatibility with simple local setups.

---

## 5. Risks and Mitigation

1. **Caching of old `widget.js` on third-party pages**:
   - *Risk*: Embedded widgets might have cached versions of `widget.js` that fail to parse `SERVER_URL` correctly.
   - *Mitigation*: Ensure cache headers on `/widget.js` are low (e.g., `Cache-Control: no-cache` or `must-revalidate`), or verify fallback handling.
2. **Trailing slash mismatch on Nginx redirects**:
   - *Risk*: A request to `/chat/admin` (without trailing slash) might trigger Nginx to redirect incorrectly if not handled.
   - *Mitigation*: Ensure Nginx is configured to handle subfolders gracefully, or add rewrite rules if needed.
