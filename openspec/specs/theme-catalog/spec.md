# Spec for theme-catalog

Server-managed theme catalog with admin selection and live push to already-loaded widgets, keeping the `auto` host-sampling option.

## Requirements

### Requirement: Server Theme Catalog

The system MUST provide a server-side catalog of at least 16 named themes, each a CSS custom-property map covering the widget's theme variables. The catalog SHALL include light, dark, vibrant, and monochrome variants. Non-auto presets MUST define exactly 13 CSS variables — `font`, `color`, `panelBg`, `surfaceBg`, `inputBg`, `inputTextColor`, `inputPlaceholderColor`, `textColor`, `mutedColor`, `borderColor`, `headerBg`, `headerColor`, `shadow` — each with a string value. The `auto` (host-sampling) preset MUST remain selectable with `vars` null, and existing presets MUST keep their names and labels. The catalog SHALL add `light-sunrise`, `light-sky`, `dark-ocean`, `dark-forest`, `mono-light`, `mono-dark`, `green-chat`, `sky-chat`, `gradient-vibrant`, and `ink` to the existing six (16 total).
(Previously: catalog shipped 6 presets — `auto`, `classic`, `light-aurora`, `light-mint`, `dark-midnight`, `dark-ember` — with no minimum catalog size.)

#### Scenario: Catalog lists variants

- GIVEN an authenticated admin
- WHEN the admin requests the theme catalog
- THEN the response SHALL include at least one light and one dark creative variant plus `auto`
- AND each variant SHALL define the full CSS-variable map the widget expects

#### Scenario: Catalog lists 16 presets with complete variable maps

- GIVEN the expanded catalog
- WHEN an authenticated admin requests the theme catalog
- THEN the response SHALL include all 16 presets
- AND each non-auto preset's `vars` SHALL contain exactly the 13 keys with string values

#### Scenario: New preset selection persists and broadcasts live

- GIVEN the admin selects a newly added preset (e.g. `dark-ocean`)
- WHEN the selection is saved
- THEN the active theme SHALL persist
- AND the server SHALL emit `theme:update` with the preset name and vars
- AND loaded widgets SHALL apply the new variables live

#### Scenario: Catalog validation rejects a malformed preset

- GIVEN a preset whose `vars` deviate from the 13-key contract
- WHEN the catalog is validated
- THEN the system SHALL reject the preset as non-conforming

#### Scenario: Invalid theme PUT returns 400

- GIVEN an admin submits an unknown theme name
- WHEN the PUT request is processed
- THEN the server SHALL respond 400
- AND SHALL NOT change the active theme

### Requirement: Admin Theme Selection

The admin MUST be able to select the active theme; the selection SHALL be persisted in the settings store and served to widgets at load time via public config.

#### Scenario: Selection persists across restart

- GIVEN the admin selected the dark creative variant
- WHEN the server restarts
- THEN newly loaded widgets SHALL receive the dark variant in their config

### Requirement: Live Theme Push to Loaded Widgets

When the admin changes the active theme, the system MUST push a socket event carrying the theme's CSS-variable map to all connected widgets, and widgets SHALL apply it live without reload.

#### Scenario: Loaded widget re-themes live

- GIVEN a visitor widget already loaded with the light variant
- WHEN the admin selects the dark variant
- THEN the widget SHALL receive the theme socket event
- AND SHALL update its CSS variables without a page reload

#### Scenario: Push with no connected widgets

- GIVEN no widgets currently connected
- WHEN the admin changes the theme
- THEN the push SHALL complete without error
- AND the next widget to load SHALL receive the new theme from config

### Requirement: Auto Host-Sampling Preserved

The `auto` theme option (sampling host page styles, dark detection by luminance) MUST keep working unchanged when selected.

#### Scenario: Auto theme on a dark host page

- GIVEN the active theme is `auto`
- WHEN the widget loads on a host page with dark computed styles (luminance < 0.35)
- THEN the widget SHALL apply its dark auto-derived theme as today

### Requirement: Theme Visual Preview in Admin

The admin Appearance tab MUST render one visual card per preset from the GET /api/admin/settings/theme payload. Each card SHALL display a pure-CSS mini-widget thumbnail (header, panel, input mock) generated from that preset's variables via CSP-safe inline styles. The `auto` preset SHALL render a placeholder preview instead of a palette. Clicking a card MUST select it (radio semantics preserved) and update the active theme via the existing PUT flow.

#### Scenario: Page load renders a card with thumbnail for every preset

- GIVEN an authenticated admin viewing the Appearance tab
- WHEN the GET payload returns the preset catalog
- THEN one card SHALL render per preset
- AND each card SHALL include a mini-widget thumbnail from that preset's variables

#### Scenario: Thumbnail CSS variables match the preset payload

- GIVEN a preset card rendered from the payload
- WHEN its thumbnail is generated
- THEN the thumbnail's CSS variables SHALL equal the preset's `vars` from the payload

#### Scenario: Auto card shows a placeholder preview

- GIVEN the `auto` preset with `vars` null
- WHEN its card renders
- THEN the card SHALL show a placeholder preview
- AND SHALL NOT build a palette thumbnail

#### Scenario: Clicking a card selects the preset

- GIVEN a rendered preset card
- WHEN the admin clicks it
- THEN the card's radio SHALL become selected
- AND the selection SHALL be submitted via the theme PUT endpoint

#### Scenario: Missing i18n key never breaks rendering

- GIVEN a preset whose `theme.<name>` label is missing from the active dictionary
- WHEN its card renders
- THEN the card SHALL display the preset name as fallback
- AND SHALL NOT render a raw key string
