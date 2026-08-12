'use strict';

const crypto = require('crypto');
const { stem, tokenize } = require('./text-match.js');
const { getLastInsertId } = require('../utils/sqlite-result');

const RETRIEVAL_STOP_WORDS = new Set([
  'a', 'al', 'como', 'con', 'cual', 'de', 'del', 'el', 'en', 'es', 'esta', 'este', 'hace', 'la', 'las', 'lo',
  'los', 'para', 'por', 'que', 'se', 'su', 'un', 'una', 'y',
  'about', 'and', 'does', 'how', 'is', 'of', 'the', 'to', 'what',
]);

function retrievalTokens(value) {
  return [...new Set(tokenize(value).filter(token => token.length > 1 && !RETRIEVAL_STOP_WORDS.has(token)).map(stem))];
}

function queryCoverage(queryTokens, candidate) {
  if (!queryTokens.length) return 0;
  const candidateTokens = new Set(retrievalTokens(candidate));
  return queryTokens.filter(token => candidateTokens.has(token)).length / queryTokens.length;
}

function lexicalScore(queryTokens, chunk, identifierTokens = []) {
  if (!queryTokens.length) return 0;
  const contentCoverage = queryCoverage(queryTokens, chunk.text);
  const metadataCoverage = queryCoverage(queryTokens, `${chunk.title || ''} ${chunk.source || ''}`);
  if (identifierTokens.length && queryCoverage(identifierTokens, `${chunk.title || ''} ${chunk.source || ''}`) < 1) {
    return 0;
  }
  if (contentCoverage === 0 && metadataCoverage === 0) return 0;
  return (contentCoverage * 0.6) + (metadataCoverage * 0.4);
}

/**
 * Splitting text into overlapping chunks (~900 chars / 150 overlap)
 * on paragraph and sentence boundaries.
 */
function chunkText(text, options = {}) {
  const maxChunkSize = options.maxChunkSize ?? 900;
  const overlap = options.overlap ?? 150;
  if (!Number.isFinite(maxChunkSize) || maxChunkSize <= 0) throw new RangeError('maxChunkSize must be greater than 0');
  if (!Number.isFinite(overlap) || overlap < 0) throw new RangeError('overlap must be greater than or equal to 0');

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

  async function stageText({ sourceType, source, sourceKey = source, title, text }) {
    if (!text || typeof text !== 'string') throw new Error('El contenido de texto es requerido para la ingestión RAG');
    if (Buffer.byteLength(text, 'utf8') > 3 * 1024 * 1024) throw new Error('El contenido RAG supera el límite de 3 MiB');
    if (!sourceType || !sourceKey) throw new Error('sourceType y source son requeridos para la ingestión RAG');
    const contentHash = crypto.createHash('sha256').update(text).digest('hex');
    const now = Date.now();
    if (typeof db?.runInTransaction !== 'function') throw new Error('La ingestión pendiente requiere soporte transaccional');
    return db.runInTransaction(async connection => {
      const existing = await connection.get('SELECT * FROM rag_documents WHERE content_hash = ?', contentHash);
      if (existing) return { documentId: existing.id, chunkCount: 0, status: existing.status };
      const inserted = await connection.run(
        "INSERT INTO rag_documents (source, source_type, title, content_hash, status, pending_text, indexed_at, error, created_at) VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, ?)",
        sourceKey, sourceType, title || null, contentHash, text, now
      );
      return { documentId: getLastInsertId(inserted), chunkCount: 0, status: 'pending' };
    });
  }

  async function promotePending() {
    if (typeof db?.runInTransaction !== 'function') throw new Error('La indexación requiere soporte transaccional');
    const pending = await db.all("SELECT * FROM rag_documents WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10");
    let indexed = 0;
    try {
      for (const document of pending) {
        await db.runInTransaction(async connection => {
          const chunks = chunkText(document.pending_text || '');
          if (!chunks.length) throw new Error(`Documento pendiente ${document.id} sin contenido`);
          for (let index = 0; index < chunks.length; index++) {
            await connection.run('INSERT INTO rag_chunks (document_id, seq, text, created_at) VALUES (?, ?, ?, ?)', document.id, index + 1, chunks[index], Date.now());
          }
          await connection.run("UPDATE rag_documents SET status = 'indexed', pending_text = NULL, indexed_at = ?, error = NULL WHERE id = ? AND status = 'pending'", Date.now(), document.id);
          if (document.source_type === 'url') {
            const older = await connection.all("SELECT id FROM rag_documents WHERE source = ? AND source_type = 'url' AND status = 'indexed' AND id <> ? ORDER BY created_at DESC", document.source, document.id);
            for (const old of older) await connection.run('DELETE FROM rag_documents WHERE id = ?', old.id);
          }
        });
        indexed++;
      }
      const remaining = await db.get?.("SELECT COUNT(*) AS count FROM rag_documents WHERE status = 'pending'");
      return { indexed, pending: remaining?.count ?? Math.max(0, pending.length - indexed) };
    } catch (error) {
      if (db?.run) {
        await db.run("UPDATE rag_documents SET error = ? WHERE status = 'pending'", [String(error.message || error).slice(0, 500)]);
      }
      throw error;
    }
  }

  async function ingestText({ sourceType, source, sourceKey = source, title, text, replaceSource = false }) {
    if (!text || typeof text !== 'string') {
      throw new Error('El contenido de texto es requerido para la ingestión RAG');
    }
    if (!sourceType || !source) {
      throw new Error('sourceType y source son requeridos para la ingestión RAG');
    }

    const contentHash = crypto.createHash('sha256').update(replaceSource ? `${sourceKey}\0${text}` : text).digest('hex');
    const now = Date.now();
    const chunks = chunkText(text);

    if (replaceSource) {
      if (typeof db?.runInTransaction !== 'function') {
        throw new Error('replaceSource requiere soporte transaccional');
      }
      return db.runInTransaction(async connection => {
        const existing = await connection.get('SELECT * FROM rag_documents WHERE content_hash = ?', contentHash);
        if (existing) {
          const count = await connection.get('SELECT COUNT(*) AS count FROM rag_chunks WHERE document_id = ?', existing.id);
          return { documentId: existing.id, chunkCount: count?.count || 0 };
        }
        const previous = await connection.all(
          "SELECT id FROM rag_documents WHERE LOWER(RTRIM(REPLACE(source, '.git', ''), '/')) = ? ORDER BY id ASC",
          String(sourceKey).toLowerCase()
        );
        const inserted = await connection.run(
          'INSERT INTO rag_documents (source, source_type, title, content_hash, created_at) VALUES (?, ?, ?, ?, ?)',
          sourceKey, sourceType, title || null, contentHash, now
        );
        const documentId = getLastInsertId(inserted);
        for (let index = 0; index < chunks.length; index++) {
          await connection.run(
            'INSERT INTO rag_chunks (document_id, seq, text, created_at) VALUES (?, ?, ?, ?)',
            documentId, index + 1, chunks[index], now
          );
        }
        for (const document of previous) {
          if (document.id !== documentId) await connection.run('DELETE FROM rag_documents WHERE id = ?', document.id);
        }
        return { documentId, chunkCount: chunks.length };
      });
    }

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

    let documentId;
    if (stmts?.insertRagDocument) {
      const res = await stmts.insertRagDocument.run({
        source,
        source_type: sourceType,
        title: title || null,
        content_hash: contentHash,
        created_at: now,
      });
      documentId = getLastInsertId(res);
    } else if (db?.run) {
      const res = await db.run(
        'INSERT INTO rag_documents (source, source_type, title, content_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [source, sourceType, title || null, contentHash, now]
      );
      documentId = getLastInsertId(res);
    }

    if (!documentId) {
      // Fallback query if the insert id wasn't returned directly. Prefer the
      // statement facade (works without a db handle in production wiring).
      let created;
      if (stmts?.getRagDocumentByHash) {
        created = await stmts.getRagDocumentByHash.get(contentHash);
      } else if (db?.get) {
        created = await db.get('SELECT id FROM rag_documents WHERE content_hash = ?', [contentHash]);
      }
      documentId = created?.id;
    }

    // Chunk text and insert chunks
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

    return { documentId, chunkCount: chunks.length };
  }

  async function retrieve(query, options = {}) {
    const limit = options.limit ?? 4;
    const minScore = options.minScore !== undefined ? options.minScore : 0.2;
    const maxContextChars = options.maxContextChars ?? 1800;

    if (!query || typeof query !== 'string') return [];
    if (!Number.isFinite(limit) || limit < 0) throw new RangeError('limit must be greater than or equal to 0');
    if (!Number.isFinite(minScore) || minScore < 0) throw new RangeError('minScore must be greater than or equal to 0');
    if (!Number.isFinite(maxContextChars) || maxContextChars < 0) {
      throw new RangeError('maxContextChars must be greater than or equal to 0');
    }

    let allChunks = [];
    if (stmts?.getAllRagChunks) {
      allChunks = await stmts.getAllRagChunks.all();
    } else if (db?.all) {
      allChunks = await db.all(`
        SELECT c.*, d.source, d.source_type, d.title
        FROM rag_chunks c
        JOIN rag_documents d ON c.document_id = d.id
        WHERE d.status = 'indexed'
      `);
    }

    if (!allChunks || allChunks.length === 0) return [];

    const queryTokens = retrievalTokens(query);
    const identifierTokens = queryTokens.filter(token => allChunks.some(chunk => {
      const metadataTokens = new Set(retrievalTokens(`${chunk.title || ''} ${chunk.source || ''}`));
      return metadataTokens.has(token);
    }));
    const scored = [];
    for (const chunk of allChunks) {
      const score = lexicalScore(queryTokens, chunk, identifierTokens);
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
      if (totalChars + item.text.length > maxContextChars) {
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
      return await db.all('SELECT id, source, source_type, title, content_hash, status, indexed_at, error, created_at FROM rag_documents ORDER BY created_at DESC');
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
    stageText,
    promotePending,
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
