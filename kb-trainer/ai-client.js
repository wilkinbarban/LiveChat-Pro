'use strict';

/**
 * ai-client.js — Multi-provider AI adapter for kb-trainer
 *
 * Supported providers:
 *   openrouter   → https://openrouter.ai          (free models available)
 *   openai       → https://api.openai.com          (GPT models)
 *   xai          → https://api.x.ai               (Grok models)
 *   groq         → https://api.groq.com            (ultra-fast, free tier)
 *   anthropic    → https://api.anthropic.com       (Claude models)
 *   gemini       → https://generativelanguage.googleapis.com (Google Gemini)
 *   mistral      → https://api.mistral.ai          (Mistral models)
 *   cohere       → https://api.cohere.com          (Command models)
 *   ollama       → http://localhost:11434          (local models, no key needed)
 *   custom       → any OpenAI-compatible endpoint  (self-hosted, LM Studio, etc.)
 */

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    freeModels: [
      'meta-llama/llama-3.1-8b-instruct:free',
      'google/gemma-3-12b-it:free',
      'mistralai/mistral-7b-instruct:free',
      'microsoft/phi-3-mini-128k-instruct:free',
      'qwen/qwen-2-7b-instruct:free',
    ],
    protocol: 'openai',
    extraHeaders: { 'HTTP-Referer': 'LiveChat Pro', 'X-Title': 'LiveChat Pro KB Trainer' },
  },
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    freeModels: [],
    protocol: 'openai',
  },
  xai: {
    name: 'xAI (Grok)',
    url: 'https://api.x.ai/v1/chat/completions',
    defaultModel: 'grok-beta',
    freeModels: [],
    protocol: 'openai',
  },
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.1-8b-instant',
    freeModels: [
      'llama-3.1-8b-instant',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    protocol: 'openai',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-haiku-20240307',
    freeModels: [],
    protocol: 'anthropic',
  },
  gemini: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    defaultModel: 'gemini-1.5-flash',
    freeModels: ['gemini-1.5-flash', 'gemini-1.0-pro'],
    protocol: 'gemini',
  },
  mistral: {
    name: 'Mistral AI',
    url: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    freeModels: [],
    protocol: 'openai',
  },
  cohere: {
    name: 'Cohere',
    url: 'https://api.cohere.com/v2/chat',
    defaultModel: 'command-r',
    freeModels: ['command-r'],
    protocol: 'cohere',
  },
  ollama: {
    name: 'Ollama (local)',
    url: 'http://localhost:11434/api/chat',
    defaultModel: 'llama3',
    freeModels: ['llama3', 'llama3.1', 'mistral', 'gemma2', 'deepseek-r1', 'qwen2'],
    protocol: 'ollama',
    noKeyRequired: true,
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    url: null, // set via --base-url
    defaultModel: 'local-model',
    freeModels: [],
    protocol: 'openai',
    noKeyRequired: true,
  },
};

const SYSTEM_PROMPT = `Eres un experto en crear bases de conocimiento para bots de soporte empresarial. 
Dado el siguiente contenido de documentación, extrae y genera entradas de knowledge base en formato JSON.
Cada entrada debe tener:
- id: string único basado en el contenido (sin espacios, máx 40 chars)
- category: categoría temática
- question: pregunta natural como la haría un humano
- answer: respuesta clara y concisa (máx 400 chars)
- keywords: array de palabras clave y variaciones incluyendo jerga y errores comunes
- source: URL o archivo fuente

Genera múltiples preguntas por tema (diferentes formas de preguntar lo mismo).
Incluye variaciones informales, jerga, preguntas con errores ortográficos.
Responde SOLO con JSON válido, sin texto adicional.
Formato: { "entries": [...] }`;

const CATEGORIES = [
  'Información general del negocio (qué es, quién lo creó, historia, misión, valores)',
  'Horarios y disponibilidad (cuándo atienden, horarios, fines de semana)',
  'Contacto y atención (WhatsApp, Telegram, email, soporte, cómo hablar con humano)',
  'Productos y servicios (qué ofrecen, planes, personalización, integraciones)',
  'Tecnología y desarrollo (stack, lenguajes, Docker, IA, modelos, requisitos)',
  'Precios y pagos (costos, planes, métodos de pago, reembolsos)',
  'Soporte técnico y problemas (errores, logs, reinstalación, actualizaciones)',
  'Seguridad y privacidad (cifrado, GDPR/LGPD, datos, backups)',
  'Instalación y configuración (guía paso a paso, Docker, VPS, conectar APIs)',
  'Preguntas humanas naturales (jerga, errores ortográficos, preguntas incompletas)',
  'Documentación (dónde están los docs, FAQs, tutoriales, arquitectura)',
  'Comercial y negocio (beneficios, ROI, casos de uso, testimonios)',
  'IA y entrenamiento (cómo aprende, PDFs, embeddings, reentrenamiento)',
  'Variaciones humanas (múltiples formas de preguntar lo mismo)',
  'Información personalizada del proyecto (nombre, dueño, stack, URLs, APIs, licencias)',
];

function extractJson(text) {
  const raw = String(text || '').trim()
    .replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch (_) {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('La IA no devolvió JSON válido. Intenta con --provider none o un modelo distinto.');
}

function buildUserPrompt(content, source, lang) {
  return `Idioma objetivo para preguntas/keywords: ${lang}
Fuente: ${source}

Cubre TODAS estas categorías cuando el contenido lo permita:
${CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Contenido:
${String(content).slice(0, 24000)}`;
}

// ── OpenAI-compatible (openrouter, openai, xai, groq, mistral, custom) ─────────
async function callOpenAIProtocol({ url, key, model, extraHeaders = {}, content, source, lang }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    ...extraHeaders,
  };
  const res = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(content, source, lang) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content || '');
}

// ── Anthropic ───────────────────────────────────────────────────────────────────
async function callAnthropic({ key, model, content, source, lang }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model, max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(content, source, lang) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.content?.[0]?.text || '');
}

// ── Google Gemini ───────────────────────────────────────────────────────────────
async function callGemini({ key, model, content, source, lang }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(content, source, lang) }],
      }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

// ── Cohere ──────────────────────────────────────────────────────────────────────
async function callCohere({ key, model, content, source, lang }) {
  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(content, source, lang) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Cohere HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.message?.content?.[0]?.text || data.text || '');
}

// ── Ollama ──────────────────────────────────────────────────────────────────────
async function callOllama({ baseUrl = 'http://localhost:11434', model, content, source, lang }) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false,
      options: { temperature: 0.3 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(content, source, lang) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJson(data.message?.content || data.response || '');
}

// ── Main dispatcher ─────────────────────────────────────────────────────────────
async function callAI({ provider, key, model, baseUrl, content, source, lang = 'es' }) {
  const def = PROVIDERS[provider];
  if (!def) {
    throw new Error(
      `Proveedor desconocido: "${provider}"\nProveedores disponibles: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  if (!def.noKeyRequired && !key) throw new Error(`${def.name} requiere --key`);

  const chosenModel = model || def.defaultModel;

  switch (def.protocol) {
    case 'openai': {
      let url = def.url;
      if (provider === 'custom') {
        if (!baseUrl) throw new Error('--provider custom requiere --base-url <url>');
        url = baseUrl.replace(/\/$/, '') + '/chat/completions';
      }
      return callOpenAIProtocol({ url, key: key || '', model: chosenModel, extraHeaders: def.extraHeaders, content, source, lang });
    }
    case 'anthropic':
      return callAnthropic({ key, model: chosenModel, content, source, lang });
    case 'gemini':
      return callGemini({ key, model: chosenModel, content, source, lang });
    case 'cohere':
      return callCohere({ key, model: chosenModel, content, source, lang });
    case 'ollama':
      return callOllama({ baseUrl: baseUrl || def.url.replace('/api/chat', ''), model: chosenModel, content, source, lang });
    default:
      throw new Error(`Protocolo desconocido: ${def.protocol}`);
  }
}

module.exports = { callAI, PROVIDERS, SYSTEM_PROMPT, CATEGORIES };
