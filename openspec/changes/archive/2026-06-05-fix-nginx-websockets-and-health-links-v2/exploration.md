# Exploration: Fix Nginx Websockets and Health Links v2

## 1. Current State & Problem Analysis

We are deploying LiveChat Pro under a subpath (e.g., `/chat`). Currently, several client-side API requests and links bypass the subpath and resolve to the absolute root domain (`/`), resulting in broken assets, failed API requests, and user redirection to login.

### Issues Detected:
1. **Admin Redirection Loop (`public/admin.html`)**:
   - Destructive mutations in `public/admin.html` (e.g., `clearBtn`, `blockBtn`, `banBtn`, `deleteBtn`) resolve paths via arrow functions starting with `/api/admin/sessions` rather than prepending the base path.
   - When these API requests fail (because the subpath is omitted), the admin application fails to fetch session updates, causing the boot/refresh chain to fail and kick the user back to the login view.
2. **Broken Demo Widget (`public/index.html`)**:
   - The demo page at `/chat/` (or `/chat/index.html`) fetches `/config-public` and loads `/widget.js` directly from the root of the domain (`/`) instead of `/chat/config-public` and `/chat/widget.js`.
3. **Absolute Health Page Links (`src/services/health.js`)**:
   - The health page UI at `/health` outputs hardcoded absolute root URLs (`/`, `/admin`, `/health?format=json`) for its navigation links, steering users away from the subpath deployment.

---

## 2. Affected Areas

* **`public/admin.html`**:
  * Needs centralized path resolution logic inside `api()` and `uploadApi()` to automatically prepend the base path.
  * Clean up caller sites currently prepending `getBasePath()` manually.
* **`public/index.html`**:
  * Needs a `getBasePath()` helper.
  * Update fetch request for `/config-public`.
  * Update widget script inclusion and code snippet text using the resolved path.
* **`src/services/health.js`**:
  * Update quick links from absolute to relative paths.

---

## 3. Proposed Approaches

### Approach A: Manual Prefixing Everywhere
Prefix every single call manually with `getBasePath()` at the call sites in `public/admin.html`.
* **Pros**: Simple to understand.
* **Cons**: Prone to future regressions if a new endpoint is introduced and developer forgets to prefix it.

### Approach B: Centralized Path Resolution in `api()` and `uploadApi()` (Recommended)
Add a robust `resolvePath()` helper inside `public/admin.html` that handles path resolution automatically:
```javascript
const resolvePath = path => {
  if (!path.startsWith('/')) return path;
  const base = getBasePath();
  if (!base) return path;
  if (path === base || path.startsWith(base + '/')) return path;
  return base + path;
};
```
* **Pros**:
  * Prevents future regressions for new API requests starting with `/`.
  * Allows call sites to be cleaner by omitting manual base path prepending.
  * Avoids double-prefixing if a developer accidentally passes an already-prefixed path.
* **Cons**: Slight addition to runtime code complexity.

---

## 4. Implementation Details & Plan

### Step 1: Centralize Paths in `public/admin.html`
1. Define the `resolvePath` helper right after `getBasePath`.
2. Inside `api(path, options)` and `uploadApi(path, form)`, resolve the path using `resolvePath(path)`.
3. Clean up the call sites in `public/admin.html` so they pass raw paths starting with `/`.

### Step 2: Fix Demo at `public/index.html`
1. Add `getBasePath()` to `public/index.html`:
   ```javascript
   const getBasePath = () => {
     const path = window.location.pathname;
     return path.replace(/\/(index\.html)?\/?$/, '');
   };
   ```
2. Modify config fetch and widget script injection to prepend `getBasePath()`.
3. Modify `data-server` and the copy-paste snippet to construct subpath-aware URLs.

### Step 3: Make Health Links Relative in `src/services/health.js`
1. Change absolute path strings to relative alternatives:
   - `/` -> `./`
   - `/admin` -> `./admin`
   - `/health?format=json` -> `./health?format=json`

---

## 5. Risks & Mitigation

* **Risk of double-prefixing**: If some calls already have `getBasePath()` prepended, centralizing resolution could double-prefix them.
  * **Mitigation**: The `resolvePath` helper explicitly checks if the path already starts with `base + '/'` or equals `base`, preventing double-prefixing.
* **Relative link resolution on `/health` trailing-slash variations**: If `/health/` is requested instead of `/health`, `./admin` would resolve to `/health/admin`.
  * **Mitigation**: Standard Express routing serves `/health` without trailing slash. Standard subpath proxies also preserve the lack of a trailing slash.
