'use strict';

const path = require('path');
const multer = require('multer');
const { Router } = require('express');
const { sanitizeText } = require('../utils/sanitizer');
const { createSettingsService } = require('../services/settings');
const { llmService: defaultLlmService } = require('../services/llm');
const defaultAiBot = require('../services/ai-bot');
const { createRagService } = require('../services/rag');
const { extractPdfText } = require('../utils/pdf');
const { createMasterPromptService } = require('../services/master-prompt');
const { createSafeFetch } = require('../utils/fetch');
const { createThemesService } = require('../services/themes');
const { stripEnvQuotes } = require('../config/index');

// Env token used for the empty-save fallback (ADR-5): a cleared settings token
// falls back to the env token or stops. deps.telegramEnvToken (server-wired)
// wins; otherwise the raw env value is read and quote-stripped like config does.
function resolveTelegramEnvToken(envToken) {
  if (envToken !== undefined) {
    return typeof envToken === 'string' ? envToken.trim() : '';
  }
  return stripEnvQuotes(process.env.TELEGRAM_TOKEN);
}

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

function githubReadmeApiUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const owner = encodeURIComponent(parts[0]);
    const repository = encodeURIComponent(parts[1].replace(/\.git$/i, ''));
    if (!repository) return null;
    return `https://api.github.com/repos/${owner}/${repository}/readme`;
  } catch {
    return null;
  }
}

const GITHUB_REPOSITORY_LIMITS = Object.freeze({
  maxFiles: 200,
  maxFileBytes: 128 * 1024,
  maxTotalBytes: 3 * 1024 * 1024,
  maxTreeEntries: 5000,
  concurrency: 5,
  timeoutMs: 30000,
});
const GITHUB_TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.conf', '.cpp', '.css', '.go', '.h', '.html', '.java', '.js', '.json', '.jsx', '.md', '.mjs',
  '.php', '.properties', '.py', '.rb', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const GITHUB_EXCLUDED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.output', '.secrets', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'secrets',
  'target', 'vendor',
]);

function parseGithubRepositoryUrl(value) {
  const apiUrl = githubReadmeApiUrl(value);
  if (!apiUrl) return null;
  const { pathname } = new URL(value);
  const [owner, rawRepository] = pathname.split('/').filter(Boolean);
  const repository = rawRepository.replace(/\.git$/i, '');
  return {
    owner,
    repository,
    apiUrl: apiUrl.replace(/\/readme$/, ''),
    sourceKey: `https://github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`,
  };
}

function normalizeGithubSelection(mode, includePaths) {
  const normalizedMode = mode === undefined ? 'repository' : String(mode);
  if (!['readme', 'docs', 'repository'].includes(normalizedMode)) throw new Error('Modo de ingesta GitHub inválido');
  if (includePaths === undefined) return { mode: normalizedMode, includePaths: [] };
  if (!Array.isArray(includePaths) || includePaths.length > 20) throw new Error('includePaths debe ser un array de hasta 20 rutas');
  const normalizedPaths = includePaths.map(value => String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
  if (normalizedPaths.some(value => !value || value.length > 160 || value.startsWith('/') || value.split('/').includes('..') || value.includes('\0'))) {
    throw new Error('includePaths contiene una ruta inválida');
  }
  return { mode: normalizedMode, includePaths: [...new Set(normalizedPaths)] };
}

function isUsefulGithubPath(filePath, size) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  const basename = parts.at(-1)?.toLowerCase() || '';
  if (!normalized || !Number.isFinite(size) || size <= 0 || size > GITHUB_REPOSITORY_LIMITS.maxFileBytes) return false;
  if (parts.slice(0, -1).some(part => GITHUB_EXCLUDED_DIRECTORIES.has(part.toLowerCase()))) return false;
  if (/^(?:\.env(?:\..*)?|.*(?:-lock\.json|\.(?:lock|map|min\.js|min\.css|pem|key|p12|pfx)))$/i.test(basename)) return false;
  if (/(?:credential|secret|private[-_]?key)/i.test(basename)) return false;
  if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.pypirc|\.netrc)$/i.test(basename)) return false;
  if (/^(?:readme|license|changelog|contributing)(?:\.[^.]+)?$/i.test(basename)) return true;
  const dot = basename.lastIndexOf('.');
  return dot >= 0 && GITHUB_TEXT_EXTENSIONS.has(basename.slice(dot));
}

function githubPathPriority(filePath) {
  const normalized = filePath.toLowerCase();
  if (/^(readme|license|changelog|contributing)(\.|$)/.test(normalized)) return 0;
  if (normalized.startsWith('docs/')) return 1;
  if (/^(src|lib|app)\//.test(normalized)) return 2;
  if (!normalized.includes('/')) return 3;
  if (/^(test|tests|spec)\//.test(normalized)) return 5;
  return 4;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchGithubRepository({ repository, fetchUrl, signal, selection = { mode: 'repository', includePaths: [] } }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'LiveChat-Pro/1.0' };
  const metadataResponse = await fetchUrl(repository.apiUrl, { signal, headers, timeoutMs: GITHUB_REPOSITORY_LIMITS.timeoutMs });
  if (!metadataResponse.ok) throw new Error(`GitHub metadata HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const branch = String(metadata.default_branch || 'main');
  const commitResponse = await fetchUrl(`${repository.apiUrl}/commits/${encodeURIComponent(branch)}`, { signal, headers, timeoutMs: GITHUB_REPOSITORY_LIMITS.timeoutMs });
  if (!commitResponse.ok) throw new Error(`GitHub commit HTTP ${commitResponse.status}`);
  const commit = await commitResponse.json();
  const commitSha = String(commit.sha || '');
  const treeSha = String(commit.commit?.tree?.sha || '');
  if (!commitSha || !treeSha) throw new Error('GitHub no devolvió un snapshot válido del repositorio');
  const treeUrl = `${repository.apiUrl}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`;
  const treeResponse = await fetchUrl(treeUrl, { signal, headers, timeoutMs: GITHUB_REPOSITORY_LIMITS.timeoutMs });
  if (!treeResponse.ok) throw new Error(`GitHub tree HTTP ${treeResponse.status}`);
  const tree = await treeResponse.json();
  if (tree.truncated) throw new Error('El árbol del repositorio GitHub excede el límite de la API');
  if (!Array.isArray(tree.tree) || tree.tree.length > GITHUB_REPOSITORY_LIMITS.maxTreeEntries) {
    throw new Error('El repositorio GitHub excede el límite de entradas permitido');
  }

  const candidates = tree.tree
    .filter(item => item.type === 'blob' && isUsefulGithubPath(item.path, item.size))
    .filter(item => {
      const lower = item.path.toLowerCase();
      const basename = lower.split('/').at(-1);
      if (selection.mode === 'readme' && !/^readme(?:\.|$)/.test(basename)) return false;
      if (selection.mode === 'docs' && !lower.startsWith('docs/') && !/^readme(?:\.|$)/.test(basename)) return false;
      return !selection.includePaths.length || selection.includePaths.some(prefix => item.path === prefix || item.path.startsWith(`${prefix}/`));
    })
    .sort((a, b) => githubPathPriority(a.path) - githubPathPriority(b.path) || a.path.localeCompare(b.path));
  if (candidates.length > GITHUB_REPOSITORY_LIMITS.maxFiles) throw new Error('La selección excede el límite de archivos permitido');
  const declaredTotal = candidates.reduce((total, file) => total + file.size, 0);
  if (declaredTotal > GITHUB_REPOSITORY_LIMITS.maxTotalBytes) throw new Error('La selección excede el tamaño total permitido');
  const selected = candidates;

  const downloaded = await mapWithConcurrency(selected, GITHUB_REPOSITORY_LIMITS.concurrency, async (file) => {
    const rawPath = file.path.split('/').map(encodeURIComponent).join('/');
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/${encodeURIComponent(commitSha)}/${rawPath}`;
    const response = await fetchUrl(rawUrl, { signal, headers: { 'User-Agent': 'LiveChat-Pro/1.0' }, timeoutMs: GITHUB_REPOSITORY_LIMITS.timeoutMs, maxBytes: GITHUB_REPOSITORY_LIMITS.maxFileBytes });
    if (!response.ok) throw new Error(`GitHub raw ${file.path} HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > GITHUB_REPOSITORY_LIMITS.maxFileBytes) {
      throw new Error(`El archivo ${file.path} excede el tamaño permitido`);
    }
    const bytesBuffer = Buffer.from(await response.arrayBuffer());
    if (bytesBuffer.length > GITHUB_REPOSITORY_LIMITS.maxFileBytes) throw new Error(`El archivo ${file.path} excede el tamaño permitido`);
    if (bytesBuffer.includes(0)) throw new Error(`El archivo ${file.path} contiene datos binarios`);
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytesBuffer);
    } catch {
      throw new Error(`El archivo ${file.path} no es UTF-8 válido`);
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (!content.trim()) throw new Error(`El archivo ${file.path} está vacío`);
    return { path: file.path, content: content.trim(), bytes };
  });

  const sections = [];
  let totalBytes = 0;
  for (const file of downloaded) {
    if (totalBytes + file.bytes > GITHUB_REPOSITORY_LIMITS.maxTotalBytes) {
      throw new Error('El contenido descargado excede el tamaño total permitido');
    }
    sections.push(`--- FILE: ${file.path} ---\n${file.content}`);
    totalBytes += file.bytes;
  }

  if (!sections.length) throw new Error('El repositorio GitHub no contiene archivos de texto admitidos');
  const heading = [`Repository: ${metadata.full_name || `${repository.owner}/${repository.repository}`}`];
  if (metadata.description) heading.push(`Description: ${metadata.description}`);
  return `${heading.join('\n')}\n\n${sections.join('\n\n')}`;
}

// Admin routes expose the single-operator web panel and all privileged chat
// mutations. Authentication and CSRF helpers are injected from server.js so tests
// can exercise the router with the same policies as production.
function createAdminRouter(deps) {
  const settingsService = deps.settingsService || createSettingsService({ db: deps.db, stmts: deps.stmts });
  const llmService = deps.llmService || defaultLlmService;
  const aiBot = deps.aiBot || defaultAiBot;
  const ragService = deps.ragService || createRagService({ db: deps.db, stmts: deps.stmts });
  const masterPromptService = deps.masterPromptService || createMasterPromptService({ settingsService });
  const themesService = deps.themesService || createThemesService({ settingsService });
  const telegramBot = deps.telegramBot || require('../telegram/bot');
  const fetchUrl = deps.fetch || createSafeFetch();
  const stageRagText = ragService.stageText?.bind(ragService) || ragService.ingestText?.bind(ragService);

  const {
    rootDir,
    adminPanelPassword,
    adminCookieName,
    adminSessionTtlMs,
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
    telegramEnvToken,
  } = deps;

  const router = Router();

  // Ban and block share the same enforcement path: persist the ban, disconnect
  // active sockets, remove shared session presence and notify admin clients.
  async function banSession(session, reason) {
    session.banned = true;
    session.connected = false;
    session.socketCount = 0;
    try {
      await stmts.banSession.run(session.sessionId);
    } catch (dbError) {
      logger.error({ err: dbError, sessionId: session.sessionId }, `Error BD en banSession (${reason})`);
    }
    await clusterState.addBanned(session.sessionId);
    const sockets = await io.in(sessionRoom(session.sessionId)).fetchSockets();
    for (const activeSocket of sockets) {
      activeSocket.emit('banned');
      activeSocket.disconnect(true);
    }
    await clusterState.deleteSession(session.sessionId);
    sessions.delete(session.sessionId);
    broadcastAdminSessionUpdate(session, { reason });
  }

  // Serving /admin also seeds the CSRF cookie used by the first login request.
  router.get('/admin', (req, res) => {
    ensureCsrfCookie(req, res);
    res.sendFile(path.join(rootDir, 'public', 'admin.html'));
  });

  router.get('/api/admin/me', (req, res) => {
    ensureCsrfCookie(req, res);
    res.json({
      enabled: !!adminPanelPassword,
      authenticated: verifyAdminToken(req.cookies?.[adminCookieName]),
    });
  });

  router.post('/api/admin/login', loginLimiter, requireCsrf, (req, res) => {
    if (!adminPanelPassword) {
      return res.status(503).json({ error: 'El panel admin no está habilitado. Define ADMIN_PANEL_PASSWORD.' });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password !== adminPanelPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.cookie(adminCookieName, createAdminToken(), {
      httpOnly: true,
      sameSite: sameSiteForRequest(req),
      secure: shouldUseSecureAdminCookie(req),
      maxAge: adminSessionTtlMs,
      path: '/',
    });

    return res.json({ ok: true });
  });

  router.post('/api/admin/logout', requireAdmin, requireCsrf, (req, res) => {
    res.clearCookie(adminCookieName, {
      path: '/',
      httpOnly: true,
      sameSite: sameSiteForRequest(req),
      secure: shouldUseSecureAdminCookie(req),
    });
    res.json({ ok: true });
  });

  router.get('/api/admin/sessions', requireAdmin, async (_req, res) => {
    res.json({ sessions: await listSessionsForAdmin() });
  });

  router.get('/api/admin/metrics/general', requireAdmin, async (_req, res) => {
    res.json({ ok: true, metrics: await getGeneralAdminMetrics() });
  });

  router.get('/api/admin/sessions/:sessionId', requireAdmin, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    return res.json({
      session: serializeSession(session),
      messages: await Promise.all(session.messages.map(serializeMessageForAdmin)),
    });
  });

  router.post('/api/admin/sessions/:sessionId/message', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const text = sanitizeText(req.body?.text);
    if (!text) return res.status(400).json({ error: 'El mensaje está vacío' });

    const result = await sendAdminReplyToSession(session, text);
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    await sendAdminTypingToSession(session, false);

    // Sending a reply implies the admin has read up to that message.
    const seenTs = result.message?.ts || Date.now();
    session.adminLastSeenTs = Math.max(session.adminLastSeenTs || 0, seenTs);
    try {
      await stmts.markAdminSeen.run(session.adminLastSeenTs, session.sessionId);
    } catch (dbError) {
      logger.error({ err: dbError, sessionId: session.sessionId }, 'Error BD en markAdminSeen (send message)');
    }
    await syncSharedSession(session);

    return res.json({
      ok: true,
      delivered: !!result.delivered,
      pending: !result.delivered,
      message: await serializeMessageForAdmin(result.message),
      session: serializeSession(session),
    });
  });

  router.post('/api/admin/sessions/:sessionId/read', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const reader = req.body?.reader === 'user' ? 'user' : 'admin';
    const candidateTs = Number(req.body?.ts);
    const ts = Number.isFinite(candidateTs) && candidateTs > 0 ? Math.floor(candidateTs) : Date.now();

    if (reader === 'admin') {
      session.adminLastSeenTs = Math.max(session.adminLastSeenTs || 0, ts);
      try {
        await stmts.markAdminSeen.run(session.adminLastSeenTs, session.sessionId);
      } catch (dbError) {
        logger.error({ err: dbError, sessionId: session.sessionId }, 'Error BD en markAdminSeen (REST)');
      }
    } else {
      session.userLastSeenTs = Math.max(session.userLastSeenTs || 0, ts);
      try {
        await stmts.markUserSeen.run(session.userLastSeenTs, session.sessionId);
      } catch (dbError) {
        logger.error({ err: dbError, sessionId: session.sessionId }, 'Error BD en markUserSeen (REST)');
      }
    }

    await syncSharedSession(session);
    broadcastAdminSessionUpdate(session, { reason: `${reader}_read` });
    return res.json({ ok: true, session: serializeSession(session) });
  });


  router.post('/api/admin/sessions/:sessionId/bot', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
      const session = await ensureSessionLoaded(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      session.botSilenced = !enabled;
      await stmts.updateBotSilenced?.run(session.botSilenced ? 1 : 0, sessionId);
      await syncSharedSession(session);
      broadcastAdminSessionUpdate(session, { reason: 'bot_toggle' });
      res.json({ ok: true, botSilenced: session.botSilenced, session: serializeSession(session) });
    } catch (err) {
      logger.error({ err }, 'Error toggling bot for session');
      res.status(500).json({ error: 'Internal error' });
    }
  });

  router.post('/api/admin/sessions/:sessionId/typing', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const active = req.body?.active !== false;
    if (!(await sendAdminTypingToSession(session, active))) {
      return res.status(409).json({ error: 'El usuario está desconectado.' });
    }

    return res.json({ ok: true, active });
  });

  router.post('/api/admin/sessions/:sessionId/clear', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    await clearSessionChat(session);
    return res.json({ ok: true, session: serializeSession(session), messages: [] });
  });

  router.delete('/api/admin/sessions/:sessionId', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    await deleteAdminSession(session);
    return res.json({ ok: true });
  });

  router.post('/api/admin/sessions/:sessionId/ban', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    await banSession(session, 'banned');
    return res.json({ ok: true, session: serializeSession(session) });
  });

  router.post('/api/admin/sessions/:sessionId/block', requireAdmin, requireCsrf, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    await banSession(session, 'blocked');
    return res.json({ ok: true, session: serializeSession(session) });
  });

  // ── LLM Settings Routes ───────────────────────────────────────────
  async function handleGetLlmSettings(_req, res) {
    try {
      const enabledVal = await settingsService.getJSON('ai.enabled', null);
      const enabled = enabledVal !== null ? Boolean(enabledVal) : aiBot.isEnabled();
      const rawDefaultProvider = await settingsService.get('llm.default_provider');
      const supported = llmService.getSupportedProviders();
      const providers = {};
      let firstConfigured = null;

      for (const provider of supported) {
        const raw = await settingsService.getJSON(`llm.provider.${provider}`, null);
        const models = typeof llmService.getProviderModels === 'function'
          ? llmService.getProviderModels(provider)
          : [];
        const catalogDefault = models[0] || 'gpt-4o-mini';
        if (raw && (raw.encKey || raw.apiKey)) {
          if (!firstConfigured) {
            firstConfigured = provider;
          }
          let plainKey = '';
          if (raw.encKey) {
            try { plainKey = settingsService.decryptSecret(raw.encKey); } catch {}
          } else {
            plainKey = raw.apiKey || '';
          }
          providers[provider] = {
            configured: true,
            maskedKey: settingsService.maskSecret(plainKey),
            model: raw.model || catalogDefault,
            models,
          };
        } else {
          providers[provider] = {
            configured: false,
            maskedKey: '',
            model: catalogDefault,
            models,
          };
        }
      }

      const defaultProvider = rawDefaultProvider || firstConfigured || null;

      return res.json({ ok: true, enabled, defaultProvider, providers });
    } catch (err) {
      logger.error?.({ err }, 'Error fetching LLM settings');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  router.get('/api/admin/llm', requireAdmin, handleGetLlmSettings);
  router.get('/api/admin/settings/llm', requireAdmin, handleGetLlmSettings);

  router.post('/api/admin/settings/llm/verify-key', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const { provider, apiKey, model } = req.body || {};
      const normProvider = String(provider || '').toLowerCase().trim();
      const supported = llmService.getSupportedProviders();

      if (!supported.includes(normProvider)) {
        return res.status(400).json({ ok: false, error: `Unsupported provider: ${provider}` });
      }

      const catalogModels = typeof llmService.getProviderModels === 'function' ? llmService.getProviderModels(normProvider) : [];
      const catalogDefault = catalogModels[0] || 'gpt-4o-mini';
      const resolvedModel = model || catalogDefault;

      const verifyRes = await llmService.verifyConnection(normProvider, apiKey, resolvedModel);
      if (!verifyRes.ok) {
        return res.status(400).json({ ok: false, error: verifyRes.error || 'Key verification failed' });
      }

      // Prefer live model listing from the provider API; fall back to the
      // static catalog when listing is unavailable (returns [] or the service
      // has no listModels). ADR-3 keeps the {ok, models} contract unchanged.
      const apiModels =
        typeof llmService.listModels === 'function'
          ? await llmService.listModels(normProvider, apiKey)
          : [];
      const models = apiModels.length ? apiModels : catalogModels;
      return res.json({ ok: true, models });
    } catch (err) {
      logger.error?.({ err }, 'Error verifying LLM key');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  async function handlePutLlmProvider(req, res) {
    try {
      const provider = req.params.name || req.body?.provider || 'openai';
      const normProvider = String(provider).toLowerCase().trim();
      const supported = llmService.getSupportedProviders();

      if (!supported.includes(normProvider)) {
        return res.status(400).json({ ok: false, error: `Unsupported provider: ${provider}` });
      }

      const catalogModels = typeof llmService.getProviderModels === 'function' ? llmService.getProviderModels(normProvider) : [];
      const catalogDefault = catalogModels[0] || 'gpt-4o-mini';
      const apiKey = req.body?.apiKey || req.body?.key;
      const model = req.body?.model || catalogDefault;

      if (apiKey) {
        const verifyRes = await llmService.verifyConnection(normProvider, apiKey, model);
        if (!verifyRes.ok) {
          return res.status(400).json({ ok: false, error: verifyRes.error || 'Invalid API key' });
        }
        const encKey = settingsService.encryptSecret(apiKey);
        await settingsService.setJSON(`llm.provider.${normProvider}`, {
          encKey,
          model,
          verifiedAt: Date.now(),
        });
        const currentDefault = await settingsService.get('llm.default_provider');
        if (!currentDefault) {
          await settingsService.set('llm.default_provider', normProvider);
        }
      } else if (req.body?.model) {
        const existing = (await settingsService.getJSON(`llm.provider.${normProvider}`)) || {};
        await settingsService.setJSON(`llm.provider.${normProvider}`, {
          ...existing,
          model: req.body.model,
        });
      }

      // Reconfigure aiBot with updated settings
      const defaultProvider = (await settingsService.get('llm.default_provider')) || normProvider;
      const activeRaw = await settingsService.getJSON(`llm.provider.${defaultProvider}`);
      let activeKey = '';
      if (activeRaw?.encKey) {
        try { activeKey = settingsService.decryptSecret(activeRaw.encKey); } catch {}
      }
      aiBot.configure({
        provider: defaultProvider,
        apiKey: activeKey,
        model: activeRaw?.model || model,
      });

      return res.json({
        ok: true,
        provider: normProvider,
        configured: true,
        maskedKey: apiKey ? settingsService.maskSecret(apiKey) : undefined,
        model,
      });
    } catch (err) {
      logger.error?.({ err }, 'Error updating LLM provider');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }

  router.put('/api/admin/llm/providers/:name', requireAdmin, requireCsrf, handlePutLlmProvider);
  router.put('/api/admin/settings/llm/providers/:name', requireAdmin, requireCsrf, handlePutLlmProvider);

  async function handlePutLlmSettings(req, res) {
    try {
      if (req.body?.enabled !== undefined) {
        const enabled = Boolean(req.body.enabled);
        await settingsService.setJSON('ai.enabled', enabled);
        aiBot.configure({ enabled });
        return res.json({ ok: true, enabled });
      }

      if (req.body?.provider || req.body?.apiKey) {
        return handlePutLlmProvider(req, res);
      }

      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    } catch (err) {
      logger.error?.({ err }, 'Error updating LLM settings');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }

  router.put('/api/admin/settings/llm', requireAdmin, requireCsrf, handlePutLlmSettings);

  router.put('/api/admin/llm/default', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const provider = String(req.body?.provider || '').toLowerCase().trim();
      const supported = llmService.getSupportedProviders();
      if (!supported.includes(provider)) {
        return res.status(400).json({ ok: false, error: `Unsupported provider: ${req.body?.provider}` });
      }

      await settingsService.set('llm.default_provider', provider);
      const activeRaw = await settingsService.getJSON(`llm.provider.${provider}`);
      let activeKey = '';
      if (activeRaw?.encKey) {
        try { activeKey = settingsService.decryptSecret(activeRaw.encKey); } catch {}
      }
      const catalogModels = typeof llmService.getProviderModels === 'function' ? llmService.getProviderModels(provider) : [];
      const catalogDefault = catalogModels[0] || 'gpt-4o-mini';
      aiBot.configure({
        provider,
        apiKey: activeKey,
        model: activeRaw?.model || catalogDefault,
      });

      return res.json({ ok: true, defaultProvider: provider });
    } catch (err) {
      logger.error?.({ err }, 'Error updating default LLM provider');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  router.put('/api/admin/llm/enabled', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const enabled = Boolean(req.body?.enabled);
      await settingsService.setJSON('ai.enabled', enabled);
      aiBot.configure({ enabled });
      return res.json({ ok: true, enabled });
    } catch (err) {
      logger.error?.({ err }, 'Error updating global AI enabled state');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // ── Master Prompt Admin Routes ────────────────────────────────────
  const handleGetMasterPrompt = async (_req, res) => {
    try {
      const prompt = await masterPromptService.getPrompt();
      return res.json({ ok: true, prompt });
    } catch (err) {
      logger.error?.({ err }, 'Error getting master prompt');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  };

  const handlePutMasterPrompt = async (req, res) => {
    try {
      const { prompt } = req.body || {};
      if (typeof prompt !== 'string') return res.status(400).json({ ok: false, error: 'prompt must be a string' });
      if (prompt.length > 20000) return res.status(413).json({ ok: false, error: 'prompt exceeds the 20,000 character limit' });
      const savedPrompt = await masterPromptService.setPrompt(prompt);
      aiBot.configure({ masterPromptService });
      return res.json({ ok: true, prompt: savedPrompt });
    } catch (err) {
      logger.error?.({ err }, 'Error updating master prompt');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  };

  router.get('/api/admin/master-prompt', requireAdmin, handleGetMasterPrompt);
  router.get('/api/admin/settings/prompt', requireAdmin, handleGetMasterPrompt);
  router.put('/api/admin/master-prompt', requireAdmin, requireCsrf, handlePutMasterPrompt);
  router.put('/api/admin/settings/prompt', requireAdmin, requireCsrf, handlePutMasterPrompt);

  // ── Telegram Admin Routes ─────────────────────────────────────────
  async function handleGetTelegramStatus(_req, res) {
    try {
      const persistedAdminId = await settingsService.get('telegram.admin_id');
      // Lazy identity refresh (ADR-9): never at boot/launch, only on status view.
      await telegramBot.refreshTelegramIdentity?.();
      const botStatus = telegramBot.getTelegramStatus?.() || { status: 'stopped', adminId: null, configured: false };
      const adminId = persistedAdminId || botStatus.adminId || null;

      if (persistedAdminId && typeof telegramBot.setTelegramAdminId === 'function') {
        telegramBot.setTelegramAdminId(persistedAdminId);
      }

      const adminUsername = await settingsService.get('telegram.admin_username', '');

      return res.json({
        ok: true,
        status: botStatus.status,
        adminId: adminId ? String(adminId) : null,
        configured: Boolean(botStatus.configured),
        botUsername: botStatus.botUsername ?? null,
        botFirstName: botStatus.botFirstName ?? null,
        maskedToken: botStatus.maskedToken ?? null,
        tokenSource: botStatus.tokenSource ?? null,
        adminUsername: adminUsername || null,
      });
    } catch (err) {
      logger.error?.({ err }, 'Error fetching Telegram status');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }

  router.get('/api/admin/telegram/status', requireAdmin, handleGetTelegramStatus);
  router.get('/api/admin/settings/telegram', requireAdmin, handleGetTelegramStatus);

  router.post('/api/admin/telegram/start', requireAdmin, requireCsrf, async (_req, res) => {
    try {
      const result = await telegramBot.startTelegramBot?.();
      return res.json({ ok: true, status: result?.status || 'running' });
    } catch (err) {
      logger.error?.({ err }, 'Error starting Telegram bot');
      return res.status(400).json({ ok: false, error: err.message || 'Could not start Telegram bot', status: 'not-configured' });
    }
  });

  router.post('/api/admin/telegram/stop', requireAdmin, requireCsrf, async (_req, res) => {
    try {
      const result = await telegramBot.stopTelegramBot?.();
      return res.json({ ok: true, status: result?.status || 'stopped' });
    } catch (err) {
      logger.error?.({ err }, 'Error stopping Telegram bot');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // Current admin ID for reconfigure calls: persisted settings win, the live
  // singleton falls back.
  async function currentTelegramAdminId() {
    const persisted = await settingsService.get('telegram.admin_id');
    return persisted || telegramBot.getTelegramStatus?.()?.adminId || null;
  }

  // Token mutation shared by both PUT aliases (ADR-5): verify-then-save mirrors
  // the LLM provider flow. Empty saves clear the stored token (env/stop
  // fallback). Responses only ever carry maskedToken/tokenSource — never the
  // full token (spec: token/botToken MUST NOT appear).
  async function handlePutTelegramToken(req, res) {
    const token = String(req.body.token).trim();

    if (!token) {
      const envToken = resolveTelegramEnvToken(telegramEnvToken);
      await settingsService.delete('telegram.token');
      await telegramBot.reconfigureTelegramBot?.({
        token: envToken || null,
        adminId: (await currentTelegramAdminId()) || undefined,
        launch: false,
        tokenSource: envToken ? 'env' : 'none',
      });
      const botStatus = telegramBot.getTelegramStatus?.() || {};
      return res.json({
        ok: true,
        maskedToken: envToken ? settingsService.maskSecret(envToken) : null,
        tokenSource: envToken ? 'env' : 'none',
        status: botStatus.status || 'not-configured',
      });
    }

    const verifyRes = await telegramBot.verifyTelegramToken(token);
    if (!verifyRes?.ok) {
      return res.status(400).json({ ok: false, error: verifyRes?.error || 'Invalid Telegram token' });
    }

    const encKey = settingsService.encryptSecret(token);
    await settingsService.setJSON('telegram.token', { encKey, verifiedAt: Date.now() });

    await telegramBot.reconfigureTelegramBot?.({
      token,
      adminId: (await currentTelegramAdminId()) || undefined,
      launch: true,
      tokenSource: 'settings',
    });

    const botStatus = telegramBot.getTelegramStatus?.() || {};
    return res.json({
      ok: true,
      maskedToken: settingsService.maskSecret(token),
      tokenSource: 'settings',
      status: botStatus.status || 'running',
    });
  }

  async function handlePutTelegramAdminId(req, res) {
    try {
      const candidate = req.body?.adminId !== undefined ? req.body.adminId : req.body?.admin_id;
      const str = String(candidate ?? '').trim();
      if (!str || !/^\d+$/.test(str)) {
        return res.status(400).json({ ok: false, error: 'Admin ID must be a numeric string' });
      }

      await settingsService.set('telegram.admin_id', str);
      if (typeof telegramBot.setTelegramAdminId === 'function') {
        telegramBot.setTelegramAdminId(str);
      }

      return res.json({ ok: true, adminId: str });
    } catch (err) {
      logger.error?.({ err }, 'Error setting Telegram admin ID');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }

  // Shared PUT dispatcher (ADR-5): token vs adminId vs adminUsername on both
  // aliases, mirroring handlePutLlmSettings. All mutations are behind
  // requireAdmin + requireCsrf (threat matrix).
  async function handlePutTelegram(req, res) {
    try {
      if (typeof req.body?.token === 'string') {
        return await handlePutTelegramToken(req, res);
      }
      if (req.body?.adminId !== undefined || req.body?.admin_id !== undefined) {
        return await handlePutTelegramAdminId(req, res);
      }
      if (req.body?.adminUsername !== undefined) {
        const username = String(req.body.adminUsername).trim();
        await settingsService.set('telegram.admin_username', username);
        return res.json({ ok: true, adminUsername: username });
      }
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    } catch (err) {
      logger.error?.({ err }, 'Error updating Telegram settings');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }

  router.put('/api/admin/telegram/admin-id', requireAdmin, requireCsrf, handlePutTelegram);
  router.put('/api/admin/settings/telegram', requireAdmin, requireCsrf, handlePutTelegram);

  // ── Themes Settings Routes ─────────────────────────────────────────
  async function handleGetThemeSettings(_req, res) {
    try {
      const active = await themesService.getActiveTheme();
      const catalog = themesService.getCatalog();
      return res.json({ ok: true, active: active.name, theme: active, presets: catalog.presets });
    } catch (err) {
      logger.error?.({ err }, 'Error fetching theme settings');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  router.get('/api/admin/themes', requireAdmin, handleGetThemeSettings);
  router.get('/api/admin/settings/theme', requireAdmin, handleGetThemeSettings);

  async function handlePutThemeSettings(req, res) {
    try {
      const name = req.body?.name || req.body?.theme;
      if (!themesService.isValidTheme(name)) {
        return res.status(400).json({ ok: false, error: 'Tema inválido' });
      }
      const updatedTheme = await themesService.setActiveTheme(name);
      if (io && typeof io.emit === 'function') {
        io.emit('theme:update', { name: updatedTheme.name, vars: updatedTheme.vars });
      }
      return res.json({ ok: true, active: updatedTheme.name, theme: updatedTheme });
    } catch (err) {
      logger.error?.({ err }, 'Error updating theme settings');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }

  router.put('/api/admin/themes/active', requireAdmin, requireCsrf, handlePutThemeSettings);
  router.put('/api/admin/settings/theme', requireAdmin, requireCsrf, handlePutThemeSettings);

  // ── RAG Admin Routes ──────────────────────────────────────────────
  let ragReadinessCache = null;
  const RAG_READINESS_TTL_MS = 10000;
  const RAG_READINESS_TIMEOUT_MS = 5000;

  async function getRagIndexReadiness() {
    const documents = await ragService.listDocuments();
    const pendingCount = documents.filter(document => document.status === 'pending').length;
    const persistedEnabled = await settingsService.getJSON('ai.enabled', null);
    const enabled = persistedEnabled === null ? aiBot.isEnabled() : persistedEnabled === true;
    if (!enabled) return { ready: false, reason: 'El modelo inteligente está deshabilitado', pendingCount };
    const provider = String(await settingsService.get('llm.default_provider') || '').trim().toLowerCase();
    if (!provider) return { ready: false, reason: 'No hay un proveedor predeterminado configurado', pendingCount };
    const config = await settingsService.getJSON(`llm.provider.${provider}`, null);
    if (!config?.model || (!config.encKey && !config.apiKey)) {
      return { ready: false, reason: 'El proveedor predeterminado no está configurado completamente', pendingCount };
    }
    let apiKey = config.apiKey || '';
    try {
      if (config.encKey) apiKey = settingsService.decryptSecret(config.encKey);
    } catch {
      return { ready: false, reason: 'No se pudo leer la credencial del proveedor', pendingCount };
    }
    const cacheKey = `${provider}:${config.model}:${config.encKey || config.apiKey}`;
    let verification;
    if (ragReadinessCache?.key === cacheKey && ragReadinessCache.expiresAt > Date.now()) {
      verification = ragReadinessCache.verification;
    } else {
      let timer;
      try {
        verification = await Promise.race([
          llmService.verifyConnection(provider, apiKey, config.model),
          new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, error: 'La verificación del proveedor excedió el tiempo límite' }), RAG_READINESS_TIMEOUT_MS); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      ragReadinessCache = { key: cacheKey, verification, expiresAt: Date.now() + RAG_READINESS_TTL_MS };
    }
    if (!verification?.ok) {
      return { ready: false, reason: verification?.error || 'El proveedor no está disponible', pendingCount };
    }
    return { ready: true, reason: null, pendingCount };
  }

  router.get('/api/admin/rag/documents', requireAdmin, async (_req, res) => {
    try {
      const documents = await ragService.listDocuments();
      return res.json({ ok: true, documents });
    } catch (err) {
      logger.error?.({ err }, 'Error listing RAG documents');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  router.get('/api/admin/rag/status', requireAdmin, async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await getRagIndexReadiness()) });
    } catch (err) {
      logger.error?.({ err }, 'Error checking RAG indexing readiness');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  router.post('/api/admin/rag/index', requireAdmin, requireCsrf, async (_req, res) => {
    try {
      const readiness = await getRagIndexReadiness();
      if (!readiness.ready) return res.status(409).json({ ok: false, ...readiness });
      const result = await ragService.promotePending();
      return res.json({ ok: true, ...result });
    } catch (err) {
      logger.error?.({ err }, 'Error promoting pending RAG documents');
      return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
    }
  });

  router.delete('/api/admin/rag/documents/:id', requireAdmin, requireCsrf, async (req, res) => {
    try {
      const id = req.params.id;
      await ragService.deleteDocument(id);
      return res.json({ ok: true });
    } catch (err) {
      logger.error?.({ err }, 'Error deleting RAG document');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  async function handleIngestText(req, res) {
    try {
      const { title, text } = req.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ ok: false, error: 'El contenido de texto es requerido' });
      }
      const result = await stageRagText({
        sourceType: 'text',
        source: title || 'Texto manual',
        title: title || 'Texto manual',
        text: text.trim(),
      });
      return res.json({ ok: true, documentId: result.documentId, chunkCount: result.chunkCount, status: result.status });
    } catch (err) {
      logger.error?.({ err }, 'Error ingesting RAG text');
      return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
    }
  }
  router.post('/api/admin/rag/documents/text', requireAdmin, requireCsrf, handleIngestText);
  router.post('/api/admin/rag/ingest-text', requireAdmin, requireCsrf, handleIngestText);

  async function handleIngestUrl(req, res) {
    try {
      const { url, title, mode, includePaths } = req.body || {};
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        return res.status(400).json({ ok: false, error: 'URL inválida o no proporcionada' });
      }
      const cleanUrl = url.trim();
      const githubRepository = parseGithubRepositoryUrl(cleanUrl);
      let selection;
      if (githubRepository) {
        try {
          selection = normalizeGithubSelection(mode, includePaths);
        } catch (selectionError) {
          return res.status(400).json({ ok: false, error: selectionError.message });
        }
      }
      const controller = new AbortController();
      const timeoutMs = githubRepository ? GITHUB_REPOSITORY_LIMITS.timeoutMs : 10000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let textContent;
      try {
        if (githubRepository) {
          textContent = await fetchGithubRepository({
            repository: githubRepository,
            fetchUrl,
            signal: controller.signal,
            selection,
          });
        } else {
          const response = await fetchUrl(cleanUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'LiveChat-Pro/1.0' },
          });
          if (!response.ok) {
            return res.status(400).json({ ok: false, error: `La URL respondió con código HTTP ${response.status}` });
          }
          const rawText = await response.text();
          const contentType = response.headers.get('content-type') || '';
          textContent = contentType.includes('html') ? stripHtml(rawText) : rawText.trim();
        }
      } catch (fetchErr) {
        return res.status(400).json({ ok: false, error: `Error de conexión al obtener la URL: ${fetchErr.message}` });
      } finally {
        clearTimeout(timer);
      }

      if (!textContent) {
        return res.status(400).json({ ok: false, error: 'No se obtuvo contenido de texto ejecutable de la URL' });
      }

      const result = await stageRagText({
        sourceType: 'url',
        source: githubRepository?.sourceKey || cleanUrl,
        sourceKey: githubRepository?.sourceKey || cleanUrl,
        title: title || cleanUrl,
        text: textContent,
      });
      return res.json({ ok: true, documentId: result.documentId, chunkCount: result.chunkCount, status: result.status });
    } catch (err) {
      logger.error?.({ err }, 'Error ingesting RAG URL');
      return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
    }
  }
  router.post('/api/admin/rag/documents/url', requireAdmin, requireCsrf, handleIngestUrl);
  router.post('/api/admin/rag/ingest-url', requireAdmin, requireCsrf, handleIngestUrl);

  const uploadPdfMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
        return cb(Object.assign(new Error('Formato de archivo no soportado. Solo se admiten archivos PDF.'), { status: 415 }));
      }
      return cb(null, true);
    },
  }).single('file');

  function runPdfUpload(upload) {
    return (req, res, next) => {
      upload(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : (error.status || 400);
        return res.status(status).json({
          ok: false,
          error: status === 413 ? 'El archivo supera el límite de 5 MB' : error.message,
        });
      });
    };
  }

  async function handleIngestPdf(req, res) {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ ok: false, error: 'No se subió ningún archivo PDF' });
      }
      const buffer = req.file.buffer;
      if (buffer.length < 5 || buffer.toString('utf8', 0, 5) !== '%PDF-') {
        return res.status(415).json({ ok: false, error: 'Formato de archivo no soportado. Solo se admiten archivos PDF.' });
      }

      let pdfText;
      try {
        pdfText = await extractPdfText(buffer);
      } catch (pdfErr) {
        return res.status(400).json({ ok: false, error: `Error procesando PDF: ${pdfErr.message}` });
      }

      if (!pdfText || !pdfText.trim()) {
        return res.status(400).json({ ok: false, error: 'El archivo PDF no contiene texto legible' });
      }

      const originalName = req.file.originalname || 'documento.pdf';
      const result = await stageRagText({
        sourceType: 'pdf',
        source: originalName,
        title: originalName,
        text: pdfText.trim(),
      });
      return res.json({ ok: true, documentId: result.documentId, chunkCount: result.chunkCount, status: result.status });
    } catch (err) {
      logger.error?.({ err }, 'Error ingesting RAG PDF file');
      return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
    }
  }

  const uploadPdf = runPdfUpload(uploadPdfMiddleware);
  router.post('/api/admin/rag/documents/file', requireAdmin, requireCsrf, uploadPdf, handleIngestPdf);
  router.post('/api/admin/rag/ingest-pdf', requireAdmin, requireCsrf, uploadPdf, handleIngestPdf);

  return router;
}

module.exports = {
  createAdminRouter,
  fetchGithubRepository,
  githubReadmeApiUrl,
  isUsefulGithubPath,
  normalizeGithubSelection,
  parseGithubRepositoryUrl,
};
