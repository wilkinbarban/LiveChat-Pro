const { shortHash } = require('./validator');

const STOPWORDS = new Set('a al algo algunas algunos ante antes como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos fue ha hay la las le les lo los mas más me mi mis muy no o para pero por que qué se ser si sin sobre su sus te tu tus un una unas uno unos y ya the and for with from this that are was were have has you your'.split(/\s+/));

function cleanText(text) {
  return String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function titleFromSource(source) {
  return String(source || 'general').split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'general';
}

function splitSections(content, source) {
  const text = cleanText(content);
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...text.matchAll(headingRegex)];
  if (matches.length) {
    return matches.map((m, i) => {
      const start = m.index + m[0].length;
      const end = matches[i + 1] ? matches[i + 1].index : text.length;
      return { title: m[2].trim(), body: cleanText(text.slice(start, end)) };
    }).filter(s => s.body.length > 20);
  }
  const blocks = text.split(/\n\s*\n/).map(cleanText).filter(b => b.length > 40);
  if (blocks.length) return blocks.map((body, i) => ({ title: i === 0 ? titleFromSource(source) : `${titleFromSource(source)} ${i + 1}`, body }));
  const chunks = [];
  for (let i = 0; i < text.length; i += 700) chunks.push({ title: `${titleFromSource(source)} ${chunks.length + 1}`, body: cleanText(text.slice(i, i + 700)) });
  return chunks.filter(s => s.body);
}

function extractKeywords(text, lang = 'es') {
  const words = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9áéíóúñçãõ]+/gi) || [];
  const counts = new Map();
  for (const word of words) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

function inferCategory(title, body) {
  const t = `${title} ${body}`.toLowerCase();
  if (/precio|cost|pago|plan|refund|reembolso|billing/.test(t)) return 'precios y pagos';
  if (/instal|config|docker|vps|setup|deploy/.test(t)) return 'instalación y configuración';
  if (/seguridad|privacidad|gdpr|lgpd|cifrado|backup/.test(t)) return 'seguridad y privacidad';
  if (/contact|whatsapp|telegram|email|soporte|humano/.test(t)) return 'contacto y atención';
  if (/error|log|problema|actualiz|reinstal/.test(t)) return 'soporte técnico';
  if (/api|stack|node|sqlite|ia|modelo|openai|ollama/.test(t)) return 'tecnología y desarrollo';
  if (/servicio|producto|integraci|personaliz/.test(t)) return 'productos y servicios';
  if (/horario|disponib|weekend|fin de semana/.test(t)) return 'horarios y disponibilidad';
  return 'general';
}

function truncate(text, max = 500) {
  const clean = cleanText(text).replace(/\n+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const last = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(' '));
  return `${cut.slice(0, last > 250 ? last : max).trim()}…`;
}

function parseWithoutAI(items, lang = 'es') {
  const entries = [];
  for (const item of items) {
    for (const section of splitSections(item.content, item.source)) {
      const answer = truncate(section.body, 500);
      const keywords = extractKeywords(`${section.title} ${section.body}`, lang);
      if (!answer || !keywords.length) continue;
      entries.push({
        id: shortHash(`${item.source}|${section.title}|${answer}`),
        keywords,
        question: `¿Qué es ${section.title}?`,
        answer,
        source: item.source,
        category: inferCategory(section.title, section.body),
      });
    }
  }
  return entries;
}

module.exports = { parseWithoutAI, splitSections, extractKeywords, inferCategory };
