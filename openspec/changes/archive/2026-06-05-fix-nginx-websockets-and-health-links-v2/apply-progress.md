# Apply Progress: Fix Nginx Websockets and Health Links v2

This document records the progress of implementing code changes for the subpath-aware Nginx WebSocket and health link routing fixes.

## Completed Changes

### 1. health.js (`src/services/health.js`)
- Replaced absolute links (`/`, `/admin`, `/health?format=json`) with relative ones (`./`, `./admin`, `./health?format=json`).
- This ensures correct subpath resolution when loading the health dashboard under proxy setups like `/chat`.

### 2. index.html (`public/index.html`)
- Added `getBasePath()` helper function to the script's IIFE.
- Configured `/config-public` fetch and the widget loader script src/data-server settings to use `getBasePath()`.
- Updated the dynamic snippet copy-paste block to display the subpath-aware URL snippet.

### 3. admin.html (`public/admin.html`)
- Added `resolvePath(path)` helper logic.
- Integrated `resolvePath(path)` inside the global `api()` and `uploadApi()` functions.
- Reverted manual prepend of `getBasePath()` across all REST API client calls so that `resolvePath()` manages them automatically and consistently.

## Current Status
- All tasks in Phase 1, Phase 2, Phase 3, and Phase 4 are completed.
- Running the native Node.js test suite with `npm test` confirms that all 98 tests continue to pass without regression.
