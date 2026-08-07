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

// ── Boot rehydration: resolveLlmBootConfig (ADR 5, default-only) ────────────
function makeBootSettingsService(overrides = {}) {
  const store = new Map(Object.entries(overrides));
  return {
    async get(key, defaultValue = null) {
      return store.has(key) ? store.get(key) : defaultValue;
    },
    async getJSON(key, defaultValue = null) {
      const raw = store.get(key);
      if (raw === undefined) return defaultValue;
      try {
        return JSON.parse(raw);
      } catch {
        return defaultValue;
      }
    },
    async decryptSecret(ciphertext) {
      if (!ciphertext || ciphertext === 'v1.invalid') throw new Error('bad ciphertext');
      return `decrypted:${ciphertext}`;
    },
  };
}

test('resolveLlmBootConfig returns settings-backed provider, decrypted key, model, and enabled', async () => {
  const settingsService = makeBootSettingsService({
    'llm.default_provider': 'deepseek',
    'llm.provider.deepseek': JSON.stringify({ encKey: 'v1.enc', model: 'deepseek-chat' }),
    'ai.enabled': 'true',
  });
  const resolved = await aiBot.resolveLlmBootConfig({ settingsService });
  assert.deepEqual(resolved, {
    provider: 'deepseek',
    defaultProvider: 'deepseek',
    apiKey: 'decrypted:v1.enc',
    model: 'deepseek-chat',
    enabled: true,
  });
});

test('resolveLlmBootConfig falls back to raw apiKey when no encKey is stored', async () => {
  const settingsService = makeBootSettingsService({
    'llm.default_provider': 'openrouter',
    'llm.provider.openrouter': JSON.stringify({ apiKey: 'sk-plain', model: 'openrouter/auto' }),
  });
  const resolved = await aiBot.resolveLlmBootConfig({ settingsService });
  assert.equal(resolved.apiKey, 'sk-plain');
  assert.equal(resolved.model, 'openrouter/auto');
});

test('resolveLlmBootConfig leaves enabled undefined when ai.enabled is not stored', async () => {
  const settingsService = makeBootSettingsService({
    'llm.default_provider': 'deepseek',
    'llm.provider.deepseek': JSON.stringify({ encKey: 'v1.enc' }),
  });
  const resolved = await aiBot.resolveLlmBootConfig({ settingsService });
  assert.equal('enabled' in resolved, false);
  assert.equal(resolved.provider, 'deepseek');
});

test('resolveLlmBootConfig returns null when decrypting the stored key fails', async () => {
  const settingsService = makeBootSettingsService({
    'llm.default_provider': 'deepseek',
    'llm.provider.deepseek': JSON.stringify({ encKey: 'v1.invalid' }),
  });
  const resolved = await aiBot.resolveLlmBootConfig({ settingsService, logger: { warn() {} } });
  assert.equal(resolved, null);
});

test('resolveLlmBootConfig returns null when no default provider is configured', async () => {
  const settingsService = makeBootSettingsService({});
  const resolved = await aiBot.resolveLlmBootConfig({ settingsService });
  assert.equal(resolved, null);
});

test('resolveLlmBootConfig returns null when the default provider row is missing', async () => {
  const settingsService = makeBootSettingsService({
    'llm.default_provider': 'anthropic',
  });
  const resolved = await aiBot.resolveLlmBootConfig({ settingsService });
  assert.equal(resolved, null);
});

test('resolveLlmBootConfig returns null without a settingsService', async () => {
  assert.equal(await aiBot.resolveLlmBootConfig({}), null);
  assert.equal(await aiBot.resolveLlmBootConfig(null), null);
});

// ── {rag_context} substitution inside the formatted prompt (ADR 7) ──────────
test('getReply feeds rag_context into getFormattedPrompt and never appends it', async () => {
  let capturedVars = null;
  let capturedSystemPrompt = null;
  const masterPromptService = {
    async getFormattedPrompt(vars) {
      capturedVars = vars;
      return `Master: ${vars.visitor_name} [${vars.rag_context}]`;
    },
  };
  const ragService = {
    async retrieve() {
      return ['Refund policy is 30 days.'];
    },
  };
  const mockLlmService = {
    async chat(options) {
      capturedSystemPrompt = options.systemPrompt;
      return { ok: true, text: 'Reply from provider' };
    },
  };

  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    llmService: mockLlmService,
    masterPromptService,
    ragService,
  });

  const session = { messages: [], visitorName: 'Ana' };
  const result = await aiBot.getReply(session, 'refunds');
  assert.equal(result.reply, 'Reply from provider');
  assert.ok(capturedVars.rag_context.includes('Refund policy is 30 days.'));
  assert.ok(capturedVars.rag_context.startsWith('Knowledge context:'));
  assert.equal(capturedSystemPrompt, 'Master: Ana [Knowledge context:\nRefund policy is 30 days.]');
  assert.ok(!capturedSystemPrompt.includes('\n\nKnowledge context:'));
});

test('getReply substitutes empty rag_context when retrieval returns nothing', async () => {
  let capturedVars = null;
  const masterPromptService = {
    async getFormattedPrompt(vars) {
      capturedVars = vars;
      return `Master: [${vars.rag_context}]`;
    },
  };
  const ragService = {
    async retrieve() {
      return [];
    },
  };
  const mockLlmService = {
    async chat(_options) {
      return { ok: true, text: 'No context reply' };
    },
  };

  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    llmService: mockLlmService,
    masterPromptService,
    ragService,
  });

  const session = { messages: [], visitorName: 'Ana' };
  const result = await aiBot.getReply(session, 'no relevant docs');
  assert.equal(result.reply, 'No context reply');
  assert.equal(capturedVars.rag_context, '');
});

test('getSystemPrompt forwards rag_context into getFormattedPrompt vars', async () => {
  let capturedVars = null;
  const masterPromptService = {
    async getFormattedPrompt(vars) {
      capturedVars = vars;
      return `Master: [${vars.rag_context}]`;
    },
  };

  aiBot.configure({
    enabled: true,
    siteTitle: 'LiveChat Pro',
    masterPromptService,
  });

  const session = { visitorName: 'Ana', lang: 'es' };
  await aiBot.getSystemPrompt(session, 'hola', { rag_context: 'extra knowledge' });
  assert.equal(capturedVars.visitor_name, 'Ana');
  assert.equal(capturedVars.current_language, 'es');
  assert.equal(capturedVars.rag_context, 'extra knowledge');
});

