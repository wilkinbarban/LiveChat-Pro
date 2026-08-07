// ============================================================
// Dead-code audit tests
// Verifies removal of HELP_TOPICS personal constant, consolidation of
// resolveTelegramReplySessionId, and deletion of scratch/ directory.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('Dead-code audit sweep', () => {
  it('elimina la constante HELP_TOPICS y su fallback de src/sockets/index.js', () => {
    const socketIndexCode = fs.readFileSync(path.join(ROOT, 'src', 'sockets', 'index.js'), 'utf8');
    assert.equal(
      socketIndexCode.includes('HELP_TOPICS'),
      false,
      'src/sockets/index.js no debe contener la constante ni referencias a HELP_TOPICS',
    );
  });

  it('elimina la definición duplicada de resolveTelegramReplySessionId en server.js y la consolida', () => {
    const serverCode = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.equal(
      /async\s+function\s+resolveTelegramReplySessionId/.test(serverCode),
      false,
      'server.js no debe definir async function resolveTelegramReplySessionId en forma duplicada',
    );

    const telegramBot = require('../src/telegram/bot');
    const serverExports = require('../server');
    assert.equal(
      typeof serverExports.resolveTelegramReplySessionId,
      'function',
      'server.js debe exportar resolveTelegramReplySessionId para compatibilidad',
    );
    assert.equal(
      serverExports.resolveTelegramReplySessionId,
      telegramBot.resolveTelegramReplySessionId,
      'server.js debe reexportar la función resolveTelegramReplySessionId de src/telegram/bot.js',
    );
  });

  it('elimina la carpeta scratch/ de la raíz del repositorio', () => {
    const scratchPath = path.join(ROOT, 'scratch');
    assert.equal(
      fs.existsSync(scratchPath),
      false,
      'La carpeta scratch/ debe ser eliminada del repositorio',
    );
  });
});
