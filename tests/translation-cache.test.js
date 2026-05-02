// ============================================================
// Translation cache tests — server.js
// Verifies that repeated translations reuse the local cache.
// ============================================================
'use strict';

process.env.TELEGRAM_TOKEN = 'test:token_000000000:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.TELEGRAM_ADMIN_ID = '999999';
process.env.ADMIN_PANEL_PASSWORD = 'testpass123';
process.env.FEATURE_TRANSLATION = 'true';
process.env.FEATURE_GEOLOCATION = 'false';
process.env.FEATURE_SENTIMENT = 'false';
process.env.REDIS_URL = '';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { translate, clearTranslationCache, closeTranslationCache, closeDb, clusterState, io, httpServer } = require('../server');

describe('Translation cache', () => {
  const originalGet = axios.get;

  after(async () => {
    axios.get = originalGet;
    clearTranslationCache();
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

  it('reutiliza caché para el mismo texto y mismo idioma destino', async () => {
    let calls = 0;

    axios.get = async (url) => {
      calls += 1;

      if (url.includes('tl=fr')) {
        return { data: [[['bonjour', 'hello', null, null]]] };
      }

      return { data: [[['hola', 'hello', null, null]]] };
    };

    clearTranslationCache();

    const first = await translate('hello', 'es');
    const second = await translate('hello', 'es');
    const third = await translate('hello', 'fr');

    assert.equal(first, 'hola');
    assert.equal(second, 'hola');
    assert.equal(third, 'bonjour');
    assert.equal(calls, 2, 'la segunda traducción idéntica debería salir de caché');
  });
});
