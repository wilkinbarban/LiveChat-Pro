const crypto = require('crypto');

function shortHash(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 12);
}

function normalizeEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const question = String(entry.question || '').trim();
  let answer = String(entry.answer || '').replace(/\s+/g, ' ').trim();
  let keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
  keywords = [...new Set(keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean))];
  if (!answer || answer.length > 1000 || !question || keywords.length < 1) return null;
  const id = String(entry.id || shortHash(`${question}|${answer}|${index}`)).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  const normalized = {
    id,
    keywords,
    question,
    answer,
    source: String(entry.source || '').trim(),
    category: String(entry.category || 'general').trim() || 'general',
  };
  if (entry.confidence !== undefined && !Number.isNaN(Number(entry.confidence))) {
    normalized.confidence = Number(entry.confidence);
  }
  return normalized;
}

function validateEntries(entries, { warn = console.warn } = {}) {
  const seen = new Set();
  const valid = [];
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const normalized = normalizeEntry(entry, index);
    if (!normalized) {
      warn(`⚠ Discarded invalid entry at index ${index}`);
      return;
    }
    if (seen.has(normalized.id)) {
      warn(`⚠ Discarded duplicate entry id: ${normalized.id}`);
      return;
    }
    seen.add(normalized.id);
    valid.push(normalized);
  });
  return valid;
}

function mergeKnowledgeBase(existing, newEntries, { mode = 'append', language = 'es' } = {}) {
  const base = mode === 'replace' ? {} : (existing && typeof existing === 'object' ? existing : {});
  const current = mode === 'append' ? validateEntries(base.entries || [], { warn: () => {} }) : [];
  const merged = validateEntries([...current, ...newEntries]);
  return {
    version: base.version || '2.0',
    language: base.language || language,
    fallback: base.fallback || 'No tengo una respuesta específica para eso. ¿Quieres hablar con una persona?',
    entries: merged,
  };
}

module.exports = { shortHash, validateEntries, mergeKnowledgeBase };
