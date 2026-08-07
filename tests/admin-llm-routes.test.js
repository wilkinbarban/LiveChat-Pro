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

  const mockLlmService = {
    ...{
      getSupportedProviders() {
        return ['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen'];
      },
      getProviderModels(provider) {
        const map = {
          openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
          anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
          openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat'],
          deepseek: ['deepseek-chat', 'deepseek-coder'],
          kimi: ['moonshot-v1-8k', 'moonshot-v1-32k'],
          qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
        };
        return map[provider] || [];
      },
      lastVerifiedModel: null,
      async verifyConnection(provider, apiKey, model) {
        this.lastVerifiedModel = model;
        if (apiKey === 'invalid-key') {
          return { ok: false, error: 'Invalid API Key' };
        }
        if (!['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen'].includes(provider)) {
          return { ok: false, error: `Unsupported provider: ${provider}` };
        }
        return { ok: true, models: this.getProviderModels(provider) };
      },
      async listModels() {
        // Default mock: model-listing API unavailable → [] → catalog fallback.
        return [];
      },
    },
    ...(overrides.llmService || {}),
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

  // The router must receive the merged mock (base + per-test overrides), not
  // the raw partial override object, so per-test listModels variants keep the
  // full getSupportedProviders/getProviderModels/verifyConnection surface.
  const routerOverrides = { ...overrides, llmService: mockLlmService };

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
    ...routerOverrides,
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
  const { app, mockLlmService } = setupTestApp();
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

  await t.test('returns ok:true and models list on successful connection test', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'openai', apiKey: 'sk-valid-key-1234', model: 'gpt-4o-mini' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.models, ['gpt-4o', 'gpt-4o-mini', 'o1-mini']);
  });

  await t.test('omitted model in verify-key resolves to provider catalog default model', async () => {
    const res = await makeRequest(app, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'deepseek', apiKey: 'sk-deepseek-valid' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(mockLlmService.lastVerifiedModel, 'deepseek-chat');
  });

  await t.test('returns API models from listModels when non-empty', async () => {
    const { app: apiApp } = setupTestApp({
      llmService: {
        listModels: async () => ['deepseek-chat-v3', 'deepseek-reasoner'],
      },
    });
    const res = await makeRequest(apiApp, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'deepseek', apiKey: 'sk-deepseek-valid' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.models, ['deepseek-chat-v3', 'deepseek-reasoner']);
  });

  await t.test('falls back to static catalog when listModels returns empty array', async () => {
    const { app: fallbackApp } = setupTestApp({
      llmService: {
        listModels: async () => [],
      },
    });
    const res = await makeRequest(fallbackApp, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'deepseek', apiKey: 'sk-deepseek-valid' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.models, ['deepseek-chat', 'deepseek-coder']);
  });

  await t.test('falls back to static catalog when listModels is absent from the service', async () => {
    const { app: legacyApp } = setupTestApp({
      llmService: {
        listModels: undefined,
      },
    });
    const res = await makeRequest(legacyApp, 'POST', '/api/admin/settings/llm/verify-key', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'openai', apiKey: 'sk-valid-key-1234', model: 'gpt-4o-mini' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.models, ['gpt-4o', 'gpt-4o-mini', 'o1-mini']);
  });
});

test('LLM Admin Endpoints — Get settings with masked keys', async (t) => {
  const { app } = setupTestApp();
  const authCookies = { admin_token: 'valid-admin-token' };

  await t.test('returns default structure when fresh including provider model lists and null keyless defaultProvider', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/settings/llm', {
      cookies: authCookies,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.enabled, false);
    assert.equal(res.json.defaultProvider, null);
    assert.ok(res.json.providers);
    assert.equal(res.json.providers.openai.configured, false);
    assert.equal(res.json.providers.openai.maskedKey, '');
    assert.equal(res.json.providers.deepseek.model, 'deepseek-chat');
    assert.equal(res.json.providers.kimi.model, 'moonshot-v1-8k');
    assert.deepEqual(res.json.providers.openai.models, ['gpt-4o', 'gpt-4o-mini', 'o1-mini']);
    assert.deepEqual(res.json.providers.anthropic.models, ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']);
  });

  await t.test('GET settings returns first configured provider when DB default is unset', async () => {
    const { app, settingsService } = setupTestApp();
    await settingsService.setJSON('llm.provider.anthropic', { encKey: settingsService.encryptSecret('sk-ant-123') });

    const res = await makeRequest(app, 'GET', '/api/admin/settings/llm', {
      cookies: authCookies,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.defaultProvider, 'anthropic');
  });
});

test('LLM Admin Endpoints — Provider auto-activation on key save', async (t) => {
  const authHeaders = { 'x-csrf-token': 'valid-csrf' };
  const authCookies = { admin_token: 'valid-admin-token' };

  await t.test('auto-activates default provider on key save when no default provider is set in DB', async () => {
    const { app, settingsService } = setupTestApp();
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm/providers/deepseek', {
      headers: authHeaders,
      cookies: authCookies,
      body: { apiKey: 'sk-deepseek-secret' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    const defaultProvider = await settingsService.get('llm.default_provider');
    assert.equal(defaultProvider, 'deepseek');
  });

  await t.test('preserves existing default provider on key save when default is already set', async () => {
    const { app, settingsService } = setupTestApp();
    await settingsService.set('llm.default_provider', 'openai');
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm/providers/anthropic', {
      headers: authHeaders,
      cookies: authCookies,
      body: { apiKey: 'sk-anthropic-secret' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    const defaultProvider = await settingsService.get('llm.default_provider');
    assert.equal(defaultProvider, 'openai');
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

  await t.test('PUT provider without model resolves to provider catalog default', async () => {
    const res = await makeRequest(app, 'PUT', '/api/admin/settings/llm/providers/deepseek', {
      headers: authHeaders,
      cookies: authCookies,
      body: { apiKey: 'sk-deepseek-secret' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.model, 'deepseek-chat');
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

  await t.test('PUT /api/admin/llm/default configures aiBot with provider catalog default model when activeRaw has no model', async () => {
    const { app, mockAiBot } = setupTestApp();
    const res = await makeRequest(app, 'PUT', '/api/admin/llm/default', {
      headers: authHeaders,
      cookies: authCookies,
      body: { provider: 'deepseek' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.defaultProvider, 'deepseek');
    assert.equal(mockAiBot.getConfig().model, 'deepseek-chat');
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
