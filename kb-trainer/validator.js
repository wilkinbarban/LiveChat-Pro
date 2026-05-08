const crypto = require('crypto');
const { getFixedEntries, FIXED_ID_PREFIX } = require('./fixed-entries');

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

/**
 * mergeKnowledgeBase
 *
 * Combina entradas existentes con nuevas, anteponiendo siempre las entradas
 * fijas de autoconocimiento del bot (prefijo 'lcp-bot-') al inicio del JSON.
 *
 * Reglas de las entradas fijas:
 * - Siempre al principio del array entries.
 * - No son sobreescritas ni reemplazadas por el entrenamiento normal.
 * - Se generan en el idioma activo del entrenamiento (language).
 * - El entrenamiento normal no puede duplicar ni modificar IDs con prefijo lcp-bot-.
 */
function mergeKnowledgeBase(existing, newEntries, { mode = 'append', language = 'es' } = {}) {
  const base = mode === 'replace' ? {} : (existing && typeof existing === 'object' ? existing : {});

  // Entradas fijas en el idioma correcto (siempre al inicio, protegidas)
  const fixedEntries = validateEntries(getFixedEntries(language), { warn: () => {} });
  const fixedIds = new Set(fixedEntries.map(e => e.id));

  // Entradas actuales (modo append), filtrando cualquier entrada fija previa
  // para evitar duplicados y garantizar que solo existe la versión canónica
  const currentRaw = mode === 'append' ? validateEntries(base.entries || [], { warn: () => {} }) : [];
  const current = currentRaw.filter(e => !fixedIds.has(e.id));

  // Entradas nuevas del entrenamiento, sin permitir que sobreescriban entradas fijas
  const incomingFiltered = (Array.isArray(newEntries) ? newEntries : []).filter(
    e => !String(e.id || '').startsWith(FIXED_ID_PREFIX)
  );

  // Orden final: fijas + entrenamiento normal (sin duplicados de ID)
  const merged = validateEntries([...fixedEntries, ...current, ...incomingFiltered]);

  return {
    version: base.version || '2.0',
    language: base.language || language,
    fallback: base.fallback || 'No tengo una respuesta específica para eso. ¿Quieres hablar con una persona?',
    entries: merged,
  };
}

module.exports = { shortHash, validateEntries, mergeKnowledgeBase };
