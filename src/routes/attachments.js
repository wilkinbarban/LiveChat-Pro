'use strict';

const path = require('path');
const multer = require('multer');
const { Router } = require('express');
const { sanitizeText } = require('../utils/sanitizer');
const { getLastInsertId } = require('../utils/sqlite-result');

// Multer keeps uploads in memory so the attachment service can validate the
// binary signature before anything is written to disk.
function createUploadMiddleware(attachmentService) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: attachmentService.maxBytes,
      files: 1,
    },
    fileFilter: (req, file, cb) => {
      if (!attachmentService.allowedImageTypes.includes(file.mimetype)) {
        return cb(Object.assign(new Error('Tipo de imagen no permitido'), { status: 415 }));
      }
      return cb(null, true);
    },
  }).single('image');
}

// Normalizes multer errors into the JSON shape used by the rest of the API.
function runUpload(upload) {
  return (req, res, next) => {
    upload(req, res, error => {
      if (!error) return next();
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : (error.status || 400);
      return res.status(status).json({ error: status === 413 ? 'La imagen no puede superar 5 MB' : error.message });
    });
  };
}

// Attachment reads are allowed for admins, tokenized links, the owning visitor
// cookie, or a session id query used by constrained widget contexts.
function canReadAttachment(req, attachment, { verifyAdminToken, adminCookieName }) {
  if (verifyAdminToken(req.cookies?.[adminCookieName])) return true;
  if (attachment.access_token && String(req.query?.token || '') === attachment.access_token) return true;
  if (String(req.query?.sid || '') === attachment.session_id) return true;
  return req.cookies?.lchat_sid === attachment.session_id;
}

// Routes for visitor uploads, admin uploads, attachment reads and admin deletes.
function createAttachmentRouter(deps) {
  const {
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
    adminCookieName,
    requireAdmin,
    requireCsrf,
    serializeMessageForAdmin,
    serializeSession,
    uploadLimiter,
  } = deps;

  const router = Router();
  const uploadImage = runUpload(createUploadMiddleware(attachmentService));

  // Optional widget API key protects upload endpoints when the project is embedded
  // on domains outside the LiveChat Pro server.
  function validateWidgetKey(req, res, next) {
    if (!WIDGET_API_KEY) return next();
    const provided = String(req.get('x-widget-api-key') || '');
    if (provided !== WIDGET_API_KEY) return res.status(401).json({ error: 'Credencial de widget inválida.' });
    return next();
  }

  // Creates the chat message first, then the file metadata. If saving the file or
  // metadata fails, the partially-created message is rolled back by the service.
  async function createAttachmentMessage({ session, role, text, file }) {
    const ts = Date.now();
    const message = {
      from: role,
      text,
      ts,
      lang: session.lang,
      attachments: [],
    };

    const inserted = await stmts.insertMessage.run({
      session_id: session.sessionId,
      from_role: role,
      text,
      ts,
      lang: session.lang,
    });
    message.id = getLastInsertId(inserted);
    if (!message.id) {
      const error = new Error('No se pudo registrar el mensaje del adjunto');
      error.status = 500;
      throw error;
    }

    let attachment;
    try {
      attachment = await attachmentService.saveAttachment({
        sessionId: session.sessionId,
        messageId: message.id,
        file,
        now: ts,
      });
    } catch (error) {
      // Avoid leaving a text-only placeholder when the intended attachment could
      // not be stored.
      try {
        await stmts.deleteMessage.run(message.id);
      } catch (deleteError) {
        logger.warn?.({ err: deleteError, messageId: message.id }, 'No se pudo revertir mensaje de adjunto fallido');
      }
      throw error;
    }
    message.attachments = [attachment];

    session.messages.push(message);
    session.lastActive = ts;
    await stmts.updateLastActive.run(session.lastActive, session.sessionId);
    await syncSharedSession(session);

    if (role === 'user') {
      io.to(sessionRoom(session.sessionId)).emit('message', message);
      await broadcastAdminMessage(session, message);
      broadcastAdminSessionUpdate(session, { reason: 'attachment' });
      await sendToAdmin?.(`🖼️ <b>${session.name || 'Usuario'}</b> envió una imagen (${session.sessionId.slice(0, 8)}).`, {}, session.sessionId);
    } else {
      io.to(sessionRoom(session.sessionId)).emit('message', message);
      await broadcastAdminMessage(session, message);
      broadcastAdminSessionUpdate(session, { reason: 'admin_attachment' });
    }

    return message;
  }

  router.post('/api/chat/:sessionId/attachments', uploadLimiter, validateWidgetKey, uploadImage, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    const providedSessionId = String(req.cookies?.lchat_sid || req.get('x-chat-session-id') || req.body?.sessionId || '');
    if (!session || providedSessionId !== session.sessionId) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    if (session.awaitingName) {
      return res.status(409).json({ error: 'Primero indica tu nombre antes de enviar imágenes.' });
    }

    try {
      const message = await createAttachmentMessage({
        session,
        role: 'user',
        text: sanitizeText(req.body?.text || ''),
        file: req.file,
      });
      return res.json({ ok: true, message });
    } catch (error) {
      logger.error({ err: error, sessionId: req.params.sessionId }, 'Error subiendo adjunto de usuario');
      return res.status(error.status || 500).json({ error: error.message || 'No se pudo subir la imagen' });
    }
  });

  router.post('/api/admin/sessions/:sessionId/attachments', requireAdmin, requireCsrf, uploadImage, async (req, res) => {
    const session = await ensureSessionLoaded(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    try {
      const message = await createAttachmentMessage({
        session,
        role: 'admin',
        text: sanitizeText(req.body?.text || ''),
        file: req.file,
      });
      return res.json({
        ok: true,
        message: await serializeMessageForAdmin(message),
        session: serializeSession(session),
      });
    } catch (error) {
      logger.error({ err: error, sessionId: req.params.sessionId }, 'Error subiendo adjunto admin');
      return res.status(error.status || 500).json({ error: error.message || 'No se pudo subir la imagen' });
    }
  });

  router.get('/api/attachments/:attachmentId', async (req, res) => {
    const attachment = await attachmentService.getAttachment(req.params.attachmentId);
    if (!attachment || !canReadAttachment(req, attachment, { verifyAdminToken, adminCookieName })) {
      return res.status(404).json({ error: 'Adjunto no encontrado' });
    }

    const storagePath = attachmentService.getStoragePath(attachment);
    if (!storagePath) return res.status(404).json({ error: 'Adjunto no encontrado' });

    res.type(attachment.mime_type);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${path.basename(attachment.original_name).replace(/"/g, '')}"`);
    return res.sendFile(storagePath);
  });

  router.delete('/api/admin/attachments/:attachmentId', requireAdmin, requireCsrf, async (req, res) => {
    const deleted = await attachmentService.deleteAttachment(req.params.attachmentId, { removeFile: true });
    if (!deleted) return res.status(404).json({ error: 'Adjunto no encontrado' });

    const session = sessions.get(deleted.sessionId) || await ensureSessionLoaded(deleted.sessionId);
    if (session) {
      for (const message of session.messages) {
        if (message.id === deleted.messageId) message.attachments = [];
      }
      await syncSharedSession(session);
      io.to(sessionRoom(session.sessionId)).emit('attachment:deleted', { attachmentId: deleted.id, messageId: deleted.messageId, sessionId: session.sessionId });
      broadcastAdminSessionUpdate(session, { reason: 'attachment_deleted' });
    }

    return res.json({ ok: true, attachment: deleted });
  });

  return router;
}

module.exports = {
  createAttachmentRouter,
};
