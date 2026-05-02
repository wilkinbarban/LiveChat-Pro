'use strict';

function createSessionService(deps) {
  const {
    sessions,
    stmts,
    clusterState,
    logger,
    adminLanguage,
    translate,
  } = deps;

  function applySharedSessionSnapshot(session, snapshot) {
    if (!session || !snapshot) return session;

    session.name = snapshot.name ?? session.name;
    session.lang = snapshot.lang || session.lang;
    session.ip = snapshot.ip || session.ip;
    session.geo = snapshot.geo || session.geo;
    session.userAgent = snapshot.userAgent || session.userAgent;
    session.currentPage = snapshot.currentPage || session.currentPage;
    session.banned = typeof snapshot.banned === 'boolean' ? snapshot.banned : session.banned;
    session.priority = typeof snapshot.priority === 'boolean' ? snapshot.priority : session.priority;
    session.adminLastSeenTs = snapshot.adminLastSeenTs || session.adminLastSeenTs || 0;
    session.userLastSeenTs = snapshot.userLastSeenTs || session.userLastSeenTs || 0;
    session.awaitingName = typeof snapshot.awaitingName === 'boolean' ? snapshot.awaitingName : session.awaitingName;
    session.lastActive = snapshot.lastActive || session.lastActive;
    session.createdAt = snapshot.createdAt || session.createdAt;
    session.connected = typeof snapshot.connected === 'boolean' ? snapshot.connected : !!session.connected;
    session.socketCount = Number.isFinite(snapshot.socketCount) ? snapshot.socketCount : (session.socketCount || 0);
    return session;
  }

  async function syncSharedSession(session, overrides = {}) {
    const snapshot = await clusterState.syncSession(session, overrides);
    return applySharedSessionSnapshot(session, snapshot);
  }

  function dbRowToSession(row, messages = []) {
    return {
      sessionId: row.session_id,
      socketId: null,
      connected: false,
      socketCount: 0,
      name: row.name,
      lang: row.lang || 'es',
      langDetected: !!row.lang_detected,
      ip: row.ip,
      geo: {
        city: row.geo_city || 'Desconocido',
        country: row.geo_country || 'Desconocido',
        isp: row.geo_isp || 'Desconocido',
      },
      userAgent: row.user_agent || '',
      currentPage: row.current_page || '/',
      banned: !!row.banned,
      priority: !!row.priority,
      adminLastSeenTs: row.admin_last_seen_ts || 0,
      userLastSeenTs: row.user_last_seen_ts || 0,
      awaitingName: !!row.awaiting_name,
      lastActive: row.last_active,
      createdAt: row.created_at,
      typingMsgId: null,
      messages,
    };
  }

  function sessionToDBRow(session) {
    return {
      session_id: session.sessionId,
      name: session.name,
      lang: session.lang,
      lang_detected: session.langDetected ? 1 : 0,
      ip: session.ip,
      geo_city: session.geo?.city,
      geo_country: session.geo?.country,
      geo_isp: session.geo?.isp,
      user_agent: session.userAgent,
      current_page: session.currentPage,
      banned: session.banned ? 1 : 0,
      priority: session.priority ? 1 : 0,
      admin_last_seen_ts: session.adminLastSeenTs || 0,
      user_last_seen_ts: session.userLastSeenTs || 0,
      awaiting_name: session.awaitingName ? 1 : 0,
      last_active: session.lastActive,
      created_at: session.createdAt || Date.now(),
    };
  }

  function countUnreadForAdmin(session) {
    const lastSeen = session.adminLastSeenTs || 0;
    return session.messages.filter(message => message.from === 'user' && message.ts > lastSeen).length;
  }

  function countUnreadForUser(session) {
    const lastSeen = session.userLastSeenTs || 0;
    return session.messages.filter(message => (message.from === 'admin' || message.from === 'bot') && message.ts > lastSeen).length;
  }

  async function loadFromDB() {
    const bannedRows = await stmts.getAllBanned.all();
    await clusterState.seedBanned(bannedRows.map(row => row.session_id));

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await stmts.getRecentSessions.all(cutoff);
    const sharedSnapshots = await clusterState.getSessionSnapshots(rows.map(row => row.session_id));
    for (const row of rows) {
      const messageRows = await stmts.getMessages.all(row.session_id);
      const messages = messageRows.map(message => ({
        id: message.id,
        from: message.from_role,
        text: message.text,
        ts: message.ts,
        lang: message.lang,
      }));
      const hydratedMessages = deps.attachmentService
        ? await deps.attachmentService.attachFilesToMessages(messages)
        : messages;
      const session = dbRowToSession(row, hydratedMessages);
      applySharedSessionSnapshot(session, sharedSnapshots.get(row.session_id));
      sessions.set(row.session_id, session);
    }
    logger.info({ sessions: rows.length }, 'Sesiones restauradas desde la base de datos');
  }

  async function loadSessionFromDB(sessionId) {
    const row = await stmts.getSession.get(sessionId);
    if (!row) return null;

    const messageRows = await stmts.getMessages.all(sessionId);
    const messages = messageRows.map(message => ({
      id: message.id,
      from: message.from_role,
      text: message.text,
      ts: message.ts,
      lang: message.lang,
    }));
    const hydratedMessages = deps.attachmentService
      ? await deps.attachmentService.attachFilesToMessages(messages)
      : messages;

    const session = dbRowToSession(row, hydratedMessages);
    applySharedSessionSnapshot(session, await clusterState.getSessionSnapshot(sessionId));
    sessions.set(sessionId, session);
    return session;
  }

  async function ensureSessionLoaded(sessionId) {
    return sessions.get(sessionId) || loadSessionFromDB(sessionId);
  }

  async function translateForAdmin(text, sourceLang = '') {
    if (!text || adminLanguage === sourceLang) return text;
    return translate(text, adminLanguage);
  }

  async function serializeMessageForAdmin(message) {
    const adminText = await translateForAdmin(message.text, message.lang || '');
    return {
      id: message.id || null,
      from: message.from,
      text: message.text,
      adminText,
      ts: message.ts,
      lang: message.lang || null,
      attachments: message.attachments || [],
    };
  }

  function serializeMessage(message) {
    return {
      id: message.id || null,
      from: message.from,
      text: message.text,
      ts: message.ts,
      lang: message.lang || null,
      attachments: message.attachments || [],
    };
  }

  function serializeSession(session) {
    const lastMessage = session.messages[session.messages.length - 1] || null;
    return {
      sessionId: session.sessionId,
      shortId: session.sessionId.slice(0, 8),
      name: session.name || 'Sin nombre',
      lang: session.lang,
      adminLanguage,
      ip: session.ip,
      geo: session.geo,
      currentPage: session.currentPage,
      priority: !!session.priority,
      adminLastSeenTs: session.adminLastSeenTs || 0,
      userLastSeenTs: session.userLastSeenTs || 0,
      unreadForAdmin: countUnreadForAdmin(session),
      unreadForUser: countUnreadForUser(session),
      banned: !!session.banned,
      awaitingName: !!session.awaitingName,
      connected: !!session.connected,
      socketCount: session.socketCount || 0,
      lastActive: session.lastActive,
      createdAt: session.createdAt,
      userAgent: session.userAgent,
      lastMessage: lastMessage ? {
        from: lastMessage.from,
        id: lastMessage.id || null,
        text: lastMessage.text,
        adminText: lastMessage.adminText || null,
        ts: lastMessage.ts,
        attachments: lastMessage.attachments || [],
      } : null,
      messageCount: session.messages.length,
    };
  }

  async function serializeSessionOverview(row, liveSession = null) {
    const effectiveSession = liveSession || sessions.get(row.session_id) || null;
    const lastMessage = row.last_text && row.last_from && row.last_ts
      ? {
          from: row.last_from,
          id: null,
          text: row.last_text,
          adminText: await translateForAdmin(row.last_text, row.last_lang || row.lang || ''),
          ts: row.last_ts,
          attachments: [],
        }
      : null;

    return {
      sessionId: row.session_id,
      shortId: row.session_id.slice(0, 8),
      name: effectiveSession?.name || row.name || 'Sin nombre',
      lang: effectiveSession?.lang || row.lang || 'es',
      adminLanguage,
      ip: effectiveSession?.ip || row.ip,
      geo: effectiveSession?.geo || {
        city: row.geo_city || 'Desconocido',
        country: row.geo_country || 'Desconocido',
        isp: row.geo_isp || 'Desconocido',
      },
      currentPage: effectiveSession?.currentPage || row.current_page || '/',
      priority: effectiveSession ? !!effectiveSession.priority : !!row.priority,
      adminLastSeenTs: effectiveSession?.adminLastSeenTs || row.admin_last_seen_ts || 0,
      userLastSeenTs: effectiveSession?.userLastSeenTs || row.user_last_seen_ts || 0,
      unreadForAdmin: effectiveSession?.messages?.length ? countUnreadForAdmin(effectiveSession) : (row.unread_admin_count || 0),
      unreadForUser: effectiveSession?.messages?.length ? countUnreadForUser(effectiveSession) : (row.unread_user_count || 0),
      banned: effectiveSession ? !!effectiveSession.banned : !!row.banned,
      awaitingName: effectiveSession ? !!effectiveSession.awaitingName : !!row.awaiting_name,
      connected: !!effectiveSession?.connected,
      socketCount: effectiveSession?.socketCount || 0,
      lastActive: effectiveSession?.lastActive || row.last_active,
      createdAt: row.created_at,
      userAgent: effectiveSession?.userAgent || row.user_agent || '',
      lastMessage,
      messageCount: effectiveSession?.messages?.length || row.message_count || 0,
    };
  }

  async function listSessionsForAdmin() {
    const rows = await stmts.getSessionsOverview.all();
    const sharedSnapshots = await clusterState.getSessionSnapshots(rows.map(row => row.session_id));
    return Promise.all(rows.map(async (row) => {
      const localSession = sessions.get(row.session_id) || null;
      if (localSession) return serializeSessionOverview(row, localSession);

      const sharedSnapshot = sharedSnapshots.get(row.session_id);
      if (!sharedSnapshot) return serializeSessionOverview(row, null);

      return serializeSessionOverview(row, applySharedSessionSnapshot(dbRowToSession(row, []), sharedSnapshot));
    }));
  }

  async function getGeneralAdminMetrics() {
    const allSessions = await listSessionsForAdmin();
    const now = Date.now();
    return allSessions.reduce((metrics, session) => {
      metrics.totalUsers++;
      metrics.totalMessages += session.messageCount || 0;
      metrics.unreadForAdmin += session.unreadForAdmin || 0;
      if (session.connected) metrics.connectedUsers++;
      else metrics.disconnectedUsers++;
      if (session.banned) metrics.bannedUsers++;
      if (session.priority) metrics.priorityChats++;
      if (session.awaitingName) metrics.awaitingName++;
      if ((session.lastActive || 0) >= now - 24 * 60 * 60 * 1000) metrics.activeLast24h++;
      return metrics;
    }, {
      totalUsers: 0,
      connectedUsers: 0,
      disconnectedUsers: 0,
      bannedUsers: 0,
      priorityChats: 0,
      awaitingName: 0,
      unreadForAdmin: 0,
      totalMessages: 0,
      activeLast24h: 0,
    });
  }

  return {
    applySharedSessionSnapshot,
    syncSharedSession,
    dbRowToSession,
    sessionToDBRow,
    countUnreadForAdmin,
    countUnreadForUser,
    loadFromDB,
    loadSessionFromDB,
    ensureSessionLoaded,
    translateForAdmin,
    serializeMessageForAdmin,
    serializeMessage,
    serializeSession,
    serializeSessionOverview,
    listSessionsForAdmin,
    getGeneralAdminMetrics,
  };
}

module.exports = {
  createSessionService,
};
