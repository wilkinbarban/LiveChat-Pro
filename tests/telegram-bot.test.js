'use strict';

// ============================================================
// Telegram bot core unit tests — src/telegram/bot.js
// Covers verifyTelegramToken, resolveTelegramToken,
// reconfigureTelegramBot, lazy identity (ADR-9), masked status
// fields (ADR-6) and the start-after-reconfigure stale-token
// regression (ADR-4).
// ============================================================

// ── Telegraf mock (installed before requiring bot.js) ───────
// The fake instance records the token it was created with and
// exposes a controllable getMe so identity tests can prove the
// lazy-cache behavior without any network.
const telegrafPath = require.resolve('telegraf');
const getMeCalls = [];
const createdTokens = [];
let getMeResult = { id: 8609135566, username: 'ChatVivo_Wilkin_bot', first_name: 'LiveChat Pro' };
let getMeError = null;
// Simulates real Telegraf launch latency (async getUpdates handshake). The
// default launch() resolves synchronously, which would mask the
// reconfigure launch-timeout regression (setTimeout with no delay fires
// before a real network handshake). Tests set this >0 to prove the default
// timeout param lets reconfigure's launch:true path succeed.
let launchDelayMs = 0;

require.cache[telegrafPath] = {
  id: telegrafPath,
  filename: telegrafPath,
  loaded: true,
  exports: {
    Telegraf: class FakeTelegraf {
      constructor(token) {
        this.token = token;
        createdTokens.push(token);
        this.telegram = {
          getMe: async () => {
            getMeCalls.push(this.token);
            if (getMeError) {
              const err = getMeError;
              getMeError = null;
              throw err;
            }
            return getMeResult;
          },
          sendMessage: async () => ({ message_id: 1 }),
        };
      }
      command() { return this; }
      on() { return this; }
      async launch() {
        if (launchDelayMs > 0) {
          await new Promise((r) => setTimeout(r, launchDelayMs));
        }
      }
      stop() {}
    },
  },
};

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  setupTelegramBot,
  launchTelegramBot,
  getTelegramStatus,
  startTelegramBot,
  stopTelegramBot,
  getBot,
  verifyTelegramToken,
  reconfigureTelegramBot,
  resolveTelegramToken,
  refreshTelegramIdentity,
} = require('../src/telegram/bot');

// Tokens with distinct last-4 suffixes so maskedToken assertions are exact.
const TOKEN_A = 'bot-token-AAAA';
const TOKEN_B = 'bot-token-BBBB';

async function resetBot() {
  try {
    await stopTelegramBot();
  } catch {
    // already stopped
  }
  setupTelegramBot({ token: null, adminId: null, logger: null });
  getMeCalls.length = 0;
  createdTokens.length = 0;
  getMeError = null;
  launchDelayMs = 0;
  getMeResult = { id: 8609135566, username: 'ChatVivo_Wilkin_bot', first_name: 'LiveChat Pro' };
}

// ── verifyTelegramToken ─────────────────────────────────────
test('verifyTelegramToken resuelve identidad válida con el token dado', async () => {
  await resetBot();
  const result = await verifyTelegramToken(TOKEN_A);
  assert.deepEqual(result, {
    ok: true,
    id: 8609135566,
    username: 'ChatVivo_Wilkin_bot',
    first_name: 'LiveChat Pro',
  });
  assert.equal(getMeCalls.length, 1);
  assert.equal(getMeCalls[0], TOKEN_A);
});

test('verifyTelegramToken rechaza token inválido (401) sin lanzar', async () => {
  await resetBot();
  getMeError = Object.assign(new Error('Unauthorized'), { response: { statusCode: 401 } });
  const result = await verifyTelegramToken('token-invalido-9999');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unauthorized/);
});

test('verifyTelegramToken rechaza token desconocido (404) sin lanzar', async () => {
  await resetBot();
  getMeError = Object.assign(new Error('Not Found'), { response: { statusCode: 404 } });
  const result = await verifyTelegramToken('token-inexistente');
  assert.equal(result.ok, false);
  assert.match(result.error, /Not Found/);
});

// ── resolveTelegramToken (ADR-2 precedence) ─────────────────
test('resolveTelegramToken: el almacenado (settings) gana sobre env', async () => {
  const settingsService = {
    getJSON: async () => ({ encKey: 'v1.enc', verifiedAt: 1 }),
    decryptSecret: async () => TOKEN_A,
  };
  const result = await resolveTelegramToken({ settingsService, envToken: TOKEN_B });
  assert.deepEqual(result, { token: TOKEN_A, tokenSource: 'settings' });
});

test('resolveTelegramToken: fallo de descifrado cae a env y avisa', async () => {
  const warnings = [];
  const settingsService = {
    getJSON: async () => ({ encKey: 'v1.invalid', verifiedAt: 1 }),
    decryptSecret: async () => { throw new Error('Unsupported state or unable to authenticate data'); },
  };
  const logger = { warn: (_payload, msg) => warnings.push(msg) };
  const result = await resolveTelegramToken({ settingsService, envToken: TOKEN_B, logger });
  assert.deepEqual(result, { token: TOKEN_B, tokenSource: 'env' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Telegram/i);
});

test('resolveTelegramToken: token almacenado vacío cae a env', async () => {
  const settingsService = {
    getJSON: async () => ({ encKey: 'v1.empty' }),
    decryptSecret: async () => '',
  };
  const result = await resolveTelegramToken({ settingsService, envToken: TOKEN_B });
  assert.deepEqual(result, { token: TOKEN_B, tokenSource: 'env' });
});

test('resolveTelegramToken: sin almacenado usa env; sin ambos es none', async () => {
  const settingsService = { getJSON: async () => null, decryptSecret: async () => '' };
  assert.deepEqual(
    await resolveTelegramToken({ settingsService, envToken: TOKEN_B }),
    { token: TOKEN_B, tokenSource: 'env' },
  );
  assert.deepEqual(
    await resolveTelegramToken({ settingsService, envToken: null }),
    { token: null, tokenSource: 'none' },
  );
});

// ── reconfigureTelegramBot (ADR-3) ──────────────────────────
test('reconfigureTelegramBot aplica token y adminId nuevos en caliente', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', tokenSource: 'env', logger: null });
  await launchTelegramBot(1000);
  assert.equal(getTelegramStatus().status, 'running');
  assert.equal(getBot().token, TOKEN_A);

  await reconfigureTelegramBot({ token: TOKEN_B, adminId: '222', launch: true });

  const status = getTelegramStatus();
  assert.equal(status.status, 'running');
  assert.equal(status.adminId, '222');
  assert.equal(getBot().token, TOKEN_B);
  assert.equal(createdTokens[createdTokens.length - 1], TOKEN_B);
});

test('reconfigureTelegramBot sin launch cambia credenciales detenido', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });

  await reconfigureTelegramBot({ token: TOKEN_B, adminId: '333', launch: false });

  const status = getTelegramStatus();
  assert.equal(status.status, 'stopped');
  assert.equal(status.adminId, '333');
  assert.equal(getBot().token, TOKEN_B);
});

test('reconfigureTelegramBot solo adminId conserva el token', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });

  await reconfigureTelegramBot({ adminId: '999', launch: false });

  assert.equal(getTelegramStatus().adminId, '999');
  assert.equal(getBot().token, TOKEN_A);
});

test('reconfigureTelegramBot con launch:true no dispara timeout por defecto con lanzamiento lento', async () => {
  await resetBot();
  // Real Telegraf launch is async (getUpdates handshake); the default-timeout
  // regression made launchTelegramBot() inside reconfigure reject immediately
  // (setTimeout with no delay fires before the handshake).
  launchDelayMs = 25;
  try {
    setupTelegramBot({ token: TOKEN_A, adminId: '111', tokenSource: 'env', logger: null });
    await launchTelegramBot(1000);
    assert.equal(getTelegramStatus().status, 'running');

    await reconfigureTelegramBot({ token: TOKEN_B, adminId: '222', launch: true, tokenSource: 'settings' });

    const status = getTelegramStatus();
    assert.equal(status.status, 'running');
    assert.equal(status.tokenSource, 'settings');
    assert.equal(status.maskedToken, '…BBBB');
    assert.equal(getBot().token, TOKEN_B);
  } finally {
    launchDelayMs = 0;
  }
});

test('reconfigureTelegramBot propaga tokenSource al estado', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });

  await reconfigureTelegramBot({ token: TOKEN_B, launch: false, tokenSource: 'settings' });
  assert.equal(getTelegramStatus().tokenSource, 'settings');

  await reconfigureTelegramBot({ token: TOKEN_A, launch: false, tokenSource: 'env' });
  assert.equal(getTelegramStatus().tokenSource, 'env');

  await reconfigureTelegramBot({ token: null, launch: false, tokenSource: 'none' });
  const cleared = getTelegramStatus();
  assert.equal(cleared.status, 'not-configured');
  assert.equal(cleared.tokenSource, null);
});

// ── startTelegramBot stale-token regression (ADR-4) ─────────
test('startTelegramBot tras reconfigure lanza instancia con el token nuevo', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });
  await launchTelegramBot(1000);
  const instanceA = getBot();
  assert.equal(instanceA.token, TOKEN_A);

  await stopTelegramBot();
  assert.equal(getTelegramStatus().status, 'stopped');

  await reconfigureTelegramBot({ token: TOKEN_B, launch: false });
  await startTelegramBot(1000);

  const instanceB = getBot();
  assert.equal(getTelegramStatus().status, 'running');
  assert.notEqual(instanceB, instanceA, 'start debe reconstruir la instancia tras reconfigure');
  assert.equal(instanceB.token, TOKEN_B);
  assert.equal(createdTokens[createdTokens.length - 1], TOKEN_B);
});

test('startTelegramBot siempre re-configura desde _deps aunque ya exista instancia', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });
  await launchTelegramBot(1000);
  const instanceA = getBot();
  await stopTelegramBot();

  const instancesBefore = createdTokens.length;
  await startTelegramBot(1000);
  const instanceB = getBot();

  assert.notEqual(instanceB, instanceA, 'start debe reconstruir siempre desde _deps');
  assert.equal(createdTokens.length, instancesBefore + 1);
  assert.equal(instanceB.token, TOKEN_A);
});

// ── getTelegramStatus masked fields (ADR-6) ─────────────────
test('getTelegramStatus expone maskedToken/tokenSource/identidad, nunca token completo', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '7051275102', tokenSource: 'settings', logger: null });
  await refreshTelegramIdentity();

  const status = getTelegramStatus();
  assert.equal(status.configured, true);
  assert.equal(status.status, 'stopped');
  assert.equal(status.adminId, '7051275102');
  assert.equal(status.maskedToken, '…AAAA');
  assert.equal(status.tokenSource, 'settings');
  assert.equal(status.botUsername, 'ChatVivo_Wilkin_bot');
  assert.equal(status.botFirstName, 'LiveChat Pro');
  assert.equal(status.token, undefined);
  assert.equal(status.botToken, undefined);
});

test('getTelegramStatus usa tokenSource env por defecto', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '1', logger: null });
  assert.equal(getTelegramStatus().tokenSource, 'env');
});

test('getTelegramStatus sin token reporta not-configured sin fugas', async () => {
  await resetBot();
  const status = getTelegramStatus();
  assert.equal(status.status, 'not-configured');
  assert.equal(status.configured, false);
  assert.equal(status.maskedToken, null);
  assert.equal(status.tokenSource, null);
  assert.equal(status.botUsername, null);
  assert.equal(status.botFirstName, null);
  assert.equal(status.token, undefined);
  assert.equal(status.botToken, undefined);
});

// ── Lazy identity (ADR-9) ───────────────────────────────────
test('la identidad es perezosa: sin getMe al configurar ni lanzar', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });
  await launchTelegramBot(1000);

  assert.equal(getMeCalls.length, 0, 'getMe no debe llamarse en setup/launch');
  assert.equal(getTelegramStatus().botUsername, null);
  assert.equal(getTelegramStatus().botFirstName, null);
});

test('refreshTelegramIdentity llena la identidad y la cachea 5 minutos', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });

  const identity = await refreshTelegramIdentity();
  assert.equal(identity.username, 'ChatVivo_Wilkin_bot');
  assert.equal(identity.firstName, 'LiveChat Pro');
  assert.ok(identity.fetchedAt > 0);
  assert.equal(getMeCalls.length, 1);

  // cache hit: segunda lectura inmediata no vuelve a llamar a getMe
  await refreshTelegramIdentity();
  assert.equal(getMeCalls.length, 1);

  const status = getTelegramStatus();
  assert.equal(status.botUsername, 'ChatVivo_Wilkin_bot');
  assert.equal(status.botFirstName, 'LiveChat Pro');
});

test('refreshTelegramIdentity falla suave a null ante error de getMe', async () => {
  await resetBot();
  setupTelegramBot({ token: TOKEN_A, adminId: '111', logger: null });
  getMeError = new Error('Network error');

  const identity = await refreshTelegramIdentity();
  assert.equal(identity.username, null);
  assert.equal(identity.firstName, null);
  assert.equal(getTelegramStatus().botUsername, null);
});

test('refreshTelegramIdentity sin token no consulta getMe', async () => {
  await resetBot();
  const identity = await refreshTelegramIdentity();
  assert.equal(identity, null);
  assert.equal(getMeCalls.length, 0);
});
