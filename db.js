// ============================================================
// LiveChat Pro — db.js
// Asynchronous SQLite persistence layer (sqlite + sqlite3)
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
// Data directory and database file path.
// Allows overriding with DB_PATH=:memory: in tests.
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'livechat.db');

if (DB_FILE !== ':memory:' && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let dbPromise = null;

function normalizeParams(params) {
  if (params.length !== 1 || !params[0] || Array.isArray(params[0]) || typeof params[0] !== 'object') {
    return params;
  }

  return [
    Object.fromEntries(
      Object.entries(params[0]).map(([key, value]) => [
        /^[@:$]/.test(key) ? key : `@${key}`,
        value,
      ])
    ),
  ];
}

function withDb(method) {
  return async (...args) => {
    const db = await initDb();
    const [sql, ...params] = args;
    return db[method](sql, ...normalizeParams(params));
  };
}

function createStatement(sql) {
  return {
    run: withDb('run').bind(null, sql),
    get: withDb('get').bind(null, sql),
    all: withDb('all').bind(null, sql),
  };
}

function createFallbackDb() {
  const { DatabaseSync } = require('node:sqlite');
  const syncDb = new DatabaseSync(DB_FILE);

  function prepare(sql) {
    const stmt = syncDb.prepare(sql);
    return stmt;
  }

  return {
    async run(sql, ...params) {
      return prepare(sql).run(...normalizeParams(params));
    },
    async get(sql, ...params) {
      return prepare(sql).get(...normalizeParams(params));
    },
    async all(sql, ...params) {
      return prepare(sql).all(...normalizeParams(params));
    },
    async exec(sql) {
      return syncDb.exec(sql);
    },
    async close() {
      if (typeof syncDb.close === 'function') {
        syncDb.close();
      }
    },
  };
}

async function createDb() {
  let db;

  try {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    require('sqlite3/lib/sqlite3-binding');
    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database,
    });
  } catch (error) {
    db = createFallbackDb();
  }

  // Performance and safety pragmas.
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('PRAGMA synchronous = NORMAL');

  // ── Schema ──────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id    TEXT    PRIMARY KEY,
      name          TEXT,
      lang          TEXT    NOT NULL DEFAULT 'es',
      lang_detected INTEGER NOT NULL DEFAULT 0,
      ip            TEXT,
      geo_city      TEXT,
      geo_country   TEXT,
      geo_isp       TEXT,
      user_agent    TEXT,
      current_page  TEXT    NOT NULL DEFAULT '/',
      banned        INTEGER NOT NULL DEFAULT 0,
      priority      INTEGER NOT NULL DEFAULT 0,
      admin_last_seen_ts INTEGER NOT NULL DEFAULT 0,
      user_last_seen_ts  INTEGER NOT NULL DEFAULT 0,
      awaiting_name INTEGER NOT NULL DEFAULT 1,
      last_active   INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      from_role   TEXT    NOT NULL CHECK(from_role IN ('user','admin','bot')),
      text        TEXT    NOT NULL,
      ts          INTEGER NOT NULL,
      lang        TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_sessions_active  ON sessions(last_active);
    CREATE INDEX IF NOT EXISTS idx_sessions_banned  ON sessions(banned);

    CREATE TABLE IF NOT EXISTS attachments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT    NOT NULL,
      message_id     INTEGER NOT NULL,
      filename       TEXT    NOT NULL,
      original_name  TEXT    NOT NULL,
      mime_type      TEXT    NOT NULL,
      size_bytes     INTEGER NOT NULL,
      storage_path   TEXT    NOT NULL,
      access_token   TEXT,
      width          INTEGER,
      height         INTEGER,
      created_at     INTEGER NOT NULL,
      deleted_at     INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id, deleted_at);
  `);

  // Migrations for existing databases (idempotent).
  try { await db.exec('ALTER TABLE sessions ADD COLUMN admin_last_seen_ts INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.exec('ALTER TABLE sessions ADD COLUMN user_last_seen_ts INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.exec('ALTER TABLE attachments ADD COLUMN access_token TEXT'); } catch {}
  try { await db.exec('ALTER TABLE attachments ADD COLUMN width INTEGER'); } catch {}
  try { await db.exec('ALTER TABLE attachments ADD COLUMN height INTEGER'); } catch {}

  return db;
}

function initDb() {
  if (!dbPromise) {
    dbPromise = createDb().catch(error => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function closeDb() {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  await db.close();
}

const db = {
  run: withDb('run'),
  get: withDb('get'),
  all: withDb('all'),
  exec: withDb('exec'),
  close: closeDb,
};

// ── Prepared statements ───────────────────────────────────────
const stmts = {
  // Sessions
  upsertSession: createStatement(`
    INSERT INTO sessions
      (session_id, name, lang, lang_detected, ip, geo_city, geo_country, geo_isp,
       user_agent, current_page, banned, priority, admin_last_seen_ts,
       user_last_seen_ts, awaiting_name, last_active, created_at)
    VALUES
      (@session_id, @name, @lang, @lang_detected, @ip, @geo_city, @geo_country, @geo_isp,
       @user_agent, @current_page, @banned, @priority, @admin_last_seen_ts,
       @user_last_seen_ts, @awaiting_name, @last_active, @created_at)
    ON CONFLICT(session_id) DO UPDATE SET
      name          = excluded.name,
      lang          = excluded.lang,
      lang_detected = excluded.lang_detected,
      current_page  = excluded.current_page,
      priority      = excluded.priority,
      admin_last_seen_ts = excluded.admin_last_seen_ts,
      user_last_seen_ts  = excluded.user_last_seen_ts,
      awaiting_name = excluded.awaiting_name,
      last_active   = excluded.last_active
  `),

  getSession: createStatement(
    'SELECT * FROM sessions WHERE session_id = ?'
  ),

  // Sessions active within the last N ms (loaded at startup).
  getRecentSessions: createStatement(
    'SELECT * FROM sessions WHERE last_active >= ? ORDER BY last_active DESC'
  ),

  getSessionsOverview: createStatement(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) AS message_count,
      (SELECT m.from_role FROM messages m WHERE m.session_id = s.session_id ORDER BY m.ts DESC LIMIT 1) AS last_from,
      (SELECT m.text FROM messages m WHERE m.session_id = s.session_id ORDER BY m.ts DESC LIMIT 1) AS last_text,
      (SELECT m.lang FROM messages m WHERE m.session_id = s.session_id ORDER BY m.ts DESC LIMIT 1) AS last_lang,
      (SELECT m.ts FROM messages m WHERE m.session_id = s.session_id ORDER BY m.ts DESC LIMIT 1) AS last_ts,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.session_id = s.session_id
          AND m.from_role = 'user'
          AND m.ts > COALESCE(s.admin_last_seen_ts, 0)
      ) AS unread_admin_count,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.session_id = s.session_id
          AND m.from_role IN ('admin', 'bot')
          AND m.ts > COALESCE(s.user_last_seen_ts, 0)
      ) AS unread_user_count
    FROM sessions s
    ORDER BY s.last_active DESC
  `),

  getAllBanned: createStatement(
    'SELECT session_id FROM sessions WHERE banned = 1'
  ),

  updateLastActive: createStatement(
    'UPDATE sessions SET last_active = ? WHERE session_id = ?'
  ),

  updateNetworkInfo: createStatement(
    'UPDATE sessions SET ip = ?, geo_city = ?, geo_country = ?, geo_isp = ?, user_agent = ?, last_active = ? WHERE session_id = ?'
  ),

  updatePage: createStatement(
    'UPDATE sessions SET current_page = ?, last_active = ? WHERE session_id = ?'
  ),

  // Stores the name and disables the awaiting_name flag.
  setName: createStatement(
    'UPDATE sessions SET name = ?, awaiting_name = 0, last_active = ? WHERE session_id = ?'
  ),

  updateLang: createStatement(
    'UPDATE sessions SET lang = ?, lang_detected = 1, last_active = ? WHERE session_id = ?'
  ),

  updatePriority: createStatement(
    'UPDATE sessions SET priority = 1, last_active = ? WHERE session_id = ?'
  ),

  markAdminSeen: createStatement(
    'UPDATE sessions SET admin_last_seen_ts = ? WHERE session_id = ?'
  ),

  markUserSeen: createStatement(
    'UPDATE sessions SET user_last_seen_ts = ? WHERE session_id = ?'
  ),

  banSession: createStatement(
    'UPDATE sessions SET banned = 1 WHERE session_id = ?'
  ),

  deleteSession: createStatement(
    'DELETE FROM sessions WHERE session_id = ?'
  ),

  // Messages
  insertMessage: createStatement(`
    INSERT INTO messages (session_id, from_role, text, ts, lang)
    VALUES (@session_id, @from_role, @text, @ts, @lang)
  `),

  getMessages: createStatement(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY ts ASC'
  ),

  clearMessagesBySession: createStatement(
    'DELETE FROM messages WHERE session_id = ?'
  ),

  deleteMessage: createStatement(
    'DELETE FROM messages WHERE id = ?'
  ),

  // Attachments
  insertAttachment: createStatement(`
    INSERT INTO attachments
      (session_id, message_id, filename, original_name, mime_type, size_bytes, storage_path, access_token, width, height, created_at, deleted_at)
    VALUES
      (@session_id, @message_id, @filename, @original_name, @mime_type, @size_bytes, @storage_path, @access_token, @width, @height, @created_at, NULL)
  `),

  getAttachment: createStatement(
    'SELECT * FROM attachments WHERE id = ?'
  ),

  getAttachmentsByMessage: createStatement(
    'SELECT * FROM attachments WHERE message_id = ? AND deleted_at IS NULL ORDER BY created_at ASC'
  ),

  getAttachmentsByMessages: createStatement(`
    SELECT * FROM attachments
    WHERE deleted_at IS NULL
      AND message_id IN (SELECT value FROM json_each(?))
    ORDER BY created_at ASC
  `),

  getAttachmentsBySession: createStatement(
    'SELECT * FROM attachments WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC'
  ),

  getAllAttachmentsBySession: createStatement(
    'SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at ASC'
  ),

  softDeleteAttachment: createStatement(
    'UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ),

  // Cleanup: deletes sessions without messages that have been inactive for more than X ms.
  deleteEmptyInactive: createStatement(`
    DELETE FROM sessions
    WHERE session_id NOT IN (SELECT DISTINCT session_id FROM messages)
      AND last_active < ?
  `),

};

module.exports = { db, stmts, initDb, closeDb };
