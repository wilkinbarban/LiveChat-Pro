'use strict';

const DEFAULT_BASE_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  kimi: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

/**
 * Executes a chat completion call against an OpenAI-compatible endpoint.
 *
 * @param {Object} params
 * @param {string} params.provider - Provider key (openai, openrouter, deepseek, kimi, qwen)
 * @param {string} params.apiKey - Provider API key
 * @param {string} params.model - Model identifier
 * @param {Array<{role: string, content: string}>} params.messages - Conversation messages
 * @param {string} [params.systemPrompt] - System prompt override
 * @param {number} [params.maxTokens] - Max tokens to generate
 * @param {string} [params.baseURL] - Custom base URL override
 * @param {Function} [params.fetchImpl] - Optional custom fetch implementation (for testing)
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
async function callOpenAiCompatible({
  provider,
  apiKey,
  model,
  messages = [],
  systemPrompt,
  maxTokens,
  baseURL,
  fetchImpl,
}) {
  try {
    const fetchFn = fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      return { ok: false, error: 'Fetch implementation unavailable' };
    }

    const resolvedBaseURL = (baseURL || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai).replace(/\/+$/, '');
    const endpoint = `${resolvedBaseURL}/chat/completions`;

    const formattedMessages = [];
    if (systemPrompt && !messages.some(m => m.role === 'system')) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg && typeof msg === 'object' && msg.content) {
        formattedMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
          content: String(msg.content),
        });
      }
    }

    const bodyObj = {
      model,
      messages: formattedMessages,
    };

    if (maxTokens) {
      bodyObj.max_tokens = Number(maxTokens);
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://livechat-pro.local';
      headers['X-Title'] = 'LiveChat Pro';
    }

    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
    });

    if (!res.ok) {
      const errText = typeof res.text === 'function' ? await res.text() : '';
      return { ok: false, error: `HTTP ${res.status}: ${errText || res.statusText || 'Request failed'}` };
    }

    const data = typeof res.json === 'function' ? await res.json() : {};
    const replyText = data.choices?.[0]?.message?.content?.trim();

    return { ok: true, text: replyText || '' };
  } catch (err) {
    return { ok: false, error: err?.message || 'OpenAI-compatible request failed' };
  }
}

/**
 * Lists available models from an OpenAI-compatible provider.
 * Never throws: returns [] on 404/405/network errors or missing fetch.
 *
 * @param {Object} params
 * @param {string} params.provider - Provider key (openai, openrouter, deepseek, kimi, qwen)
 * @param {string} params.apiKey - Provider API key
 * @param {string} [params.baseURL] - Custom base URL override
 * @param {Function} [params.fetchImpl] - Optional custom fetch implementation (for testing)
 * @returns {Promise<string[]>} - Model ids from GET {base}/models
 */
async function listOpenAiCompatibleModels({ provider, apiKey, baseURL, fetchImpl }) {
  try {
    const fetchFn = fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      return [];
    }

    const resolvedBaseURL = (baseURL || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai).replace(/\/+$/, '');
    const endpoint = `${resolvedBaseURL}/models`;

    const res = await fetchFn(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      return [];
    }

    const data = typeof res.json === 'function' ? await res.json() : {};
    if (!Array.isArray(data.data)) {
      return [];
    }
    return data.data
      .map((item) => (item && typeof item.id === 'string' ? item.id : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_BASE_URLS,
  callOpenAiCompatible,
  listOpenAiCompatibleModels,
};
