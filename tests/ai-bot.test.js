// ============================================================
// AI bot behavior tests — src/services/ai-bot.js
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const aiBot = require('../src/services/ai-bot');

test('knowledge bot keeps disambiguation context on the real session', async () => {
  const session = {
    lang: 'es',
    browserLang: 'es',
    messages: [],
    botSilenced: false,
  };

  aiBot.init({ mode: 'knowledge-base', confidenceThreshold: 0.95 });
  aiBot.kb = {
    version: 'test',
    language: 'multi',
    entries: [
      {
        id: 'livechat-instalacion',
        language: 'es',
        keywords: ['instalar livechat', 'configurar livechat'],
        question: '¿Cómo instalo LiveChat Pro?',
        answer: 'Instala LiveChat Pro con node setup.js.',
        source: 'test',
        category: 'instalacion',
      },
    ],
  };

  const first = await aiBot.getReply(session, 'como instalo');
  assert.equal(first.escalate, false);
  assert.equal(session.botContext?.pendingIntent, 'install');

  const second = await aiBot.getReply(session, 'LiveChat Pro');
  assert.equal(second.escalate, false);
  assert.match(second.reply, /node setup\.js/);
  assert.equal(session.botContext, null);
});
