'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAdminRouter } = require('../src/routes/admin');
const { createSettingsService } = require('../src/services/settings');
const { createThemesService, THEME_PRESETS } = require('../src/services/themes');

function createMockDb() {
  const store = new Map();
  return {
    get: async (_sql, params) => {
      const key = params[0];
      if (store.has(key)) return { value: store.get(key) };
      return undefined;
    },
    run: async (sql, params) => {
      const key = params[0];
      const val = params[1];
      if (sql.startsWith('DELETE')) {
        store.delete(key);
      } else {
        store.set(key, val);
      }
      return { changes: 1 };
    },
    all: async () => {
      return Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    },
    _store: store,
  };
}

function setupTestApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const mockDb = createMockDb();
  const settingsService = overrides.settingsService || createSettingsService({ db: mockDb });
  const themesService = overrides.themesService || createThemesService({ settingsService });

  const emittedEvents = [];
  const mockIo = {
    emit: (event, data) => {
      emittedEvents.push({ event, data });
    },
  };

  const verifyAdminToken = (token) => token === 'valid-admin-token';
  const requireAdmin = (req, res, next) => {
    if (!verifyAdminToken(req.cookies?.admin_token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
  const requireCsrf = (req, res, next) => {
    if (req.headers['x-csrf-token'] !== 'valid-csrf-token') {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
  };

  const router = createAdminRouter({
    settingsService,
    themesService,
    io: mockIo,
    requireAdmin,
    requireCsrf,
    verifyAdminToken,
    rootDir: __dirname,
    adminCookieName: 'admin_token',
    adminPanelPassword: 'secretpassword',
    adminSessionTtlMs: 3600000,
    loginLimiter: (_req, _res, next) => next(),
    ensureCsrfCookie: () => {},
    logger: { error: () => {}, info: () => {} },
    sameSiteForRequest: () => 'strict',
    shouldUseSecureAdminCookie: () => false,
    createAdminToken: () => 'valid-admin-token',
    ...overrides,
  });

  app.use(router);

  app.get('/config-public', async (_req, res) => {
    const activeTheme = await themesService.getActiveTheme();
    res.json({
      primaryColor: '#4F46E5',
      buttonStyle: 'floating',
      apiKey: 'test-api-key',
      theme: activeTheme,
    });
  });

  return { app, mockDb, settingsService, themesService, emittedEvents };
}

test('Theme service catalog includes required presets and 13 CSS custom property maps', () => {
  const expectedPresets = [
    'auto', 'classic', 'light-aurora', 'light-mint', 'dark-midnight', 'dark-ember',
    'light-sunrise', 'light-sky', 'dark-ocean', 'dark-forest', 'mono-light',
    'mono-dark', 'green-chat', 'sky-chat', 'gradient-vibrant', 'ink',
  ];
  const presets = Object.keys(THEME_PRESETS);

  for (const presetName of expectedPresets) {
    assert.ok(presets.includes(presetName), `Missing preset: ${presetName}`);
  }

  assert.equal(presets.length, 16, 'Catalog must contain exactly 16 presets');

  const expectedVars = [
    'font', 'color', 'panelBg', 'surfaceBg', 'inputBg', 'inputTextColor',
    'inputPlaceholderColor', 'textColor', 'mutedColor', 'borderColor',
    'headerBg', 'headerColor', 'shadow'
  ];

  for (const [name, preset] of Object.entries(THEME_PRESETS)) {
    assert.ok(preset.label, `Preset ${name} missing label`);
    if (name === 'auto') {
      assert.equal(preset.vars, null, 'Auto theme vars must be null');
    } else {
      assert.ok(preset.vars, `Preset ${name} missing vars`);
      for (const varKey of expectedVars) {
        assert.ok(varKey in preset.vars, `Preset ${name} missing property: ${varKey}`);
        assert.equal(typeof preset.vars[varKey], 'string', `Preset ${name} ${varKey} must be a string`);
      }
      assert.equal(Object.keys(preset.vars).length, 13, `Preset ${name} must have exactly 13 variables`);
    }
  }
});

test('Expanded catalog adds 10 new presets with exact labels, types, and 13-key variable maps', () => {
  const newPresets = {
    'light-sunrise': { label: 'Light Sunrise', type: 'light' },
    'light-sky': { label: 'Light Sky', type: 'light' },
    'dark-ocean': { label: 'Dark Ocean', type: 'dark' },
    'dark-forest': { label: 'Dark Forest', type: 'dark' },
    'mono-light': { label: 'Mono Light', type: 'light' },
    'mono-dark': { label: 'Mono Dark', type: 'dark' },
    'green-chat': { label: 'Green Chat', type: 'light' },
    'sky-chat': { label: 'Sky Chat', type: 'light' },
    'gradient-vibrant': { label: 'Gradient Vibrant', type: 'light' },
    'ink': { label: 'Ink', type: 'light' },
  };
  const expectedVars = [
    'font', 'color', 'panelBg', 'surfaceBg', 'inputBg', 'inputTextColor',
    'inputPlaceholderColor', 'textColor', 'mutedColor', 'borderColor',
    'headerBg', 'headerColor', 'shadow',
  ];

  for (const [name, expected] of Object.entries(newPresets)) {
    const preset = THEME_PRESETS[name];
    assert.ok(preset, `Missing new preset: ${name}`);
    assert.equal(preset.label, expected.label, `Preset ${name} label`);
    assert.equal(preset.type, expected.type, `Preset ${name} type`);
    assert.ok(preset.vars, `Preset ${name} missing vars`);
    for (const varKey of expectedVars) {
      assert.ok(varKey in preset.vars, `Preset ${name} missing property: ${varKey}`);
      assert.equal(typeof preset.vars[varKey], 'string', `Preset ${name} ${varKey} must be a string`);
    }
    assert.equal(Object.keys(preset.vars).length, 13, `Preset ${name} must have exactly 13 variables`);
  }

  // Distinctive values from the design table (source of truth)
  assert.equal(THEME_PRESETS['green-chat'].vars.color, '#25D366');
  assert.equal(THEME_PRESETS['green-chat'].vars.headerBg, '#075E54');
  assert.equal(THEME_PRESETS['sky-chat'].vars.color, '#2AABEE');
  assert.equal(THEME_PRESETS['mono-dark'].vars.color, '#6b7280');
  assert.equal(THEME_PRESETS.ink.vars.color, '#000000');
  assert.equal(
    THEME_PRESETS['gradient-vibrant'].vars.headerBg,
    'linear-gradient(135deg,#fa7e1e,#d62976 50%,#962fbf)',
  );
});

test('ThemesService persists active theme selection across restarts', async () => {
  const mockDb = createMockDb();
  const settingsService = createSettingsService({ db: mockDb });
  const service = createThemesService({ settingsService });

  const initial = await service.getActiveTheme();
  assert.equal(initial.name, 'auto');
  assert.equal(initial.vars, null);

  const updated = await service.setActiveTheme('dark-midnight');
  assert.equal(updated.name, 'dark-midnight');
  assert.ok(updated.vars);
  assert.equal(updated.vars.panelBg, '#0f172a');

  // Re-instantiate service over same DB/settings
  const serviceReboot = createThemesService({ settingsService });
  const restored = await serviceReboot.getActiveTheme();
  assert.equal(restored.name, 'dark-midnight');
  assert.equal(restored.vars.panelBg, '#0f172a');
});

test('ThemesService rejects unknown preset name', async () => {
  const mockDb = createMockDb();
  const settingsService = createSettingsService({ db: mockDb });
  const service = createThemesService({ settingsService });

  await assert.rejects(
    async () => { await service.setActiveTheme('non-existent-theme'); },
    /Invalid theme/
  );
});

test('GET /api/admin/settings/theme requires admin authentication', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings/theme`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/admin/settings/theme and GET /api/admin/themes return theme settings', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const headers = { Cookie: 'admin_token=valid-admin-token' };
    const res1 = await fetch(`http://127.0.0.1:${port}/api/admin/settings/theme`, { headers });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.ok, true);
    assert.equal(body1.active, 'auto');
    assert.ok(body1.presets.classic);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/admin/themes`, { headers });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.ok, true);
    assert.equal(body2.active, 'auto');
  } finally {
    server.close();
  }
});

test('PUT /api/admin/settings/theme requires admin and CSRF token', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Missing auth
    const res1 = await fetch(`http://127.0.0.1:${port}/api/admin/settings/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'light-mint' }),
    });
    assert.equal(res1.status, 401);

    // Missing CSRF
    const res2 = await fetch(`http://127.0.0.1:${port}/api/admin/settings/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'admin_token=valid-admin-token',
      },
      body: JSON.stringify({ name: 'light-mint' }),
    });
    assert.equal(res2.status, 403);
  } finally {
    server.close();
  }
});

test('PUT /api/admin/settings/theme updates active theme and emits theme:update via socket', async () => {
  const { app, emittedEvents } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf-token',
      },
      body: JSON.stringify({ name: 'dark-ember' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.active, 'dark-ember');
    assert.ok(body.theme.vars);
    assert.equal(body.theme.vars.color, '#e11d48');

    // Check socket broadcast
    const themeUpdate = emittedEvents.find(e => e.event === 'theme:update');
    assert.ok(themeUpdate, 'theme:update socket event was not emitted');
    assert.equal(themeUpdate.data.name, 'dark-ember');
    assert.equal(themeUpdate.data.vars.color, '#e11d48');

    // New preset hot-change: green-chat persists and broadcasts live
    const res2 = await fetch(`http://127.0.0.1:${port}/api/admin/settings/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf-token',
      },
      body: JSON.stringify({ name: 'green-chat' }),
    });

    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.ok, true);
    assert.equal(body2.active, 'green-chat');
    assert.ok(body2.theme.vars);
    assert.equal(body2.theme.vars.color, '#25D366');

    const greenUpdate = emittedEvents.filter(e => e.event === 'theme:update').at(-1);
    assert.ok(greenUpdate, 'theme:update socket event was not emitted for green-chat');
    assert.equal(greenUpdate.data.name, 'green-chat');
    assert.equal(greenUpdate.data.vars.color, '#25D366');
  } finally {
    server.close();
  }
});

test('/config-public returns theme object', async () => {
  const { app, themesService } = setupTestApp();
  await themesService.setActiveTheme('light-aurora');

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/config-public`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.theme.name, 'light-aurora');
    assert.ok(body.theme.vars);
    assert.equal(body.theme.vars.color, '#0d9488');
  } finally {
    server.close();
  }
});
