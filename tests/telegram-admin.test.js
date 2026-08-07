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
