'use strict';

const MAX_MSG_LEN  = 2000;
const MAX_NAME_LEN = 100;
const MAX_PAGE_LEN = 500;
const MAX_LANG_LEN = 8;

// Widget UI supports a curated locale set. Unknown locales fall back to Spanish,
// matching the project defaults.
function normalizeWidgetLang(lang) {
  const baseLang = typeof lang === 'string' ? lang.toLowerCase().split('-')[0] : '';
  return ['es', 'en', 'pt', 'fr', 'de'].includes(baseLang) ? baseLang : 'es';
}

// Shared text sanitizer for visitor/admin input. It removes control characters
// that can break terminals, logs, Telegram HTML or JSON consumers.
function sanitizeText(val) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_MSG_LEN);
}

// Names are short single-line display values, not arbitrary message bodies.
function sanitizeName(val) {
  return sanitizeText(val)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, MAX_NAME_LEN);
}

// Only path/query/hash are stored for page context, even when the widget sends a
// full URL. This avoids leaking external origins into admin output.
function sanitizePage(value) {
  if (typeof value !== 'string') return '/';
  const page = value.trim().slice(0, MAX_PAGE_LEN);
  if (!page) return '/';

  try {
    const parsed = new URL(page, 'http://local.invalid');
    if (!['http:', 'https:'].includes(parsed.protocol)) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, MAX_PAGE_LEN) || '/';
  } catch {
    return page.startsWith('/') ? page.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, MAX_PAGE_LEN) : '/';
  }
}

function sanitizeLanguage(value) {
  return normalizeWidgetLang(String(value || '').slice(0, MAX_LANG_LEN));
}

// User agents are shown in the admin panel and Telegram, so they are bounded and
// stripped of control characters.
function sanitizeUserAgent(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 512)
    : '';
}

// HTML escaping for pages rendered by this server.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Telegram HTML supports a restricted tag set; escaping quotes is unnecessary
// for text nodes and would make notifications harder to read.
function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// CSS custom properties must receive a strict color format to prevent style
// injection through environment-configured widget colors.
function safeCssColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value)) ? value : '#4F46E5';
}

module.exports = {
  normalizeWidgetLang,
  sanitizeText,
  sanitizeName,
  sanitizePage,
  sanitizeLanguage,
  sanitizeUserAgent,
  escapeHtml,
  escapeTelegramHtml,
  safeCssColor,
  MAX_MSG_LEN,
  MAX_NAME_LEN,
  MAX_PAGE_LEN,
  MAX_LANG_LEN
};
