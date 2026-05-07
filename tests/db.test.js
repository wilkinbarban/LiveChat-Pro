// ============================================================
// Persistence layer tests — db.js
// Uses an in-memory database (:memory:) for isolation.
// ============================================================
'use strict';

// Must be set BEFORE requiring db.js.
process.env.DB_PATH = ':memory:';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, stmts, initDb, closeDb } = require('../db');

// ── Test data ────────────────────────────────────────────────
const SID = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID2 = 'b2b2b2b2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = Date.now();

function makeSession(overrides = {}) {
  return {
    session_id: SID,
    name: null,
    lang: 'es',
    lang_detected: 0,
    ip: '1.2.3.4',
    geo_city: 'Madrid',
    geo_country: 'ES',
    geo_isp: 'ISP Test',
    user_agent: 'TestAgent/1.0',
    current_page: '/',
    banned: 0,
    priority: 0,
    admin_last_seen_ts: 0,
    user_last_seen_ts: 0,
    awaiting_name: 1,
    bot_silenced: 0,
    last_active: NOW,
    created_at: NOW,
    ...overrides,
  };
}

after(async () => {
  await closeDb();
});

// ── Sessions ─────────────────────────────────────────────────
describe('Sesiones', () => {
  it('upsertSession inserta una sesión nueva', async () => {
    await initDb();
    await stmts.upsertSession.run(makeSession());
    const row = await stmts.getSession.get(SID);
    assert.ok(row, 'la sesión no fue encontrada');
    assert.equal(row.session_id, SID);
    assert.equal(row.lang, 'es');
    assert.equal(row.ip, '1.2.3.4');
  });

  it('upsertSession hace UPDATE sin duplicar al volver a insertar', async () => {
    await stmts.upsertSession.run(makeSession({ name: 'Usuario Test', awaiting_name: 0 }));
    const row = await stmts.getSession.get(SID);
    assert.equal(row.name, 'Usuario Test');
    assert.equal(row.awaiting_name, 0);
    const all = await stmts.getSessionsOverview.all();
    const matches = all.filter(r => r.session_id === SID);
    assert.equal(matches.length, 1);
  });

  it('getSession retorna null para un ID inexistente', async () => {
    const row = await stmts.getSession.get('00000000-0000-4000-8000-000000000000');
    assert.equal(row, undefined);
  });

  it('setName actualiza el nombre y desactiva awaiting_name', async () => {
    await stmts.upsertSession.run(makeSession({ awaiting_name: 1 }));
    await stmts.setName.run('Carlos', NOW, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.name, 'Carlos');
    assert.equal(row.awaiting_name, 0);
  });

  it('updatePage actualiza current_page', async () => {
    await stmts.updatePage.run('/contacto', NOW, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.current_page, '/contacto');
  });

  it('updateLastActive actualiza el timestamp', async () => {
    const ts = NOW + 5000;
    await stmts.updateLastActive.run(ts, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.last_active, ts);
  });

  it('updateNetworkInfo actualiza IP, geo, user-agent y actividad', async () => {
    const ts = NOW + 6000;
    await stmts.updateNetworkInfo.run('8.8.8.8', 'Mountain View', 'US', 'Base local', 'Agent/2.0', ts, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.ip, '8.8.8.8');
    assert.equal(row.geo_city, 'Mountain View');
    assert.equal(row.geo_country, 'US');
    assert.equal(row.geo_isp, 'Base local');
    assert.equal(row.user_agent, 'Agent/2.0');
    assert.equal(row.last_active, ts);
  });

  it('updateLang actualiza idioma y marca lang_detected', async () => {
    await stmts.updateLang.run('en', NOW, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.lang, 'en');
    assert.equal(row.lang_detected, 1);
  });

  it('updatePriority marca prioridad alta', async () => {
    await stmts.updatePriority.run(NOW, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.priority, 1);
  });

  it('markAdminSeen y markUserSeen actualizan read receipts', async () => {
    const adminTs = NOW + 500;
    const userTs = NOW + 700;
    await stmts.markAdminSeen.run(adminTs, SID);
    await stmts.markUserSeen.run(userTs, SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.admin_last_seen_ts, adminTs);
    assert.equal(row.user_last_seen_ts, userTs);
  });
});

// ── Messages ─────────────────────────────────────────────────
describe('Mensajes', () => {
  it('insertMessage guarda un mensaje de usuario', async () => {
    await stmts.insertMessage.run({ session_id: SID, from_role: 'user', text: 'Hola', ts: NOW, lang: 'es' });
    const msgs = await stmts.getMessages.all(SID);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, 'Hola');
    assert.equal(msgs[0].from_role, 'user');
  });

  it('insertMessage guarda un mensaje de admin', async () => {
    await stmts.insertMessage.run({ session_id: SID, from_role: 'admin', text: 'Hola, ¿en qué puedo ayudarte?', ts: NOW + 100, lang: 'es' });
    const msgs = await stmts.getMessages.all(SID);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].from_role, 'admin');
  });

  it('getMessages retorna mensajes ordenados por ts ascendente', async () => {
    const msgs = await stmts.getMessages.all(SID);
    for (let i = 1; i < msgs.length; i++) {
      assert.ok(msgs[i].ts >= msgs[i - 1].ts, 'mensajes no están ordenados por ts');
    }
  });

  it('getMessages retorna array vacío para sesión sin mensajes', async () => {
    await stmts.upsertSession.run(makeSession({ session_id: SID2 }));
    const msgs = await stmts.getMessages.all(SID2);
    assert.deepEqual(msgs, []);
  });
});

// ── Attachments ──────────────────────────────────────────────
describe('Adjuntos', () => {
  it('insertAttachment guarda metadatos y permite listarlos por mensaje y sesión', async () => {
    const [message] = await stmts.getMessages.all(SID);
    assert.ok(message?.id, 'mensaje base no encontrado');

    const result = await stmts.insertAttachment.run({
      session_id: SID,
      message_id: message.id,
      filename: 'foto.png',
      original_name: 'foto.png',
      mime_type: 'image/png',
      size_bytes: 1234,
      storage_path: '/tmp/foto.png',
      access_token: 'token-db-test',
      width: 10,
      height: 20,
      created_at: NOW + 200,
    });

    const row = await stmts.getAttachment.get(result.lastID);
    assert.equal(row.session_id, SID);
    assert.equal(row.message_id, message.id);
    assert.equal(row.mime_type, 'image/png');
    assert.equal(row.access_token, 'token-db-test');
    assert.equal(row.width, 10);
    assert.equal(row.height, 20);

    const byMessage = await stmts.getAttachmentsByMessage.all(message.id);
    assert.equal(byMessage.length, 1);

    const bySession = await stmts.getAttachmentsBySession.all(SID);
    assert.equal(bySession.length, 1);
  });

  it('getAttachmentsByMessages agrupa adjuntos de varios mensajes y softDeleteAttachment los oculta', async () => {
    const [message] = await stmts.getMessages.all(SID);
    const rows = await stmts.getAttachmentsByMessages.all(JSON.stringify([message.id]));
    assert.equal(rows.length, 1);

    await stmts.softDeleteAttachment.run(NOW + 300, rows[0].id);
    const active = await stmts.getAttachmentsBySession.all(SID);
    assert.equal(active.length, 0);

    const all = await stmts.getAllAttachmentsBySession.all(SID);
    assert.equal(all.length, 1);
    assert.ok(all[0].deleted_at);
  });
});

// ── Sessions overview ────────────────────────────────────────
describe('getSessionsOverview', () => {
  it('incluye conteo de mensajes correcto', async () => {
    const rows = await stmts.getSessionsOverview.all();
    const s = rows.find(r => r.session_id === SID);
    assert.ok(s, 'no encontró la sesión SID en el overview');
    assert.equal(s.message_count, 2, 'conteo de mensajes incorrecto');
  });

  it('incluye el último mensaje y su rol', async () => {
    const rows = await stmts.getSessionsOverview.all();
    const s = rows.find(r => r.session_id === SID);
    assert.equal(s.last_from, 'admin');
    assert.equal(s.last_text, 'Hola, ¿en qué puedo ayudarte?');
    assert.ok(s.last_ts > 0);
  });

  it('sesión sin mensajes tiene message_count 0 y last_* null', async () => {
    const rows = await stmts.getSessionsOverview.all();
    const s = rows.find(r => r.session_id === SID2);
    assert.ok(s, 'no encontró la sesión SID2 en el overview');
    assert.equal(s.message_count, 0);
    assert.equal(s.last_from, null);
    assert.equal(s.last_text, null);
  });
});

// ── Banning ──────────────────────────────────────────────────
describe('Baneo', () => {
  it('banSession marca la sesión como baneada', async () => {
    await stmts.banSession.run(SID);
    const row = await stmts.getSession.get(SID);
    assert.equal(row.banned, 1);
  });

  it('getAllBanned retorna solo sesiones baneadas', async () => {
    const banned = await stmts.getAllBanned.all();
    const ids = banned.map(r => r.session_id);
    assert.ok(ids.includes(SID), 'SID debería estar en baneados');
    assert.ok(!ids.includes(SID2), 'SID2 no debería estar baneado');
  });
});

// ── Cleanup ──────────────────────────────────────────────────
describe('deleteEmptyInactive', () => {
  it('elimina sesión inactiva sin mensajes', async () => {
    const oldTs = NOW - 3_600_001;
    const emptySid = 'c3c3c3c3-cccc-4ccc-8ccc-cccccccccccc';
    await stmts.upsertSession.run(makeSession({ session_id: emptySid, last_active: oldTs, created_at: oldTs }));
    await stmts.deleteEmptyInactive.run(NOW - 3_600_000);
    const row = await stmts.getSession.get(emptySid);
    assert.equal(row, undefined, 'sesión vacía inactiva debería haber sido eliminada');
  });

  it('NO elimina sesión con mensajes aunque esté inactiva', async () => {
    await stmts.deleteEmptyInactive.run(NOW + 1_000_000);
    const row = await stmts.getSession.get(SID);
    assert.ok(row, 'sesión con mensajes NO debe ser eliminada');
  });
});

// ── Base persistence ─────────────────────────────────────────
describe('Persistencia', () => {
  it('la BD en memoria está disponible y contiene la tabla sessions', async () => {
    const result = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
    assert.ok(result, 'tabla sessions no encontrada');
  });

  it('la BD en memoria contiene la tabla messages', async () => {
    const result = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'");
    assert.ok(result, 'tabla messages no encontrada');
  });

});
