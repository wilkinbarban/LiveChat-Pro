'use strict';

const { callOpenAiCompatible, DEFAULT_BASE_URLS } = require('./openai-compatible');
const { callAnthropic } = require('./anthropic');

const SUPPORTED_PROVIDERS = Object.freeze(['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen']);

class LlmService {
  constructor() {
    this.config = Object.freeze({
      defaultProvider: null,
      providers: {},
    });
  }

  /**
   * Applies an atomic frozen snapshot update to the service configuration (ADR-6).
   * @param {Object} nextConfig
   */
  configure(nextConfig = {}) {
    this.config = Object.freeze({
      ...this.config,
      ...nextConfig,
      providers: Object.freeze({
        ...(this.config.providers || {}),
        ...(nextConfig.providers || {}),
      }),
    });
    return this.config;
  }

  /**
   * Returns current frozen snapshot of service configuration.
   */
  getConfig() {
    return this.config;
  }

  /**
   * Returns supported provider list.
   */
  getSupportedProviders() {
    return SUPPORTED_PROVIDERS;
  }

  /**
   * Dispatches a chat request to the specified LLM adapter.
   *
   * @param {Object} options
   * @param {string} options.provider - Provider name (openai, anthropic, openrouter, deepseek, kimi, qwen)
   * @param {string} options.apiKey - API Key
   * @param {string} options.model - Model name
   * @param {Array<{role: string, content: string}>} [options.messages] - Conversation messages
   * @param {string} [options.systemPrompt] - System prompt
   * @param {number} [options.maxTokens] - Max tokens to generate
   * @param {string} [options.baseURL] - Custom base URL override
   * @param {Function} [options.fetchImpl] - Optional custom fetch function for testing
   * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
   */
  async chat({
    provider,
    apiKey,
    model,
    messages = [],
    systemPrompt,
    maxTokens,
    baseURL,
    fetchImpl,
  } = {}) {
    const normProvider = String(provider || '').toLowerCase().trim();

    if (!SUPPORTED_PROVIDERS.includes(normProvider)) {
      return { ok: false, error: `Unsupported provider: ${provider}` };
    }

    if (!apiKey) {
      return { ok: false, error: 'API key is required' };
    }

    if (!model) {
      return { ok: false, error: 'Model is required' };
    }

    if (normProvider === 'anthropic') {
      return callAnthropic({
        apiKey,
        model,
        messages,
        systemPrompt,
        maxTokens,
        fetchImpl,
      });
    }

    return callOpenAiCompatible({
      provider: normProvider,
      apiKey,
      model,
      messages,
      systemPrompt,
      maxTokens,
      baseURL,
      fetchImpl,
    });
  }

  /**
   * Performs a 1-token test call to verify API key & model connectivity before saving (spec requirement).
   *
   * @param {string} provider
   * @param {string} apiKey
   * @param {string} model
   * @param {Object} [options]
   * @param {Function} [options.fetchImpl] - Optional custom fetch function
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async verifyConnection(provider, apiKey, model, { fetchImpl } = {}) {
    const normProvider = String(provider || '').toLowerCase().trim();

    if (!SUPPORTED_PROVIDERS.includes(normProvider)) {
      return { ok: false, error: `Unsupported provider: ${provider}` };
    }

    const testRes = await this.chat({
      provider: normProvider,
      apiKey,
      model,
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 1,
      fetchImpl,
    });

    if (testRes.ok) {
      return { ok: true };
    }

    return { ok: false, error: testRes.error || 'Connection verification failed' };
  }
}

const llmService = new LlmService();

module.exports = {
  llmService,
  LlmService,
  SUPPORTED_PROVIDERS,
  DEFAULT_BASE_URLS,
};
