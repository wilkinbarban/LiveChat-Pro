# Proposal: Theme Catalog Expansion — 16 presets + visual thumbnails

## Intent

User wants many more themes, each with a visible thumbnail preview, and hot theme switching — scoped to the visitor chat widget only. Catalog is code-as-data (`THEME_PRESETS`) and persistence stores only the active name string, so expanding the catalog needs **no DB migration**. Hot-change already works (PUT → `io.emit('theme:update')` → widget applies via `applyThemeVars`); this change **verifies** it, doesn't rework it.

## Scope & Boundaries

### In Scope
- Expand catalog 6 → **16 (Option B)**: add `light-sunrise`, `light-sky`, `dark-ocean`, `dark-forest`, `mono-light`, `mono-dark`, `brand-whatsapp`, `brand-telegram`, `brand-instagram`, `brand-x` (concrete 13-var hex palettes per explore artifact). Existing 6 stay byte-identical; `auto` stays `vars:null` (backward compatible).
- Thumbnails: pure-CSS mini-widget preview per preset, rendered client-side from vars the GET payload already ships (no server-route change; CSP-safe inline styles confirmed). `auto` gets a placeholder card (site-sampling graphic, not a real palette).
- Cards rendered dynamically from GET payload (`renderThemeCards`) — future themes become data + i18n keys only.
- Tests: extend `themes.test.js` `expectedPresets` + conformance continues; **update** `admin-theme-tab.test.js` L17-26 (static `data-theme` asserts) for dynamic rendering; new preview-render string tests; E2E container hot-change verify.

### Out of Scope
- No new CSS variables beyond the 13 (would require `widget.js` changes).
- No server-side thumbnail images; no per-tenant theme upload; no admin-panel chrome theming.
- `WIDGET_OPTIONS.theme` embed option stays `auto|classic`.
- No changes to `widget.js`, `src/routes/admin.js`, `server.js`, `db.js`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `theme-catalog` (main delta): requirement expansion — catalog grows to ≥16 presets incl. social-branded variants; each preset SHALL display a visual thumbnail in admin; dynamic rendering.
- `admin-settings`: i18n convention delta — new `theme.<name>` keys required in all 5 dicts (es/en/pt/fr/de).

## Approach

Thumbnail: client-side JS builds a generic `.theme-preview` mock (header bar + avatar + user/bot bubbles + input row) whose root sets the 13 vars as inline `--lcp-*` custom properties; a ~40-line static CSS block styles it via `var(--lcp-*)`. Server payload is the single source of truth — no var duplication, pixel fidelity with the widget, scales to N themes. Hot-change: keep as-is; add E2E verify task (admin PUT new theme → loaded widget re-themes).

## Affected Areas

| File | Action | Description |
|------|--------|-------------|
| `src/services/themes.js` | Modified | +10 presets in `THEME_PRESETS` (13-var maps, Inter font) |
| `public/admin.html` | Modified | `renderThemeCards`, `.theme-preview` CSS/JS, i18n keys ×5 dicts (L465-469) |
| `tests/themes.test.js` | Modified | Extend `expectedPresets`; conformance gate (13-key) acts as guardrail |
| `tests/admin-theme-tab.test.js` | Modified | L17-26 static asserts → render-path asserts (deliberate break); extend i18n coverage ×5 langs |
| `package.json` | Modified | Add new test file to `npm test` if created |

## Decisions (pending user confirmation at plan review)

> Proposal question round — 3 open product questions; recommended positions marked.

1. **Catalog size 12 / 16 / 20** → recommend **16 (Option B)**: covers light/dark/vibrant/mono/social in one coherent batch.
2. **Brand presets use trademarked names/colors** (WhatsApp/Telegram/Instagram/X) → acceptable, or rename to neutral (`brand-green`, `brand-blue`, `brand-pink`, `brand-dark`)?
3. **Card rendering: fully-dynamic vs hybrid static+dynamic** → recommend **fully-dynamic** (future themes = data-only; the admin-theme-tab test change is deliberate, not collateral).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `admin-theme-tab.test.js` L17-26 breaks on dynamic render | High | Deliberate, updated in same change |
| Missing i18n key renders raw key (`t()` fallback L482) | Med | Add `theme.<name>` to all 5 dicts |
| Conformance gate fails on non-13-key preset | Low | Automated guardrail; 13-key/13-string contract enforced |
| Trademark sensitivity on brand presets | Low | Decision 2; neutral rename fallback |
| GET payload grows ~1KB/preset | Low | Trivial for local admin API |

## Rollback

Catalog is code-as-data: revert the `themes.js` commit removes presets. Reverting dynamic rendering restores the static cards in `admin.html`. `settings.theme.active` persisted name is unaffected — an unknown name falls back to `auto` in `getActiveTheme()`. No DB migration, no schema risk.

## Success Criteria

- [ ] ≥15 total presets (16 shipped); every preset shows a visual thumbnail in the admin Appearance tab
- [ ] PUT theme persists + emits `theme:update`; widget hot-applies on loaded pages (E2E verified)
- [ ] `npm test` green, including updated `admin-theme-tab.test.js` and new preview/catalog tests
