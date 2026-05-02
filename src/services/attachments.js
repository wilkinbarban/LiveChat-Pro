'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { getLastInsertId } = require('../utils/sqlite-result');

const DEFAULT_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const EXTENSIONS_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length < 12) return null;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return 'image/png';
  const gifHeader = buffer.toString('ascii', 0, 6);
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function readImageDimensions(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return { width: null, height: null };
  if (mimeType === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === 'image/gif' && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (mimeType === 'image/webp' && buffer.length >= 30) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
      return {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      };
    }
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

function sanitizeOriginalName(name = '') {
  const base = path.basename(String(name || 'imagen'));
  return base
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'imagen';
}

function normalizeUploadConfig(config = {}, rootDir = process.cwd()) {
  const maxMb = Number.isFinite(Number(config.maxMb)) && Number(config.maxMb) > 0 ? Number(config.maxMb) : 5;
  const uploadDir = path.isAbsolute(config.dir || '')
    ? config.dir
    : path.join(rootDir, config.dir || path.join('data', 'uploads'));

  return {
    uploadDir,
    maxBytes: Math.floor(maxMb * 1024 * 1024),
    allowedImageTypes: new Set(config.allowedImageTypes?.length ? config.allowedImageTypes : DEFAULT_ALLOWED_IMAGE_TYPES),
  };
}

function createAttachmentService({ stmts, logger = console, config = {}, rootDir }) {
  const { uploadDir, maxBytes, allowedImageTypes } = normalizeUploadConfig(config, rootDir);

  function validateImageFile(file) {
    if (!file) {
      const error = new Error('No se recibió ninguna imagen');
      error.status = 400;
      throw error;
    }

    if (!allowedImageTypes.has(file.mimetype)) {
      const error = new Error('Tipo de imagen no permitido');
      error.status = 415;
      throw error;
    }

    const detectedMime = detectImageMime(file.buffer);
    if (!detectedMime || detectedMime !== file.mimetype) {
      const error = new Error('El archivo no coincide con una imagen válida');
      error.status = 415;
      throw error;
    }

    if (file.size > maxBytes) {
      const error = new Error(`La imagen no puede superar ${Math.floor(maxBytes / 1024 / 1024)} MB`);
      error.status = 413;
      throw error;
    }
  }

  async function ensureUploadDir() {
    await fs.mkdir(uploadDir, { recursive: true });
  }

  async function saveAttachment({ sessionId, messageId, file, now = Date.now() }) {
    validateImageFile(file);
    await ensureUploadDir();

    const extension = EXTENSIONS_BY_MIME[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.img';
    const filename = `${now}-${crypto.randomUUID()}${extension}`;
    const accessToken = crypto.randomBytes(24).toString('base64url');
    const dimensions = readImageDimensions(file.buffer, file.mimetype);
    const storagePath = path.join(uploadDir, filename);
    await fs.writeFile(storagePath, file.buffer);

    const originalName = sanitizeOriginalName(file.originalname);

    try {
      const result = await stmts.insertAttachment.run({
        session_id: sessionId,
        message_id: messageId,
        filename,
        original_name: originalName,
        mime_type: file.mimetype,
        size_bytes: file.size,
        storage_path: storagePath,
        access_token: accessToken,
        width: dimensions.width,
        height: dimensions.height,
        created_at: now,
      });

      const id = getLastInsertId(result);
      if (!id) throw new Error('No se pudo registrar el adjunto');

      return serializeAttachment({
        id,
        session_id: sessionId,
        message_id: messageId,
        filename,
        original_name: originalName,
        mime_type: file.mimetype,
        size_bytes: file.size,
        storage_path: storagePath,
        access_token: accessToken,
        width: dimensions.width,
        height: dimensions.height,
        created_at: now,
        deleted_at: null,
      });
    } catch (error) {
      try {
        await fs.unlink(storagePath);
      } catch {}
      throw error;
    }
  }

  function serializeAttachment(row) {
    if (!row || row.deleted_at) return null;
    return {
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      filename: row.filename,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      width: row.width || null,
      height: row.height || null,
      url: `/api/attachments/${row.id}?token=${encodeURIComponent(row.access_token || '')}`,
      downloadUrl: `/api/attachments/${row.id}?download=1&token=${encodeURIComponent(row.access_token || '')}`,
      createdAt: row.created_at,
    };
  }

  async function getAttachment(id, { includeDeleted = false } = {}) {
    const row = await stmts.getAttachment.get(id);
    if (!row) return null;
    if (row.deleted_at && !includeDeleted) return null;
    return row;
  }

  async function listMessageAttachments(messageId) {
    const rows = await stmts.getAttachmentsByMessage.all(messageId);
    return rows.map(serializeAttachment).filter(Boolean);
  }

  async function attachFilesToMessages(messages = []) {
    const ids = messages.map(message => message.id).filter(Number.isFinite);
    if (!ids.length) return messages.map(message => ({ ...message, attachments: message.attachments || [] }));

    let rows = [];
    try {
      rows = await stmts.getAttachmentsByMessages.all(JSON.stringify(ids));
    } catch (error) {
      logger.error?.({ err: error }, 'Error BD en getAttachmentsByMessages');
      rows = [];
    }

    const byMessage = new Map();
    for (const row of rows) {
      const attachment = serializeAttachment(row);
      if (!attachment) continue;
      const list = byMessage.get(row.message_id) || [];
      list.push(attachment);
      byMessage.set(row.message_id, list);
    }

    return messages.map(message => ({
      ...message,
      attachments: byMessage.get(message.id) || message.attachments || [],
    }));
  }

  async function deleteAttachment(id, { removeFile = false } = {}) {
    const row = await getAttachment(id);
    if (!row) return null;

    const deletedAt = Date.now();
    await stmts.softDeleteAttachment.run(deletedAt, row.id);

    if (removeFile) {
      try {
        await fs.unlink(row.storage_path);
      } catch (error) {
        if (error.code !== 'ENOENT') logger.warn?.({ err: error, attachmentId: row.id }, 'No se pudo borrar archivo adjunto');
      }
    }

    return {
      ...serializeAttachment(row),
      deletedAt,
    };
  }

  async function deleteSessionAttachmentFiles(sessionId) {
    const rows = await stmts.getAllAttachmentsBySession.all(sessionId);
    let deletedFiles = 0;
    for (const row of rows) {
      try {
        await fs.unlink(row.storage_path);
        deletedFiles++;
      } catch (error) {
        if (error.code !== 'ENOENT') logger.warn?.({ err: error, attachmentId: row.id }, 'No se pudo borrar archivo adjunto de sesión');
      }
    }
    return deletedFiles;
  }

  function getStoragePath(row) {
    if (!row?.storage_path) return null;
    const resolved = path.resolve(row.storage_path);
    const uploadRoot = path.resolve(uploadDir);
    if (!resolved.startsWith(`${uploadRoot}${path.sep}`)) return null;
    return resolved;
  }

  return {
    uploadDir,
    maxBytes,
    allowedImageTypes: Array.from(allowedImageTypes),
    validateImageFile,
    saveAttachment,
    serializeAttachment,
    getAttachment,
    listMessageAttachments,
    attachFilesToMessages,
    deleteAttachment,
    deleteSessionAttachmentFiles,
    getStoragePath,
  };
}

module.exports = {
  createAttachmentService,
  sanitizeOriginalName,
  detectImageMime,
  readImageDimensions,
};
