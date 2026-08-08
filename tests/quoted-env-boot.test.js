// ============================================================
// E2E — quoted env boot (env-quote-hygiene slice 3)
// Boots the real server on PORT 3100 with every scoped env value
// JSON-quoted (the setup.js / docker-compose / systemd shape) and
// proves the normalization from slices 1-2 works end-to-end:
// CORS origins, features, image uploads + upload dir, widget auth,
// Redis config, translator provider and aiBot numerics.
// ============================================================
'use strict';

// ── Environment variables (before any require) ───────────────
// Every value intentionally carries literal surrounding quotes so the
// server has to normalize them before the config/services can be right.
const os = require('os');
const path = require('path');

const UPLOADS_DIR = path.join(os.tmpdir(), `lcp-e2e-uploads-${process.pid}`);

process.env.PORT = '"3100"';
process.env.DB_PATH = ':memory:';
process.env.TELEGRAM_TOKEN = '"test:token_3100:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"';
process.env.TELEGRAM_ADMIN_ID = '"999999"';
process.env.ADMIN_PANEL_PASSWORD = '"testpass123"';
// Fixed 64-hex key: never touches data/.settings-key, keeps the boot hermetic.
process.env.SETTINGS_KEY = '"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"';
process.env.ADMIN_LANGUAGE = '"en"';
process.env.COOKIE_SAME_SITE = '"strict"';
process.env.ALLOWED_ORIGINS = '["https://chat.example.com","https://admin.example.com"]';
process.env.FEATURE_TRANSLATION = '"false"';
process.env.FEATURE_SENTIMENT = '"false"';
process.env.FEATURE_GHOST_TYPING = '"false"';
process.env.FEATURE_GEOLOCATION = '"false"';
process.env.WIDGET_API_KEY = '"lcp_widget_key_123"';
process.env.WIDGET_PRIMARY_COLOR = '"#112233"';
process.env.WIDGET_BUTTON_STYLE = '"hidden"';
process.env.ALLOWED_IMAGE_TYPES = '"image/png,image/jpeg"';
process.env.UPLOAD_DIR = `"${UPLOADS_DIR}"`;
process.env.REDIS_URL = '"redis://lcp-e2e:6379"';
process.env.REDIS_KEY_PREFIX = '"lcpe2e"';
process.env.REDIS_ENABLED = '"false"';
process.env.TRANSLATION_PROVIDER = '"deepl"';
process.env.TRANSLATION_API_KEY = '"k123"';
process.env.DEEPL_API_URL = '"https://api.deepl.com/v2/translate"';
process.env.BOT_MODE = '"disabled"';
process.env.OPENAI_MAX_TOKENS = '"300"';
process.env.BOT_CONFIDENCE_THRESHOLD = '"0.6"';
process.env.RATE_LIMIT_PUBLIC_MAX = '"10000"';
process.env.RATE_LIMIT_ADMIN_MAX = '"10000"';
process.env.RATE_LIMIT_LOGIN_MAX = '"10000"';
process.env.RATE_LIMIT_UPLOAD_MAX = '"10000"';

// ── Telegraf mock (before requiring server.js) ───────────────
const telegrafPath = require.resolve('telegraf');
require.cache[telegrafPath] = {
  id: telegrafPath,
  filename: telegrafPath,
  loaded: true,
  exports: {
    Telegraf: class FakeTelegraf {
      constructor() {
        this.telegram = {
          sendMessage: async () => ({ message_id: 1 }),
          deleteMessage: async () => {},
          editMessageText: async () => {},
        };
      }
      command() { return this; }
      on() { return this; }
      async launch() {}
      stop() {}
    },
  },
};

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { stmts, closeDb } = require('../db');
const { httpServer, io, start, clusterState } = require('../server');
const { createConfig } = require('../src/config');
const { getProviderConfig } = require('../src/services/translator');

const config = createConfig();

const BASE = 'http://127.0.0.1:3100';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const WIDGET_KEY = 'lcp_widget_key_123';

const pngFile = {
  name: 'foto.png',
  type: 'image/png',
  buffer: Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex'
  ),
};

before(async () => {
  await start();
  // The upload E2E needs a real session row (awaitingName=0), same as api.test.js.
  const now = Date.now();
  await stmts.upsertSession.run({
    session_id: SESSION_ID,
    name: 'Usuario E2E Quoted',
    lang: 'es',
    lang_detected: 1,
    ip: '127.0.0.1',
    geo_city: 'Local',
    geo_country: 'Test',
    geo_isp: 'Test',
    user_agent: 'test',
    current_page: '/',
    banned: 0,
    priority: 0,
    admin_last_seen_ts: 0,
    user_last_seen_ts: 0,
    awaiting_name: 0,
    bot_silenced: 0,
    last_active: now,
    created_at: now,
  });
});

after(async () => {
  await new Promise(resolve => io.close(() => httpServer.close(resolve)));
  await clusterState.close();
  await closeDb();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────
async function request(urlPath, { method = 'GET', headers: extraHeaders = {} } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, { method, headers: extraHeaders });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json };
}

async function multipartUpload(urlPath, { file, extraHeaders = {} } = {}) {
  const form = new FormData();
  if (file) {
    form.set('image', new Blob([file.buffer], { type: file.type }), file.name);
  }
  const res = await fetch(`${BASE}${urlPath}`, { method: 'POST', headers: extraHeaders, body: form });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

// ── E2E assertions ───────────────────────────────────────────
describe('Quoted env boot (PORT 3100)', () => {
  it('(a) quoted ALLOWED_ORIGINS restores the CORS origin allowlist', async () => {
    assert.deepEqual(config.server.corsOptions.origin, [
      'https://chat.example.com',
      'https://admin.example.com',
    ]);

    const allowed = await request('/health', { headers: { Origin: 'https://chat.example.com' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://chat.example.com');

    const denied = await request('/health', { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });

  it('(a) quoted ALLOWED_ORIGINS answers the CORS preflight for an allowed origin', async () => {
    const preflight = await request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://admin.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://admin.example.com');
  });

  it('(b) quoted FEATURE_* "false" keeps features off; quoted PORT and ADMIN_LANGUAGE resolve', async () => {
    const r = await request('/health');
    assert.equal(r.status, 200);
    assert.equal(r.json?.features?.translation, false);
    assert.equal(r.json?.features?.sentiment, false);
    assert.equal(r.json?.features?.ghostTyping, false);
    assert.equal(r.json?.features?.geoLocation, false);
    assert.equal(r.json?.port, 3100);
    assert.equal(r.json?.adminLanguage, 'en');
  });

  it('(c)+(e) quoted ALLOWED_IMAGE_TYPES accepts the upload (no 415) and UPLOAD_DIR lands the file', async () => {
    const r = await multipartUpload(`/api/chat/${SESSION_ID}/attachments`, {
      file: pngFile,
      extraHeaders: {
        'x-chat-session-id': SESSION_ID,
        'x-widget-api-key': WIDGET_KEY,
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.message?.attachments?.length, 1);
    assert.equal(r.json.message.attachments[0].mimeType, 'image/png');

    assert.equal(createConfig().uploads.dir, UPLOADS_DIR);
    assert.ok(fs.existsSync(UPLOADS_DIR), 'el directorio de uploads no se creó');
    assert.ok(fs.readdirSync(UPLOADS_DIR).length >= 1, 'ningún archivo aterrizó en UPLOAD_DIR');
  });

  it('(c) quoted ALLOWED_IMAGE_TYPES still rejects a disallowed MIME type (415)', async () => {
    const r = await multipartUpload(`/api/chat/${SESSION_ID}/attachments`, {
      file: { name: 'nota.txt', type: 'text/plain', buffer: Buffer.from('hola') },
      extraHeaders: {
        'x-chat-session-id': SESSION_ID,
        'x-widget-api-key': WIDGET_KEY,
      },
    });
    assert.equal(r.status, 415);
  });

  it('(d) quoted WIDGET_API_KEY enables embed auth and is served by /config-public', async () => {
    const pub = await request('/config-public');
    assert.equal(pub.status, 200);
    assert.equal(pub.json?.apiKey, WIDGET_KEY);

    const wrongKey = await multipartUpload(`/api/chat/${SESSION_ID}/attachments`, {
      file: pngFile,
      extraHeaders: { 'x-chat-session-id': SESSION_ID, 'x-widget-api-key': 'wrong-key' },
    });
    assert.equal(wrongKey.status, 401);

    const missingKey = await multipartUpload(`/api/chat/${SESSION_ID}/attachments`, {
      file: pngFile,
      extraHeaders: { 'x-chat-session-id': SESSION_ID },
    });
    assert.equal(missingKey.status, 401);
  });

  it('(f) quoted REDIS_URL/PREFIX normalize and quoted REDIS_ENABLED "false" keeps Redis disabled', async () => {
    assert.deepEqual(config.redis, {
      url: 'redis://lcp-e2e:6379',
      keyPrefix: 'lcpe2e',
      enabled: false,
    });
    assert.equal(clusterState.enabled, false);
    const r = await request('/health');
    assert.equal(r.json?.stateMode, 'memory');
  });

  it('(g) quoted TRANSLATION_PROVIDER is honored by the translator service', () => {
    assert.deepEqual(getProviderConfig(), { provider: 'deepl', apiKey: 'k123' });
  });

  it('quoted COOKIE_SAME_SITE, widget visuals and aiBot numerics normalize at config level', () => {
    assert.equal(config.admin.cookieSameSite, 'strict');
    assert.equal(config.widget.primaryColor, '#112233');
    assert.equal(config.widget.buttonStyle, 'hidden');
    assert.equal(config.aiBot.mode, 'disabled');
    assert.equal(config.aiBot.maxTokens, 300);
    assert.equal(config.aiBot.confidenceThreshold, 0.6);
  });
});
