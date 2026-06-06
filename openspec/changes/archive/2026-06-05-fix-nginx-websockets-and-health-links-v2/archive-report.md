# Archive Report: fix-nginx-websockets-and-health-links-v2

## Change Metadata
- **Change Name**: `fix-nginx-websockets-and-health-links-v2`
- **Archived Date**: 2026-06-05
- **Status**: Archived
- **Execution Mode**: `openspec`

## Executive Summary
This change resolved absolute path resolutions and WebSocket routing issues that bypass subpath-based proxy deployments (specifically under Nginx proxied subpaths like `/chat/`). It centralized client-side base path resolution, adapted demo/widget script loaders to dynamically resolve URLs under subpaths, converted health metrics dashboard links to relative routes, and added integration coverage for subpath redirect behaviors.

## Deliverables & Key Changes
1. **Admin Panel Path Resolution (`public/admin.html`)**:
   - Added a centralized `resolvePath(path)` helper.
   - Wrapped `api()` and `uploadApi()` calls to avoid double-prefixing.
   - Configured Socket.IO base path and connection paths dynamically using `getBasePath()`.
2. **Demo Widget Subpath Integration (`public/index.html` & `widget.js`)**:
   - Extracted base path dynamically for script injection and config fetching.
3. **Health Dashboard Routes (`src/services/health.js`)**:
   - Converted absolute links on the HTML metrics dashboard (e.g. `/admin`, `/health`) to relative links (e.g. `./admin`, `./health?format=json`).
4. **Smoke/Redirect Tests (`tests/api.test.js`)**:
   - Verified that `/demo` correctly redirects to `./` to match relative deployment.

## Verification & Validation Summary
- **Test Results**: 98 tests passed / 0 failed / 0 skipped.
- **Coverage**: 78.25% average coverage across test execution.
- **Spec Compliance**: 5/5 requirements verified as fully compliant.
- **Verdict**: PASS

## Archived Files
The following SDD artifacts have been archived inside this directory:
- `proposal.md`: Original scope, architecture approach, and success criteria.
- `exploration.md`: Initial research into subpath proxy configuration and frontend link layouts.
- `tasks.md`: Detailed work breakdown and task check-offs.
- `apply-progress.md`: Phase implementation log and incremental milestones.
- `verify-report.md`: Verification run, spec matrix, and test suite execution logs.
- `archive-report.md`: This summary report.
