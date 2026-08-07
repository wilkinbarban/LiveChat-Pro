'use strict';

const crypto = require('crypto');
const { diceCoefficient } = require('./text-match.js');

/**
 * Splitting text into overlapping chunks (~900 chars / 150 overlap)
 * on paragraph and sentence boundaries.
 */
function chunkText(text, options = {}) {
  const maxChunkSize = options.maxChunkSize || 900;
  const overlap = options.overlap || 150;

  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.length <= maxChunkSize) return [raw];

  const chunks = [];
  let startIndex = 0;

  while (startIndex < raw.length) {
    const endIndex = startIndex + maxChunkSize;

    if (endIndex >= raw.length) {
      const lastChunk = raw.slice(startIndex).trim();
      if (lastChunk) chunks.push(lastChunk);
      break;
    }

    let boundary = -1;
    const searchSub = raw.slice(startIndex, endIndex);

    // Look for paragraph break (\n\n)
    const lastParagraph = searchSub.lastIndexOf('\n\n');
    if (lastParagraph > maxChunkSize * 0.3) {
      boundary = startIndex + lastParagraph + 2;
    } else {
      // Look for sentence break (. , ! , ? , \n)
      const matches = [...searchSub.matchAll(/[.?!]\s+|\n/g)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        if (lastMatch.index > maxChunkSize * 0.3) {
          boundary = startIndex + lastMatch.index + lastMatch[0].length;
        }
      }
      if (boundary === -1) {
        // Look for word space
        const lastSpace = searchSub.lastIndexOf(' ');
        if (lastSpace > maxChunkSize * 0.3) {
          boundary = startIndex + lastSpace + 1;
        }
      }
    }

    if (boundary === -1 || boundary <= startIndex) {
      boundary = endIndex;
    }

    const chunk = raw.slice(startIndex, boundary).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    let nextStart = boundary - overlap;
    if (nextStart <= startIndex) {
      nextStart = boundary;
    }
    startIndex = nextStart;
  }

  return chunks;
}

/**
 * Creates RAG core service for managing documents, chunks, and lexical retrieval.
 */
function createRagService(deps = {}) {
  const db = deps.db;
  const stmts = deps.stmts;

  async function ingestText({ sourceType, source, title, text }) {
    if (!text || typeof text !== 'string') {
      throw new Error('El contenido de texto es requerido para la ingestión RAG');
    }
    if (!sourceType || !source) {
      throw new Error('sourceType y source son requeridos para la ingestión RAG');
    }

    const contentHash = crypto.createHash('sha256').update(text).digest('hex');
    const now = Date.now();

    // Check if document already exists by content_hash
    let existingDoc;
    if (stmts?.getRagDocumentByHash) {
      existingDoc = await stmts.getRagDocumentByHash.get(contentHash);
    } else if (db?.get) {
      existingDoc = await db.get('SELECT * FROM rag_documents WHERE content_hash = ?', [contentHash]);
    }

    if (existingDoc) {
      let chunksCountRow;
      if (db?.get) {
        chunksCountRow = await db.get('SELECT COUNT(*) as count FROM rag_chunks WHERE document_id = ?', [
          existingDoc.id,
        ]);
      }
      return {
        documentId: existingDoc.id,
        chunkCount: chunksCountRow ? chunksCountRow.count : 0,
      };
    }

    // Insert new document
    let documentId;
    if (stmts?.insertRagDocument) {
      const res = await stmts.insertRagDocument.run({
        source,
        source_type: sourceType,
        title: title || null,
        content_hash: contentHash,
        created_at: now,
      });
      documentId = res.lastID || res.id;
    } else if (db?.run) {
      const res = await db.run(
        'INSERT INTO rag_documents (source, source_type, title, content_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [source, sourceType, title || null, contentHash, now]
      );
      documentId = res.lastID || res.id;
    }

    if (!documentId) {
      // Fallback query if lastID wasn't returned directly
      const created = await db.get('SELECT id FROM rag_documents WHERE content_hash = ?', [contentHash]);
      documentId = created?.id;
    }

    // Chunk text and insert chunks
    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      const chunkStr = chunks[i];
      const seq = i + 1;
      if (stmts?.insertRagChunk) {
        await stmts.insertRagChunk.run({
          document_id: documentId,
          seq,
          text: chunkStr,
          created_at: now,
        });
      } else if (db?.run) {
        await db.run(
          'INSERT INTO rag_chunks (document_id, seq, text, created_at) VALUES (?, ?, ?, ?)',
          [documentId, seq, chunkStr, now]
        );
      }
    }

    return {
      documentId,
      chunkCount: chunks.length,
    };
  }

  async function retrieve(query, options = {}) {
    const limit = options.limit || 4;
    const minScore = options.minScore !== undefined ? options.minScore : 0.2;
    const maxContextChars = options.maxContextChars || 1800;

    if (!query || typeof query !== 'string') return [];

    let allChunks = [];
    if (stmts?.getAllRagChunks) {
      allChunks = await stmts.getAllRagChunks.all();
    } else if (db?.all) {
      allChunks = await db.all(`
        SELECT c.*, d.source, d.source_type, d.title
        FROM rag_chunks c
        JOIN rag_documents d ON c.document_id = d.id
      `);
    }

    if (!allChunks || allChunks.length === 0) return [];

    const scored = [];
    for (const chunk of allChunks) {
      const score = diceCoefficient(query, chunk.text);
      if (score >= minScore) {
        scored.push({
          chunkId: chunk.id,
          documentId: chunk.document_id,
          seq: chunk.seq,
          text: chunk.text,
          title: chunk.title,
          source: chunk.source,
          sourceType: chunk.source_type,
          score: Number(score.toFixed(4)),
        });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score || a.chunkId - b.chunkId);

    // Limit to top N chunks within total character context limit
    const results = [];
    let totalChars = 0;

    for (const item of scored) {
      if (results.length >= limit) break;
      if (totalChars + item.text.length > maxContextChars && results.length > 0) {
        continue;
      }
      results.push(item);
      totalChars += item.text.length;
    }

    return results;
  }

  async function listDocuments() {
    if (stmts?.getAllRagDocuments) {
      return await stmts.getAllRagDocuments.all();
    }
    if (db?.all) {
      return await db.all('SELECT * FROM rag_documents ORDER BY created_at DESC');
    }
    return [];
  }

  async function deleteDocument(id) {
    if (stmts?.deleteRagDocument) {
      await stmts.deleteRagDocument.run(id);
    } else if (db?.run) {
      await db.run('DELETE FROM rag_documents WHERE id = ?', [id]);
    }
  }

  return {
    chunkText,
    ingestText,
    retrieve,
    listDocuments,
    deleteDocument,
  };
}

module.exports = {
  createRagService,
  chunkText,
};
