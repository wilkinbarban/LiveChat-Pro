'use strict';

const Sentiment = require('sentiment');
const dictionaries = require('./dictionaries.json');

const sentiment = new Sentiment();
const SUPPORTED_LANGS = new Set(Object.keys(dictionaries));

// Sentiment dictionaries are keyed by base language. Region variants reuse the
// same local vocabulary.
function normalizeLang(lang) {
  const baseLang = typeof lang === 'string' ? lang.toLowerCase().split('-')[0] : '';
  return SUPPORTED_LANGS.has(baseLang) ? baseLang : '';
}

// Match complete words with Unicode-aware boundaries so short dictionary terms
// do not accidentally match inside unrelated words.
function includesWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

function countMatches(text, words = []) {
  return words.reduce((count, word) => count + (includesWord(text, word) ? 1 : 0), 0);
}

// Lightweight language guess based on the same dictionaries used for priority
// detection. This is a fallback, not a general-purpose detector.
function detectLanguage(text = '') {
  const lower = String(text).toLowerCase();
  const scores = Object.entries(dictionaries).map(([lang, dict]) => {
    const score =
      countMatches(lower, dict.offensive) * 4 +
      countMatches(lower, dict.negative) * 2 +
      countMatches(lower, dict.hints);
    return { lang, score };
  }).sort((a, b) => b.score - a.score);

  return scores[0]?.score > 0 ? scores[0].lang : 'es';
}

// Combines the generic sentiment package with curated multilingual dictionaries.
// Offensive content is flagged separately from high-priority negative feedback.
function analyzeSentiment(text, lang = '') {
  const safeText = typeof text === 'string' ? text : '';
  const resolvedLang = normalizeLang(lang) || detectLanguage(safeText);
  const dictionary = dictionaries[resolvedLang] || dictionaries.es;
  const result = sentiment.analyze(safeText);
  const lower = safeText.toLowerCase();
  const offensiveMatches = countMatches(lower, dictionary.offensive);
  const negativeMatches = countMatches(lower, dictionary.negative);
  const dictionaryScore = (offensiveMatches * -4) + (negativeMatches * -2);
  const score = result.score + dictionaryScore;
  const isOffensive = offensiveMatches > 0;
  const isNegative = score < -3;

  return {
    score,
    lang: resolvedLang,
    isOffensive,
    isHighPriority: isNegative && !isOffensive,
  };
}

module.exports = {
  analyzeSentiment,
  detectLanguage,
};
