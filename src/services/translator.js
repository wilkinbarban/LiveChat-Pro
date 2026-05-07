'use strict';

const crypto = require('crypto');
const axios = require('axios');
const NodeCache = require('node-cache');

const SUPPORTED_PROVIDERS = new Set(['google_free', 'google_cloud', 'deepl']);

// Short-lived in-process cache avoids repeatedly translating the same message
// when it appears in admin lists, detail views and Telegram notifications.
const translationCache = new NodeCache({
  stdTTL: 60 * 60,
  checkperiod: 10 * 60,
  useClones: false,
});

// Provider selection is environment-driven so deployments can start with the
// free Google endpoint and later switch to an official paid API without code.
function getProviderConfig() {
  const provider = String(process.env.TRANSLATION_PROVIDER || 'google_free').toLowerCase();
  return {
    provider: SUPPORTED_PROVIDERS.has(provider) ? provider : 'google_free',
    apiKey: process.env.TRANSLATION_API_KEY || '',
  };
}

// Include provider and target language in the hash to avoid cross-provider or
// cross-language cache collisions for identical input text.
function buildTranslationCacheKey(text, targetLang, provider = getProviderConfig().provider) {
  return crypto
    .createHash('sha256')
    .update(`${provider}\0${targetLang}\0${text}`)
    .digest('hex');
}

function clearTranslationCache() {
  translationCache.flushAll();
}

function closeTranslationCache() {
  translationCache.close();
}

async function translateWithGoogleFree(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const { data } = await axios.get(url, { timeout: 1500 });
  return data[0].map(s => s[0]).join('');
}

// DeepL expects form-urlencoded payloads and uppercase target language codes.
async function translateWithDeepL(text, targetLang, apiKey) {
  const endpoint = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';
  const params = new URLSearchParams({
    text,
    target_lang: targetLang.toUpperCase(),
  });
  const { data } = await axios.post(endpoint, params, {
    timeout: 2000,
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  return data?.translations?.[0]?.text || text;
}

async function translateWithGoogleCloud(text, targetLang, apiKey) {
  const { data } = await axios.post(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    { q: text, target: targetLang, format: 'text' },
    { timeout: 2000 }
  );
  return data?.data?.translations?.[0]?.translatedText || text;
}

// Adapter dispatcher. Missing API keys intentionally fall back to google_free so
// translation remains best-effort instead of disabling chat delivery.
async function runTranslationAdapter(text, targetLang, config) {
  if (config.provider === 'deepl' && config.apiKey) return translateWithDeepL(text, targetLang, config.apiKey);
  if (config.provider === 'google_cloud' && config.apiKey) return translateWithGoogleCloud(text, targetLang, config.apiKey);
  return translateWithGoogleFree(text, targetLang);
}

// ── Proper-noun protection ──────────────────────────────────────────────────
// Project names, person names, and place names that must never be translated.
// Listed longest-first so partial names (e.g. 'LiveChat') don't shadow
// longer ones ('LiveChat Pro') during regex matching.
const PROTECTED_NAMES = [
  // Projects
  'LiveChat Pro',
  'LiveChat',
  'YouTube Downloader',
  'PhotoDedup',
  'Photo Dedup',
  'Normalizador Audio',
  'Normalizador',
  // Person
  'Wilkin Barbán',
  'Wilkin Barban',
  'Wilkin',
  // Places
  'Curitiba',
  'Brasil',
  'Brazil',
  'Cuba',
  // Brands / tools referenced in KB answers
  'GitHub',
  'Docker',
  'Telegram',
  'OpenAI',
  'FFmpeg',
  'PyQt6',
  'SQLite',
  'Redis',
  'Wise',
  'GPL-3.0',
  'GPL',
];

// Build a single regex (longest match first to avoid partial overlaps).
const PROTECTED_SORTED = [...PROTECTED_NAMES].sort((a, b) => b.length - a.length);
const PROTECTED_RE = new RegExp(
  PROTECTED_SORTED.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// Replace protected names with neutral placeholders before sending to the
// translation API; restore canonical casing afterward.
function protectNames(text) {
  const map = [];
  const masked = text.replace(PROTECTED_RE, match => {
    const canonical = PROTECTED_SORTED.find(
      n => n.toLowerCase() === match.toLowerCase()
    ) || match;
    const token = `__NP${map.length}__`;
    map.push(canonical);
    return token;
  });
  return { masked, map };
}

function restoreNames(text, map) {
  return text.replace(/__NP(\d+)__/g, (_, i) => map[Number(i)] ?? _);
}

// Translation is best-effort: any provider failure returns the original text so
// message delivery is never blocked by a third-party outage.
async function translate(text, targetLang, isEnabled = true) {
  if (!isEnabled) return text;

  const safeText = typeof text === 'string' ? text : '';
  const safeTargetLang = typeof targetLang === 'string' ? targetLang.toLowerCase().split('-')[0] : '';
  if (!safeText || !safeTargetLang) return safeText;

  const config = getProviderConfig();
  const cacheKey = buildTranslationCacheKey(safeText, safeTargetLang, config.provider);
  const cached = translationCache.get(cacheKey);
  if (typeof cached === 'string') return cached;

  const { masked, map } = protectNames(safeText);

  async function runWithRestore(fn) {
    const raw = await fn();
    return restoreNames(raw, map);
  }

  try {
    const translated = await runWithRestore(() => runTranslationAdapter(masked, safeTargetLang, config));
    translationCache.set(cacheKey, translated);
    return translated;
  } catch {
    if (config.provider !== 'google_free') {
      try {
        const translated = await runWithRestore(() => translateWithGoogleFree(masked, safeTargetLang));
        translationCache.set(cacheKey, translated);
        return translated;
      } catch {}
    }
    return safeText;
  }
}

async function detectLangWithGoogleFree(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const { data } = await axios.get(url, { timeout: 1500 });
  return data[2] || 'es';
}

async function detectLangWithGoogleCloud(text, apiKey) {
  const { data } = await axios.post(
    `https://translation.googleapis.com/language/translate/v2/detect?key=${encodeURIComponent(apiKey)}`,
    { q: text },
    { timeout: 2000 }
  );
  return data?.data?.detections?.[0]?.[0]?.language || 'es';
}

// Language detection follows the same fail-open rule as translation. Spanish is
// the default because the admin copy and historical defaults are Spanish-first.
async function detectLang(text, isEnabled = true) {
  if (!isEnabled) return 'es';
  try {
    const config = getProviderConfig();
    if (config.provider === 'google_cloud' && config.apiKey) return detectLangWithGoogleCloud(text, config.apiKey);
    return detectLangWithGoogleFree(text);
  } catch {
    return 'es';
  }
}

module.exports = {
  translate,
  detectLang,
  getProviderConfig,
  clearTranslationCache,
  closeTranslationCache,
  translationCache
};
