// ============================================================
// Migration script tests — data/knowledge-base.json to RAG DB
// ============================================================
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRagService } = require('../src/services/rag');

const { migrateKbToRag } = require('../scripts/migrate-kb-to-rag');

describe('scripts/migrate-kb-to-rag.js', () => {
  const tmpDir = path.join(__dirname, 'tmp-kb-migrate-' + Date.now());
  const testKbPath = path.join(tmpDir, 'knowledge-base.json');
  const testBakPath = path.join(tmpDir, 'knowledge-base.json.bak');
  let mockDb;
  let ragService;

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // In-memory sqlite mock structure for testing
    const docs = new Map();
    const chunks = [];
    let docIdSeq = 1;
    let chunkIdSeq = 1;

    mockDb = {
      docs,
      chunks,
      async get(sql, params = []) {
        if (sql.includes('FROM rag_documents WHERE content_hash = ?')) {
          const hash = params[0];
          for (const doc of docs.values()) {
            if (doc.content_hash === hash) return doc;
          }
          return null;
        }
        if (sql.includes('SELECT COUNT(*) as count FROM rag_chunks WHERE document_id = ?')) {
          const docId = params[0];
          const count = chunks.filter((c) => c.document_id === docId).length;
          return { count };
        }
        if (sql.includes('SELECT id FROM rag_documents WHERE content_hash = ?')) {
          const hash = params[0];
          for (const doc of docs.values()) {
            if (doc.content_hash === hash) return { id: doc.id };
          }
          return null;
        }
        return null;
      },
      async run(sql, params = []) {
        if (sql.includes('INSERT INTO rag_documents')) {
          const [source, sourceType, title, contentHash, createdAt] = params;
          const id = docIdSeq++;
          const doc = { id, source, source_type: sourceType, title, content_hash: contentHash, created_at: createdAt };
          docs.set(id, doc);
          return { lastID: id };
        }
        if (sql.includes('INSERT INTO rag_chunks')) {
          const [docId, seq, text, createdAt] = params;
          const id = chunkIdSeq++;
          chunks.push({ id, document_id: docId, seq, text, created_at: createdAt });
          return { lastID: id };
        }
        return {};
      },
      async all(sql) {
        if (sql.includes('FROM rag_documents')) {
          return Array.from(docs.values());
        }
        if (sql.includes('FROM rag_chunks')) {
          return chunks;
        }
        return [];
      },
    };

    ragService = createRagService({ db: mockDb });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reporta "nothing to migrate" y retorna éxito cuando el archivo KB no existe', async () => {
    const missingPath = path.join(tmpDir, 'non-existent-kb.json');
    const result = await migrateKbToRag({
      kbPath: missingPath,
      ragService,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrated, 0);
    assert.match(result.message, /nothing to migrate/i);
    assert.equal(fs.existsSync(`${missingPath}.bak`), false);
  });

  it('crea un archivo de backup y migra la base de conocimiento en formato de mapa de idiomas', async () => {
    const kbData = {
      es: [
        {
          id: 'test-es-1',
          question: '¿Qué es esto?',
          answer: 'Es una prueba de migración RAG.',
          language: 'es',
        },
        {
          id: 'test-es-2',
          question: '¿Cómo funciona?',
          answer: 'Lee el archivo JSON e ingesta cada elemento.',
          language: 'es',
        },
      ],
      en: [
        {
          id: 'test-en-1',
          question: 'What is this?',
          answer: 'It is a RAG migration test.',
          language: 'en',
        },
      ],
    };
    fs.writeFileSync(testKbPath, JSON.stringify(kbData, null, 2), 'utf8');

    const result = await migrateKbToRag({
      kbPath: testKbPath,
      backupPath: testBakPath,
      ragService,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrated, 3);
    assert.equal(fs.existsSync(testBakPath), true);

    const docs = await ragService.listDocuments();
    assert.equal(docs.length, 3);
  });

  it('migra la base de conocimiento en formato de arreglo plano', async () => {
    const kbArray = [
      {
        id: 'flat-1',
        question: 'Pregunta 1',
        answer: 'Respuesta 1',
      },
      {
        id: 'flat-2',
        question: 'Pregunta 2',
        answer: 'Respuesta 2',
      },
    ];
    fs.writeFileSync(testKbPath, JSON.stringify(kbArray, null, 2), 'utf8');

    const result = await migrateKbToRag({
      kbPath: testKbPath,
      backupPath: testBakPath,
      ragService,
    });

    assert.equal(result.success, true);
    assert.equal(result.migrated, 2);
  });

  it('es idempotente: ejecuciones secundarias no duplican documentos ni incrementan la cuenta', async () => {
    const kbData = {
      es: [
        {
          id: 'idem-1',
          question: '¿Es idéntico?',
          answer: 'Sí, la hash de contenido evita duplicados.',
          language: 'es',
        },
      ],
    };
    fs.writeFileSync(testKbPath, JSON.stringify(kbData, null, 2), 'utf8');

    const run1 = await migrateKbToRag({
      kbPath: testKbPath,
      backupPath: testBakPath,
      ragService,
    });
    assert.equal(run1.migrated, 1);
    assert.equal((await ragService.listDocuments()).length, 1);

    const run2 = await migrateKbToRag({
      kbPath: testKbPath,
      backupPath: testBakPath,
      ragService,
    });
    assert.equal(run2.migrated, 0); // No new documents migrated
    assert.equal(run2.skipped, 1);
    assert.equal((await ragService.listDocuments()).length, 1);
  });
});
