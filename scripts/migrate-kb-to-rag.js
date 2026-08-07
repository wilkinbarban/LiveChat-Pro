// ============================================================
// LiveChat Pro — scripts/migrate-kb-to-rag.js
// One-time migration script importing legacy data/knowledge-base.json
// items into the RAG database system.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Migrates legacy knowledge-base.json entries into RAG documents/chunks.
 *
 * @param {Object} options
 * @param {string} [options.kbPath] - Path to knowledge-base.json
 * @param {string} [options.backupPath] - Path to write backup file
 * @param {Object} [options.db] - SQLite database connection
 * @param {Object} [options.ragService] - Pre-initialized RAG service instance
 * @returns {Promise<{success: boolean, migrated: number, skipped: number, total: number, message: string}>}
 */
async function migrateKbToRag(options = {}) {
  let kbPath = options.kbPath;
  if (!kbPath) {
    const defaultDataKb = path.join(__dirname, '../data/knowledge-base.json');
    const fallbackTrainerKb = path.join(__dirname, '../kb-trainer/knowledge-base.json');
    if (fs.existsSync(defaultDataKb)) {
      kbPath = defaultDataKb;
    } else if (fs.existsSync(fallbackTrainerKb)) {
      kbPath = fallbackTrainerKb;
    } else {
      kbPath = defaultDataKb;
    }
  }

  if (!fs.existsSync(kbPath)) {
    const msg = `No knowledge base file found at ${kbPath} — nothing to migrate`;
    return {
      success: true,
      migrated: 0,
      skipped: 0,
      total: 0,
      backupPath: null,
      message: msg,
    };
  }

  // 1. Create backup
  const backupPath = options.backupPath || `${kbPath}.bak`;
  try {
    fs.copyFileSync(kbPath, backupPath);
    // Also create timestamped backup if using default backupPath
    if (!options.backupPath) {
      const ts = Date.now();
      const tsBackupPath = path.join(path.dirname(kbPath), `knowledge-base.${ts}.bak`);
      fs.copyFileSync(kbPath, tsBackupPath);
    }
  } catch (err) {
    throw new Error(`Failed to create knowledge base backup: ${err.message}`);
  }

  // 2. Read and parse KB JSON
  let kbData;
  try {
    const raw = fs.readFileSync(kbPath, 'utf8');
    kbData = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse knowledge base JSON at ${kbPath}: ${err.message}`);
  }

  // Extract items (handles language map object or flat array)
  const items = [];
  if (Array.isArray(kbData)) {
    items.push(...kbData);
  } else if (kbData && typeof kbData === 'object') {
    for (const lang of Object.keys(kbData)) {
      if (Array.isArray(kbData[lang])) {
        items.push(...kbData[lang]);
      }
    }
  }

  if (items.length === 0) {
    return {
      success: true,
      migrated: 0,
      skipped: 0,
      total: 0,
      backupPath,
      message: 'Knowledge base file is empty — nothing to migrate',
    };
  }

  // 3. Initialize RAG service if not provided
  let ragService = options.ragService;
  if (!ragService) {
    const { initDb } = require('../db');
    const { createRagService } = require('../src/services/rag');
    const { db, stmts } = await initDb();
    ragService = createRagService({ db, stmts });
  }

  // 4. Ingest items into RAG
  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    const question = String(item.question || '').trim();
    const answer = String(item.answer || '').trim();
    const text = question ? `${question}\n\n${answer}` : answer;

    if (!text) continue;

    const contentHash = crypto.createHash('sha256').update(text).digest('hex');
    const existingDocs = await ragService.listDocuments();
    const isExisting = existingDocs.some((doc) => doc.content_hash === contentHash);

    const docId = item.id || `kb-${item.language || 'entry'}`;
    const title = question || item.id || 'Knowledge Base Entry';

    await ragService.ingestText({
      sourceType: 'kb-migration',
      source: `kb:${docId}`,
      title,
      text,
    });

    if (isExisting) {
      skipped++;
    } else {
      migrated++;
    }
  }

  const message = `Migration completed: ${migrated} imported, ${skipped} skipped out of ${items.length} total entries. Backup saved to ${backupPath}`;
  return {
    success: true,
    migrated,
    skipped,
    total: items.length,
    backupPath,
    message,
  };
}

if (require.main === module) {
  (async () => {
    try {
      const result = await migrateKbToRag();
      console.log(result.message);
      process.exit(0);
    } catch (err) {
      console.error('Migration failed:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  migrateKbToRag,
};
