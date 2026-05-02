// ============================================================
// Widget responsive tests — widget.js and README.md
// Static checks for mobile layout options and documented embed behavior.
// ============================================================
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const widgetSource = fs.readFileSync(path.join(__dirname, '..', 'widget.js'), 'utf8');
const readmeSource = fs.readFileSync(path.join(__dirname, '..', 'README_ES.md'), 'utf8');

test('widget detecta modo movil y responde a cambios de viewport', () => {
  assert.match(widgetSource, /matchMedia\(`\(max-width: \$\{WIDGET_OPTIONS\.mobileBreakpoint\}px\)`\)/);
  assert.match(widgetSource, /window\.innerWidth <= WIDGET_OPTIONS\.mobileBreakpoint/);
  assert.match(widgetSource, /wrap\.classList\.toggle\('lcp-mobile', isMobileViewport\(\)\)/);
  assert.match(widgetSource, /addEventListener\('change', updateResponsiveMode\)/);
});

test('widget expone configuracion responsive por cliente', () => {
  assert.match(widgetSource, /window\.LiveChatConfig \|\| window\.LiveChatProConfig/);
  assert.match(widgetSource, /data-\$\{name\.replace/);
  assert.match(widgetSource, /mobileMode: optionIn\(getOption\('mobileMode', 'dock'\)/);
  assert.match(widgetSource, /mobileWidth: parsePercent\(getOption\('mobileWidth', 100\)/);
  assert.match(widgetSource, /mobileFocusedWidth: parsePercent\(getOption\('mobileFocusedWidth', 94\)/);
  assert.match(widgetSource, /mobileFocusedHeight: parsePercent\(getOption\('mobileFocusedHeight', 76\)/);
  assert.match(widgetSource, /theme: optionIn\(getOption\('theme', 'auto'\)/);
  assert.match(widgetSource, /position: optionIn\(getOption\('position', 'bottom-right'\)/);
});

test('widget usa barra inferior fija en modo movil dock', () => {
  assert.match(widgetSource, /'dock', 'bottom-sheet', 'fullscreen', 'compact'/);
  assert.match(widgetSource, /#lcp-wrap\.lcp-mobile\.lcp-mobile-dock/);
  assert.match(widgetSource, /#lcp-wrap\.lcp-mobile\.lcp-mobile-dock #lcp-window/);
  assert.match(widgetSource, /#lcp-btn-label/);
  assert.match(widgetSource, /display: flex; flex-direction: column/);
});

test('modo movil dock abre una vista controlada sin afectar escritorio', () => {
  assert.match(widgetSource, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(widgetSource, /#lcp-wrap\.lcp-mobile\.lcp-mobile-dock #lcp-window/);
  assert.match(widgetSource, /top: var\(--lcp-visual-top\)/);
  assert.match(widgetSource, /bottom: var\(--lcp-mobile-keyboard-inset\)/);
  assert.match(widgetSource, /height: auto/);
  assert.match(widgetSource, /--lcp-mobile-window-width/);
  assert.match(widgetSource, /--lcp-mobile-focused-window-width/);
  assert.match(widgetSource, /--lcp-mobile-focused-window-height/);
  assert.match(widgetSource, /#lcp-wrap\.lcp-mobile\.lcp-mobile-dock\.lcp-open #lcp-btn \{ display: none; \}/);
  assert.match(widgetSource, /id="lcp-close"/);
});

test('modo dock no altera el escritorio si no esta activa la clase movil', () => {
  assert.doesNotMatch(widgetSource, /#lcp-wrap\.lcp-mobile-dock\s*\{/);
  assert.doesNotMatch(widgetSource, /#lcp-wrap\.lcp-mobile-dock #lcp-btn/);
});

test('widget en modo auto hereda tono visual del sitio', () => {
  assert.match(widgetSource, /function readSiteTheme\(fallbackColor\)/);
  assert.match(widgetSource, /window\.getComputedStyle\(document\.body\)/);
  assert.match(widgetSource, /--lcp-header-bg/);
  assert.match(widgetSource, /--lcp-border-color/);
  assert.match(widgetSource, /--lcp-input-bg/);
});

test('widget limita la ventana abierta al viewport visible del movil', () => {
  assert.match(widgetSource, /function updateViewportMetrics\(\)/);
  assert.match(widgetSource, /window\.visualViewport/);
  assert.match(widgetSource, /keyboardInset/);
  assert.match(widgetSource, /--lcp-mobile-window-height/);
  assert.match(widgetSource, /--lcp-mobile-viewport-height/);
  assert.match(widgetSource, /--lcp-mobile-window-bottom/);
  assert.match(widgetSource, /--lcp-mobile-keyboard-inset/);
  assert.match(widgetSource, /configuredFocusedHeight/);
  assert.match(widgetSource, /focusedWindowHeight/);
  assert.match(widgetSource, /lcp-input-focused/);
  assert.match(widgetSource, /visualViewport\?\.(addEventListener|addEventListener)/);
});

test('documentacion describe el comportamiento responsive', () => {
  assert.match(readmeSource, /Comportamiento responsive del widget/);
  assert.match(readmeSource, /data-mobile-breakpoint/);
  assert.match(readmeSource, /data-mobile-mode/);
  assert.match(readmeSource, /data-mobile-width/);
  assert.match(readmeSource, /data-mobile-focused-width/);
  assert.match(readmeSource, /data-mobile-focused-height/);
  assert.match(readmeSource, /Defecto: `dock`/);
  assert.match(readmeSource, /window\.LiveChatConfig/);
});
