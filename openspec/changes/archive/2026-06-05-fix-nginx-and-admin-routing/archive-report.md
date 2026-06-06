# Archive Report: Fix Nginx and Admin Routing

This report documents the completion and archiving of the **fix-nginx-and-admin-routing** change.

## 1. Executive Summary
- **Change Name**: fix-nginx-and-admin-routing
- **Completion Date**: 2026-06-05
- **Status**: COMPLETED & VERIFIED
- **Artifact Mode**: openspec

## 2. Scope & Implementation Summary
The primary goal of this change was to resolve routing, path mismatches, and widget connection errors when hosting the application under Nginx subpaths (e.g., `/chat`).

### Modified Files:
- **`public/admin.html`**: Implemented dynamic client-side subpath resolution helper (`getBasePath()`), prepended it to REST APIs, loaded `socket.io.js` dynamically, and updated the admin socket connection.
- **`widget.js`**: Replaced static socket connection URLs with parsed origin/subpath extraction using standard `URL` objects.
- **`server.js`**: Added dynamic fallback redirect for `GET /demo` to `./`.
- **Nginx Config (`/etc/nginx/sites-available/wilkinbarban`)**: Added Nginx location blocks for `/chat/`, `/chat/socket.io/`, and redirects from `/chat/demo` and `/demo` to `/chat/`.

## 3. Verification Details
- **Test Runner**: Node.js Native Test Runner
- **Test Status**: All 98 tests passed.
- **Manual verification**: Confirmed correct Socket.io connections and route redirects (302) under subpaths.

## 4. Risks & Maintenance
- **Old widget caching**: Clients with old cached `widget.js` versions might experience temporary connection failures. Recommend low cache headers (`Cache-Control: no-cache`).
