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

test('isEnabled reflects runtime configure snapshot', () => {
  aiBot.configure({ enabled: false, mode: 'disabled' });
  assert.equal(aiBot.isEnabled(), false);

  aiBot.configure({ enabled: true, provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini' });
  assert.equal(aiBot.isEnabled(), true);

  aiBot.configure({ enabled: false });
  assert.equal(aiBot.isEnabled(), false);

  // Backwards compatibility with legacy mode string
  aiBot.configure({ mode: 'knowledge-base' });
  assert.equal(aiBot.isEnabled(), true);

  aiBot.configure({ mode: 'disabled' });
  assert.equal(aiBot.isEnabled(), false);
});

test('runtime provider switch applies to next getReply without restart', async () => {
  let calledProvider = null;
  const mockLlmService = {
    async chat(options) {
      calledProvider = options.provider;
      return { ok: true, text: `Response from ${options.provider}` };
    },
  };

  aiBot.configure({
    enabled: true,
    provider: 'openai',
    apiKey: 'sk-test-1',
    model: 'gpt-4o-mini',
    llmService: mockLlmService,
  });

  const session = { messages: [] };
  const res1 = await aiBot.getReply(session, 'Hello');
  assert.equal(res1.escalate, false);
  assert.equal(res1.reply, 'Response from openai');
  assert.equal(calledProvider, 'openai');

  // Switch provider at runtime
  aiBot.configure({
    enabled: true,
    provider: 'anthropic',
    apiKey: 'sk-ant-1',
    model: 'claude-3-5-sonnet',
    llmService: mockLlmService,
  });

  const res2 = await aiBot.getReply(session, 'Hello again');
  assert.equal(res2.escalate, false);
  assert.equal(res2.reply, 'Response from anthropic');
  assert.equal(calledProvider, 'anthropic');
});

test('provider failure returns escalating no-reply fail-open without crashing', async () => {
  const mockLlmService = {
    async chat() {
      return { ok: false, error: 'Provider rate limit or 500 error' };
    },
  };

  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'key',
    model: 'deepseek-chat',
    llmService: mockLlmService,
  });

  const session = { messages: [] };
  const result = await aiBot.getReply(session, 'test query');
  assert.equal(result.reply, null);
  assert.equal(result.confidence, 0);
  assert.equal(result.escalate, true);
});

test('provider exception throws handled gracefully fail-open', async () => {
  const mockLlmService = {
    async chat() {
      throw new Error('Network timeout');
    },
  };

  aiBot.configure({
    enabled: true,
    provider: 'openrouter',
    apiKey: 'key',
    model: 'openrouter-model',
    llmService: mockLlmService,
  });

  const session = { messages: [] };
  const result = await aiBot.getReply(session, 'test query');
  assert.equal(result.reply, null);
  assert.equal(result.confidence, 0);
  assert.equal(result.escalate, true);
});

test('high-priority sentiment bypass is honored by shouldBotHandle', () => {
  aiBot.configure({ enabled: true });
  const normalSession = { botSilenced: false };
  assert.equal(aiBot.shouldBotHandle(normalSession), true);

  // High priority option bypasses bot
  assert.equal(aiBot.shouldBotHandle(normalSession, { isHighPriority: true }), false);

  // Session flagged with high priority bypasses bot
  const highPrioritySession = { botSilenced: false, isHighPriority: true };
  assert.equal(aiBot.shouldBotHandle(highPrioritySession), false);

  // Silenced session bypasses bot
  const silencedSession = { botSilenced: true };
  assert.equal(aiBot.shouldBotHandle(silencedSession), false);
});

