'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  llmService,
  DEFAULT_BASE_URLS,
  SUPPORTED_PROVIDERS,
  PROVIDER_MODELS,
} = require('../src/services/llm/index.js');

test('LLM Adapters — Registry and provider validation', async (t) => {
  await t.test('lists all 6 supported providers', () => {
    assert.deepEqual(SUPPORTED_PROVIDERS, ['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen']);
  });

  await t.test('exports PROVIDER_MODELS catalog and getProviderModels', () => {
    assert.ok(PROVIDER_MODELS);
    assert.deepEqual(llmService.getProviderModels('openai'), ['gpt-4o', 'gpt-4o-mini', 'o1-mini']);
    assert.deepEqual(llmService.getProviderModels('anthropic'), ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']);
    assert.deepEqual(llmService.getProviderModels('UNKNOWN'), []);
  });

  await t.test('rejects unknown provider in verifyConnection', async () => {
    const result = await llmService.verifyConnection('unknown-provider', 'test-key', 'model-1');
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported provider/i);
  });

  await t.test('rejects unknown provider in chat call', async () => {
    const result = await llmService.chat({
      provider: 'invalid-llm',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported provider/i);
  });
});

test('LLM Adapters — OpenAI-compatible provider requests', async (t) => {
  await t.test('openai provider uses default OpenAI baseURL and Auth header', async () => {
    let capturedUrl = null;
    let capturedOptions = null;

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI response' } }],
        }),
      };
    };

    const res = await llmService.chat({
      provider: 'openai',
      apiKey: 'sk-test-key',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hi' }],
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, 'OpenAI response');
    assert.ok(capturedUrl.startsWith(DEFAULT_BASE_URLS.openai));
    assert.equal(capturedOptions.headers['Authorization'], 'Bearer sk-test-key');
  });

  await t.test('deepseek provider uses DeepSeek baseURL', async () => {
    let capturedUrl = null;

    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'DeepSeek response' } }],
        }),
      };
    };

    const res = await llmService.chat({
      provider: 'deepseek',
      apiKey: 'sk-ds-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Test' }],
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.ok(capturedUrl.startsWith(DEFAULT_BASE_URLS.deepseek));
  });

  await t.test('handles HTTP 401 error gracefully without throwing', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized API key',
    });

    const res = await llmService.chat({
      provider: 'openrouter',
      apiKey: 'invalid-key',
      model: 'auto',
      messages: [{ role: 'user', content: 'Test' }],
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, false);
    assert.match(res.error, /401/);
  });
});

test('LLM Adapters — Anthropic provider requests', async (t) => {
  await t.test('Anthropic request matches protocol verbatim (x-api-key, anthropic-version, system, max_tokens)', async () => {
    let capturedUrl = null;
    let capturedOptions = null;

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ text: 'Anthropic reply' }],
        }),
      };
    };

    const res = await llmService.chat({
      provider: 'anthropic',
      apiKey: 'anthropic-secret-key',
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are helpful assistant',
      messages: [{ role: 'user', content: 'Hello Claude' }],
      maxTokens: 1024,
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, 'Anthropic reply');
    assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(capturedOptions.headers['x-api-key'], 'anthropic-secret-key');
    assert.equal(capturedOptions.headers['anthropic-version'], '2023-06-01');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.model, 'claude-3-5-sonnet-20241022');
    assert.equal(body.system, 'You are helpful assistant');
    assert.equal(body.max_tokens, 1024);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello Claude' }]);
  });
});

test('LLM Adapters — Connection verification helper', async (t) => {
  await t.test('verifyConnection returns ok:true and models list when 1-token test call succeeds', async () => {
    const mockFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      // Confirm max_tokens or minimal token limit used for test call
      assert.ok(body.max_tokens <= 5);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Hi' } }],
        }),
      };
    };

    const result = await llmService.verifyConnection('qwen', 'qwen-key', 'qwen-turbo', { fetchImpl: mockFetch });
    assert.equal(result.ok, true);
    assert.deepEqual(result.models, ['qwen-turbo', 'qwen-plus', 'qwen-max']);
  });

  await t.test('verifyConnection returns ok:false with error on failure', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Invalid key',
    });

    const result = await llmService.verifyConnection('anthropic', 'bad-key', 'claude-3-haiku', { fetchImpl: mockFetch });
    assert.equal(result.ok, false);
    assert.match(result.error, /401/);
  });
});

test('LLM Adapters — Service configure snapshot', async (t) => {
  await t.test('configure() sets frozen active snapshot without throwing', () => {
    llmService.configure({
      defaultProvider: 'anthropic',
      providers: {
        anthropic: { apiKey: 'key-1', model: 'claude-3-haiku' },
      },
    });

    const config = llmService.getConfig();
    assert.equal(config.defaultProvider, 'anthropic');
    assert.ok(Object.isFrozen(config));
  });
});
