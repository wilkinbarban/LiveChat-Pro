'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAdminRouter } = require('../src/routes/admin');
const { createSettingsService } = require('../src/services/settings');
const { createMasterPromptService, DEFAULT_MASTER_PROMPT } = require('../src/services/master-prompt');

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
  const masterPromptService = createMasterPromptService({ settingsService });

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

  const adminRouter = createAdminRouter({
    rootDir: __dirname,
    adminCookieName: 'admin_token',
    verifyAdminToken,
    requireAdmin,
    requireCsrf,
    loginLimiter: (_req, _res, next) => next(),
    ensureCsrfCookie: () => {},
    settingsService,
    masterPromptService,
    logger: { error: () => {}, info: () => {} },
    ...overrides,
  });

  app.use(adminRouter);

  return { app, mockDb, settingsService, masterPromptService };
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
    const json = await res.json();
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

test('Admin Prompt Endpoints — Authentication and CSRF Protection', async (t) => {
  const { app } = setupTestApp();

  await t.test('GET /api/admin/settings/prompt returns 401 without admin cookie', async () => {
    const { status, body } = await makeRequest(app, 'GET', '/api/admin/settings/prompt');
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  await t.test('GET /api/admin/master-prompt returns 401 without admin cookie', async () => {
    const { status, body } = await makeRequest(app, 'GET', '/api/admin/master-prompt');
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  await t.test('PUT /api/admin/settings/prompt returns 401 without admin cookie', async () => {
    const { status, body } = await makeRequest(app, 'PUT', '/api/admin/settings/prompt', {
      headers: { 'x-csrf-token': 'valid-csrf' },
      body: { prompt: 'New prompt' },
    });
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  await t.test('PUT /api/admin/settings/prompt returns 403 without valid CSRF header', async () => {
    const { status, body } = await makeRequest(app, 'PUT', '/api/admin/settings/prompt', {
      cookies: { admin_token: 'valid-admin-token' },
      body: { prompt: 'New prompt' },
    });
    assert.equal(status, 403);
    assert.equal(body.error, 'CSRF token missing or invalid');
  });
});

test('Admin Prompt Endpoints — GET & PUT Master Prompt Flow', async (t) => {
  const { app } = setupTestApp();

  await t.test('GET returns default prompt when setting is unset', async () => {
    const { status, body } = await makeRequest(app, 'GET', '/api/admin/settings/prompt', {
      cookies: { admin_token: 'valid-admin-token' },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.prompt, DEFAULT_MASTER_PROMPT);
  });

  await t.test('PUT updates the prompt in settings and returns updated prompt', async () => {
    const newPrompt = 'System prompt updated via admin panel endpoint for testing.';
    const { status, body } = await makeRequest(app, 'PUT', '/api/admin/settings/prompt', {
      cookies: { admin_token: 'valid-admin-token' },
      headers: { 'x-csrf-token': 'valid-csrf' },
      body: { prompt: newPrompt },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.prompt, newPrompt);

    // Verify GET immediately reflects updated prompt
    const { status: getStatus, body: getBody } = await makeRequest(app, 'GET', '/api/admin/settings/prompt', {
      cookies: { admin_token: 'valid-admin-token' },
    });
    assert.equal(getStatus, 200);
    assert.equal(getBody.prompt, newPrompt);
  });

  await t.test('GET /api/admin/master-prompt alias returns updated prompt', async () => {
    const { status, body } = await makeRequest(app, 'GET', '/api/admin/master-prompt', {
      cookies: { admin_token: 'valid-admin-token' },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.prompt === 'string');
  });
});
