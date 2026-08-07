'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAdminRouter } = require('../src/routes/admin');
const { createSettingsService } = require('../src/services/settings');

// Simple mock in-memory DB for settings
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

  let aiBotConfig = { enabled: false, provider: null, model: 'gpt-4o-mini' };
  const mockAiBot = {
    configure(cfg) {
      aiBotConfig = { ...aiBotConfig, ...cfg };
      return aiBotConfig;
    },
    isEnabled() {
      return Boolean(aiBotConfig.enabled);
    },
    getConfig() {
      return aiBotConfig;
    },
  };

  const mockLlmService = overrides.llmService || {
    getSupportedProviders() {
      return ['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen'];
    },
    async verifyConnection(provider, apiKey, _model) {
      if (apiKey === 'invalid-key') {
        return { ok: false, error: 'Invalid API Key' };
      }
      if (!['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen'].includes(provider)) {
        return { ok: false, error: `Unsupported provider: ${provider}` };
      }
      return { ok: true };
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
    llmService: mockLlmService,
    aiBot: mockAiBot,
    logger: { error: () => {}, info: () => {} },
    ...overrides,
  });

  app.use(adminRouter);

  return { app, mockDb, settingsService, mockAiBot, mockLlmService };
}

// HTTP request helper via node fetch / app.listen on ephemeral port
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
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
  } finally {
    server.close();
  }
}

test('LLM Admin Endpoints — Authentication and CSRF enforcement', async (t) => {
  const { app } = setupTestApp();

  await t.test('GET /api/admin/settings/llm returns 401 without admin cookie', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/settings/llm');
    assert.equal(res.status, 401);
  });

  await t.test('PUT /api/admin/settings/llm returns 401 without admin cookie', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm', {
      headers: { 'x-csrf-token': 'valid-csrf' },
      body: { provider: 'openai', apiKey: 'sk-1234567890' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('PUT /api/admin/settings/llm returns 403 without CSRF header', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm', {
      cookies: { admin_token: 'valid-admin-token' },
      body: { provider: 'openai', apiKey: 'sk-1234567890' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('POST /api/admin/settings/llm/verify-key returns 401 without admin cookie', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: { 'x-csrf-token': 'valid-csrf' },
      body: { provider: 'openai', apiKey: 'sk-1234567890' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('POST /api/admin/settings/llm/verify-key returns 403 without CSRF', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      cookies: { admin_token: 'valid-admin-token' },
      body: { provider: 'openai', apiKey: 'sk-1234567890' },
    });
    assert.equal(res.status, 403);
  });
});

test('LLM Admin Endpoints — Verification endpoint', async (t) => {
  const { app } = setupTestApp();
  const authHeaders = { 'x-csrf-token': 'valid-csrf' };
  const authCookies = { admin_token: 'valid-admin-token' };

  await t.test('rejects unknown provider', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'unknown-llm', apiKey: 'sk-1234' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.match(res.json.error, /Unsupported provider/i);
  });

  await t.test('returns error when key verification fails', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'openai', apiKey: 'invalid-key' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, 'Invalid API Key');
  });

  await t.test('returns ok:true on successful connection test', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'openai', apiKey: 'sk-valid-key-1234', model: 'gpt-4o-mini' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });
});

test('LLM Admin Endpoints — Get settings with masked keys', async (t) => {
  const { app } = setupTestApp();
  const authCookies = { admin_token: 'valid-admin-token' };

  await t.test('returns default structure when fresh', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/settings/llm', {
      cookies: authCookies,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.enabled, false);
    assert.equal(res.json.defaultProvider, 'openai');
    assert.ok(res.json.providers);
    assert.equal(res.json.providers.openai.configured, false);
    assert.equal(res.json.providers.openai.maskedKey, '');
  });
});

test('LLM Admin Endpoints — Update provider, default, enabled', async (t) => {
  const { app, mockAiBot, settingsService } = setupTestApp();
  const authHeaders = { 'x-csrf-token': 'valid-csrf' };
  const authCookies = { admin_token: 'valid-admin-token' };

  await t.test('verifies, encrypts and saves provider key, masking response output', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm/providers/openai', {
      headers: authHeaders,
      cookies: authCookies,
      body: { apiKey: 'sk-proj-super-secret-key-9999', model: 'gpt-4o' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);

    // Verify GET returns masked key, NEVER plain key
    const getRes = await makeRequest(app, 'GET', '/api/admin/settings/llm', {
      cookies: authCookies,
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.providers.openai.configured, true);
    assert.equal(getRes.json.providers.openai.maskedKey, '…9999');
    assert.equal(getRes.json.providers.openai.model, 'gpt-4o');

    // Verify key in DB is encrypted and decryptable
    const rawVal = await settingsService.getJSON('llm.provider.openai');
    assert.ok(rawVal.encKey.startsWith('v1.'));
    const decrypted = settingsService.decryptSecret(rawVal.encKey);
    assert.equal(decrypted, 'sk-proj-super-secret-key-9999');
  });

  await t.test('failed key verification blocks saving and leaves config unchanged', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm/providers/anthropic', {
      headers: authHeaders,
      cookies: authCookies,
      body: { apiKey: 'invalid-key', model: 'claude-3-haiku' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.ok, false);

    const getRes = await makeRequest(app, 'GET', '/api/admin/settings/llm', {
      cookies: authCookies,
    });
    assert.equal(getRes.json.providers.anthropic.configured, false);
  });

  await t.test('PUT /api/admin/llm/default updates default provider', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/llm/default', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'anthropic' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.defaultProvider, 'anthropic');
  });

  await t.test('PUT /api/admin/llm/enabled toggles global bot state dynamically', async () => {
    assert.equal(mockAiBot.isEnabled(), false);

    const res = await makeRequest(app, 'PUT', '/api/admin/llm/enabled', {
      headers: authHeaders,
      cookies: authCookies,
      body: { enabled: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.enabled, true);
    assert.equal(mockAiBot.isEnabled(), true);
  });
});
