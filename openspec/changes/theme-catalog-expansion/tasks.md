# Tasks: Theme Catalog Expansion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 300–370 |
| 400-line budget risk | Medium (High if dict lines reflow) |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback |
|------|------|----|----------------------|-----------------|----------|
| 1 theme-catalog-presets | +10 presets + conformance RED | PR 1 | `node --test tests/themes.test.js` | `npm test` | revert themes.js commit |
| 2 admin-theme-cards-dynamic | renderPresetCards + thumbnails | PR 2 | `node --test tests/admin-theme-tab.test.js` | browser: Appearance tab | revert admin.html render commit |
| 3 admin-theme-i18n | 11 keys × 5 dicts + i18n test | PR 3 | `node --test tests/admin-theme-tab.test.js` | `npm test` | revert dict commit |

## Phase 1: Catalog (RED → GREEN → verify)

- [x] 1.1 RED `tests/themes.test.js`: `expectedPresets` (L102) → 16 names; count 16. Fails: 10 missing.
- [x] 1.2 RED `tests/themes.test.js`: extend PUT hot-change test (L228-259) with `green-chat` → 200 + `theme:update`. Fails: 400 today.
- [x] 1.3 GREEN `src/services/themes.js`: +10 presets (`light-sunrise`, `light-sky`, `dark-ocean`, `dark-forest`, `mono-light`, `mono-dark`, `green-chat`, `sky-chat`, `gradient-vibrant` (linear-gradient headerBg), `ink`) — 13-var maps EXACTLY per design.md L17-28 + Inter font (design.md L15); `auto` vars:null; existing 6 + exports unchanged.
- [ ] 1.4 VERIFY: `node --test tests/themes.test.js` (gate L115-127 auto-covers) && `npm test` && `npx biome check src/services/themes.js tests/themes.test.js`
- Rollback: revert themes.js commit; unknown names degrade to `auto`.

## Phase 2: Dynamic cards + thumbnails (RED → GREEN → verify)

- [ ] 2.1 RED `tests/admin-theme-tab.test.js`: rewrite L17-26 → renderer-contract asserts (file-content, no DOM): `renderPresetCards` defined; iterates payload (Object.entries); radio per preset (`name="theme-preset"`); `.theme-preview` via `setProperty('--lcp-…')`; auto placeholder (`.theme-preview--auto`); i18n-guard fallback to `preset.label` (no raw key); static `data-theme="…"` labels gone.
- [ ] 2.2 GREEN `public/admin.html`: delete static cards L402-431; add `renderPresetCards(presets, active)` → `#theme-presets-container` (checked when active; label via `t('theme.'+name.replace(/-/g,'_'))` guarded by dict-key presence → `preset.label`); ~40-line `.theme-preview` CSS in `<style>` (L8); `loadThemeSettings` (L1468-1482) → `renderPresetCards(res.presets, res.active)`; save handler (L1484-1508) unchanged.
- [ ] 2.3 VERIFY: `node --test tests/admin-theme-tab.test.js` && `npm test` && `npx biome check .`
- Rollback: revert admin.html render commit restores static cards.

## Phase 3: i18n ×5 dicts (RED → GREEN → verify)

- [ ] 3.1 RED `tests/admin-theme-tab.test.js`: i18n `requiredKeys` (L30) → 16 `theme.*` + `theme.preview` ×5 langs. Fails: 10 missing.
- [ ] 3.2 GREEN `public/admin.html`: +11 keys × 5 dicts (L465-469): `theme.light_sunrise`, `theme.light_sky`, `theme.dark_ocean`, `theme.dark_forest`, `theme.mono_light`, `theme.mono_dark`, `theme.green_chat`, `theme.sky_chat`, `theme.gradient_vibrant`, `theme.ink`, `theme.preview`; EN labels per design.md L42; `fr` uses U+2019; existing 6 keys untouched.
- [ ] 3.3 VERIFY: `node --test tests/admin-theme-tab.test.js` && `npm test` && `npx biome check .`
- Rollback: revert dict commit; missing keys fall back to `preset.label`.

## Phase 4: Final verification

- [ ] 4.1 `npm test` full suite green (incl. hot-change).
- [ ] 4.2 `npx biome check .` clean.
- [ ] 4.3 `git diff`: no changes to `widget.js`, `src/routes/admin.js`, `server.js`, `db.js`, `package.json`.
