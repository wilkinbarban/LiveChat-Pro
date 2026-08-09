// ============================================================
// AI bot behavior tests — src/services/ai-bot.js
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const aiBot = require('../src/services/ai-bot');

test('postprocessWebReply removes empty opening filler and decorative role emoji without deleting the closing', () => {
  const result = aiBot.postprocessWebReply(`¡Claro!\n\n## 🤖 Resumen\n\n**LiveChat Pro** usa RAG.\n\n¿Hay algo más en lo que pueda ayudarte?`);
  assert.equal(result, '## Resumen\n\n**LiveChat Pro** usa RAG.\n\n¿Hay algo más en lo que pueda ayudarte?');
});

test('postprocessWebReply preserves substantive questions, Markdown, and code symbols', () => {
  const input = `**Configuración**\n\n¿Qué puerto querés usar para el servidor?\n\n\`a < b && c > d\`\n\n\`\`\`js\nconst icon = "🤖";\nif (a < b) console.log("?");\n\`\`\``;
  assert.equal(aiBot.postprocessWebReply(input), input);
});

test('postprocessWebReply preserves closing lines in six languages to avoid hiding substantive output', () => {
  const closings = [
    '¿Hay algo más en lo que pueda ayudarte?', 'Is there anything else I can help you with?',
    'Há algo mais em que posso ajudar?', 'Puis-je vous aider avec autre chose ?',
    'Kann ich dir sonst noch helfen?', "C'è altro in cui posso aiutarti?",
    '¿Necesitas ayuda con algún test en particular?', 'Do you need help with a specific test?',
    'Você precisa de ajuda com algum teste específico?', "Avez-vous besoin d'aide avec un test précis ?",
    'Brauchst du Hilfe bei einem bestimmten Test?', 'Hai bisogno di aiuto con un test specifico?',
    'Si necesitas más detalles sobre algún test en particular, consúltame.',
    'If you need more details about a specific test, let me know.',
  ];
  for (const closing of closings) assert.equal(aiBot.postprocessWebReply(`Respuesta técnica.\n\n${closing}`), `Respuesta técnica.\n\n${closing}`);
});

test('configured provider requests one continuation when token limit truncates the response', async () => {
  const calls = [];
  aiBot.configure({
    enabled: true, provider: 'openai', apiKey: 'key', model: 'model', maxTokens: 1200,
    llmService: { async chat(options) {
      calls.push(options);
      return calls.length === 1
        ? { ok: true, text: '[Photo Dedup](https', finishReason: 'length' }
        : { ok: true, text: '://example.com) is complete.', finishReason: 'stop' };
    } },
    ragService: { async retrieve() { return []; } },
    masterPromptService: { async getFormattedPrompt() { return 'system'; } },
  });
  const result = await aiBot.getReply({ messages: [] }, 'Tell me about Photo Dedup');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].maxTokens, 1200);
  assert.equal(calls[1].messages.at(-2).role, 'assistant');
  assert.equal(result.reply, '[Photo Dedup](https://example.com) is complete.');
  aiBot.configure({ provider: null, apiKey: null, llmService: null, masterPromptService: null, ragService: null, mode: 'knowledge-base' });
});

test('configured provider never delivers a response that remains truncated after continuation', async () => {
  let calls = 0;
  aiBot.configure({
    enabled: true, provider: 'anthropic', apiKey: 'key', model: 'model',
    llmService: { async chat() { calls++; return { ok: true, text: calls === 1 ? 'partial pipe |' : 'still partial', stopReason: 'max_tokens' }; } },
    ragService: { async retrieve() { return []; } }, masterPromptService: { async getFormattedPrompt() { return 'system'; } },
  });
  const result = await aiBot.getReply({ messages: [] }, 'command');
  assert.deepEqual(result, { reply: null, confidence: 0, escalate: true });
  assert.equal(calls, 2);
  aiBot.configure({ provider: null, apiKey: null, llmService: null, masterPromptService: null, ragService: null, mode: 'knowledge-base' });
});

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

test('resolveLlmBootConfig warns instructing one-time secret re-entry when decrypt fails (A4)', async () => {
  // A quoted SETTINGS_KEY changes the derived key (ADR-2): decrypt fails at
  // boot and the warning MUST tell the operator to re-enter LLM secrets once.
  // Boot continues (null) — never throws.
  const warnings = [];
  const settingsService = makeBootSettingsService({
    'llm.default_provider': 'deepseek',
    'llm.provider.deepseek': JSON.stringify({ encKey: 'v1.invalid' }),
  });
  const resolved = await aiBot.resolveLlmBootConfig({
    settingsService,
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.equal(resolved, null);
  const warnText = warnings.map(w => String(w.at(-1) ?? '')).join(' ');
  assert.match(warnText, /reingres/i);
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
  assert.ok(capturedSystemPrompt.startsWith('Master: Ana [Knowledge context:\nRELEVANT KNOWLEDGE CHUNKS:\nRefund policy is 30 days.]'));
  assert.match(capturedSystemPrompt, /WEB RESPONSE STYLE POLICY \(always follow\)/);
  assert.match(capturedSystemPrompt, /professional, direct web-support tone/);
  assert.match(capturedSystemPrompt, /Do not repeat greetings.*decorative emoji.*filler farewells/);
  assert.match(capturedSystemPrompt, /Preserve all facts and constraints.*RAG context/);
  assert.ok(!capturedSystemPrompt.includes('\n\nKnowledge context:'));
});

test('configured provider overrides knowledge-base mode and answers with SQLite RAG context', async () => {
  let retrievedQuery = null;
  let capturedSystemPrompt = null;
  const legacyAnswer = 'Legacy JSON answer must not be used';

  aiBot.configure({
    mode: 'knowledge-base',
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    model: 'deepseek-chat',
    ragService: {
      async retrieve(query) {
        retrievedQuery = query;
        return [{ text: 'AI Workspace Manager orchestrates isolated AI workspaces from its GitHub README.' }];
      },
    },
    masterPromptService: {
      async getFormattedPrompt({ rag_context }) {
        return `Use only this knowledge:\n${rag_context}`;
      },
    },
    llmService: {
      async chat(options) {
        capturedSystemPrompt = options.systemPrompt;
        return { ok: true, text: 'Respuesta basada en el README recuperado.' };
      },
    },
  });
  aiBot.kb = {
    entries: [{ id: 'legacy', language: 'es', keywords: ['workspace'], answer: legacyAnswer }],
  };

  const result = await aiBot.getReply({ messages: [], lang: 'es' }, '¿Qué hace AI Workspace Manager?');

  assert.equal(retrievedQuery, '¿Qué hace AI Workspace Manager?');
  assert.match(capturedSystemPrompt, /orchestrates isolated AI workspaces/);
  assert.equal(result.reply, 'Respuesta basada en el README recuperado.');
  assert.notEqual(result.reply, legacyAnswer);
});

test('configured provider failure never falls back to legacy JSON answers', async () => {
  aiBot.configure({
    mode: 'knowledge-base',
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    ragService: { async retrieve() { return []; } },
    llmService: { async chat() { return { ok: false, error: 'provider unavailable' }; } },
  });
  aiBot.kb = {
    entries: [{ id: 'legacy', language: 'es', keywords: ['workspace'], answer: 'Legacy JSON answer' }],
  };

  const result = await aiBot.getReply({ messages: [], lang: 'es' }, 'workspace');
  assert.deepEqual(result, { reply: null, confidence: 0, escalate: true });
});

test('inventory query returns the deterministic six-project catalog despite stale history', async () => {
  let llmCalled = false;
  const documents = [
    ['AI Workspace Manager', 'https://github.com/example/AI-Workspace-Manager'],
    ['WSL Manager Pro', 'https://github.com/example/WSL-Manager-Pro'],
    ['LiveChat Pro', 'https://github.com/example/LiveChat-Pro'],
    ['Photo Dedup', 'https://github.com/example/photo-dedup'],
    ['Normalizador Audio', 'https://github.com/example/normalizador-audio'],
    ['YouTube Downloader', 'https://github.com/example/youtube-downloader'],
    ['LiveChat duplicate', 'https://github.com/example/livechat-pro.git/'],
  ].map(([title, source]) => ({ title, source, source_type: 'url' }));
  documents.push(
    { title: 'Manual PDF', source: 'manual.pdf', source_type: 'pdf' },
    { title: 'Manual text', source: 'Texto manual', source_type: 'text' },
    { title: 'External website', source: 'https://example.com/project', source_type: 'url' },
  );
  aiBot.configure({
    mode: 'knowledge-base',
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    ragService: {
      async listDocuments() { return documents; },
      async retrieve() { return [{ text: 'AI Workspace details' }, { text: 'LiveChat details' }]; },
    },
    llmService: { async chat() { llmCalled = true; return { ok: true, text: 'Tengo información de 2 proyectos.' }; } },
  });
  const session = {
    messages: [
      { from: 'user', text: '¿Cuántos proyectos conoces?' },
      { from: 'bot', text: 'Solo tengo información de 2 proyectos.' },
    ],
  };

  const result = await aiBot.getReply(session, '¿Cuántos proyectos tienes información?');
  assert.equal(result.source, 'rag-catalog');
  assert.equal(result.confidence, 1);
  assert.equal(result.escalate, false);
  assert.match(result.reply, /información de 6 proyectos/);
  for (const document of documents.slice(0, 6)) assert.match(result.reply, new RegExp(document.title));
  assert.doesNotMatch(result.reply, /Manual PDF|Manual text|External website/);
  assert.equal(llmCalled, false);
});

test('singular project information query continues to the configured LLM', async () => {
  let llmCalled = false;
  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    ragService: {
      async listDocuments() { return [{ title: 'LiveChat Pro', source: 'https://github.com/example/livechat-pro', source_type: 'url' }]; },
      async retrieve() { return [{ text: 'LiveChat details' }]; },
    },
    llmService: { async chat() { llmCalled = true; return { ok: true, text: 'LiveChat information' }; } },
  });

  const result = await aiBot.getReply({ messages: [], lang: 'es' }, 'Dame información del proyecto LiveChat Pro');
  assert.equal(result.reply, 'LiveChat information');
  assert.equal(llmCalled, true);
});

test('inventory query with no RAG documents continues to the configured LLM', async () => {
  let llmCalled = false;
  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    ragService: { async listDocuments() { return []; }, async retrieve() { return []; } },
    llmService: { async chat() { llmCalled = true; return { ok: true, text: 'No catalog available' }; } },
  });

  const result = await aiBot.getReply({ messages: [], lang: 'es' }, '¿Cuántos proyectos conoces?');
  assert.equal(result.reply, 'No catalog available');
  assert.equal(llmCalled, true);
});

test('authoritative catalog remains available when relevant chunk retrieval fails', async () => {
  let captured = null;
  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    ragService: {
      async listDocuments() { return [{ title: 'Only Project', source: 'https://github.com/example/only', source_type: 'url' }]; },
      async retrieve() { throw new Error('retrieval unavailable'); },
    },
    masterPromptService: { async getFormattedPrompt(vars) { captured = vars.rag_context; return captured; } },
    llmService: { async chat() { return { ok: true, text: 'Catalog answer' }; } },
    logger: { error() {} },
  });

  await aiBot.getReply({ messages: [] }, 'project details');
  assert.match(captured, /AUTHORITATIVE KNOWLEDGE CATALOG \(count=1\)/);
  assert.match(captured, /Only Project/);
  assert.doesNotMatch(captured, /RELEVANT KNOWLEDGE CHUNKS/);
});

test('LLM context separates six GitHub projects from additional knowledge documents', async () => {
  let captured = null;
  const documents = Array.from({ length: 6 }, (_, index) => ({
    title: `Project ${index + 1}`,
    source: `https://github.com/example/project-${index + 1}`,
    source_type: 'url',
  })).concat([
    { title: 'Operations PDF', source: 'operations.pdf', source_type: 'pdf' },
    { title: 'Manual notes', source: 'Texto manual', source_type: 'text' },
    { title: 'Company website', source: 'https://example.com', source_type: 'url' },
  ]);
  aiBot.configure({
    enabled: true,
    provider: 'deepseek',
    apiKey: 'persisted-key',
    ragService: { async listDocuments() { return documents; }, async retrieve() { return []; } },
    masterPromptService: { async getFormattedPrompt(vars) { captured = vars.rag_context; return captured; } },
    llmService: { async chat() { return { ok: true, text: 'Context answer' }; } },
  });

  await aiBot.getReply({ messages: [], lang: 'es' }, 'Resume el conocimiento disponible');
  const projectSection = captured.match(/AUTHORITATIVE KNOWLEDGE CATALOG \(count=6\):([\s\S]*?)\n\nAdditional knowledge documents:/)?.[1];
  assert.ok(projectSection);
  assert.doesNotMatch(projectSection, /Operations PDF|Manual notes|Company website/);
  assert.match(captured, /Additional knowledge documents:[\s\S]*Operations PDF[\s\S]*Manual notes[\s\S]*Company website/);
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
