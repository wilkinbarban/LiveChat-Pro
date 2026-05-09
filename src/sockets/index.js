const crypto = require('crypto');
const { getClientIpFromSocket, getGeoInfo, shouldRefreshGeo } = require('../services/geo');
const { sanitizeLanguage, sanitizeUserAgent, sanitizePage, sanitizeText, sanitizeName, escapeTelegramHtml } = require('../utils/sanitizer');
const { getLastInsertId } = require('../utils/sqlite-result');

// Socket setup handles two namespaces:
// - default namespace: visitor widget connections
// - /admin namespace: authenticated admin realtime updates
function setupSockets(io, adminIo, deps) {
  const {
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
    HELP_COMMANDS = {},
    HELP_TOPICS = {},
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
    aiBot
  } = deps;

  io.on('connection', async (socket) => {
    // Optional shared secret for embedded widgets. Timing-safe comparison avoids
    // leaking how much of the configured key matched.
    if (WIDGET_API_KEY) {
      const providedApiKey = typeof socket.handshake.auth?.apiKey === 'string'
        ? socket.handshake.auth.apiKey
        : '';
      const expectedBuf = Buffer.from(WIDGET_API_KEY);
      const providedBuf = Buffer.from(providedApiKey);
      const apiKeyValid = expectedBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, providedBuf);
      if (!apiKeyValid) {
        socket.emit('error', { code: 'INVALID_WIDGET_API_KEY', message: 'Credencial de widget inválida.' });
        socket.disconnect(true);
        return;
      }
    }

    const cookies = socket.handshake.headers.cookie || '';
    const cookieMap = parseCookies(cookies);
    let sessionId = cookieMap['lchat_sid'] || socket.handshake.auth?.sessionId;
    const widgetLang = sanitizeLanguage(socket.handshake.auth?.lang);
    // browserLang is the resolved bot-response language (from navigator, never overwritten by text detection).
    // Unsupported langs already fall back to 'es' inside sanitizeLanguage/normalizeWidgetLang.
    const browserLang = widgetLang || 'es';

    // Only accept v4 UUIDs from clients; otherwise issue a fresh id to prevent
    // arbitrary room names or path-like values from becoming session identifiers.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!sessionId || !UUID_RE.test(sessionId)) sessionId = crypto.randomUUID();

    if (await clusterState.isBanned(sessionId)) {
      socket.emit('banned');
      socket.disconnect();
      return;
    }

    const msgRateLimiter = createMsgRateLimiter(20, 60000);
    socket.data.sessionId = sessionId;
    socket.join(sessionRoom(sessionId));
    const clientIp = getClientIpFromSocket(socket);
    const userAgent = sanitizeUserAgent(socket.handshake.headers['user-agent']);

    let session = sessions.get(sessionId) || await loadSessionFromDB(sessionId);
    const isNewSession = !session;

    if (isNewSession) {
      // New sessions start in "awaitingName" mode. The first user message is
      // captured as the visitor name rather than stored as a support message.
      const geo = await getGeoInfo(clientIp, features.geoLocation);
      session = {
        sessionId,
        socketId:     socket.id,
        connected:    true,
        socketCount:  1,
        name:         null,
        lang:         widgetLang,
        browserLang:  browserLang,
        langDetected: false,
        ip:           clientIp,
        geo,
        userAgent,
        currentPage:  '/',
        messages:     [],
        lastActive:   Date.now(),
        createdAt:    Date.now(),
        banned:       false,
        priority:     false,
        adminLastSeenTs: 0,
        userLastSeenTs: 0,
        awaitingName: true,
        botSilenced: false,
        typingMsgId:  null,
      };
      sessions.set(sessionId, session);
      try {
        await stmts.upsertSession.run(sessionToDBRow(session));
      } catch (dbError) {
        logger.error({ err: dbError, sessionId }, 'Error BD en upsertSession');
      }
      await syncSharedSession(session, { connected: true, socketCount: await clusterState.incrementPresence(sessionId) });
      broadcastAdminSessionUpdate(session, { reason: 'created' });
    } else {
      session.socketId = socket.id;
      session.lastActive = Date.now();
      session.connected = true;
      // Reconnects may arrive through a different proxy/IP. Refresh network
      // metadata only when it is meaningfully different or previously unknown.
      const refreshNetworkInfo = shouldRefreshGeo(session, clientIp);
      if (refreshNetworkInfo) {
        session.ip = clientIp;
        session.geo = await getGeoInfo(clientIp, features.geoLocation);
        session.userAgent = userAgent || session.userAgent;
      }
      // Always refresh browserLang from the current connection — navigator lang may have changed.
      if (browserLang) session.browserLang = browserLang;
      try {
        if (refreshNetworkInfo) {
          await stmts.updateNetworkInfo.run(
            session.ip,
            session.geo?.city,
            session.geo?.country,
            session.geo?.isp,
            session.userAgent,
            session.lastActive,
            sessionId
          );
        } else {
          await stmts.updateLastActive.run(session.lastActive, sessionId);
        }
      } catch (dbError) {
        logger.error({ err: dbError, sessionId }, 'Error BD en updateLastActive (reconnect)');
      }
      await syncSharedSession(session, { connected: true, socketCount: await clusterState.incrementPresence(sessionId) });
      broadcastAdminSessionUpdate(session, { reason: 'connected' });
    }

    socket.emit('session', {
      sessionId,
      history: session.messages,
      name:    session.name,
      config:  { primaryColor: widgetCfg.primaryColor },
    });

    if (!session.name) {
      const welcome = widgetCfg.welcomeMessage || getWidgetMessage(session.lang, 'welcome');
      socket.emit('message', { from: 'bot', text: welcome, ts: Date.now() });
    }

    socket.on('page', async (page) => {
      if (!session) return;
      const safePage = sanitizePage(page);
      session.currentPage = safePage;
      session.lastActive  = Date.now();
      try {
        await stmts.updatePage.run(safePage, session.lastActive, sessionId);
      } catch (dbError) {
        logger.error({ err: dbError, sessionId }, 'Error BD en updatePage');
      }
      await syncSharedSession(session);
      broadcastAdminSessionUpdate(session, { reason: 'page' });
    });

    let typingTimeout;
    socket.on('typing', async (text) => {
      // Ghost typing sends a translated preview to Telegram after a short debounce
      // so the admin can see visitor intent without flooding Telegram edits.
      if (!session || !features.ghostTyping || typeof text !== 'string') return;
      clearTimeout(typingTimeout);
      const previewText = await translateForAdmin(sanitizeText(text).slice(0, 100), session.lang);
      const preview = `✍️ <b>${escapeTelegramHtml(session.name || 'Usuario')}</b> escribiendo...\n<i>${escapeTelegramHtml(previewText)}</i>`;
      typingTimeout = setTimeout(async () => {
        if (session.typingMsgId) {
          try {
            await getBot()?.telegram.editMessageText(ADMIN_ID, session.typingMsgId, null, preview, { parse_mode: 'HTML' });
          } catch { session.typingMsgId = null; }
        } else {
          const m = await sendToAdmin(preview, {}, session.sessionId);
          if (m) session.typingMsgId = m.message_id;
        }
      }, 400);
    });

    socket.on('message', async (data) => {
      if (!session) return;

      if (!msgRateLimiter()) {
        socket.emit('error', { code: 'RATE_LIMITED', message: 'Estás enviando mensajes muy rápido.' });
        return;
      }

      const text = sanitizeText(data?.text);
      if (!text) return;

      session.lastActive = Date.now();

      const sessionLang = session.browserLang || session.lang || 'en';
      const helpCmd = HELP_COMMANDS[sessionLang] || HELP_COMMANDS.es || '/ayuda';
      const isHelpCommand = text.trim().toLowerCase() === helpCmd.toLowerCase();

      if (isHelpCommand) {
        const helpText = HELP_TOPICS[sessionLang] || HELP_TOPICS.es;
        const helpMsg = { from: 'bot', text: helpText, ts: Date.now(), lang: sessionLang };
        try {
          const inserted = await stmts.insertMessage.run({ session_id: sessionId, from_role: 'bot', text: helpMsg.text, ts: helpMsg.ts, lang: sessionLang });
          helpMsg.id = getLastInsertId(inserted);
        } catch (dbError) {
          logger.error({ err: dbError, sessionId }, 'Error BD insertMessage (help command)');
        }
        session.messages.push(helpMsg);
        socket.emit('message', helpMsg);
        await syncSharedSession(session);
        await broadcastAdminMessage(session, helpMsg);
        return;
      }

      // A real message supersedes the transient Telegram typing preview.
      // Instead of deleting and creating a new message, we edit the existing one
      // so Telegram shows a single notification that transitions from ✍️ to 💬.
      // (edit logic runs below, after telegramText is assembled)

      if (session.awaitingName) {
        const name = sanitizeName(text);
        session.name = name;
        session.awaitingName = false;
        try {
          await stmts.setName.run(name, session.lastActive, sessionId);
        } catch (dbError) {
          logger.error({ err: dbError, sessionId }, 'Error BD en setName');
        }
        await syncSharedSession(session);
        socket.emit('name_set', { name });
        const botLang = session.browserLang || session.lang;
        const botMsg = { from: 'bot', text: getWidgetMessage(botLang, 'named', name), ts: Date.now(), lang: botLang };
        try {
          const inserted = await stmts.insertMessage.run({ session_id: sessionId, from_role: 'bot', text: botMsg.text, ts: botMsg.ts, lang: botLang });
          botMsg.id = getLastInsertId(inserted);
        } catch (dbError) {
          logger.error({ err: dbError, sessionId }, 'Error BD en insertMessage (bot welcome)');
        }
        session.messages.push(botMsg);
        socket.emit('message', botMsg);
        await clusterState.setPendingReply(ADMIN_ID, sessionId);
        await sendToAdmin(`🆕 <b>Nueva sesión iniciada</b>\n\n${sessionCard(session)}`, {}, sessionId);
        broadcastAdminSessionUpdate(session, { reason: 'named' });
        await broadcastAdminMessage(session, botMsg);
        return;
      }

      if (!session.langDetected) {
        // Browser language is used initially, but the first real message can
        // correct it when the user writes in another language.
        // Run detectLang and translate in parallel to reduce Telegram delivery latency.
        const [detectedLang, translatedEarly] = await Promise.all([
          detectLang(text),
          translate(text, ADMIN_LANGUAGE),
        ]);
        session.lang = detectedLang;
        session.langDetected = true;
        try {
          await stmts.updateLang.run(session.lang, session.lastActive, sessionId);
        } catch (dbError) {
          logger.error({ err: dbError, sessionId }, 'Error BD en updateLang');
        }
        await syncSharedSession(session);
        var textForAdmin = session.lang !== ADMIN_LANGUAGE ? translatedEarly : text;
      }

      if (typeof textForAdmin === 'undefined') {
        var textForAdmin = session.lang !== ADMIN_LANGUAGE ? await translate(text, ADMIN_LANGUAGE) : text;
      }

      const { isOffensive, isHighPriority } = features.sentiment
        ? analyzeSentiment(text, session.lang)
        : { isOffensive: false, isHighPriority: false };

      let telegramText = `💬 <b>${escapeTelegramHtml(session.name || 'Usuario')}</b> <code>${escapeTelegramHtml(`(${session.sessionId.slice(0,8)})`)}</code>:\n${escapeTelegramHtml(textForAdmin)}`;

      if (isOffensive) telegramText = `⚠️ [CONTENIDO OFENSIVO]\n${telegramText}`;
      if (isHighPriority) {
        telegramText = `🔴 [PRIORIDAD ALTA: CLIENTE MOLESTO]\n${telegramText}`;
        session.priority = true;
        try {
          await stmts.updatePriority.run(session.lastActive, sessionId);
        } catch (dbError) {
          logger.error({ err: dbError, sessionId }, 'Error BD en updatePriority');
        }
        await syncSharedSession(session);
      }

      const msgObj = { from: 'user', text, ts: Date.now(), lang: session.lang };
      session.messages.push(msgObj);
      session.lastActive = msgObj.ts;
      try {
        const inserted = await stmts.insertMessage.run({ session_id: sessionId, from_role: 'user', text, ts: msgObj.ts, lang: session.lang });
        msgObj.id = getLastInsertId(inserted);
      } catch (dbError) {
        logger.error({ err: dbError, sessionId }, 'Error BD en insertMessage (user msg)');
      }
      await syncSharedSession(session);
      socket.emit('message', { from: 'user', text, ts: msgObj.ts });
      await broadcastAdminMessage(session, msgObj);

      // AI Bot intercept — attempt automated reply before notifying admin
      if (!isHighPriority && aiBot?.isEnabled() && aiBot.shouldBotHandle(session)) {
        try {
          socket.emit('typing_start', { from: 'bot' });
          socket.emit('typing', 'bot');
          const botResult = await aiBot.getReply(session, text);
          socket.emit('typing_stop');
          if (botResult?.reply && !botResult.escalate) {
            // Bot already responds in the detected visitor language — no translation needed.
            const botMsg = { from: 'bot', text: botResult.reply, ts: Date.now(), lang: botResult.language || session.lang };
            session.messages.push(botMsg);
            try {
              const inserted = await stmts.insertMessage.run({ session_id: sessionId, from_role: 'bot', text: botMsg.text, ts: botMsg.ts, lang: session.lang });
              botMsg.id = getLastInsertId(inserted);
            } catch (dbError) {
              logger.error({ err: dbError, sessionId }, 'Error BD insertMessage (bot reply)');
            }
            io.to(sessionRoom(sessionId)).emit('message', botMsg);
            await syncSharedSession(session);
            await broadcastAdminMessage(session, botMsg);
            await broadcastAdminSessionUpdate(session, { reason: 'bot_reply' });
            if (features.botNotifyAdmin) {
              await sendToAdmin(`🤖 <b>Bot respondió a ${escapeTelegramHtml(session.name || 'usuario')}</b>:
${escapeTelegramHtml(botResult.reply.slice(0, 100))}${botResult.reply.length > 100 ? '…' : ''}`, {}, sessionId);
            }
            return; // do not forward to admin Telegram
          }

          // Bot could not answer — notify visitor in their language before escalating to admin.
          if (botResult?.escalate) {
            const detectedLang = session.browserLang || botResult.language || session.lang || 'en';
            const ESCALATE_MESSAGES = {
              es: '🤔 No entiendo bien tu pregunta. La voy a pasar al administrador del proyecto para que te responda personalmente.',
              en: "🤔 I'm not sure I understand your question. I'll forward it to the project administrator so they can reply to you directly.",
              pt: '🤔 Não entendi bem a sua pergunta. Vou encaminhá-la ao administrador do projeto para que ele responda pessoalmente.',
              fr: "🤔 Je ne suis pas sûr de comprendre votre question. Je vais la transmettre à l'administrateur du projet pour qu'il vous réponde directement.",
              de: '🤔 Ich bin mir nicht sicher, ob ich Ihre Frage verstehe. Ich leite sie an den Projektadministrator weiter, damit er Ihnen persönlich antwortet.',
              it: "🤔 Non sono sicuro di capire la tua domanda. La passerò all'amministratore del progetto affinché ti risponda direttamente.",
            };
            const escalateText = ESCALATE_MESSAGES[detectedLang] || ESCALATE_MESSAGES['es'];
            const escalateMsg = { from: 'bot', text: escalateText, ts: Date.now(), lang: detectedLang };
            session.messages.push(escalateMsg);
            try {
              const inserted = await stmts.insertMessage.run({ session_id: sessionId, from_role: 'bot', text: escalateMsg.text, ts: escalateMsg.ts, lang: detectedLang });
              escalateMsg.id = getLastInsertId(inserted);
            } catch (dbError) {
              logger.error({ err: dbError, sessionId }, 'Error BD insertMessage (escalate notify)');
            }
            io.to(sessionRoom(sessionId)).emit('message', escalateMsg);
            await syncSharedSession(session);
            await broadcastAdminMessage(session, escalateMsg);
          }
        } catch (botErr) {
          logger.error({ err: botErr, sessionId }, 'AI bot error, falling back to Telegram');
          socket.emit('typing_stop');
        }
      }

      await clusterState.setPendingReply(ADMIN_ID, sessionId);

      if (session.typingMsgId) {
        // Edit the existing typing preview in-place → single Telegram notification.
        const prevTypingId = session.typingMsgId;
        session.typingMsgId = null;
        try {
          await getBot()?.telegram.editMessageText(
            ADMIN_ID, prevTypingId, null, telegramText, { parse_mode: 'HTML' }
          );
          // Remap the message id so replies still target this session.
          await clusterState?.setTelegramMessageSession?.(ADMIN_ID, prevTypingId, sessionId);
        } catch {
          // Edit can fail if the message is too old or was already deleted;
          // fall back to sending a fresh message.
          await sendToAdmin(telegramText, {}, sessionId);
        }
      } else {
        await sendToAdmin(telegramText, {}, sessionId);
      }
    });

    socket.on('read', async (payload = {}) => {
      if (!session) return;

      const candidateTs = Number(payload.ts);
      const ts = Number.isFinite(candidateTs) && candidateTs > 0 ? Math.floor(candidateTs) : Date.now();
      session.userLastSeenTs = Math.max(session.userLastSeenTs || 0, ts);

      try {
        await stmts.markUserSeen.run(session.userLastSeenTs, sessionId);
      } catch (dbError) {
        logger.error({ err: dbError, sessionId }, 'Error BD en markUserSeen');
      }

      await syncSharedSession(session);
      broadcastAdminSessionUpdate(session, { reason: 'user_read' });
    });

    socket.on('disconnect', async () => {
      if (session) {
        session.lastActive = Date.now();
        try {
          await stmts.updateLastActive.run(session.lastActive, sessionId);
        } catch (dbError) {
          logger.error({ err: dbError, sessionId }, 'Error BD en updateLastActive (disconnect)');
        }
        const socketCount = await clusterState.decrementPresence(sessionId);
        session.connected = socketCount > 0;
        session.socketCount = socketCount;
        await syncSharedSession(session, { connected: session.connected, socketCount });
        broadcastAdminSessionUpdate(session, { reason: 'disconnected' });
      }
    });
  });

  adminIo.use((socket, next) => {
    // Admin realtime access relies on the same signed cookie as the REST API.
    if (!ADMIN_PANEL_PASSWORD) return next(new Error('Panel admin deshabilitado'));
    const cookies = parseCookies(socket.handshake.headers.cookie || '');
    if (!verifyAdminToken(cookies[ADMIN_COOKIE_NAME])) return next(new Error('No autenticado'));
    next();
  });

  adminIo.on('connection', async (socket) => {
    // Bootstrap gives newly-opened admin tabs the current overview immediately;
    // subsequent changes arrive through session:update/message:new events.
    socket.emit('bootstrap', { sessions: await listSessionsForAdmin() });
  });
}

module.exports = setupSockets;
