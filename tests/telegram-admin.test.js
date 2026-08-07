'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAdminRouter } = require('../src/routes/admin');
const { createSettingsService } = require('../src/services/settings');
const { setupTelegramBot, launchTelegramBot, getTelegramStatus, startTelegramBot, stopTelegramBot, setTelegramAdminId } = require('../src/telegram/bot');

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
  const settingsService = createSettingsService({ db: mockDb });

  const verifyAdminToken = (token) => token === 'valid-admin-token';
  const requireAdmin = (req, res, next) => {
    if (!verifyAdminToken(req.cookies?.admin_token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
  const requireCsrf = (req, res, next) => {
    if (req.headers['x-csrf-token'] !== 'valid-csrf') {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
    next();
  };

  const fakeTelegramBot = overrides.telegramBot || {
    getTelegramStatus: getTelegramStatus || (() => ({ status: 'stopped', adminId: '123456', configured: true })),
    startTelegramBot: startTelegramBot || (async () => ({ status: 'running' })),
    stopTelegramBot: stopTelegramBot || (async () => ({ status: 'stopped' })),
    setTelegramAdminId: setTelegramAdminId || (() => {}),
    // FakeTelegraf has no getMe: the default token verification fails so a
    // token save through the default fake is rejected (verify-failure path).
    verifyTelegramToken: async () => ({ ok: false, error: 'getMe unavailable (FakeTelegraf)' }),
    reconfigureTelegramBot: async () => ({ status: 'stopped' }),
    refreshTelegramIdentity: async () => null,
  };

  const adminRouter = createAdminRouter({
    rootDir: __dirname,
    adminCookieName: 'admin_token',
    verifyAdminToken,
    requireAdmin,
    requireCsrf,
    loginLimiter: (_req, _res, next) => next(),
    ensureCsrfCookie: () => {},
    settingsService,
    telegramBot: fakeTelegramBot,
    logger: { error: () => {}, info: () => {} },
    ...overrides,
  });

  app.use(adminRouter);

  return { app, mockDb, settingsService, telegramBot: fakeTelegramBot };
}

async function makeRequest(app, method, path, { headers = {}, body, cookies = {} } = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  } finally {
    server.close();
  }
}

test('Telegram Admin Endpoints — Authentication and Authorization', async (t) => {
  const { app } = setupTestApp();

  await t.test('GET /api/admin/telegram/status returns 401 without admin cookie', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/telegram/status');
    assert.equal(res.status, 401);
  });

  await t.test('POST /api/admin/telegram/start returns 401 without cookie', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/telegram/start', {
      headers: { 'x-csrf-token': 'valid-csrf' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('POST /api/admin/telegram/start returns 403 without CSRF token', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/telegram/start', {
      cookies: { admin_token: 'valid-admin-token' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('POST /api/admin/telegram/stop returns 401 without cookie', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/telegram/stop', {
      headers: { 'x-csrf-token': 'valid-csrf' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('POST /api/admin/telegram/stop returns 403 without CSRF token', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/telegram/stop', {
      cookies: { admin_token: 'valid-admin-token' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('PUT /api/admin/settings/telegram returns 401 without cookie', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      headers: { 'x-csrf-token': 'valid-csrf' },
      body: { adminId: '12345' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('PUT /api/admin/settings/telegram returns 403 without CSRF token', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      cookies: { admin_token: 'valid-admin-token' },
      body: { adminId: '12345' },
    });
    assert.equal(res.status, 403);
  });
});

test('Telegram Admin Endpoints — Status, Control, and Admin ID Mutation', async (t) => {
  let statusState = 'stopped';
  let adminIdState = '123456789';
  let tokenConfigured = true;

  const mockTelegramBot = {
    getTelegramStatus: () => ({
      status: statusState,
      adminId: adminIdState,
      configured: tokenConfigured,
    }),
    startTelegramBot: async () => {
      if (!tokenConfigured) {
        throw new Error('Telegram bot token is not configured');
      }
      statusState = 'running';
      return { status: 'running' };
    },
    stopTelegramBot: async () => {
      if (!tokenConfigured) {
        statusState = 'not-configured';
        return { status: 'not-configured' };
      }
      statusState = 'stopped';
      return { status: 'stopped' };
    },
    setTelegramAdminId: (id) => {
      adminIdState = String(id);
    },
  };

  const { app } = setupTestApp({ telegramBot: mockTelegramBot });
  const authHeaders = {
    cookies: { admin_token: 'valid-admin-token' },
    headers: { 'x-csrf-token': 'valid-csrf' },
  };

  await t.test('GET /api/admin/telegram/status returns bot status and admin ID without token leak', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/telegram/status', {
      cookies: authHeaders.cookies,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'stopped');
    assert.equal(res.body.adminId, '123456789');
    assert.equal(res.body.configured, true);
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.botToken, undefined);
  });

  await t.test('POST /api/admin/telegram/start starts bot and updates status', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/telegram/start', authHeaders);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'running');
    assert.equal(statusState, 'running');
  });

  await t.test('POST /api/admin/telegram/stop stops bot and updates status', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/telegram/stop', authHeaders);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'stopped');
    assert.equal(statusState, 'stopped');
  });

  await t.test('PUT /api/admin/settings/telegram rejects non-numeric admin ID', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { adminId: 'invalid-id-abc' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /numeric/i);
  });

  await t.test('PUT /api/admin/settings/telegram accepts valid numeric admin ID and updates state', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { adminId: '987654321' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.adminId, '987654321');
    assert.equal(adminIdState, '987654321');
  });

  await t.test('PUT /api/admin/telegram/admin-id alias accepts valid numeric admin ID', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/telegram/admin-id', {
      ...authHeaders,
      body: { adminId: '555444333' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.adminId, '555444333');
    assert.equal(adminIdState, '555444333');
  });
});

test('Telegram Admin Endpoints — Token Save Dispatch (verify → encrypt → reconfigure)', async (t) => {
  let statusState = 'stopped';
  let adminIdState = '123456789';
  const reconfigureCalls = [];
  const VALID_TOKEN = '8609135566:AAEGvalidtoken9876';

  const mockTelegramBot = {
    getTelegramStatus: () => ({
      status: statusState,
      adminId: adminIdState,
      configured: statusState !== 'not-configured',
      maskedToken: statusState === 'not-configured' ? null : '…9876',
      tokenSource: statusState === 'not-configured' ? null : 'settings',
      botUsername: 'ChatVivo_Wilkin_bot',
      botFirstName: 'ChatVivo Wilkin',
    }),
    startTelegramBot: async () => ({ status: 'running' }),
    stopTelegramBot: async () => {
      statusState = 'stopped';
      return { status: 'stopped' };
    },
    setTelegramAdminId: (id) => {
      adminIdState = String(id);
    },
    refreshTelegramIdentity: async () => null,
    verifyTelegramToken: async (token) =>
      token === VALID_TOKEN
        ? { ok: true, id: 8609135566, username: 'ChatVivo_Wilkin_bot', first_name: 'ChatVivo Wilkin' }
        : { ok: false, error: 'getMe unavailable (FakeTelegraf)' },
    reconfigureTelegramBot: async (opts) => {
      reconfigureCalls.push(opts);
      statusState = opts.launch ? 'running' : (opts.token ? 'stopped' : 'not-configured');
      return { status: statusState };
    },
  };

  const { app, settingsService } = setupTestApp({ telegramBot: mockTelegramBot });
  const authHeaders = {
    cookies: { admin_token: 'valid-admin-token' },
    headers: { 'x-csrf-token': 'valid-csrf' },
  };

  await t.test('PUT /api/admin/settings/telegram saves a verified token encrypted and reconfigures live', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { token: VALID_TOKEN },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tokenSource, 'settings');
    assert.equal(res.body.maskedToken, '…9876');
    assert.equal(res.body.status, 'running');
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.botToken, undefined);

    const stored = await settingsService.getJSON('telegram.token');
    assert.ok(stored?.encKey, 'encrypted token persisted');
    assert.equal(settingsService.decryptSecret(stored.encKey), VALID_TOKEN);
    assert.ok(Number.isFinite(stored.verifiedAt));

    assert.equal(reconfigureCalls.length, 1);
    assert.deepEqual(reconfigureCalls[0], { token: VALID_TOKEN, adminId: '123456789', launch: true, tokenSource: 'settings' });
  });

  await t.test('PUT /api/admin/telegram/admin-id alias also saves a verified token', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/telegram/admin-id', {
      ...authHeaders,
      body: { token: VALID_TOKEN },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tokenSource, 'settings');
  });

  await t.test('PUT rejects an unverifiable token and keeps the active token', async () => {
    const storedBefore = await settingsService.getJSON('telegram.token');
    const callsBefore = reconfigureCalls.length;
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { token: 'BAD_TOKEN' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /getMe/);
    assert.deepEqual(await settingsService.getJSON('telegram.token'), storedBefore, 'active token unchanged');
    assert.equal(reconfigureCalls.length, callsBefore, 'reconfigure must not run for a rejected token');
  });

  await t.test('PUT with token and adminId together dispatches to the token flow', async () => {
    const callsBefore = reconfigureCalls.length;
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { token: VALID_TOKEN, adminId: '999' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.tokenSource, 'settings');
    assert.ok(reconfigureCalls.length > callsBefore, 'token flow ran');
    assert.equal(reconfigureCalls.at(-1).token, VALID_TOKEN);
  });

  await t.test('PUT with an empty token clears storage and falls back to the env token', async () => {
    const { app: envApp, settingsService: envSettings } = setupTestApp({
      telegramBot: mockTelegramBot,
      telegramEnvToken: 'env-token-4321',
    });
    const res = await makeRequest(envApp, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { token: '' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tokenSource, 'env');
    assert.equal(res.body.maskedToken, '…4321');
    assert.equal(await envSettings.getJSON('telegram.token', 'MISSING'), 'MISSING', 'stored token removed');
    assert.deepEqual(reconfigureCalls.at(-1), { token: 'env-token-4321', adminId: '123456789', launch: false, tokenSource: 'env' });
  });

  await t.test('PUT with an empty token and no env falls back to none', async () => {
    const { app: noneApp, settingsService: noneSettings } = setupTestApp({
      telegramBot: mockTelegramBot,
      telegramEnvToken: '',
    });
    const res = await makeRequest(noneApp, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { token: '' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tokenSource, 'none');
    assert.equal(res.body.maskedToken, null);
    assert.equal(res.body.status, 'not-configured');
    assert.equal(await noneSettings.getJSON('telegram.token', 'MISSING'), 'MISSING');
  });

  await t.test('PUT with no recognized key returns 400', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      ...authHeaders,
      body: { foo: 'bar' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });
});

test('Telegram Admin Endpoints — Status Enrichment and adminUsername', async (t) => {
  let refreshCalls = 0;
  const mockTelegramBot = {
    getTelegramStatus: () => ({
      status: 'running',
      adminId: '123456789',
      configured: true,
      maskedToken: '…9876',
      tokenSource: 'settings',
      botUsername: 'ChatVivo_Wilkin_bot',
      botFirstName: 'ChatVivo Wilkin',
    }),
    startTelegramBot: async () => ({ status: 'running' }),
    stopTelegramBot: async () => ({ status: 'stopped' }),
    setTelegramAdminId: () => {},
    refreshTelegramIdentity: async () => {
      refreshCalls += 1;
      return { username: 'ChatVivo_Wilkin_bot', firstName: 'ChatVivo Wilkin' };
    },
  };

  const { app, settingsService } = setupTestApp({ telegramBot: mockTelegramBot });
  await settingsService.set('telegram.admin_username', '@WilkinBR');
  const auth = { cookies: { admin_token: 'valid-admin-token' } };

  await t.test('GET status surfaces identity, masked token, source and adminUsername without leaking token', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/telegram/status', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'running');
    assert.equal(res.body.configured, true);
    assert.equal(res.body.adminId, '123456789');
    assert.equal(res.body.botUsername, 'ChatVivo_Wilkin_bot');
    assert.equal(res.body.botFirstName, 'ChatVivo Wilkin');
    assert.equal(res.body.maskedToken, '…9876');
    assert.equal(res.body.tokenSource, 'settings');
    assert.equal(res.body.adminUsername, '@WilkinBR');
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.botToken, undefined);
    assert.ok(refreshCalls >= 1, 'lazy identity refresh triggered');
  });

  await t.test('GET status alias /api/admin/settings/telegram returns the same enriched shape', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/settings/telegram', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.botUsername, 'ChatVivo_Wilkin_bot');
    assert.equal(res.body.maskedToken, '…9876');
    assert.equal(res.body.adminUsername, '@WilkinBR');
  });

  await t.test('PUT adminUsername persists as informational metadata and reflects in status', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/telegram', {
      cookies: { admin_token: 'valid-admin-token' },
      headers: { 'x-csrf-token': 'valid-csrf' },
      body: { adminUsername: '@OtherAdmin' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.adminUsername, '@OtherAdmin');
    assert.equal(await settingsService.get('telegram.admin_username'), '@OtherAdmin');

    const statusRes = await makeRequest(app, 'GET', '/api/admin/telegram/status', auth);
    assert.equal(statusRes.body.adminUsername, '@OtherAdmin');
  });
});
