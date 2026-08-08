'use strict';

// Pure environment-value helpers shared by config and service modules. This
// module intentionally requires nothing (ADR-4): config/index.js loads dotenv
// at import time, so services import helpers directly from here to avoid
// dragging dotenv.config() into their test processes.

// setup.js writes every .env value JSON-quoted, so env reads may carry literal
// " or ' around the value. Strip both ends and trim; non-strings yield ''.
function stripEnvQuotes(value) {
  return typeof value === 'string' ? value.replace(/^["']|["']$/g, '').trim() : '';
}

// Booleans arrive as strings. Accept true/1/yes and false/0/no after quote
// stripping; empty or unknown values fall back to the caller-provided default
// so a quoted "false" can never invert to enabled (fail-safe).
function parseEnvBoolean(value, fallback) {
  const normalized = stripEnvQuotes(value).toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

// Environment variables represent lists as comma-separated strings or as
// JSON-array encodings (["a","b"]). Each item is quote/whitespace-stripped so
// a whole-list quoted value like "image/jpeg,image/png" cannot leak quotes onto
// the first/last item (the 415 bug). Empty input falls back to the
// caller-provided defaults.
function parseCsv(value, fallback = []) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const items = parsed.map(item => stripEnvQuotes(item)).filter(Boolean);
        return items.length ? items : fallback;
      }
    } catch {
      // Not valid JSON — fall through to comma-separated handling below.
    }
  }

  const parsed = raw
    .split(',')
    .map(item => stripEnvQuotes(item.trim()))
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

// Integers arrive as strings; strip quotes and whitespace before parseInt so
// JSON-quoted numbers ("300") resolve correctly. Non-finite results fall back.
function parseInteger(value, fallback) {
  const sanitized = typeof value === 'string' ? value.replace(/['"]/g, '').trim() : value;
  const parsed = parseInt(sanitized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = { stripEnvQuotes, parseEnvBoolean, parseCsv, parseInteger };
