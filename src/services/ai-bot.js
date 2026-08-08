'use strict';

const fs = require('fs');
const { getFixedEntries } = require('./master-prompt');
const {
  stem,
  normalizeStr,
  expandProjectAliases,
  tokenize,
  tokenizeStem,
} = require('./text-match');
const { llmService: defaultLlmService } = require('./llm');

const SUPPORTED_LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const FALLBACK_MESSAGES = {
  es: 'No tengo una respuesta específica para eso. He notificado al administrador y te responderá pronto.',
  en: "I don't have a specific answer for that. I've notified the administrator and they'll reply soon.",
  pt: 'Não tenho uma resposta específica para isso. Notifiquei o administrador e ele responderá em breve.',
  fr: "Je n'ai pas de resposta spécifique à cela. J'ai notifié l'administrateur qui vous répondra bientôt.",
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

// ── Project detection ────────────────────────────────────────────────────────
// Maps canonical token → internal project key.
const PROJECT_TOKENS = {
  livechat:     ['livechat', 'chatpro'],
  photodup:     ['photodup', 'photodedup'],
  normalizador: ['normalizador'],
  youtube:      ['youtubedownloader', 'ytdownloader', 'ytdlp'],
};

function detectProject(normalizedText) {
  for (const [project, tokens] of Object.entries(PROJECT_TOKENS)) {
    if (tokens.some(t => normalizedText.includes(t))) return project;
  }
  if (/(^|\s)youtube(\s|$)/.test(normalizedText)) return 'youtube';
  return null;
}

// ── Intent detection ─────────────────────────────────────────────────────────
const INTENT_STEMS = {
  install:      ['instal', 'descarg', 'baj', 'setup', 'ejecut', 'inici', 'configur'],
  requirements: ['requisit', 'neces', 'compatibil', 'soporta', 'sistem', 'requerimient'],
  roadmap:      ['roadmap', 'futur', 'proxim', 'version', 'plan', 'milestone', 'prox'],
  features:     ['funcion', 'caracteristic', 'incluy', 'ofrec', 'tien', 'soporta', 'permit'],
  dependencies: ['dependenc', 'librer', 'paquet', 'tecnolog', 'stack'],
};

function detectIntent(stemmedTokens) {
  for (const [intent, stems] of Object.entries(INTENT_STEMS)) {
    if (stems.some(s => stemmedTokens.some(t => t.startsWith(s) || s.startsWith(t)))) {
      return intent;
    }
  }
  return null;
}

// ── Per-entry metadata ───────────────────────────────────────────────────────
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
  'normalizador-estructura': 'normalizador',
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

const DEFAULT_CONFIG = Object.freeze({
  mode: 'disabled',
  enabled: false,
  provider: null,
  model: 'gpt-4o-mini',
  maxTokens: 300,
  systemPrompt: "You are a friendly support assistant. Be brief and reply in the user's language.",
  confidenceThreshold: 0.6,
  contextMessages: 6,
  notifyAdmin: false,
});

// ── AiBot ────────────────────────────────────────────────────────────────────
class AiBot {
  constructor() {
    this.config = DEFAULT_CONFIG;
    this.kb = null;
    this.openai = null;
  }

  configure(nextConfig = {}) {
    let enabled = nextConfig.enabled;
    if (enabled === undefined) {
      if (nextConfig.mode !== undefined) {
        enabled = nextConfig.mode !== 'disabled';
      } else {
        enabled = this.config.enabled;
      }
    }
    const merged = {
      ...this.config,
      ...nextConfig,
      enabled,
    };
    this.config = Object.freeze(merged);

    if (this.config.mode === 'knowledge-base' || this.config.mode === 'ai') {
      this.loadKnowledgeBase();
    }
    return this.config;
  }

  init(config = {}) {
    try {
      this.configure(config);
      if (this.config.mode === 'ai' && this.config.openaiKey) {
        try {
          const OpenAI = require('openai');
          this.openai = new OpenAI({ apiKey: this.config.openaiKey });
        } catch (err) {
          this.logError(err, 'OpenAI package/client init failed');
        }
      }
    } catch (err) {
      this.logError(err, 'AiBot init failed');
    }
  }

  isEnabled() {
    try {
      if (this.config.enabled === false) return false;
      if (this.config.enabled === true) return true;
      return Boolean(this.config.mode && this.config.mode !== 'disabled');
    } catch {
      return false;
    }
  }

  shouldBotHandle(session, { isHighPriority = false } = {}) {
    try {
      if (isHighPriority || session?.isHighPriority) return false;
      return this.isEnabled() && !session?.botSilenced;
    } catch {
      return false;
    }
  }

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
        }
      }

      if (this.config.mode === 'knowledge-base') {
        return this.matchKnowledge(text, session);
      }

      // Active LLM provider resolution
      const activeLlmService = this.config.llmService || defaultLlmService;
      const provider = this.config.provider || this.config.defaultProvider;
      const apiKey = this.config.apiKey || this.config.openaiKey;

      if (provider && apiKey) {
        const messages = this.buildLLMContext(session, text);
        // RAG context is fetched FIRST and fed into the prompt template via the
        // {rag_context} placeholder (ADR 7) — never appended after the prompt.
        const ragContext = await this.getRAGContext(session, text);
        const systemPrompt = await this.getSystemPrompt(session, text, { rag_context: ragContext || '' });

        try {
          const res = await activeLlmService.chat({
            provider,
            apiKey,
            model: this.config.model || 'gpt-4o-mini',
            messages,
            systemPrompt,
            maxTokens: this.config.maxTokens,
            baseURL: this.config.baseURL,
          });

          if (res && res.ok && res.text) {
            const reply = String(res.text).trim();
            if (reply) {
              return { reply, confidence: 0.9, escalate: false };
            }
          }
        } catch (err) {
          this.logError(err, 'LLM provider reply failed');
        }

        if (this.kb?.entries?.length) {
          const fallback = this.matchKnowledge(text, session);
          if (fallback?.reply && !fallback.escalate) return fallback;
        }
        return { reply: null, confidence: 0, escalate: true };
      }

      if (this.config.mode === 'ai' && this.openai) {
        try {
          const completion = await this.openai.chat.completions.create({
            model: this.config.model,
            messages: this.buildOpenAIContext(session, text),
            max_tokens: this.config.maxTokens,
          });
          const reply = completion?.choices?.[0]?.message?.content?.trim();
          if (reply) return { reply, confidence: 0.9, escalate: false };
        } catch (err) {
          this.logError(err, 'OpenAI reply failed');
        }
        const fallback = this.matchKnowledge(text, session);
        return fallback?.reply && !fallback.escalate
          ? fallback
          : { reply: fallback.reply, confidence: fallback.confidence || 0, escalate: true };
      }

      if (this.kb?.entries?.length) {
        return this.matchKnowledge(text, session);
      }
    } catch (err) {
      this.logError(err, 'AiBot getReply failed');
    }
    return { reply: null, confidence: 0, escalate: true };
  }

  async getSystemPrompt(session, text, extra = {}) {
    if (typeof this.config.masterPromptService?.getFormattedPrompt === 'function') {
      return await this.config.masterPromptService.getFormattedPrompt({
        visitor_name: session?.visitorName || session?.name,
        site_title: this.config.siteTitle,
        current_language: session?.lang || session?.browserLang || 'es',
        rag_context: extra.rag_context || '',
      });
    }
    if (typeof this.config.masterPromptService?.getPrompt === 'function') {
      return await this.config.masterPromptService.getPrompt(session, text);
    }
    return this.config.systemPrompt || "You are a friendly support assistant. Be brief and reply in the user's language.";
  }

  async getRAGContext(session, text) {
    if (typeof this.config.ragService?.retrieve === 'function') {
      try {
        const chunks = await this.config.ragService.retrieve(text);
        if (Array.isArray(chunks) && chunks.length > 0) {
          const formatted = chunks.map(c => (typeof c === 'string' ? c : c.content || c.text || '')).filter(Boolean).join('\n---\n');
          if (formatted) {
            return `Knowledge context:\n${formatted}`;
          }
        }
      } catch (err) {
        this.logError(err, 'RAG retrieval failed');
      }
    }
    return null;
  }

  // Attempt to resolve a pending disambiguation using the user's follow-up.
  resolveDisambiguation(ctx, text) {
    const normalized = this.normalizeStr(expandProjectAliases(text));
    const project = detectProject(normalized);
    if (!project) return null;

    const candidates = (this.kb?.entries || []).filter(e => {
      return ENTRY_PROJECT[e.id] === project &&
        (ENTRY_INTENTS[e.id] || []).includes(ctx.pendingIntent);
    });
    if (candidates.length) return { reply: candidates[0].answer, confidence: 0.92, escalate: false };

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

  normalizeStr(text) {
    return normalizeStr(text);
  }

  tokenize(text) {
    return tokenize(text);
  }

  tokenizeStem(text) {
    return tokenizeStem(text);
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
      const preferredLang = session?.browserLang || session?.lang;
      const lang = (preferredLang && ['es','en','pt','fr','de','it'].includes(preferredLang)) ? preferredLang : this.detectLanguage(text);
      const threshold = Number(this.config.confidenceThreshold) || 0.6;

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

      const kbEntries = this.entriesForLanguage(this.kb.entries, lang);
      const kbMatch = this.matchEntries(text, kbEntries, session, { allowDisambiguation: true });
      if (kbMatch.confidence >= threshold || !kbMatch.escalate) return { ...kbMatch, language: lang };

      return { reply: FALLBACK_MESSAGES[lang], confidence: kbMatch.confidence || fixedMatch.confidence || 0, escalate: true, language: lang };
    } catch (err) {
      this.logError(err, 'Knowledge match failed');
      return { reply: FALLBACK_MESSAGES.es, confidence: 0, escalate: true, language: 'es' };
    }
  }

  buildOpenAIContext(session, text) {
    return this.buildLLMContext(session, text);
  }

  buildLLMContext(session, text) {
    try {
      const messages = [];
      const contextCount = this.config.contextMessages || 6;
      const history = Array.isArray(session?.messages) ? session.messages.slice(-contextCount) : [];
      for (const msg of history) {
        messages.push({ role: msg.from === 'user' ? 'user' : 'assistant', content: String(msg.text || '').slice(0, 2000) });
      }
      messages.push({ role: 'user', content: String(text || '').slice(0, 4000) });
      return messages;
    } catch (err) {
      this.logError(err, 'LLM context build failed');
      return [{ role: 'user', content: String(text || '') }];
    }
  }

  logError(err, msg) {
    const logger = this.config?.logger || console;
    logger.error?.({ err }, msg);
  }
}

// Boot-time LLM config resolution (ADR 5): settings-backed (decrypted) wins;
// default-provider only, no failover chain (ADR 8). Any missing/invalid piece
// resolves to null so the caller keeps the env-only init config untouched.
async function resolveLlmBootConfig(deps = {}) {
  const settingsService = deps?.settingsService;
  const logger = deps?.logger;
  if (!settingsService) return null;
  try {
    const defaultProvider = String((await settingsService.get('llm.default_provider')) || '').trim().toLowerCase();
    if (!defaultProvider) return null;

    const raw = await settingsService.getJSON(`llm.provider.${defaultProvider}`, null);
    if (!raw) return null;

    let apiKey = '';
    if (raw.encKey) {
      apiKey = await settingsService.decryptSecret(raw.encKey);
    } else {
      apiKey = String(raw.apiKey || '');
    }
    if (!apiKey) return null;

    const resolved = {
      provider: defaultProvider,
      defaultProvider,
      apiKey,
      model: raw.model || null,
    };
    const enabledVal = await settingsService.getJSON('ai.enabled', null);
    if (enabledVal !== null) {
      resolved.enabled = Boolean(enabledVal);
    }
    return resolved;
  } catch (error) {
    logger?.warn?.(
      { err: error },
      'No se pudo descifrar la configuración LLM; usando variable de entorno. Si SETTINGS_KEY estaba entre comillas, reingrese las claves LLM una sola vez en la pestaña IA del panel de administración.'
    );
    return null;
  }
}

module.exports = new AiBot();
module.exports.resolveLlmBootConfig = resolveLlmBootConfig;

