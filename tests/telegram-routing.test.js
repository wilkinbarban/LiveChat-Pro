// ============================================================
// Telegram routing tests — server.js
// Verifies that replying to a Telegram message correctly resolves
// the linked session.
// ============================================================
'use strict';

process.env.TELEGRAM_TOKEN = 'test:token_000000000:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.TELEGRAM_ADMIN_ID = '999999';
process.env.ADMIN_PANEL_PASSWORD = 'testpass123';
process.env.FEATURE_TRANSLATION = 'false';
process.env.FEATURE_GEOLOCATION = 'false';
process.env.FEATURE_SENTIMENT = 'false';
process.env.REDIS_URL = '';

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

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  clusterState,
  resolveTelegramReplySessionId,
  closeDb,
  closeTranslationCache,
  io,
  httpServer,
} = require('../server');

describe('Telegram reply routing', () => {
  after(async () => {
    closeTranslationCache();
    await new Promise(resolve => {
      io.close(() => {
        if (!httpServer.listening) return resolve();
        httpServer.close(() => resolve());
      });
    });
    await clusterState.close();
    await closeDb();
  });

  it('resuelve la sesión a partir del mensaje de Telegram respondido', async () => {
    const sessionId = '11111111-2222-4333-8444-555555555555';
    await clusterState.setTelegramMessageSession(999999, 321, sessionId);

    const resolved = await resolveTelegramReplySessionId({
      reply_to_message: { message_id: 321 },
    });

    assert.equal(resolved, sessionId);
  });

  it('retorna null cuando el mensaje respondido no tiene sesión asociada', async () => {
    const resolved = await resolveTelegramReplySessionId({
      reply_to_message: { message_id: 999999 },
    });

    assert.equal(resolved, null);
  });
});
