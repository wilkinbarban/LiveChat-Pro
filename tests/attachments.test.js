// ============================================================
// Attachment service unit tests — src/services/attachments.js
// Covers filename sanitization, MIME signature checks, dimensions and cleanup.
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAttachmentService, sanitizeOriginalName, detectImageMime, readImageDimensions } = require('../src/services/attachments');

const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function createService() {
  return createAttachmentService({
    stmts: {},
    rootDir: process.cwd(),
    config: {
      dir: 'data/test-uploads',
      maxMb: 5,
      allowedImageTypes: ['image/png'],
    },
  });
}

test('sanitizeOriginalName elimina rutas y caracteres peligrosos', () => {
  assert.equal(sanitizeOriginalName('../mi <foto>.png'), 'mi foto.png');
});

test('validateImageFile permite imagen válida menor a 5 MB', () => {
  const service = createService();
  assert.doesNotThrow(() => service.validateImageFile({
    mimetype: 'image/png',
    size: pngBuffer.length,
    originalname: 'ok.png',
    buffer: pngBuffer,
  }));
});

test('validateImageFile rechaza archivos mayores a 5 MB', () => {
  const service = createService();
  assert.throws(() => service.validateImageFile({
    mimetype: 'image/png',
    size: 5 * 1024 * 1024 + 1,
    originalname: 'grande.png',
    buffer: pngBuffer,
  }), /no puede superar 5 MB/);
});

test('validateImageFile rechaza tipos no permitidos', () => {
  const service = createService();
  assert.throws(() => service.validateImageFile({
    mimetype: 'text/plain',
    size: 10,
    originalname: 'nota.txt',
    buffer: Buffer.from('hola'),
  }), /Tipo de imagen no permitido/);
});

test('detectImageMime detecta firmas binarias conocidas', () => {
  assert.equal(detectImageMime(pngBuffer), 'image/png');
  assert.equal(detectImageMime(Buffer.from('ffd8ffe000104a464946', 'hex')), 'image/jpeg');
  assert.equal(detectImageMime(Buffer.from('GIF89a000000000000', 'ascii')), 'image/gif');
  assert.equal(detectImageMime(Buffer.from('RIFF0000WEBPVP8 ', 'ascii')), 'image/webp');
});

test('readImageDimensions extrae dimensiones PNG', () => {
  const info = readImageDimensions(Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000002000000030806000000',
    'hex'
  ), 'image/png');
  assert.deepEqual(info, { width: 2, height: 3 });
});

test('validateImageFile rechaza MIME falso aunque el nombre parezca imagen', () => {
  const service = createService();
  assert.throws(() => service.validateImageFile({
    mimetype: 'image/png',
    size: 10,
    originalname: 'falsa.png',
    buffer: Buffer.from('esto no es png'),
  }), /imagen válida/);
});

test('deleteSessionAttachmentFiles borra archivos físicos de una sesión', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcp-attachments-'));
  const filePath = path.join(dir, 'imagen.png');
  await fs.writeFile(filePath, Buffer.from('png'));

  const service = createAttachmentService({
    stmts: {
      getAllAttachmentsBySession: {
        all: async sessionId => [{ id: 1, session_id: sessionId, storage_path: filePath }],
      },
    },
    rootDir: process.cwd(),
    config: { dir, maxMb: 5, allowedImageTypes: ['image/png'] },
  });

  const count = await service.deleteSessionAttachmentFiles('session-1');
  assert.equal(count, 1);
  await assert.rejects(() => fs.stat(filePath), { code: 'ENOENT' });
});
