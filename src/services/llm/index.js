'use strict';

const { callOpenAiCompatible, DEFAULT_BASE_URLS } = require('./openai-compatible');
const { callAnthropic } = require('./anthropic');

const SUPPORTED_PROVIDERS = Object.freeze(['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen']);

const PROVIDER_MODELS = Object.freeze({
  openai: Object.freeze(['gpt-4o', 'gpt-4o-mini', 'o1-mini']),
  anthropic: Object.freeze(['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']),
  openrouter: Object.freeze(['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat']),
  deepseek: Object.freeze(['deepseek-chat', 'deepseek-coder']),
  kimi: Object.freeze(['moonshot-v1-8k', 'moonshot-v1-32k']),
  qwen: Object.freeze(['qwen-turbo', 'qwen-plus', 'qwen-max']),
});

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
   * Returns supported model list for a given provider.
   * @param {string} provider
   * @returns {string[]}
   */
  getProviderModels(provider) {
    const normProvider = String(provider || '').toLowerCase().trim();
    return Array.from(PROVIDER_MODELS[normProvider] || []);
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
      return { ok: true, models: this.getProviderModels(normProvider) };
    }

    return { ok: false, error: testRes.error || 'Connection verification failed' };
  }
}

const llmService = new LlmService();

module.exports = {
  llmService,
  LlmService,
  SUPPORTED_PROVIDERS,
  PROVIDER_MODELS,
  DEFAULT_BASE_URLS,
};
