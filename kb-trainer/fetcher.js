const fs = require('fs');
const path = require('path');

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(h[1-6]|p|li|div|section|article|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectType(source, contentType = '') {
  const ext = path.extname(source.split('?')[0]).toLowerCase();
  if (contentType.includes('html') || ['.html', '.htm'].includes(ext)) return 'html';
  if (ext === '.md') return 'markdown';
  if (ext === '.json') return 'json';
  return 'text';
}

async function fetchSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(source, { signal: controller.signal, headers: { 'User-Agent': 'LiveChat-Pro-KB-Trainer/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const type = detectType(source, res.headers.get('content-type') || '');
      return { source, content: type === 'html' ? stripHtml(raw) : raw.trim(), type };
    } finally {
      clearTimeout(timer);
    }
  }

  const filePath = path.resolve(process.cwd(), source);
  const ext = path.extname(filePath).toLowerCase();
  if (!['.md', '.txt', '.html', '.htm', '.json'].includes(ext)) {
    throw new Error(`Unsupported file type: ${ext || 'unknown'}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const type = detectType(filePath);
  return { source, content: type === 'html' ? stripHtml(raw) : raw.trim(), type };
}

module.exports = { fetchSource, stripHtml };
