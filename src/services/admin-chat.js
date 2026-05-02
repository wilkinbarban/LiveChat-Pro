'use strict';

const { getLastInsertId } = require('../utils/sqlite-result');

// AdminChatService contains operations initiated by the web admin panel. It
// updates memory, SQLite, Redis snapshots, visitor sockets and admin sockets as
// one coordinated workflow.
function createAdminChatService(deps) {
  const {
    io,
    adminIo,
    sessions,
    stmts,
    logger,
    clusterState,
    adminId,
    adminLanguage,
    sessionRoom,
    syncSharedSession,
    serializeSession,
    serializeMessageForAdmin,
    translate,
    attachmentService,
  } = deps;

  // Lightweight session broadcasts keep the admin list and metrics fresh without
  // forcing every connected admin client to reload full message history.
  function broadcastAdminSessionUpdate(session, extra = {}) {
    adminIo.emit('session:update', {
      session: serializeSession(session),
      ...extra,
    });
  }

  async function broadcastAdminMessage(session, message) {
    adminIo.emit('message:new', {
      sessionId: session.sessionId,
      session: serializeSession(session),
      message: await serializeMessageForAdmin(message),
    });
  }

  // Clearing a chat removes message and attachment history, resets read markers
  // and tells the visitor widget to clear its local thread.
  async function clearSessionChat(session) {
    session.messages = [];
    session.lastActive = Date.now();
    session.adminLastSeenTs = session.lastActive;
    session.userLastSeenTs = session.lastActive;
    try {
      await attachmentService?.deleteSessionAttachmentFiles?.(session.sessionId);
      await stmts.clearMessagesBySession.run(session.sessionId);
      await stmts.updateLastActive.run(session.lastActive, session.sessionId);
      await stmts.markAdminSeen.run(session.adminLastSeenTs, session.sessionId);
      await stmts.markUserSeen.run(session.userLastSeenTs, session.sessionId);
    } catch (dbError) {
      logger.error({ err: dbError, sessionId: session.sessionId }, 'Error BD en clearSessionChat');
      throw dbError;
    }
    await syncSharedSession(session);
    io.to(sessionRoom(session.sessionId)).emit('chat:cleared');
    broadcastAdminSessionUpdate(session, { reason: 'cleared' });
  }

  // Full deletion disconnects active visitor sockets before deleting the durable
  // session row so no client continues writing to a removed conversation.
  async function deleteAdminSession(session) {
    const sockets = await io.in(sessionRoom(session.sessionId)).fetchSockets();
    for (const activeSocket of sockets) {
      activeSocket.emit('chat:deleted');
      activeSocket.disconnect(true);
    }

    try {
      await attachmentService?.deleteSessionAttachmentFiles?.(session.sessionId);
      await stmts.deleteSession.run(session.sessionId);
    } catch (dbError) {
      logger.error({ err: dbError, sessionId: session.sessionId }, 'Error BD en deleteAdminSession');
      throw dbError;
    }

    await clusterState.deleteSession(session.sessionId);
    await clusterState.removeBanned(session.sessionId);
    sessions.delete(session.sessionId);
    adminIo.emit('session:deleted', { sessionId: session.sessionId });
  }

  // Typing state is only useful for currently connected visitors. When no socket
  // remains in the room, the session presence is corrected and the caller can
  // return a conflict to the admin UI.
  async function sendAdminTypingToSession(session, active) {
    const sockets = await io.in(sessionRoom(session.sessionId)).fetchSockets();
    if (!sockets.length) {
      session.connected = false;
      session.socketCount = 0;
      await syncSharedSession(session, { connected: false, socketCount: 0 });
      return false;
    }

    session.connected = true;
    session.socketCount = sockets.length;
    await syncSharedSession(session, { connected: true, socketCount: sockets.length });
    io.to(sessionRoom(session.sessionId)).emit('typing_admin', { active: !!active });
    return true;
  }

  // Admin replies are translated into the visitor language before persistence so
  // all delivery channels and history show the same text to the visitor.
  async function sendAdminReplyToSession(session, replyText) {
    const sockets = await io.in(sessionRoom(session.sessionId)).fetchSockets();
    const isOnline = sockets.length > 0;

    try {
      const translatedText = session.lang && session.lang !== adminLanguage
        ? await translate(replyText, session.lang)
        : replyText;

      const msgObj = { from: 'admin', text: translatedText, ts: Date.now(), lang: session.lang };
      session.messages.push(msgObj);
      session.lastActive = Date.now();
      session.connected = isOnline;
      session.socketCount = sockets.length;

      try {
        const inserted = await stmts.insertMessage.run({
          session_id: session.sessionId,
          from_role: 'admin',
          text: translatedText,
          ts: msgObj.ts,
          lang: session.lang,
        });
        msgObj.id = getLastInsertId(inserted);
        await stmts.updateLastActive.run(session.lastActive, session.sessionId);
      } catch (dbError) {
        logger.error({ err: dbError, sessionId: session.sessionId }, 'Error BD en sendAdminReplyToSession');
      }

      await syncSharedSession(session, { connected: isOnline, socketCount: sockets.length });
      if (isOnline) io.to(sessionRoom(session.sessionId)).emit('message', msgObj);
      await clusterState.setPendingReply(adminId, session.sessionId);
      await broadcastAdminMessage(session, msgObj);

      return { ok: true, message: msgObj, delivered: isOnline };
    } catch (error) {
      logger.error({ err: error, sessionId: session.sessionId }, 'Error en sendAdminReplyToSession');
      return { ok: false, status: 500, error: 'Error al procesar la respuesta' };
    }
  }

  return {
    broadcastAdminSessionUpdate,
    broadcastAdminMessage,
    clearSessionChat,
    deleteAdminSession,
    sendAdminTypingToSession,
    sendAdminReplyToSession,
  };
}

module.exports = {
  createAdminChatService,
};
