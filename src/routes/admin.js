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
const { createThemesService } = require('../services/themes');

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
      const defaultProvider = (await settingsService.get('llm.default_provider')) || 'openai';
      const supported = llmService.getSupportedProviders();
      const providers = {};

      for (const provider of supported) {
        const raw = await settingsService.getJSON(`llm.provider.${provider}`, null);
        if (raw && (raw.encKey || raw.apiKey)) {
          let plainKey = '';
          if (raw.encKey) {
            try { plainKey = settingsService.decryptSecret(raw.encKey); } catch {}
          } else {
            plainKey = raw.apiKey || '';
          }
          providers[provider] = {
            configured: true,
            maskedKey: settingsService.maskSecret(plainKey),
            model: raw.model || 'gpt-4o-mini',
          };
        } else {
          providers[provider] = {
            configured: false,
            maskedKey: '',
            model: provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini',
          };
        }
      }

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

      const verifyRes = await llmService.verifyConnection(normProvider, apiKey, model || 'gpt-4o-mini');
      if (!verifyRes.ok) {
        return res.status(400).json({ ok: false, error: verifyRes.error || 'Key verification failed' });
      }

      return res.json({ ok: true });
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

      const apiKey = req.body?.apiKey || req.body?.key;
      const model = req.body?.model || 'gpt-4o-mini';

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
      aiBot.configure({
        provider,
        apiKey: activeKey,
        model: activeRaw?.model || 'gpt-4o-mini',
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
      const botStatus = telegramBot.getTelegramStatus?.() || { status: 'stopped', adminId: null, configured: false };
      const adminId = persistedAdminId || botStatus.adminId || null;

      if (persistedAdminId && typeof telegramBot.setTelegramAdminId === 'function') {
        telegramBot.setTelegramAdminId(persistedAdminId);
      }

      return res.json({
        ok: true,
        status: botStatus.status,
        adminId: adminId ? String(adminId) : null,
        configured: Boolean(botStatus.configured),
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

  router.put('/api/admin/telegram/admin-id', requireAdmin, requireCsrf, handlePutTelegramAdminId);
  router.put('/api/admin/settings/telegram', requireAdmin, requireCsrf, handlePutTelegramAdminId);

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
  router.get('/api/admin/rag/documents', requireAdmin, async (_req, res) => {
    try {
      const documents = await ragService.listDocuments();
      return res.json({ ok: true, documents });
    } catch (err) {
      logger.error?.({ err }, 'Error listing RAG documents');
      return res.status(500).json({ ok: false, error: 'Internal server error' });
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
      const result = await ragService.ingestText({
        sourceType: 'text',
        source: title || 'Texto manual',
        title: title || 'Texto manual',
        text: text.trim(),
      });
      return res.json({ ok: true, documentId: result.documentId, chunkCount: result.chunkCount });
    } catch (err) {
      logger.error?.({ err }, 'Error ingesting RAG text');
      return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
    }
  }
  router.post('/api/admin/rag/documents/text', requireAdmin, requireCsrf, handleIngestText);
  router.post('/api/admin/rag/ingest-text', requireAdmin, requireCsrf, handleIngestText);

  async function handleIngestUrl(req, res) {
    try {
      const { url, title } = req.body || {};
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        return res.status(400).json({ ok: false, error: 'URL inválida o no proporcionada' });
      }
      const cleanUrl = url.trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      let response;
      try {
        response = await fetch(cleanUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'LiveChat-Pro/1.0' },
        });
      } catch (fetchErr) {
        clearTimeout(timer);
        return res.status(400).json({ ok: false, error: `Error de conexión al obtener la URL: ${fetchErr.message}` });
      }
      clearTimeout(timer);

      if (!response.ok) {
        return res.status(400).json({ ok: false, error: `La URL respondió con código HTTP ${response.status}` });
      }

      const rawText = await response.text();
      const contentType = response.headers.get('content-type') || '';
      const textContent = contentType.includes('html') ? stripHtml(rawText) : rawText.trim();

      if (!textContent) {
        return res.status(400).json({ ok: false, error: 'No se obtuvo contenido de texto ejecutable de la URL' });
      }

      const result = await ragService.ingestText({
        sourceType: 'url',
        source: cleanUrl,
        title: title || cleanUrl,
        text: textContent,
      });
      return res.json({ ok: true, documentId: result.documentId, chunkCount: result.chunkCount });
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
      const result = await ragService.ingestText({
        sourceType: 'pdf',
        source: originalName,
        title: originalName,
        text: pdfText.trim(),
      });
      return res.json({ ok: true, documentId: result.documentId, chunkCount: result.chunkCount });
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
};
