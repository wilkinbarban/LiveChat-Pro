'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAttachmentService } = require('../src/services/attachments');
const { createSessionService } = require('../src/services/sessions');
const { runMigrations } = require('../db');

test('confirmed dead service exports are absent', () => {
  const attachmentService = createAttachmentService({ stmts: {} });
  const sessionService = createSessionService({
    sessions: new Map(), stmts: {}, clusterState: {}, logger: {},
    adminLanguage: 'en', translate: async value => value,
  });

  assert.equal(Object.hasOwn(attachmentService, 'listMessageAttachments'), false);
  assert.equal(Object.hasOwn(sessionService, 'serializeMessage'), false);
});

test('orphan cleanup deletes only unreferenced regular files older than one hour', async (t) => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcp-gc-'));
  t.after(() => fs.rm(uploadDir, { recursive: true, force: true }));
  const now = Date.now();
  const referenced = path.join(uploadDir, 'referenced.png');
  const oldOrphan = path.join(uploadDir, 'old-orphan.png');
  const freshOrphan = path.join(uploadDir, 'fresh-orphan.png');
  await Promise.all([
    fs.writeFile(referenced, 'referenced'),
    fs.writeFile(oldOrphan, 'orphan'),
    fs.writeFile(freshOrphan, 'fresh'),
  ]);
  const old = new Date(now - 3_600_001);
  await Promise.all([fs.utimes(referenced, old, old), fs.utimes(oldOrphan, old, old)]);
  const service = createAttachmentService({
    stmts: { getAllAttachmentPaths: { all: async () => [{ storage_path: referenced }] } },
    config: { dir: uploadDir },
  });

  assert.deepEqual(await service.cleanupOrphanFiles({ now }), { scanned: 3, deleted: 1 });
  assert.equal(await fs.readFile(referenced, 'utf8'), 'referenced');
  assert.equal(await fs.readFile(freshOrphan, 'utf8'), 'fresh');
  await assert.rejects(fs.stat(oldOrphan), { code: 'ENOENT' });
});

test('orphan cleanup deletes nothing when the database snapshot fails', async (t) => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcp-gc-safe-'));
  t.after(() => fs.rm(uploadDir, { recursive: true, force: true }));
  const orphan = path.join(uploadDir, 'uncertain.png');
  await fs.writeFile(orphan, 'keep');
  const logger = { errorCalls: [], error(value, message) { this.errorCalls.push([value, message]); } };
  const service = createAttachmentService({
    stmts: { getAllAttachmentPaths: { all: async () => { throw new Error('snapshot unavailable'); } } },
    logger,
    config: { dir: uploadDir },
  });

  await assert.rejects(service.cleanupOrphanFiles(), /snapshot unavailable/);
  assert.equal(await fs.readFile(orphan, 'utf8'), 'keep');
  assert.equal(logger.errorCalls.length, 1);
});

test('orphan cleanup tolerates an ENOENT unlink race and continues', async (t) => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcp-gc-race-'));
  t.after(() => fs.rm(uploadDir, { recursive: true, force: true }));
  const vanished = path.join(uploadDir, 'vanished.png');
  const orphan = path.join(uploadDir, 'orphan.png');
  await Promise.all([fs.writeFile(vanished, 'gone'), fs.writeFile(orphan, 'delete')]);
  const old = new Date(Date.now() - 3_600_001);
  await Promise.all([fs.utimes(vanished, old, old), fs.utimes(orphan, old, old)]);
  const fileSystem = {
    ...fs,
    async unlink(filePath) {
      if (filePath === vanished) {
        await fs.unlink(filePath);
        return fs.unlink(filePath);
      }
      return fs.unlink(filePath);
    },
  };
  const service = createAttachmentService({
    stmts: { getAllAttachmentPaths: { all: async () => [] } },
    config: { dir: uploadDir },
    fileSystem,
  });

  assert.deepEqual(await service.cleanupOrphanFiles({ now: Date.now() }), { scanned: 2, deleted: 1 });
  await assert.rejects(fs.stat(orphan), { code: 'ENOENT' });
});

test('migration failure reports version, statement identity, and cause and stops', async () => {
  const executed = [];
  const cause = new Error('syntax near BROKEN');
  const db = { exec: async statement => { executed.push(statement); if (statement === 'BROKEN SQL') throw cause; } };
  const errors = [];

  await assert.rejects(
    runMigrations(db, [
      { version: 10, id: 'first', statement: 'SELECT 1' },
      { version: 11, id: 'broken-column', statement: 'BROKEN SQL' },
      { version: 12, id: 'later', statement: 'SELECT 2' },
    ], { error: value => errors.push(value) }),
    error => error.cause === cause && error.migrationVersion === 11 && error.statementId === 'broken-column',
  );
  assert.deepEqual(executed, ['SELECT 1', 'BROKEN SQL']);
  assert.equal(errors[0].cause, cause);
});

test('legacy RAG rebuild identifies its failing migration step and cause', async () => {
  const { rebuildLegacyRagTable } = require('../db');
  const cause = new Error('legacy row violates rebuilt constraint');
  const executed = [];
  const db = { exec: async statement => {
    executed.push(statement);
    if (statement.startsWith('INSERT INTO rag_documents_new')) throw cause;
  } };

  await assert.rejects(
    rebuildLegacyRagTable(db, new Set(['status', 'pending_text', 'indexed_at', 'error', 'created_at'])),
    error => error.cause === cause && error.migrationVersion === 'legacy-rag-source-type-v1'
      && error.statementId === 'copy-legacy-rag-documents',
  );
  assert.equal(executed.includes('ALTER TABLE rag_documents_new RENAME TO rag_documents'), false);
});
