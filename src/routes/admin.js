'use strict';

const path = require('path');
const { Router } = require('express');
const { sanitizeText } = require('../utils/sanitizer');
const { createSettingsService } = require('../services/settings');
const { llmService: defaultLlmService } = require('../services/llm');
const defaultAiBot = require('../services/ai-bot');

// Admin routes expose the single-operator web panel and all privileged chat
// mutations. Authentication and CSRF helpers are injected from server.js so tests
// can exercise the router with the same policies as production.
function createAdminRouter(deps) {
  const settingsService = deps.settingsService || createSettingsService({ db: deps.db, stmts: deps.stmts });
  const llmService = deps.llmService || defaultLlmService;
  const aiBot = deps.aiBot || defaultAiBot;

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

  return router;
}

module.exports = {
  createAdminRouter,
};
