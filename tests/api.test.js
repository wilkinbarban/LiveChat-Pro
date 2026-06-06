// ============================================================
// HTTP integration tests — server.js
// Smoke tests + Admin API (authentication and session management)
// ============================================================
'use strict';

// ── Environment variables (before any require) ───────────────
process.env.TELEGRAM_TOKEN = 'test:token_000000000:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.TELEGRAM_ADMIN_ID = '999999';
process.env.ADMIN_PANEL_PASSWORD = 'testpass123';
process.env.PORT = '3099';
process.env.DB_PATH = ':memory:';
process.env.FEATURE_TRANSLATION = 'false';
process.env.FEATURE_GEOLOCATION = 'false';
process.env.FEATURE_SENTIMENT = 'false';
process.env.REDIS_URL = '';
process.env.RATE_LIMIT_PUBLIC_MAX = '10000';
process.env.RATE_LIMIT_ADMIN_MAX = '10000';
process.env.RATE_LIMIT_LOGIN_MAX = '10000';
process.env.RATE_LIMIT_UPLOAD_MAX = '10000';
process.env.WIDGET_API_KEY = '';

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
const { db, stmts, closeDb } = require('../db');
const { httpServer, io, start, clusterState, security } = require('../server');

const BASE = 'http://127.0.0.1:3099';
const PASSWORD = 'testpass123';

before(async () => {
  await start();
});

after(async () => {
  await new Promise(resolve => io.close(() => httpServer.close(resolve)));
  await clusterState.close();
  await closeDb();
});

// ── Helpers ──────────────────────────────────────────────────
async function request(urlPath, { method = 'GET', body, cookie, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie?.header) headers['Cookie'] = cookie.header;
  if (cookie?.csrfToken && method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = cookie.csrfToken;

  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

async function multipartRequest(urlPath, { method = 'POST', fields = {}, file, cookie, headers: extraHeaders = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) {
    form.set('image', new Blob([file.buffer], { type: file.type }), file.name);
  }

  const headers = { ...extraHeaders };
  if (cookie?.header) headers['Cookie'] = cookie.header;
  if (cookie?.csrfToken && method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = cookie.csrfToken;

  const res = await fetch(`${BASE}${urlPath}`, { method, headers, body: form });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

function parseCookie(setCookieHeader, name) {
  const match = (setCookieHeader || '').match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function getCsrfSession() {
  const res = await request('/api/admin/me');
  const setCookie = res.headers.get('set-cookie') || '';
  const csrf = parseCookie(setCookie, 'lcp_csrf');
  return csrf
    ? { header: `lcp_csrf=${csrf}`, csrfToken: csrf }
    : { header: '', csrfToken: '' };
}

async function login(password = PASSWORD) {
  const csrfSession = await getCsrfSession();
  const res = await request('/api/admin/login', { method: 'POST', body: { password }, cookie: csrfSession });
  const setCookie = res.headers.get('set-cookie') || '';
  const adminCookie = parseCookie(setCookie, 'lcp_admin');
  return {
    status: res.status,
    json: res.json,
    cookie: adminCookie
      ? { header: `${csrfSession.header}; lcp_admin=${adminCookie}`, csrfToken: csrfSession.csrfToken }
      : null,
  };
}

// ── Smoke tests ───────────────────────────────────────────────
describe('Smoke tests', () => {
  it('GET /health retorna 200 y { status: ok }', async () => {
    const r = await request('/health');
    assert.equal(r.status, 200);
    assert.equal(r.json?.status, 'ok');
    assert.equal(r.json?.stateMode, 'memory');
    assert.equal(typeof r.json?.uptime, 'number');
  });

  it('GET /config-public retorna la configuración del widget', async () => {
    const r = await request('/config-public', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.ok('primaryColor' in r.json, 'falta primaryColor');
    assert.ok('buttonStyle' in r.json, 'falta buttonStyle');
    assert.ok('apiKey' in r.json, 'falta apiKey');
  });

  it('OPTIONS /config-public permite preflight público del widget', async () => {
    const r = await request('/config-public', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('access-control-allow-methods') || '', /GET/);
  });

  it('GET /admin retorna HTML del panel de administración', async () => {
    const r = await request('/admin');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cross-origin-opener-policy'), null);
    assert.equal(r.headers.get('origin-agent-cluster'), null);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    const isHtml = r.text.includes('<!DOCTYPE html') || r.text.includes('<html');
    assert.ok(isHtml, 'respuesta no parece HTML');
  });

  it('GET /widget.js retorna JavaScript del widget', async () => {
    const r = await request('/widget.js', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const isJs = r.text.includes('function') || r.text.includes('=>') || r.text.includes('const ');
    assert.ok(isJs, 'respuesta no parece JavaScript');
  });

  it('GET /demo redirige a ./', async () => {
    const res = await fetch(`${BASE}/demo`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), './');
  });
});

// ── Admin authentication ─────────────────────────────────────
describe('Autenticación admin', () => {
  it('GET /api/admin/me sin sesión → { enabled: true, authenticated: false }', async () => {
    const r = await request('/api/admin/me');
    assert.equal(r.status, 200);
    assert.equal(r.json?.enabled, true);
    assert.equal(r.json?.authenticated, false);
  });

  it('GET /api/admin/me en HTTP público entrega CSRF sin Secure', async () => {
    const r = await request('/api/admin/me');
    const setCookie = r.headers.get('set-cookie') || '';
    assert.match(setCookie, /lcp_csrf=/);
    assert.match(setCookie, /;\s*SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /;\s*Secure/i);
    assert.doesNotMatch(setCookie, /;\s*HttpOnly/i);
  });

  it('GET /api/admin/me detrás de HTTPS entrega CSRF con Secure', async () => {
    const r = await request('/api/admin/me', { headers: { 'x-forwarded-proto': 'https' } });
    const setCookie = r.headers.get('set-cookie') || '';
    assert.match(setCookie, /lcp_csrf=/);
    assert.match(setCookie, /;\s*Secure/i);
  });

  it('POST /api/admin/login contraseña incorrecta → 401', async () => {
    const csrfSession = await getCsrfSession();
    const r = await request('/api/admin/login', {
      method: 'POST',
      body: { password: 'contraseña_errónea' },
      cookie: csrfSession,
    });
    assert.equal(r.status, 401);
  });

  it('POST /api/admin/login sin body → 401', async () => {
    const csrfSession = await getCsrfSession();
    const r = await request('/api/admin/login', { method: 'POST', body: {}, cookie: csrfSession });
    assert.equal(r.status, 401);
  });

  it('POST /api/admin/login sin CSRF → 403', async () => {
    const r = await request('/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
    assert.equal(r.status, 403);
  });

  it('GET /api/admin/sessions sin autenticar → 401', async () => {
    const r = await request('/api/admin/sessions');
    assert.equal(r.status, 401);
  });

  it('POST /api/admin/login contraseña correcta → 200 { ok: true } + cookie', async () => {
    const { status, json, cookie } = await login();
    assert.equal(status, 200);
    assert.equal(json?.ok, true);
    assert.ok(cookie, 'no se recibió la cookie lcp_admin en Set-Cookie');
  });

  it('POST /api/admin/login cookie admin usa HttpOnly, SameSite y Secure solo en HTTPS', async () => {
    const csrfSession = await getCsrfSession();
    const http = await request('/api/admin/login', { method: 'POST', body: { password: PASSWORD }, cookie: csrfSession });
    const httpCookie = http.headers.get('set-cookie') || '';
    assert.match(httpCookie, /lcp_admin=/);
    assert.match(httpCookie, /;\s*HttpOnly/i);
    assert.match(httpCookie, /;\s*SameSite=Lax/i);
    assert.doesNotMatch(httpCookie, /;\s*Secure/i);

    const httpsCsrf = await getCsrfSession();
    const https = await request('/api/admin/login', {
      method: 'POST',
      body: { password: PASSWORD },
      cookie: httpsCsrf,
      headers: { 'x-forwarded-proto': 'https' },
    });
    const httpsCookie = https.headers.get('set-cookie') || '';
    assert.match(httpsCookie, /lcp_admin=/);
    assert.match(httpsCookie, /;\s*HttpOnly/i);
    assert.match(httpsCookie, /;\s*SameSite=Lax/i);
    assert.match(httpsCookie, /;\s*Secure/i);
  });

  it('GET /api/admin/me con cookie válida → { authenticated: true }', async () => {
    const { cookie } = await login();
    const r = await request('/api/admin/me', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json?.authenticated, true);
  });

  it('GET /api/admin/sessions con auth → 200 { sessions: [] }', async () => {
    const { cookie } = await login();
    const r = await request('/api/admin/sessions', { cookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json?.sessions), 'sessions no es un array');
  });

  it('POST /api/admin/logout → 200 { ok: true }', async () => {
    const { cookie } = await login();
    const r = await request('/api/admin/logout', { method: 'POST', cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
  });

  it('GET /api/admin/me sin cookie (tras logout implícito) → authenticated false', async () => {
    const r = await request('/api/admin/me');
    assert.equal(r.json?.authenticated, false);
  });
});

describe('Endurecimiento de entradas', () => {
  it('escapeTelegramHtml escapa etiquetas, atributos y entidades peligrosas', () => {
    const payload = `<b onclick="alert(1)">Hola</b> & <script>alert(2)</script>`;
    assert.equal(
      security.escapeTelegramHtml(payload),
      '&lt;b onclick="alert(1)"&gt;Hola&lt;/b&gt; &amp; &lt;script&gt;alert(2)&lt;/script&gt;'
    );
  });

  it('validadores por campo normalizan nombres, textos, idiomas, user-agent y URLs raras', () => {
    assert.equal(security.sanitizeText('\u0000 <script>x</script> \u0007'), '<script>x</script>');
    assert.equal(security.sanitizeName('  Ana\n\t<script>  Test  '), 'Ana <script> Test');
    assert.equal(security.sanitizeLanguage('javascript:alert(1)'), 'es');
    assert.equal(security.sanitizeLanguage('de-DE'), 'de');
    assert.equal(security.sanitizeUserAgent('Agent\u0000<script>alert(1)</script>').includes('\u0000'), false);
    assert.equal(security.sanitizePage('javascript:alert(1)'), '/');
    assert.equal(security.sanitizePage('data:text/html,<svg onload=alert(1)>'), '/');
    assert.equal(security.sanitizePage('https://evil.example/path?q=<script>#x'), '/path?q=%3Cscript%3E#x');
    assert.equal(security.sanitizePage('/local/path?<img src=x onerror=alert(1)>'), '/local/path?%3Cimg%20src=x%20onerror=alert(1)%3E');
  });
});

// ── Session management ───────────────────────────────────────
describe('Sesiones admin', () => {
  const UNKNOWN_SID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const TEST_SID = 'd4d4d4d4-dddd-4ddd-8ddd-dddddddddddd';
  const CLEAR_SID = 'c1eac1ea-c1ea-41ea-81ea-c1eac1eac1ea';
  const DELETE_SID = 'de1e7e00-de1e-4e00-8e00-de1e7ede1e7e';

  it('GET /api/admin/sessions/:id desconocido → 404', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${UNKNOWN_SID}`, { cookie });
    assert.equal(r.status, 404);
  });

  it('POST /api/admin/sessions/:id/ban desconocido → 404', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${UNKNOWN_SID}/ban`, { method: 'POST', cookie });
    assert.equal(r.status, 404);
  });

  it('POST /api/admin/sessions/:id/message desconocido → 404', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${UNKNOWN_SID}/message`, {
      method: 'POST',
      body: { text: 'Hola' },
      cookie,
    });
    assert.equal(r.status, 404);
  });

  it('POST /api/admin/sessions/:id/typing desconocido → 404', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${UNKNOWN_SID}/typing`, {
      method: 'POST',
      body: { active: true },
      cookie,
    });
    assert.equal(r.status, 404);
  });

  it('POST /api/admin/sessions/:id/read desconocido → 404', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${UNKNOWN_SID}/read`, {
      method: 'POST',
      body: { reader: 'admin', ts: Date.now() },
      cookie,
    });
    assert.equal(r.status, 404);
  });

  it('GET /api/admin/sessions/:id existente → 200 con sesión y mensajes', async () => {
    const now = Date.now();
    await stmts.upsertSession.run({
      session_id: TEST_SID,
      name: 'Tester Automático',
      lang: 'es',
      lang_detected: 0,
      ip: '10.0.0.1',
      geo_city: 'Barcelona',
      geo_country: 'ES',
      geo_isp: 'ISP Test',
      user_agent: 'TestAgent/2.0',
      current_page: '/prueba',
      banned: 0,
      priority: 0,
      admin_last_seen_ts: 0,
      user_last_seen_ts: 0,
      awaiting_name: 0,
      bot_silenced: 0,
      last_active: now,
      created_at: now,
    });
    await stmts.insertMessage.run({ session_id: TEST_SID, from_role: 'user', text: 'Mensaje de prueba', ts: now, lang: 'es' });

    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${TEST_SID}`, { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json?.session?.sessionId, TEST_SID);
    assert.ok(Array.isArray(r.json?.messages), 'messages no es array');
    assert.equal(r.json.messages.length, 1);
  });

  it('POST /api/admin/sessions/:id/message usuario desconectado → 200 y queda pendiente', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${TEST_SID}/message`, {
      method: 'POST',
      body: { text: 'Respuesta desde admin' },
      cookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.delivered, false);
    assert.equal(r.json?.pending, true);
    assert.equal(r.json?.message?.from, 'admin');

    const messages = await stmts.getMessages.all(TEST_SID);
    assert.ok(messages.some(message => message.from_role === 'admin' && message.text === 'Respuesta desde admin'));
  });

  it('POST /api/admin/sessions/:id/message conserva payloads como texto y no ejecuta SQL', async () => {
    const sid = '5ec00000-0000-4000-8000-000000000001';
    const now = Date.now();
    const payload = `<script>alert(1)</script><svg onload=alert(2)><img src=x onerror=alert(3)>'; DROP TABLE sessions; --`;

    await stmts.upsertSession.run({
      session_id: sid,
      name: '<b onclick=alert(1)>Mallory</b>',
      lang: 'es',
      lang_detected: 1,
      ip: '8.8.8.8',
      geo_city: '<svg onload=alert(1)>',
      geo_country: 'US',
      geo_isp: 'ISP Test',
      user_agent: 'BadAgent"><script>alert(1)</script>',
      current_page: '/prueba?x=<script>alert(1)</script>',
      banned: 0,
      priority: 0,
      admin_last_seen_ts: 0,
      user_last_seen_ts: 0,
      awaiting_name: 0,
      bot_silenced: 0,
      last_active: now,
      created_at: now,
    });

    const { cookie } = await login();
    const sent = await request(`/api/admin/sessions/${sid}/message`, {
      method: 'POST',
      body: { text: payload },
      cookie,
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.json?.message?.text, payload);

    const table = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
    assert.equal(table?.name, 'sessions');

    const detail = await request(`/api/admin/sessions/${sid}`, { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json?.session?.name, '<b onclick=alert(1)>Mallory</b>');
    assert.ok(detail.json?.messages.some(message => message.text === payload));
  });

  it('POST /api/admin/sessions/:id/typing usuario desconectado → 409', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${TEST_SID}/typing`, {
      method: 'POST',
      body: { active: true },
      cookie,
    });
    assert.equal(r.status, 409);
  });

  it('POST /api/admin/sessions/:id/read marca lectura admin → 200', async () => {
    const { cookie } = await login();
    const ts = Date.now();
    const r = await request(`/api/admin/sessions/${TEST_SID}/read`, {
      method: 'POST',
      body: { reader: 'admin', ts },
      cookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.ok(r.json?.session?.adminLastSeenTs >= ts);
  });

  it('POST /api/admin/sessions/:id/ban → 200 y sesión marcada baneada', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${TEST_SID}/ban`, { method: 'POST', cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.session?.banned, true);
  });

  it('GET /api/admin/metrics/general → 200 con métricas generales', async () => {
    const { cookie } = await login();
    const r = await request('/api/admin/metrics/general', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(typeof r.json?.metrics?.totalUsers, 'number');
    assert.equal(typeof r.json?.metrics?.connectedUsers, 'number');
    assert.equal(typeof r.json?.metrics?.totalMessages, 'number');
  });

  it('POST /api/admin/sessions/:id/clear → limpia mensajes del chat', async () => {
    const now = Date.now();
    await stmts.upsertSession.run({
      session_id: CLEAR_SID,
      name: 'Usuario Limpieza',
      lang: 'es',
      lang_detected: 1,
      ip: '10.0.0.2',
      geo_city: 'Madrid',
      geo_country: 'ES',
      geo_isp: 'ISP Test',
      user_agent: 'TestAgent/3.0',
      current_page: '/limpieza',
      banned: 0,
      priority: 0,
      admin_last_seen_ts: 0,
      user_last_seen_ts: 0,
      awaiting_name: 0,
      bot_silenced: 0,
      last_active: now,
      created_at: now,
    });
    await stmts.insertMessage.run({ session_id: CLEAR_SID, from_role: 'user', text: 'Mensaje para limpiar', ts: now, lang: 'es' });

    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${CLEAR_SID}/clear`, { method: 'POST', cookie });
    const rows = await stmts.getMessages.all(CLEAR_SID);
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.messages?.length, 0);
    assert.equal(rows.length, 0);
  });

  it('POST /api/admin/sessions/:id/block → bloquea usuario', async () => {
    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${CLEAR_SID}/block`, { method: 'POST', cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.session?.banned, true);
  });

  it('DELETE /api/admin/sessions/:id → elimina sesión y mensajes', async () => {
    const now = Date.now();
    await stmts.upsertSession.run({
      session_id: DELETE_SID,
      name: 'Usuario Delete',
      lang: 'es',
      lang_detected: 1,
      ip: '10.0.0.3',
      geo_city: 'Valencia',
      geo_country: 'ES',
      geo_isp: 'ISP Test',
      user_agent: 'TestAgent/4.0',
      current_page: '/delete',
      banned: 0,
      priority: 0,
      admin_last_seen_ts: 0,
      user_last_seen_ts: 0,
      awaiting_name: 0,
      bot_silenced: 0,
      last_active: now,
      created_at: now,
    });
    await stmts.insertMessage.run({ session_id: DELETE_SID, from_role: 'user', text: 'Mensaje para eliminar', ts: now, lang: 'es' });

    const { cookie } = await login();
    const r = await request(`/api/admin/sessions/${DELETE_SID}`, { method: 'DELETE', cookie });
    const row = await stmts.getSession.get(DELETE_SID);
    const messages = await stmts.getMessages.all(DELETE_SID);
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(row, undefined);
    assert.equal(messages.length, 0);
  });

});

describe('Adjuntos de imagen', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const pngFile = {
    name: 'foto.png',
    type: 'image/png',
    buffer: Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
      'hex'
    ),
  };

  before(async () => {
    const now = Date.now();
    await stmts.upsertSession.run({
      session_id: sessionId,
      name: 'Usuario Imagen',
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

  it('POST /api/chat/:sessionId/attachments sube imagen válida y permite verla con cookie de sesión', async () => {
    const r = await multipartRequest(`/api/chat/${sessionId}/attachments`, {
      fields: { text: 'mira esta imagen' },
      file: pngFile,
      cookie: { header: `lchat_sid=${sessionId}` },
    });

    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.message?.attachments?.length, 1);
    assert.equal(r.json.message.attachments[0].mimeType, 'image/png');
    assert.equal(r.json.message.attachments[0].width, 1);
    assert.equal(r.json.message.attachments[0].height, 1);
    assert.match(r.json.message.attachments[0].url, /token=/);

    const image = await request(r.json.message.attachments[0].url, {
      cookie: { header: `lchat_sid=${sessionId}` },
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
  });

  it('POST /api/chat/:sessionId/attachments permite subir con x-chat-session-id sin cookie', async () => {
    const r = await multipartRequest(`/api/chat/${sessionId}/attachments`, {
      file: pngFile,
      headers: { 'x-chat-session-id': sessionId },
    });

    assert.equal(r.status, 200);
    assert.equal(r.json?.message?.attachments?.length, 1);
  });

  it('GET /api/attachments/:id exige token o cookie válida', async () => {
    const created = await multipartRequest(`/api/chat/${sessionId}/attachments`, {
      file: pngFile,
      cookie: { header: `lchat_sid=${sessionId}` },
    });
    const url = created.json.message.attachments[0].url;
    const bareUrl = url.split('?')[0];

    const denied = await request(bareUrl);
    assert.equal(denied.status, 404);

    const wrongToken = await request(`${bareUrl}?token=incorrecto`);
    assert.equal(wrongToken.status, 404);

    const sidOnly = await request(`${bareUrl}?sid=${sessionId}`);
    assert.equal(sidOnly.status, 404);

    const allowed = await request(url);
    assert.equal(allowed.status, 200);
  });

  it('POST /api/chat/:sessionId/attachments rechaza archivo mayor a 5 MB', async () => {
    const r = await multipartRequest(`/api/chat/${sessionId}/attachments`, {
      file: {
        name: 'grande.png',
        type: 'image/png',
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      },
      cookie: { header: `lchat_sid=${sessionId}` },
    });

    assert.equal(r.status, 413);
  });

  it('POST /api/chat/:sessionId/attachments rechaza tipo no permitido', async () => {
    const beforeMessages = await stmts.getMessages.all(sessionId);
    const r = await multipartRequest(`/api/chat/${sessionId}/attachments`, {
      file: {
        name: 'nota.txt',
        type: 'text/plain',
        buffer: Buffer.from('hola'),
      },
      cookie: { header: `lchat_sid=${sessionId}` },
    });

    assert.equal(r.status, 415);
    const afterMessages = await stmts.getMessages.all(sessionId);
    assert.equal(afterMessages.length, beforeMessages.length);
  });

  it('DELETE /api/admin/attachments/:id borra adjunto desde admin', async () => {
    const created = await multipartRequest(`/api/chat/${sessionId}/attachments`, {
      file: pngFile,
      cookie: { header: `lchat_sid=${sessionId}` },
    });
    const attachmentId = created.json.message.attachments[0].id;
    const { cookie } = await login();

    const deleted = await request(`/api/admin/attachments/${attachmentId}`, {
      method: 'DELETE',
      cookie,
    });

    assert.equal(deleted.status, 200);
    assert.equal(deleted.json?.ok, true);

    const image = await request(`/api/attachments/${attachmentId}`, {
      cookie: { header: `lchat_sid=${sessionId}` },
    });
    assert.equal(image.status, 404);
  });

  it('uploadLimiter limita subidas por IP y sesión', async () => {
    const { createHttpRateLimiters } = require('../src/utils/rate-limiters');
    let calls = 0;
    const { uploadLimiter } = createHttpRateLimiters({
      rateLimitConfig: { windowMinutes: 1, uploadWindowMinutes: 1, uploadMax: 1, publicMax: 100, adminMax: 100, loginMax: 100 },
      adminCookieName: 'lcp_admin',
      verifyAdminToken: () => false,
    });

    async function runLimiter() {
      const req = { ip: '127.0.0.1', params: { sessionId: 'limit-test' }, body: {}, cookies: {} };
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        getHeader(name) { return this.headers[name.toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
      };
      await new Promise(resolve => {
        res.json = payload => { res.payload = payload; calls++; resolve(); return res; };
        res.send = payload => { res.payload = payload; calls++; resolve(); return res; };
        uploadLimiter(req, res, resolve);
      });
      return res;
    }

    await runLimiter();
    const limited = await runLimiter();
    assert.equal(limited.statusCode, 429);
    assert.equal(calls, 1);
  });
});

// ── Persistence: the DB exists and has the expected tables ───
describe('Persistencia', () => {
  it('la BD en memoria está disponible y contiene la tabla sessions', async () => {
    const result = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
    assert.ok(result, 'tabla sessions no encontrada');
  });

  it('la BD en memoria contiene la tabla messages', async () => {
    const result = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'");
    assert.ok(result, 'tabla messages no encontrada');
  });

});
