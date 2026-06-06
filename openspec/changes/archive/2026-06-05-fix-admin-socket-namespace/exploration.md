# Exploration: Fix Admin Socket Namespace

This exploration details the investigation and proposal to fix the Socket.io client connection namespace error in the admin page when served under a subpath prefix (e.g. `/chat`).

---

## 1. Current State and Problem Analysis

### A. Context and Files Involved
- **Client**: `public/admin.html` (lines 381-399)
- **Server**: `server.js` (line 361) and `src/sockets/index.js` (lines 443-456)

### B. Root Cause
- On the server, Socket.io is configured with a dedicated admin namespace `/admin`:
  ```javascript
  const adminIo = io.of('/admin');
  ```
- On the client side, the admin socket connection is initialized as follows:
  ```javascript
  state.socket = io(getBasePath() + '/admin', {
    path: getBasePath() + '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling']
  });
  ```
- When accessing the admin page under a subpath such as `/chat/admin`, `getBasePath()` evaluates to `/chat`. 
- Consequently, the first argument to `io()` becomes `/chat/admin`.
- The Socket.io client interprets a URL-like string or path with sub-directories as the namespace. Therefore, it tries to connect to the namespace `/chat/admin`.
- Since the server is only configured to listen to the namespace `/admin` (and the root namespace `/`), it rejects the connection request, and the client receives the `Invalid namespace` error, causing the page to redirect or log the user out.

---

## 2. Proposed Approaches

### Approach 1: Decouple Namespace from Subpath Prefix (Recommended)

Instead of passing the full subpath prefix to the first argument of `io()`, pass only `/admin` to target the correct namespace, and let the connection `path` parameter handle the subpath routing.

```javascript
state.socket = io('/admin', {
  path: getBasePath() + '/socket.io',
  withCredentials: true,
  transports: ['websocket', 'polling']
});
```

#### Trade-offs:
- **Pros**: 
  - Standard Socket.io practice: namespace is kept distinct from routing prefix path.
  - Fully resolves the issue for any arbitrary reverse-proxy subpaths.
  - Minimizes changes; requires modifying only a single line in `public/admin.html`.
- **Cons**:
  - None.

---

## 3. Recommendation

Implement **Approach 1** by updating the socket initialization inside `connectRealtime()` in `public/admin.html`. This aligns the admin socket connection logic with the widget's dynamic path routing setup in `widget.js`.

---

## 4. Risks & Verification Plan

### Risks
- No significant architectural risks. The admin page is served from the same host, so a host-relative namespace connection to `/admin` with the correct `path` parameter is safe.

### Verification Plan
1. Start the application locally.
2. Verify access to the admin page `/admin` under a standard configuration (no subpath).
3. Set up or simulate a subpath configuration (e.g. `/chat/admin`) and verify that Socket.io successfully connects to `/admin` without getting kicked out or receiving `Invalid namespace` errors.
