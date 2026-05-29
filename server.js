// ============================================================
// LiveChat Pro — server.js v4 (Phases 1-4: DB, security, Docker, CI/CD)
// ============================================================
'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const pino = require('pino');
const crypto = require('crypto');
const path = require('path');
const { initDb, closeDb, stmts } = require('./db');
const { ClusterState } = require('./cluster-state');
const { createConfig, validateConfig } = require('./src/config');
const {
  normalizeWidgetLang,
  sanitizeText,
  sanitizeName,
  sanitizePage,
  sanitizeLanguage,
  sanitizeUserAgent,
  escapeTelegramHtml,
} = require('./src/utils/sanitizer');
const {
  getGeoInfo
} = require('./src/services/geo');
const { parseCookies } = require('./src/utils/cookies');
const { createHttpRateLimiters, createMsgRateLimiter } = require('./src/utils/rate-limiters');
const { createAdminAuth } = require('./src/security/admin-auth');
const translator = require('./src/services/translator');
const { createSessionService } = require('./src/services/sessions');
const { createAdminChatService } = require('./src/services/admin-chat');
const { createAttachmentService } = require('./src/services/attachments');
const setupSockets = require('./src/sockets');
const { createAdminRouter } = require('./src/routes/admin');
const { createAttachmentRouter } = require('./src/routes/attachments');
const { createHealthRouter } = require('./src/routes/health');
const { analyzeSentiment } = require('./src/services/sentiment');
const aiBot = require('./src/services/ai-bot');
const { clearTranslationCache, closeTranslationCache } = translator;
const {
  setupTelegramBot,
  launchTelegramBot,
  sendToAdmin,
  sessionCard,
  getBot
} = require('./src/telegram/bot');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Configuration is normalized once during bootstrap. The constants below keep
// the rest of server.js readable while still preserving the structured config
// object for services that need grouped settings.
const config = createConfig({ logger });
const configErrors = validateConfig(config);
const TELEGRAM_TOKEN = config.telegram.token;
const ADMIN_ID = config.telegram.adminId;
const PORT = config.server.port;
const widgetCfg = config.widget;
const ADMIN_PANEL_PASSWORD = config.admin.password;
const ADMIN_SESSION_TTL_MS = config.admin.sessionTtlMs;
const ADMIN_COOKIE_NAME = config.admin.cookieName;
const ADMIN_CSRF_COOKIE_NAME = config.admin.csrfCookieName;
const WIDGET_API_KEY = config.widget.apiKey;
const REDIS_URL = config.redis.url;
const REDIS_KEY_PREFIX = config.redis.keyPrefix;
const TELEGRAM_LAUNCH_TIMEOUT_MS = config.telegram.launchTimeoutMs;
const COOKIE_SAME_SITE = config.admin.cookieSameSite;
const TRUST_PROXY_HOPS = config.server.trustProxyHops;
const corsOptions = config.server.corsOptions;
const features = config.features;
const ADMIN_LANGUAGE = config.admin.language;

aiBot.init({
  mode: process.env.BOT_MODE || 'disabled',
  openaiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 300,
  systemPrompt: process.env.BOT_SYSTEM_PROMPT || "You are a friendly support assistant. Be brief and reply in the user's language.",
  confidenceThreshold: parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD) || 0.6,
  contextMessages: parseInt(process.env.BOT_CONTEXT_MESSAGES, 10) || 6,
  notifyAdmin: process.env.BOT_NOTIFY_ADMIN === 'true',
  kbPath: path.join(__dirname, 'data/knowledge-base.json'),
  logger,
});

const HELP_COMMANDS = {
  es: '/ayuda',
  en: '/help',
  pt: '/ajuda',
  fr: '/aide',
  de: '/hilfe',
  it: '/aiuto',
};

const HELP_TOPICS = {
  es: `📚 *Guía de preguntas que puedo responder:*

👤 *Sobre el creador:*
• ¿Quién es Wilkin Barbán?
• ¿Qué estudió? ¿Cuál es su formación?
• ¿De dónde es? ¿Dónde vive?
• ¿Habla varios idiomas?
• ¿Qué lo motivó a crear esto?

🤖 *Sobre el bot y el sistema:*
• ¿Qué eres? ¿Eres un bot o una persona?
• ¿Qué puedes hacer?
• ¿Cómo funciona el bot?
• ¿Cada cuánto se actualiza?

💼 *Proyectos disponibles:*
• ¿Qué es LiveChat Pro?
• ¿Cómo instalo LiveChat Pro?
• ¿Qué es PhotoDedup?
• ¿Qué es Normalizador Audio?
• ¿Qué es YouTube Downloader?
• ¿Cómo instalo cada proyecto?
• ¿Qué tecnologías usan?

🛠️ *Servicios y contacto:*
• ¿Qué servicios ofrece el desarrollador?
• ¿Cuánto cobran?
• ¿Cómo puedo contratar?
• ¿Dónde están los proyectos en GitHub?
• ¿Cuál es el horario de atención?

_Escribe tu pregunta con tus propias palabras — haré lo posible por responder 😊_`,
  en: `📚 *Guide to questions I can answer:*

👤 *About the creator:*
• Who is Wilkin Barbán?
• What did he study? What is his background?
• Where is he from? Where does he live?
• Does he speak several languages?
• What motivated him to create this?

🤖 *About the bot and the system:*
• What are you? Are you a bot or a person?
• What can you do?
• How does the bot work?
• How often are you updated?

💼 *Available projects:*
• What is LiveChat Pro?
• How do I install LiveChat Pro?
• What is PhotoDedup?
• What is Normalizador Audio?
• What is YouTube Downloader?
• How do I install each project?
• What technologies do they use?

🛠️ *Services and contact:*
• What services does the developer offer?
• How much do they charge?
• How can I hire them?
• Where are the projects on GitHub?
• What are the support hours?

_Write your question in your own words — I’ll do my best to answer 😊_`,
  pt: `📚 *Guia de perguntas que posso responder:*

👤 *Sobre o criador:*
• Quem é Wilkin Barbán?
• O que ele estudou? Qual é a formação dele?
• De onde ele é? Onde mora?
• Ele fala vários idiomas?
• O que o motivou a criar isto?

🤖 *Sobre o bot e o sistema:*
• O que você é? É um bot ou uma pessoa?
• O que você pode fazer?
• Como o bot funciona?
• Com que frequência é atualizado?

💼 *Projetos disponíveis:*
• O que é LiveChat Pro?
• Como instalo o LiveChat Pro?
• O que é PhotoDedup?
• O que é Normalizador Audio?
• O que é YouTube Downloader?
• Como instalo cada projeto?
• Quais tecnologias eles usam?

🛠️ *Serviços e contato:*
• Quais serviços o desenvolvedor oferece?
• Quanto cobram?
• Como posso contratar?
• Onde estão os projetos no GitHub?
• Qual é o horário de atendimento?

_Escreva sua pergunta com suas próprias palavras — farei o possível para responder 😊_`,
  fr: `📚 *Guide des questions auxquelles je peux répondre :*

👤 *À propos du créateur :*
• Qui est Wilkin Barbán ?
• Qu’a-t-il étudié ? Quelle est sa formation ?
• D’où vient-il ? Où vit-il ?
• Parle-t-il plusieurs langues ?
• Qu’est-ce qui l’a motivé à créer ceci ?

🤖 *À propos du bot et du système :*
• Qu’es-tu ? Es-tu un bot ou une personne ?
• Que peux-tu faire ?
• Comment fonctionne le bot ?
• À quelle fréquence es-tu mis à jour ?

💼 *Projets disponibles :*
• Qu’est-ce que LiveChat Pro ?
• Comment installer LiveChat Pro ?
• Qu’est-ce que PhotoDedup ?
• Qu’est-ce que Normalizador Audio ?
• Qu’est-ce que YouTube Downloader ?
• Comment installer chaque projet ?
• Quelles technologies utilisent-ils ?

🛠️ *Services et contact :*
• Quels services propose le développeur ?
• Combien facturent-ils ?
• Comment puis-je engager ses services ?
• Où sont les projets sur GitHub ?
• Quels sont les horaires d’assistance ?

_Écrivez votre question avec vos propres mots — je ferai de mon mieux pour répondre 😊_`,
  de: `📚 *Leitfaden zu Fragen, die ich beantworten kann:*

👤 *Über den Ersteller:*
• Wer ist Wilkin Barbán?
• Was hat er studiert? Welche Ausbildung hat er?
• Woher kommt er? Wo lebt er?
• Spricht er mehrere Sprachen?
• Was hat ihn motiviert, das hier zu erstellen?

🤖 *Über den Bot und das System:*
• Was bist du? Bist du ein Bot oder eine Person?
• Was kannst du tun?
• Wie funktioniert der Bot?
• Wie oft wirst du aktualisiert?

💼 *Verfügbare Projekte:*
• Was ist LiveChat Pro?
• Wie installiere ich LiveChat Pro?
• Was ist PhotoDedup?
• Was ist Normalizador Audio?
• Was ist YouTube Downloader?
• Wie installiere ich jedes Projekt?
• Welche Technologien verwenden sie?

🛠️ *Services und Kontakt:*
• Welche Services bietet der Entwickler an?
• Wie viel kostet es?
• Wie kann ich ihn beauftragen?
• Wo sind die Projekte auf GitHub?
• Wie sind die Supportzeiten?

_Schreib deine Frage in deinen eigenen Worten — ich gebe mein Bestes, sie zu beantworten 😊_`,
  it: `📚 *Guida alle domande a cui posso rispondere:*

👤 *Sul creatore:*
• Chi è Wilkin Barbán?
• Cosa ha studiato? Qual è la sua formazione?
• Da dove viene? Dove vive?
• Parla più lingue?
• Cosa lo ha motivato a creare questo?

🤖 *Sul bot e sul sistema:*
• Cosa sei? Sei un bot o una persona?
• Cosa puoi fare?
• Come funziona il bot?
• Ogni quanto vieni aggiornato?

💼 *Progetti disponibili:*
• Cos’è LiveChat Pro?
• Come installo LiveChat Pro?
• Cos’è PhotoDedup?
• Cos’è Normalizador Audio?
• Cos’è YouTube Downloader?
• Come installo ogni progetto?
• Che tecnologie usano?

🛠️ *Servizi e contatto:*
• Quali servizi offre lo sviluppatore?
• Quanto costa?
• Come posso assumere i suoi servizi?
• Dove sono i progetti su GitHub?
• Quali sono gli orari di assistenza?

_Scrivi la tua domanda con parole tue — farò del mio meglio per rispondere 😊_`,
};

const WIDGET_MESSAGES = {
  es: {
    welcome: '¡Hola! Qué gusto tenerte por aquí. ¿Cómo te gustaría que te llamemos?',
    named: name => `¡Encantado, ${name}! Cuéntanos, ¿en qué podemos ayudarte hoy?

💡 Escribe /ayuda para ver una guía de preguntas que puedo responder.`,
  },
  en: {
    welcome: 'Hi! It is great to have you here. What name would you like us to use?',
    named: name => `Nice to meet you, ${name}! Tell us, how can we help you today?

💡 Type /help to see a guide of questions I can answer.`,
  },
  pt: {
    welcome: 'Olá! Que bom ter você por aqui. Como você gostaria que chamássemos você?',
    named: name => `Prazer, ${name}! Conte para nós, como podemos ajudar hoje?

💡 Digite /ajuda para ver um guia de perguntas que posso responder.`,
  },
  fr: {
    welcome: 'Bonjour ! Ravi de vous accueillir ici. Quel nom souhaitez-vous utiliser ?',
    named: name => `Enchanté, ${name} ! Comment pouvons-nous vous aider aujourd'hui ?

💡 Tapez /aide pour voir un guide des questions auxquelles je peux répondre.`,
  },
  de: {
    welcome: 'Hallo! Schön, dass du hier bist. Wie sollen wir dich nennen?',
    named: name => `Freut mich, ${name}! Wie können wir heute helfen?

💡 Tippe /hilfe für eine Übersicht der Fragen, die ich beantworten kann.`,
  },
  it: {
    welcome: 'Ciao! Che piacere averti qui. Come vorresti che ti chiamassimo?',
    named: name => `Piacere, ${name}! Come possiamo aiutarti oggi?

💡 Scrivi /aiuto per vedere una guida alle domande a cui posso rispondere.`,
  },
};

// Widget greetings are server-side so every embedded site receives the same
// localized first-run flow without needing to bundle copy in widget config.
function getWidgetMessage(lang, key, ...args) {
  const message = WIDGET_MESSAGES[normalizeWidgetLang(lang)]?.[key] || WIDGET_MESSAGES.es[key];
  return typeof message === 'function' ? message(...args) : message;
}

if (configErrors.length) {
  logger.error({ errors: configErrors }, 'Configuración inválida. Copia .env.example como .env y ejecuta: node setup.js');
  process.exit(1);
}

// ── App bootstrap ────────────────────────────────────────────
const app = express();

// Trust the first reverse proxy (nginx / Docker / Heroku).
// Required so req.ip reflects the real client IP and so the rate limiter
// does not treat nginx (127.0.0.1) as the only client.
app.set('trust proxy', TRUST_PROXY_HOPS);

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
});
const adminIo = io.of('/admin');

function publicWidgetHeaders(req, res, next) {
  // widget.js and config-public must be embeddable from arbitrary websites, so
  // they get permissive cross-origin headers independent of the private API CORS.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}

// ── Security ──────────────────────────────────────────────────
// CSP for admin/demo/health without blocking local scripts and styles that
// still live embedded in the project HTML pages.
// crossOriginResourcePolicy is disabled globally so embeddable public
// resources can be exposed explicitly per route.
// crossOriginOpenerPolicy and originAgentCluster are disabled because Chrome
// rejects them in HTTP development deployments by public IP.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));
app.use(['/widget.js', '/config-public'], publicWidgetHeaders);
app.use((req, res, next) => {
  if (req.path === '/widget.js' || req.path === '/config-public') return next();
  return cors(corsOptions)(req, res, next);
});
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  // Sanitize incoming X-Request-Id to prevent HTTP response header injection.
  // Only allow alphanumeric characters, hyphens and underscores (max 64 chars).
  const rawRequestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : '';
  const sanitizedId = rawRequestId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
  const requestId = sanitizedId || crypto.randomUUID();
  const startedAt = Date.now();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    logger.info({
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    }, 'http_request');
  });

  next();
});

const {
  createAdminToken,
  ensureCsrfCookie,
  verifyAdminToken,
  requireAdmin,
  requireCsrf,
  sameSiteForRequest,
  shouldUseSecureAdminCookie,
} = createAdminAuth({
  telegramToken: TELEGRAM_TOKEN,
  adminPanelPassword: ADMIN_PANEL_PASSWORD,
  adminSessionTtlMs: ADMIN_SESSION_TTL_MS,
  adminCookieName: ADMIN_COOKIE_NAME,
  csrfCookieName: ADMIN_CSRF_COOKIE_NAME,
  cookieSameSite: COOKIE_SAME_SITE,
});

// HTTP rate limiting is applied before routers. Authenticated admin calls are
// exempted inside the limiter factory.
const {
  publicApiLimiter,
  loginLimiter,
  adminLimiter,
  uploadLimiter,
} = createHttpRateLimiters({
  rateLimitConfig: config.rateLimit,
  adminCookieName: ADMIN_COOKIE_NAME,
  verifyAdminToken,
});

app.use('/api/admin', adminLimiter);

// ── Telegram Bot ─────────────────────────────────────────────
let telegramReady = false;

// ── In-memory state (cache over the DB) ───────────────────────
// sessions: local session cache with history hydrated from SQLite
// clusterState: optional shared state in Redis for multi-node deployments
const sessions = new Map();
const clusterState = new ClusterState({
  redisUrl: REDIS_URL,
  keyPrefix: REDIS_KEY_PREFIX,
  logger,
  enabled: config.redis.enabled,
});

async function resolveTelegramReplySessionId(message) {
  // Used by tests and by Telegram reply handling to resolve quoted admin
  // notifications back to the original chat session.
  const replyToMessageId = message?.reply_to_message?.message_id;
  if (!replyToMessageId) return null;
  return clusterState.getTelegramMessageSession(ADMIN_ID, replyToMessageId);
}

function sessionRoom(sessionId) {
  // Every visitor tab for the same logical chat joins the same room.
  return `session:${sessionId}`;
}

// ── Translation ──────────────────────────────────────────────
async function translate(text, targetLang) {
  return translator.translate(text, targetLang, features.translation);
}

async function detectLang(text) {
  return translator.detectLang(text, features.translation);
}

const attachmentService = createAttachmentService({
  stmts,
  logger,
  config: config.uploads,
  rootDir: __dirname,
});

// Services are created before routers/sockets so every transport shares the same
// session serialization, persistence and broadcast behavior.
const sessionService = createSessionService({
  sessions,
  stmts,
  clusterState,
  logger,
  adminLanguage: ADMIN_LANGUAGE,
  translate,
  attachmentService,
});

const {
  applySharedSessionSnapshot,
  syncSharedSession,
  dbRowToSession,
  sessionToDBRow,
  loadFromDB,
  loadSessionFromDB,
  ensureSessionLoaded,
  translateForAdmin,
  serializeMessageForAdmin,
  serializeMessage,
  serializeSession,
  listSessionsForAdmin,
  getGeneralAdminMetrics,
} = sessionService;

const adminChatService = createAdminChatService({
  io,
  adminIo,
  sessions,
  stmts,
  logger,
  clusterState,
  adminId: ADMIN_ID,
  adminLanguage: ADMIN_LANGUAGE,
  sessionRoom,
  syncSharedSession,
  serializeSession,
  serializeMessageForAdmin,
  translate,
  attachmentService,
});

const {
  broadcastAdminSessionUpdate,
  broadcastAdminMessage,
  clearSessionChat,
  deleteAdminSession,
  sendAdminTypingToSession,
  sendAdminReplyToSession,
} = adminChatService;

// ── Geo lookup ───────────────────────────────────────────────
// Moved to src/services/geo.js

// ── Validation and sanitization ───────────────────────────────
// Moved to src/utils/sanitizer.js

// ── Telegram helpers ─────────────────────────────────────────
async function findSessionIdByPrefix(prefix) {
  if (!prefix) return null;

  for (const sessionId of sessions.keys()) {
    if (sessionId.startsWith(prefix)) return sessionId;
  }

  const rows = await stmts.getSessionsOverview.all();
  const match = rows.find(row => row.session_id.startsWith(prefix));
  return match?.session_id || null;
}

setupSockets(io, adminIo, {
  WIDGET_API_KEY,
  clusterState,
  sessions,
  features,
  stmts,
  logger,
  widgetCfg,
  ADMIN_ID,
  ADMIN_LANGUAGE,
  ADMIN_PANEL_PASSWORD,
  ADMIN_COOKIE_NAME,
  parseCookies,
  sessionRoom,
  loadSessionFromDB,
  sessionToDBRow,
  syncSharedSession,
  broadcastAdminSessionUpdate,
  broadcastAdminMessage,
  getWidgetMessage,
  HELP_COMMANDS,
  HELP_TOPICS,
  attachmentService,
  translateForAdmin,
  translate,
  detectLang,
  analyzeSentiment,
  sendToAdmin,
  sessionCard,
  createMsgRateLimiter,
  verifyAdminToken,
  listSessionsForAdmin,
  getBot,
  aiBot,
});

app.use(createAttachmentRouter({
  WIDGET_API_KEY,
  attachmentService,
  ensureSessionLoaded,
  stmts,
  logger,
  io,
  sessions,
  sessionRoom,
  syncSharedSession,
  broadcastAdminMessage,
  broadcastAdminSessionUpdate,
  sendToAdmin,
  ADMIN_ID,
  verifyAdminToken,
  adminCookieName: ADMIN_COOKIE_NAME,
  requireAdmin,
  requireCsrf,
  serializeMessageForAdmin,
  serializeSession,
  uploadLimiter,
}));

app.get('/widget.js', publicApiLimiter, (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'widget.js'));
});

app.get('/config-public', publicApiLimiter, (req, res) => {
  // Only expose visual widget settings that are safe for public embedded pages.
  res.json({
    primaryColor: widgetCfg.primaryColor,
    buttonStyle: widgetCfg.buttonStyle,
    apiKey: widgetCfg.apiKey
  });
});

app.use(createAdminRouter({
  rootDir: __dirname,
  adminPanelPassword: ADMIN_PANEL_PASSWORD,
  adminCookieName: ADMIN_COOKIE_NAME,
  adminSessionTtlMs: ADMIN_SESSION_TTL_MS,
  clusterState,
  io,
  sessions,
  stmts,
  logger,
  ensureCsrfCookie,
  verifyAdminToken,
  createAdminToken,
  sameSiteForRequest,
  shouldUseSecureAdminCookie,
  requireAdmin,
  requireCsrf,
  loginLimiter,
  ensureSessionLoaded,
  listSessionsForAdmin,
  getGeneralAdminMetrics,
  serializeSession,
  serializeMessageForAdmin,
  sendAdminReplyToSession,
  sendAdminTypingToSession,
  syncSharedSession,
  broadcastAdminSessionUpdate,
  clearSessionChat,
  deleteAdminSession,
  sessionRoom,
}));

app.use(createHealthRouter({ sessions, clusterState, get telegramReady() { return telegramReady; }, config }));

// ── Startup ───────────────────────────────────────────────────
async function start() {
  // Startup order matters: database first, optional cluster state second, then
  // hydration. HTTP starts before Telegram so a slow bot launch does not block
  // the health endpoint or local development.
  logger.info('Iniciando base de datos SQLite...');
  await initDb();
  if (config.redis.enabled) {
    logger.info('Conectando con el estado del cluster (Redis)...');
  }
  await clusterState.connect(io);
  logger.info('Restaurando sesiones desde la base de datos...');
  await loadFromDB();

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, '0.0.0.0', () => {
      httpServer.off('error', reject);
      logger.info({ port: PORT }, 'LiveChat Pro iniciado');
      logger.info('Comandos Telegram: /usuarios /ban /info /clean');
      logger.info('Base de datos: data/livechat.db');
      resolve();
    });
  });

  void (async () => {
    try {
      setupTelegramBot({
        token: TELEGRAM_TOKEN,
        adminId: ADMIN_ID,
        logger,
        sessions,
        clusterState,
        stmts,
        io,
        sessionRoom,
        ensureSessionLoaded,
        listSessionsForAdmin,
        sendAdminReplyToSession,
        findSessionIdByPrefix,
        aiBot,
      });
      await launchTelegramBot(TELEGRAM_LAUNCH_TIMEOUT_MS);
      telegramReady = true;
      logger.info('Telegram bot activo');
    } catch (error) {
      telegramReady = false;
      logger.error({ err: error }, 'No se pudo iniciar el bot de Telegram');
    }
  })();
}

async function shutdown(signal) {
  // Close external resources that can otherwise keep the process alive during
  // tests, Docker stops or local Ctrl+C.
  if (telegramReady) {
    try {
      getBot()?.stop(signal);
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo detener el bot de Telegram');
    }
  }
  closeTranslationCache();
  await clusterState.close();
}

process.once('SIGINT', () => {
  shutdown('SIGINT').catch(error => logger.error({ err: error }, 'Error durante SIGINT'));
});
process.once('SIGTERM', () => {
  shutdown('SIGTERM').catch(error => logger.error({ err: error }, 'Error durante SIGTERM'));
});

if (require.main === module) start();

module.exports = {
  httpServer,
  io,
  start,
  closeDb,
  getGeoInfo,
  translate,
  translateForAdmin,
  clearTranslationCache,
  closeTranslationCache,
  HELP_COMMANDS,
  HELP_TOPICS,
  WIDGET_MESSAGES,
  clusterState,
  resolveTelegramReplySessionId,
  security: {
    escapeTelegramHtml,
    sanitizeText,
    sanitizeName,
    sanitizePage,
    sanitizeLanguage,
    sanitizeUserAgent,
  },
};
