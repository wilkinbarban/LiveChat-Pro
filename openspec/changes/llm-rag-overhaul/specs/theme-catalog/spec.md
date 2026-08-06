# Delta for theme-catalog

Server-managed theme catalog with admin selection and live push to already-loaded widgets, keeping the `auto` host-sampling option.

## ADDED Requirements

### Requirement: Server Theme Catalog

The system MUST provide a server-side catalog of named themes, each defined as a CSS custom-property map covering the widget's existing theme variables. The catalog SHALL include light and dark creative variants. The `auto` (host-sampling) and existing default behaviors MUST remain selectable.

#### Scenario: Catalog lists variants

- GIVEN an authenticated admin
- WHEN the admin requests the theme catalog
- THEN the response SHALL include at least one light and one dark creative variant plus `auto`
- AND each variant SHALL define the full CSS-variable map the widget expects

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
