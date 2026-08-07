'use strict';

// ── Spanish stemmer ──────────────────────────────────────────────────────────
// Strips common verb/noun inflection endings so "instalo", "instala",
// "instalar", "instalas" all reduce to the same root "instal".
function stem(word) {
  if (!word || word.length < 4) return word || '';
  const rules = [
    ['ando', 4], ['iendo', 5],
    ['amos', 4], ['aron', 4], ['aban', 4], ['ados', 4], ['idos', 4],
    ['ado', 3], ['ido', 3],
    ['ar', 2], ['er', 2], ['ir', 2],
    ['as', 2], ['es', 2], ['os', 2], ['an', 2], ['en', 2],
    ['a', 1], ['e', 1], ['o', 1], ['s', 1],
  ];
  for (const [suffix, minRemain] of rules) {
    if (word.length > suffix.length + minRemain && word.endsWith(suffix)) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

// ── Base text normalization ──────────────────────────────────────────────────
// Lowercase, strip accents (NFD decomposition), remove non-alphanumeric chars.
function normalizeStr(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Project name normalization ───────────────────────────────────────────────
// Collapses multi-word / hyphenated project names to a single canonical token.
function expandProjectAliases(text) {
  return String(text || '')
    .replace(/photo[\s-]?dedup/gi, 'photodup')
    .replace(/livechat[\s-]?pro/gi, 'livechat')
    .replace(/live[\s-]?chat/gi, 'livechat')
    .replace(/youtube[\s-]?downloader/gi, 'youtubedownloader');
}

// ── Tokenize without stemming ────────────────────────────────────────────────
function tokenize(text) {
  const normalized = normalizeStr(expandProjectAliases(text));
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

// ── Tokenize + stem ──────────────────────────────────────────────────────────
function tokenizeStem(text) {
  return tokenize(text).map(stem);
}

// ── Dice coefficient calculation ─────────────────────────────────────────────
// Calculates fuzzy Dice coefficient similarity between two sets of tokens or text strings.
// Supports both string arrays and raw string inputs.
function diceCoefficient(inputA, inputB) {
  const tokensA = Array.isArray(inputA) ? inputA : tokenize(inputA);
  const tokensB = Array.isArray(inputB) ? inputB : tokenize(inputB);

  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const stemmedA = tokensA.map(stem);
  const stemmedB = tokensB.map(stem);
  const stemSetA = new Set(stemmedA);
  const stemSetB = new Set(stemmedB);

  const exactHits = tokensA.filter(t => setB.has(t)).length;
  const stemHits = stemmedA.filter(t => stemSetB.has(t)).length;
  const hits = Math.max(exactHits, stemHits);

  return (hits * 2) / (tokensA.length + tokensB.length);
}

module.exports = {
  stem,
  normalizeStr,
  expandProjectAliases,
  tokenize,
  tokenizeStem,
  diceCoefficient,
};
