'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasterPromptService, DEFAULT_MASTER_PROMPT, getFixedEntries } = require('../src/services/master-prompt');

test('Master Prompt Service — Default Fallback & Persistence', async (t) => {
  const dummySettings = {
    store: {},
    async get(key, fallback = null) {
      return this.store[key] !== undefined ? this.store[key] : fallback;
    },
    async set(key, val) {
      this.store[key] = String(val);
    },
  };

  const service = createMasterPromptService({ settingsService: dummySettings });

  await t.test('returns DEFAULT_MASTER_PROMPT on fresh install when setting is unset', async () => {
    const prompt = await service.getPrompt();
    assert.equal(prompt, DEFAULT_MASTER_PROMPT);
    assert.ok(prompt.includes('{visitor_name}'), 'Default prompt should contain variable placeholders');
    assert.ok(prompt.includes('{site_title}'));
  });

  await t.test('allows updating system prompt and retrieving updated prompt', async () => {
    const customPrompt = 'Custom system prompt for testing {visitor_name}';
    await service.setPrompt(customPrompt);

    const retrieved = await service.getPrompt();
    assert.equal(retrieved, customPrompt);
  });

  await t.test('falls back to default if prompt is set to empty or whitespace', async () => {
    await service.setPrompt('   ');
    const retrieved = await service.getPrompt();
    assert.equal(retrieved, DEFAULT_MASTER_PROMPT);
  });
});

test('Master Prompt Service — Variable Substitution', async (t) => {
  const dummySettings = {
    store: {},
    async get(key, fallback = null) {
      return this.store[key] !== undefined ? this.store[key] : fallback;
    },
    async set(key, val) {
      this.store[key] = String(val);
    },
  };

  const service = createMasterPromptService({ settingsService: dummySettings });

  await t.test('substitutes {visitor_name}, {site_title}, {current_language}, and {rag_context}', async () => {
    const template = 'Hello {visitor_name} on {site_title} in {current_language}. Context: {rag_context}';
    const formatted = service.formatPrompt(template, {
      visitor_name: 'Alice',
      site_title: 'My Store',
      current_language: 'es',
      rag_context: 'RAG information here',
    });

    assert.equal(formatted, 'Hello Alice on My Store in es. Context: RAG information here');
  });

  await t.test('uses sensible defaults for missing variables in template substitution', async () => {
    const template = 'Visitor: "{visitor_name}", Site: "{site_title}", Lang: "{current_language}", RAG: "{rag_context}"';
    const formatted = service.formatPrompt(template, {});

    assert.equal(formatted, 'Visitor: "Visitor", Site: "LiveChat Pro", Lang: "es", RAG: ""');
  });
});

test('Master Prompt Service — Ported Identity Answers (6 Languages)', async (t) => {
  const supportedLangs = ['es', 'en', 'pt', 'fr', 'de', 'it'];

  for (const lang of supportedLangs) {
    await t.test(`provides fixed identity entries for '${lang}' with no kb-trainer dependency`, () => {
      const entries = getFixedEntries(lang);
      assert.ok(Array.isArray(entries), `Entries for ${lang} should be an array`);
      assert.ok(entries.length > 0, `Entries for ${lang} should not be empty`);

      const identityEntry = entries.find((e) => e.id === 'lcp-bot-identidad' || e.id === 'lcp-bot-identity' || e.id === 'lcp-bot-identidade');
      assert.ok(identityEntry, `Missing identity entry for ${lang}`);
      assert.ok(identityEntry.answer.includes('LiveChat Pro'), `Identity answer in ${lang} should mention LiveChat Pro`);
    });
  }
});
