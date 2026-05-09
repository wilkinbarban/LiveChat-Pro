'use strict';

const fs = require('fs');
const path = require('path');
const { getFixedEntries } = require('../../kb-trainer/fixed-entries');


const SUPPORTED_LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const FALLBACK_MESSAGES = {
  es: 'No tengo una respuesta específica para eso. He notificado al administrador y te responderá pronto.',
  en: "I don't have a specific answer for that. I've notified the administrator and they'll reply soon.",
  pt: 'Não tenho uma resposta específica para isso. Notifiquei o administrador e ele responderá em breve.',
  fr: "Je n'ai pas de réponse spécifique à cela. J'ai notifié l'administrateur qui vous répondra bientôt.",
  de: 'Ich habe keine spezifische Antwort darauf. Ich habe den Administrator benachrichtigt, der Ihnen bald antworten wird.',
  it: "Non ho una risposta specifica per questo. Ho notificato l'amministratore che risponderà presto.",
};

const LANGUAGE_HINTS = {
  es: ['que', 'como', 'donde', 'quien', 'instalar', 'requisitos', 'funciones', 'proyecto', 'ayuda', 'hola'],
  en: ['what', 'how', 'where', 'who', 'install', 'requirements', 'features', 'project', 'help', 'hello'],
  pt: ['que', 'como', 'onde', 'quem', 'instalar', 'requisitos', 'funções', 'projeto', 'ajuda', 'olá', 'voce', 'você'],
  fr: ['quoi', 'comment', 'où', 'qui', 'installer', 'exigences', 'fonctionnalités', 'projet', 'aide', 'bonjour'],
  de: ['was', 'wie', 'wo', 'wer', 'installieren', 'anforderungen', 'funktionen', 'projekt', 'hilfe', 'hallo'],
  it: ['cosa', 'come', 'dove', 'chi', 'installare', 'requisiti', 'funzioni', 'progetto', 'aiuto', 'ciao'],
};

// ── Spanish stemmer ──────────────────────────────────────────────────────────
// Strips common verb/noun inflection endings so "instalo", "instala",
// "instalar", "instalas" all reduce to the same root "instal".
// Applied to both query tokens and keyword tokens for fuzzy matching.
function stem(word) {
  if (word.length < 4) return word;
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

// ── Project name normalization ───────────────────────────────────────────────
// Collapses multi-word / hyphenated project names to a single canonical token
// so "Photo Dedup", "photo-dedup" and "photodup" all match the same keyword.
// NOTE: 'normalizador audio' is intentionally NOT collapsed because "normalizador"
// alone already triggers the project detection and collapsing would eat the word
// "audio" from otherwise valid keyword phrases like "funciones normalizador audio".
function expandProjectAliases(text) {
  return text
    .replace(/photo[\s\-]?dedup/gi, 'photodup')
    .replace(/livechat[\s\-]?pro/gi, 'livechat')
    .replace(/live[\s\-]?chat/gi, 'livechat')
    .replace(/youtube[\s\-]?downloader/gi, 'youtubedownloader');
}

// ── Project detection ────────────────────────────────────────────────────────
// Maps canonical token → internal project key.
const PROJECT_TOKENS = {
  livechat:     ['livechat', 'chatpro'],
  photodup:     ['photodup', 'photodedup'],
  normalizador: ['normalizador'],
  youtube:      ['youtubedownloader', 'ytdownloader', 'ytdlp'],
};

// Word-level project detection: normalizedText is the joined token string.
// 'youtube' as a standalone word (not part of 'youtubelufs' etc.) maps to the
// YouTube Downloader project; it must not match on normalizador-presets context
// but that is handled by the entry-level boost logic.
function detectProject(normalizedText) {
  for (const [project, tokens] of Object.entries(PROJECT_TOKENS)) {
    if (tokens.some(t => normalizedText.includes(t))) return project;
  }
  // Standalone 'youtube' token (space-bounded) → youtube project
  if (/(^|\s)youtube(\s|$)/.test(normalizedText)) return 'youtube';
  return null;
}

// ── Intent detection ─────────────────────────────────────────────────────────
// Detects the user's intent category from stemmed query tokens.
const INTENT_STEMS = {
  install:      ['instal', 'descarg', 'baj', 'setup', 'ejecut', 'inici', 'configur'],
  requirements: ['requisit', 'neces', 'compatibil', 'soporta', 'sistem', 'requerimient'],
  roadmap:      ['roadmap', 'futur', 'proxim', 'version', 'plan', 'milestone', 'prox'],
  features:     ['funcion', 'caracteristic', 'incluy', 'ofrec', 'tien', 'soporta', 'permit'],
  dependencies: ['dependenc', 'librer', 'paquet', 'tecnolog', 'stack'],
};

function detectIntent(stemmedTokens) {
  const tokenSet = new Set(stemmedTokens);
  for (const [intent, stems] of Object.entries(INTENT_STEMS)) {
    if (stems.some(s => stemmedTokens.some(t => t.startsWith(s) || s.startsWith(t)))) {
      return intent;
    }
  }
  return null;
}

// ── Per-entry metadata ───────────────────────────────────────────────────────
// Used for boosting: if detected project + intent align with entry, score rises.
const ENTRY_PROJECT = {
  'livechat-que-es': 'livechat', 'livechat-instalacion': 'livechat',
  'livechat-requisitos': 'livechat', 'livechat-docker': 'livechat',
  'livechat-telegram': 'livechat', 'livechat-bot-ia': 'livechat',
  'livechat-variables': 'livechat', 'livechat-widget': 'livechat',
  'livechat-admin-api': 'livechat', 'livechat-dependencias': 'livechat',
  'livechat-redis': 'livechat', 'livechat-traduccion': 'livechat',
  'livechat-tests': 'livechat', 'livechat-nginx': 'livechat',
  'livechat-estructura': 'livechat',
  'youtube-downloader-que-es': 'youtube', 'youtube-downloader-instalacion': 'youtube',
  'youtube-downloader-caracteristicas': 'youtube', 'youtube-downloader-roadmap': 'youtube',
  'youtube-downloader-dependencias': 'youtube', 'youtube-downloader-aviso': 'youtube',
  'photo-dedup-que-es': 'photodup', 'photo-dedup-instalacion': 'photodup',
  'photo-dedup-ediciones': 'photodup', 'photo-dedup-google-takeout': 'photodup',
  'normalizador-que-es': 'normalizador', 'normalizador-presets': 'normalizador',
  'normalizador-instalacion': 'normalizador', 'normalizador-gpu': 'normalizador',
  'normalizador-roadmap': 'normalizador', 'normalizador-ffmpeg-auto': 'normalizador',
  'normalizador-roadmap': 'normalizador', 'normalizador-estructura': 'normalizador',
  'normalizador-ffmpeg-auto': 'normalizador',
};

const ENTRY_INTENTS = {
  'livechat-instalacion': ['install'], 'livechat-requisitos': ['requirements'],
  'livechat-que-es': ['features'], 'livechat-docker': ['install'],
  'livechat-widget': ['install', 'features'], 'livechat-bot-ia': ['features'],
  'livechat-variables': ['features'], 'livechat-dependencias': ['dependencies'],
  'livechat-nginx': ['install'],
  'youtube-downloader-instalacion': ['install'],
  'youtube-downloader-que-es': ['features'],
  'youtube-downloader-caracteristicas': ['features'],
  'youtube-downloader-roadmap': ['roadmap'],
  'youtube-downloader-dependencias': ['dependencies'],
  'photo-dedup-instalacion': ['install'],
  'photo-dedup-que-es': ['features'],
  'photo-dedup-ediciones': ['features'],
  'normalizador-instalacion': ['install'],
  'normalizador-que-es': ['features'],
  'normalizador-presets': ['features'],
  'normalizador-roadmap': ['roadmap'],
  'normalizador-ffmpeg-auto': ['install', 'requirements'],
  'normalizador-gpu': ['features'],
};

// ── Disambiguation questions ─────────────────────────────────────────────────
const PROJECTS_LIST = '• LiveChat Pro\n• YouTube Downloader\n• PhotoDedup\n• Normalizador Audio';

const DISAMBIGUATION = {
  install:      `¿Sobre qué proyecto quieres instrucciones de instalación?\n${PROJECTS_LIST}`,
  requirements: `¿Los requisitos de qué proyecto necesitas?\n${PROJECTS_LIST}`,
  roadmap:      `¿El roadmap de qué proyecto te interesa?\n• YouTube Downloader\n• Normalizador Audio`,
  features:     `¿Me puedes decir de qué proyecto quieres saber más?\n${PROJECTS_LIST}`,
  dependencies: `¿Las dependencias de qué proyecto necesitas?\n${PROJECTS_LIST}`,
};

// ── AiBot ────────────────────────────────────────────────────────────────────
class AiBot {
  constructor() { this.config = {}; this.kb = null; this.openai = null; }

  init(config = {}) {
    try {
      this.config = {
        mode: 'disabled', model: 'gpt-4o-mini', maxTokens: 300,
        systemPrompt: "You are a friendly support assistant. Be brief and reply in the user's language.",
        confidenceThreshold: 0.6, contextMessages: 6, notifyAdmin: false,
        ...config,
      };
      if (this.config.mode === 'knowledge-base' || this.config.mode === 'ai') this.loadKnowledgeBase();
      if (this.config.mode === 'ai' && this.config.openaiKey) {
        try { const OpenAI = require('openai'); this.openai = new OpenAI({ apiKey: this.config.openaiKey }); }
        catch (err) { this.logError(err, 'OpenAI package/client init failed'); }
      }
    } catch (err) { this.logError(err, 'AiBot init failed'); }
  }

  isEnabled() { try { return this.config.mode && this.config.mode !== 'disabled'; } catch { return false; } }
  shouldBotHandle(session) { try { return this.isEnabled() && !session?.botSilenced; } catch { return false; } }

  async getReply(session, text) {
    try {
      if (!this.isEnabled()) return { reply: null, confidence: 0, escalate: true };

      // ── Resolve pending disambiguation ──────────────────────────────────
      if (session?.botContext?.pendingIntent) {
        const ctx = session.botContext;
        session.botContext = null;
        if (Date.now() <= ctx.expiresAt) {
          const resolved = this.resolveDisambiguation(ctx, text);
          if (resolved) return resolved;
          // Can't resolve → fall through to normal match
        }
      }

      if (this.config.mode === 'knowledge-base') return this.matchKnowledge(text, session);

      if (this.config.mode === 'ai') {
        try {
          if (!this.openai) throw new Error('OpenAI client is not configured');
          const completion = await this.openai.chat.completions.create({
            model: this.config.model,
            messages: this.buildOpenAIContext(session, text),
            max_tokens: this.config.maxTokens,
          });
          const reply = completion?.choices?.[0]?.message?.content?.trim();
          if (reply) return { reply, confidence: 0.9, escalate: false };
        } catch (err) { this.logError(err, 'OpenAI reply failed'); }
        const fallback = this.matchKnowledge(text, session);
        return fallback?.reply && !fallback.escalate ? fallback : { reply: fallback.reply, confidence: fallback.confidence || 0, escalate: true };
      }
    } catch (err) { this.logError(err, 'AiBot getReply failed'); }
    return { reply: null, confidence: 0, escalate: true };
  }

  // Attempt to resolve a pending disambiguation using the user's follow-up.
  resolveDisambiguation(ctx, text) {
    const normalized = this.normalizeStr(expandProjectAliases(text));
    const project = detectProject(normalized);
    if (!project) return null;

    // Find the best entry matching project + pending intent
    const candidates = (this.kb?.entries || []).filter(e => {
      return ENTRY_PROJECT[e.id] === project &&
        (ENTRY_INTENTS[e.id] || []).includes(ctx.pendingIntent);
    });
    if (candidates.length) return { reply: candidates[0].answer, confidence: 0.92, escalate: false };

    // No intent match — fall back to the "what is" entry for the project
    const about = (this.kb?.entries || []).find(e =>
      ENTRY_PROJECT[e.id] === project && (ENTRY_INTENTS[e.id] || []).includes('features')
    );
    if (about) return { reply: about.answer, confidence: 0.82, escalate: false };
    return null;
  }

  loadKnowledgeBase() {
    try {
      const kbPath = this.config.kbPath;
      if (kbPath && fs.existsSync(kbPath)) this.kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
      else this.kb = null;
    } catch (err) { this.kb = null; this.logError(err, 'Knowledge base load failed'); }
  }

  // Base text normalization: lowercase, strip accents, collapse non-alphanum to space.
  normalizeStr(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Tokenize without stemming (for exact match layer).
  tokenize(text) {
    return this.normalizeStr(expandProjectAliases(text)).split(' ').filter(Boolean);
  }

  // Tokenize + stem (for fuzzy match layer).
  tokenizeStem(text) {
    return this.tokenize(text).map(stem);
  }

  detectLanguage(text) {
    const raw = String(text || '').toLowerCase();
    const normalized = this.normalizeStr(text);
    const tokens = new Set(normalized.split(' ').filter(Boolean));
    if (tokens.has('does') || tokens.has('speak') || tokens.has('several') || tokens.has('charge') || tokens.has('hire') || tokens.has('support')) return 'en';
    if (/[ãõç]/i.test(raw) || raw.startsWith('o que ') || raw.startsWith('como ') || tokens.has('voce') || tokens.has('voces') || tokens.has('obrigado') || tokens.has('obrigada') || tokens.has('ele') || tokens.has('quais') || tokens.has('cobram') || (tokens.has('posso') && !tokens.has('assumere')) || tokens.has('atendimento') || tokens.has('frequencia') || tokens.has('formacao')) return 'pt';
    if (/[ìò]/i.test(raw) || tokens.has('ciao') || tokens.has('grazie') || tokens.has('cos') || tokens.has('che') || tokens.has('parla') || tokens.has('lingue') || tokens.has('ogni') || tokens.has('dove') || tokens.has('costa') || tokens.has('viene') || tokens.has('sviluppatore') || tokens.has('assistenza')) return 'it';
    if (/[âæêëîïôœùûüÿ]/i.test(raw) || /[’']/.test(raw) || tokens.has('bonjour') || tokens.has('merci') || tokens.has('parle') || tokens.has('peux') || tokens.has('quelle') || tokens.has('quelles') || tokens.has('quels') || tokens.has('propose') || tokens.has('assistance') || tokens.has('facturent')) return 'fr';
    if (/[äöüß]/i.test(raw) || tokens.has('und') || tokens.has('der') || tokens.has('ich') || tokens.has('wirst') || tokens.has('welche') || tokens.has('entwickler') || tokens.has('supportzeiten') || tokens.has('spricht')) return 'de';
    let best = { lang: 'es', score: 0 };
    for (const [lang, hints] of Object.entries(LANGUAGE_HINTS)) {
      const score = hints.reduce((sum, hint) => sum + (tokens.has(this.normalizeStr(hint)) ? 1 : 0), 0);
      const adjusted = score;
      if (adjusted > best.score) best = { lang, score: adjusted };
    }
    return SUPPORTED_LANGS.includes(best.lang) ? best.lang : 'es';
  }

  entriesForLanguage(entries, lang) {
    const list = Array.isArray(entries) ? entries : [];
    const localized = list.filter(e => !e.language || e.language === lang);
    return localized.length ? localized : list;
  }

  matchEntries(text, entries, session, { allowDisambiguation = false } = {}) {
    const queryTokens   = this.tokenize(text);
    const queryStemmed  = queryTokens.map(stem);
    const querySet      = new Set(queryTokens);
    const queryStemSet  = new Set(queryStemmed);
    const normalizedText = queryTokens.join(' ');

    const detectedProject = detectProject(normalizedText);
    const detectedIntent  = detectIntent(queryStemmed);
    let best = null;

    for (const entry of entries) {
      const keywords = Array.isArray(entry.keywords) ? [...entry.keywords, entry.question].filter(Boolean) : [entry.question].filter(Boolean);
      if (!keywords.length) continue;

      let topScore = 0;
      for (const kw of keywords) {
        const kwTokens  = this.tokenize(kw);
        const kwStemmed = kwTokens.map(stem);
        if (!kwTokens.length) continue;
        const exactHits = kwTokens.filter(t => querySet.has(t)).length;
        const stemHits  = kwStemmed.filter(t => queryStemSet.has(t)).length;
        const hits = Math.max(exactHits, stemHits);
        const dice = (hits * 2) / (kwTokens.length + queryTokens.length);
        if (dice > topScore) topScore = dice;
      }

      let boost = 1.0;
      if (detectedProject && ENTRY_PROJECT[entry.id] === detectedProject) boost *= 1.40;
      if (detectedIntent  && (ENTRY_INTENTS[entry.id] || []).includes(detectedIntent)) boost *= 1.30;

      const entryConf  = Number(entry.confidence) || 0.8;
      const confidence = topScore > 0 ? Math.min(0.99, topScore * entryConf * boost) : 0;
      if (!best || confidence > best.confidence) best = { entry, confidence };
    }

    const threshold = Number(this.config.confidenceThreshold) || 0.6;
    if (best && best.confidence >= threshold) {
      return { reply: best.entry.answer, confidence: best.confidence, escalate: false, source: best.entry.source || 'knowledge-base', entryId: best.entry.id };
    }

    if (allowDisambiguation && detectedIntent && !detectedProject && DISAMBIGUATION[detectedIntent]) {
      if (session) session.botContext = { pendingIntent: detectedIntent, expiresAt: Date.now() + 120_000 };
      return { reply: DISAMBIGUATION[detectedIntent], confidence: 0.85, escalate: false, source: 'disambiguation' };
    }
    return { reply: null, confidence: best?.confidence || 0, escalate: true };
  }

  matchKnowledge(text, session) {
    try {
      // Prefer the browser language for bot replies; fall back to the detected
      // conversation language and finally to text hints.
      const preferredLang = session?.browserLang || session?.lang;
      const lang = (preferredLang && ['es','en','pt','fr','de','it'].includes(preferredLang)) ? preferredLang : this.detectLanguage(text);
      const threshold = Number(this.config.confidenceThreshold) || 0.6;

      // Priority 1: protected bot/creator entries, selected by detected visitor language.
      const fixedEntries = getFixedEntries(lang);
      const normalizedQuery = this.normalizeStr(text);
      const identityEntry = fixedEntries.find(e => e.id === 'lcp-bot-identidad' || e.id === 'lcp-bot-identity');
      if (identityEntry && /(quien eres|who are you|quem es|quem voce|qui es tu|wer bist|chi sei)/.test(normalizedQuery)) {
        return { reply: identityEntry.answer, confidence: 0.98, escalate: false, language: lang, source: 'fixed-entries', entryId: identityEntry.id };
      }
      const fixedMatch = this.matchEntries(text, fixedEntries, session, { allowDisambiguation: false });
      if (fixedMatch.confidence >= threshold) return { ...fixedMatch, language: lang, source: 'fixed-entries' };

      if (!this.kb?.entries?.length) {
        return { reply: FALLBACK_MESSAGES[lang], confidence: 0, escalate: true, language: lang };
      }

      // Priority 2: active production KB, filtered to the visitor language when available.
      const kbEntries = this.entriesForLanguage(this.kb.entries, lang);
      const kbMatch = this.matchEntries(text, kbEntries, session, { allowDisambiguation: true });
      if (kbMatch.confidence >= threshold || !kbMatch.escalate) return { ...kbMatch, language: lang };

      // No visitor translation here. Admin/Telegram translation is handled by the normal escalation pipeline.
      return { reply: FALLBACK_MESSAGES[lang], confidence: kbMatch.confidence || fixedMatch.confidence || 0, escalate: true, language: lang };
    } catch (err) {
      this.logError(err, 'Knowledge match failed');
      return { reply: FALLBACK_MESSAGES.es, confidence: 0, escalate: true, language: 'es' };
    }
  }

  buildOpenAIContext(session, text) {
    try {
      const messages = [{ role: 'system', content: this.config.systemPrompt }];
      const history = Array.isArray(session?.messages) ? session.messages.slice(-this.config.contextMessages) : [];
      for (const msg of history) {
        messages.push({ role: msg.from === 'user' ? 'user' : 'assistant', content: String(msg.text || '').slice(0, 2000) });
      }
      messages.push({ role: 'user', content: String(text || '').slice(0, 4000) });
      return messages;
    } catch (err) {
      this.logError(err, 'OpenAI context build failed');
      return [{ role: 'user', content: String(text || '') }];
    }
  }

  logError(err, msg) {
    const logger = this.config?.logger || console;
    logger.error?.({ err }, msg);
  }
}

module.exports = new AiBot();
