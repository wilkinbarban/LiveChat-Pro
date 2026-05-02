'use strict';

const path = require('path');
const { Router } = require('express');
const { sanitizeText } = require('../utils/sanitizer');

// Admin routes expose the single-operator web panel and all privileged chat
// mutations. Authentication and CSRF helpers are injected from server.js so tests
// can exercise the router with the same policies as production.
function createAdminRouter(deps) {
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

  router.get('/api/admin/sessions', requireAdmin, async (req, res) => {
    res.json({ sessions: await listSessionsForAdmin() });
  });

  router.get('/api/admin/metrics/general', requireAdmin, async (req, res) => {
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

  return router;
}

module.exports = {
  createAdminRouter,
};
