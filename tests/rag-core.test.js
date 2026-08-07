// ============================================================
// Tests for RAG Core Service & SQLite Storage (DDL, Chunking, Retrieval)
// ============================================================
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Ensure DB runs in memory for tests
process.env.DB_PATH = ':memory:';
const { db, closeDb, initDb } = require('../db.js');
const { createRagService, chunkText } = require('../src/services/rag.js');

describe('RAG Core — Text Chunker', () => {
  it('returns an empty array for empty or whitespace text', () => {
    assert.deepEqual(chunkText(''), []);
    assert.deepEqual(chunkText('   '), []);
    assert.deepEqual(chunkText(null), []);
  });

  it('returns a single chunk when text length is below maxChunkSize (~900 chars)', () => {
    const text = 'Esta es una política de devoluciones muy corta para pruebas.';
    const chunks = chunkText(text, { maxChunkSize: 900 });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], text);
  });

  it('chunks long text into multiple overlapping segments on paragraph/sentence boundaries', () => {
    const paragraph1 = 'Primer párrafo con suficiente texto. ' + 'Palabras de ejemplo. '.repeat(20);
    const paragraph2 = 'Segundo párrafo con otro contenido. ' + 'Devoluciones y reembolsos. '.repeat(20);
    const paragraph3 = 'Tercer párrafo con detalles de garantías. ' + 'Contacto con soporte. '.repeat(20);
    const fullText = `${paragraph1}\n\n${paragraph2}\n\n${paragraph3}`;

    const chunks = chunkText(fullText, { maxChunkSize: 500, overlap: 100 });
    assert.ok(chunks.length >= 2, 'Debe generar al menos 2 chunks');

    for (const chunk of chunks) {
      assert.ok(chunk.length <= 600, `El chunk supera el tamaño límite: ${chunk.length}`);
      assert.ok(chunk.trim().length > 0, 'No debe haber chunks vacíos');
    }
  });
});

describe('RAG Core — SQLite Tables & Service Storage', () => {
  beforeEach(async () => {
    await initDb();
    await db.exec('DELETE FROM rag_chunks; DELETE FROM rag_documents;');
  });

  afterEach(async () => {
    await closeDb();
  });

  it('crea las tablas rag_documents y rag_chunks con DDL e índices válidos', async () => {
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rag_documents', 'rag_chunks')"
    );
    assert.equal(tables.length, 2, 'Las tablas rag_documents y rag_chunks deben existir en la BD');

    const index = await db.get(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rag_chunks_doc'"
    );
    assert.ok(index, 'El índice idx_rag_chunks_doc debe existir');
  });

  it('ingestText almacena documento y chunks, deduplicando por SHA-256 content_hash', async () => {
    const ragService = createRagService({ db });

    const doc1 = await ragService.ingestText({
      sourceType: 'url',
      source: 'https://example.com/refunds',
      title: 'Política de Reembolsos',
      text: 'Ofrecemos reembolso completo durante los primeros 30 días posteriores a la compra.',
    });

    assert.ok(doc1.documentId > 0);
    assert.ok(doc1.chunkCount >= 1);

    // Intento de re-ingest del mismo contenido exacto
    const doc1Dup = await ragService.ingestText({
      sourceType: 'url',
      source: 'https://example.com/refunds-dup',
      title: 'Política Duplicada',
      text: 'Ofrecemos reembolso completo durante los primeros 30 días posteriores a la compra.',
    });

    assert.equal(doc1Dup.documentId, doc1.documentId, 'Debe retornar el ID del documento existente por content_hash');

    const docCount = await db.get('SELECT COUNT(*) as count FROM rag_documents');
    assert.equal(docCount.count, 1, 'No debe duplicar registros en rag_documents');
  });

  it('retrieve() es una interfaz asíncrona que retorna los top-4 chunks con score Dice >= 0.2', async () => {
    const ragService = createRagService({ db });

    await ragService.ingestText({
      sourceType: 'kb-migration',
      source: 'kb:refund',
      title: 'Reembolsos',
      text: 'Para solicitar una devolución o reembolso de dinero, contacte al soporte dentro de los 30 días.',
    });

    await ragService.ingestText({
      sourceType: 'kb-migration',
      source: 'kb:shipping',
      title: 'Envíos',
      text: 'Los envíos nacionales tardan de 2 a 5 días hábiles en llegar a su destino.',
    });

    // Query relevante para reembolsos
    const results = await ragService.retrieve('¿Cómo pido una devolución o reembolso?');
    assert.ok(Array.isArray(results), 'retrieve() debe retornar un array (Promise)');
    assert.ok(results.length >= 1, 'Debe encontrar al menos un chunk relevante');
    assert.equal(results[0].title, 'Reembolsos');
    assert.ok(results[0].score >= 0.2, 'El score debe ser mayor o igual al umbral 0.2');

    // Query sin similitud
    const emptyResults = await ragService.retrieve('Astronomía y galaxias lejanas');
    assert.deepEqual(emptyResults, [], 'Debe retornar [] cuando ningún chunk alcance el umbral 0.2');
  });

  it('retrieve() respeta el límite top-4 y el tope de caracteres acumulados (<= 1800)', async () => {
    const ragService = createRagService({ db });

    // Ingest 6 documents with refund keyword
    for (let i = 1; i <= 6; i++) {
      await ragService.ingestText({
        sourceType: 'url',
        source: `https://example.com/item-${i}`,
        title: `Documento ${i}`,
        text: `Información sobre devoluciones y reembolso para el artículo número ${i}. Detalle extendido.`,
      });
    }

    const results = await ragService.retrieve('devoluciones y reembolso', { limit: 4 });
    assert.ok(results.length <= 4, 'No debe retornar más de 4 chunks');

    const totalChars = results.reduce((sum, item) => sum + item.text.length, 0);
    assert.ok(totalChars <= 1800, 'El contexto acumulado no debe superar 1800 caracteres');
  });

  it('deleteDocument elimina el documento y sus chunks por ON DELETE CASCADE', async () => {
    const ragService = createRagService({ db });

    const doc = await ragService.ingestText({
      sourceType: 'pdf',
      source: 'manual.pdf',
      title: 'Manual de Usuario',
      text: 'Este es el texto del manual de usuario en formato PDF.',
    });

    const docsBefore = await ragService.listDocuments();
    assert.equal(docsBefore.length, 1);

    await ragService.deleteDocument(doc.documentId);

    const docsAfter = await ragService.listDocuments();
    assert.equal(docsAfter.length, 0);

    const chunkCount = await db.get('SELECT COUNT(*) as count FROM rag_chunks WHERE document_id = ?', [
      doc.documentId,
    ]);
    assert.equal(chunkCount.count, 0, 'Los chunks deben haberse borrado en cascada');
  });
});
