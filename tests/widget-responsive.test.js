// ============================================================
// Widget responsive tests — widget.js and README.md
// Static checks for mobile layout options and documented embed behavior.
// ============================================================
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { hasRichMarkdown, reconcileHistory, renderSafeMarkdown, shouldTypewriterMessage } = require('../widget.js');

const widgetSource = fs.readFileSync(path.join(__dirname, '..', 'widget.js'), 'utf8');
const socketSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'sockets', 'index.js'), 'utf8');
const readmeSource = fs.readFileSync(path.join(__dirname, '..', 'README_ES.md'), 'utf8');

test('widget renderiza Markdown limitado y seguro', () => {
  const html = renderSafeMarkdown('**Resumen**\n\n- Uno\n- Dos\n\n1. Primero\n2. Segundo\n\n`npm test`\n\n```js\nconst ok = true;\n```\n\n[Docs](https://example.com/docs)');
  assert.match(html, /<strong>Resumen<\/strong>/);
  assert.match(html, /<ul><li>Uno<\/li><li>Dos<\/li><\/ul>/);
  assert.match(html, /<ol><li>Primero<\/li><li>Segundo<\/li><\/ol>/);
  assert.match(html, /<code>npm test<\/code>/);
  assert.match(html, /<pre><code>const ok = true;<\/code><\/pre>/);
  assert.match(html, /href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer"/);
});

test('widget escapa HTML arbitrario y no enlaza protocolos inseguros', () => {
  const html = renderSafeMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) <script>alert(2)</script>');
  assert.doesNotMatch(html, /<img|<script|href="javascript:/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /\[bad\]\(javascript:alert\(1\)\)/);
});

test('widget usa roles profesionales y estilos para contenido enriquecido', () => {
  assert.match(widgetSource, /msg\.from === 'bot' \? 'Asistente' : 'Soporte'/);
  assert.doesNotMatch(widgetSource, /🤖 Asistente|👤 Admin/);
  assert.match(widgetSource, /\.lcp-rich-text ul, \.lcp-rich-text ol/);
  assert.match(widgetSource, /\.lcp-rich-text pre code/);
  assert.match(widgetSource, /const useTypewriter = shouldTypewriterMessage\(msg, opts\)/);
});

test('widget conserva typewriter para todas las respuestas frescas del agente', () => {
  assert.equal(hasRichMarkdown('Respuesta breve y directa.'), false);
  assert.equal(hasRichMarkdown('**Resumen**'), true);
  assert.equal(hasRichMarkdown('- Uno\n- Dos'), true);
  assert.equal(shouldTypewriterMessage({ from: 'bot', text: 'Respuesta breve.' }), true);
  assert.equal(shouldTypewriterMessage({ from: 'admin', text: 'Respuesta breve.' }), true);
  assert.equal(shouldTypewriterMessage({ from: 'bot', text: '**Respuesta**' }), true);
  assert.equal(shouldTypewriterMessage({ from: 'bot', text: '- Uno\n- Dos' }), true);
  assert.equal(shouldTypewriterMessage({ from: 'bot', text: 'Respuesta', attachments: [{}] }), false);
  assert.equal(shouldTypewriterMessage({ from: 'user', text: 'Respuesta' }), false);
  assert.equal(shouldTypewriterMessage({ from: 'bot', text: 'Respuesta' }, { history: true }), false);
  assert.match(widgetSource, /typewriterReveal\(div, msg\.text, text, timeEl/);
  assert.match(widgetSource, /textNode\.textContent = slice/);
  assert.match(widgetSource, /textNode\.innerHTML = fullHtml/);
});

test('same-session reconnect adds only history missed while disconnected', () => {
  const rendered = new Set(['id:1', 'id:2']);
  const history = [
    { id: 1, from: 'bot', text: 'Welcome', ts: 1 },
    { id: 2, from: 'user', text: 'Hello', ts: 2 },
    { id: 3, from: 'admin', text: 'While disconnected', ts: 3 },
  ];

  assert.deepEqual(reconcileHistory(history, rendered), [history[2]]);
  assert.deepEqual([...rendered], ['id:1', 'id:2', 'id:3']);
  assert.deepEqual(reconcileHistory(history, rendered), []);
});

test('history reconciliation deduplicates legacy messages without database ids', () => {
  const rendered = new Set();
  const message = { from: 'bot', text: 'Legacy welcome', ts: 1 };
  assert.deepEqual(reconcileHistory([message, message], rendered), [message]);
});

test('saludo inicial se persiste una sola vez', () => {
  assert.match(socketSource, /insertInitialGreeting\.run/);
  assert.match(socketSource, /session\.messages = history\.map/);
  assert.doesNotMatch(socketSource, /if \(!session\.name\) \{[\s\S]{0,200}socket\.emit\('message'/);
});

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

test('session bootstrap preserves the fully applied public theme', () => {
  const sessionHandler = widgetSource.match(
    /socket\.on\('session',[\s\S]*?socket\.on\('message'/,
  )?.[0];

  assert.ok(sessionHandler, 'session socket handler was not found');
  assert.match(sessionHandler, /if \(cfg\?\.primaryColor\) primaryColor = cfg\.primaryColor/);
  assert.doesNotMatch(sessionHandler, /applyTheme\(cfg\.primaryColor/);
});

test('live theme updates apply preset variables and reset auto theme', () => {
  const themeUpdateHandler = widgetSource.match(
    /socket\.on\('theme:update',[\s\S]*?socket\.connect\(\)/,
  )?.[0];

  assert.ok(themeUpdateHandler, 'theme:update socket handler was not found');
  assert.match(themeUpdateHandler, /data\.name === 'auto' \|\| !data\.vars/);
  assert.match(themeUpdateHandler, /applyThemeVars\(readSiteTheme\(primaryColor\)\)/);
  assert.match(themeUpdateHandler, /applyThemeVars\(data\.vars\)/);
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
