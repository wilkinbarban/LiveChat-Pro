'use strict';

/**
 * Executes a message completion call against the Anthropic Messages API.
 * Ported from kb-trainer/ai-client.js (~L183–200) per ADR-2.
 *
 * @param {Object} params
 * @param {string} params.apiKey - Anthropic API key (x-api-key header)
 * @param {string} params.model - Model identifier (e.g. claude-3-5-sonnet-20241022)
 * @param {Array<{role: string, content: string}>} params.messages - Conversation messages
 * @param {string} [params.systemPrompt] - Top-level system prompt
 * @param {number} [params.maxTokens] - Max tokens to generate (mandatory in Anthropic API)
 * @param {Function} [params.fetchImpl] - Optional custom fetch implementation
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
async function callAnthropic({
  apiKey,
  model,
  messages = [],
  systemPrompt,
  maxTokens = 1024,
  fetchImpl,
}) {
  try {
    const fetchFn = fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      return { ok: false, error: 'Fetch implementation unavailable' };
    }

    const endpoint = 'https://api.anthropic.com/v1/messages';

    // Extract system prompt from messages if not provided explicitly
    let resolvedSystem = systemPrompt || '';
    const userAssistantMessages = [];

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      if (msg.role === 'system') {
        if (!resolvedSystem) resolvedSystem = String(msg.content);
      } else {
        userAssistantMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: String(msg.content || ''),
        });
      }
    }

    // Anthropic requires at least one message
    if (!userAssistantMessages.length) {
      userAssistantMessages.push({ role: 'user', content: 'Hello' });
    }

    const bodyObj = {
      model,
      max_tokens: Number(maxTokens) || 1024,
      messages: userAssistantMessages,
    };

    if (resolvedSystem) {
      bodyObj.system = resolvedSystem;
    }

    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(bodyObj),
    });

    if (!res.ok) {
      const errText = typeof res.text === 'function' ? await res.text() : '';
      return { ok: false, error: `Anthropic HTTP ${res.status}: ${errText || res.statusText || 'Request failed'}` };
    }

    const data = typeof res.json === 'function' ? await res.json() : {};
    const replyText = data.content?.[0]?.text?.trim();

    return { ok: true, text: replyText || '' };
  } catch (err) {
    return { ok: false, error: err?.message || 'Anthropic request failed' };
  }
}

module.exports = {
  callAnthropic,
};
