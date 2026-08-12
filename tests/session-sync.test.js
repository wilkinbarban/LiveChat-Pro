'use strict';

process.env.DB_PATH = ':memory:';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { stmts, closeDb } = require('../db');
const { createSessionService, persistSessionMessage } = require('../src/services/sessions');
const { createAdminChatService } = require('../src/services/admin-chat');
const setupSockets = require('../src/sockets');

const SID = '11111111-1111-4111-8111-111111111111';

function sessionRow(sessionId) {
  return {
    session_id: sessionId, name: null, lang: 'en', lang_detected: 0,
    ip: '127.0.0.1', geo_city: '', geo_country: '', geo_isp: '',
    user_agent: 'test', current_page: '/', banned: 0, priority: 0,
    admin_last_seen_ts: 0, user_last_seen_ts: 0, awaiting_name: 1,
    bot_silenced: 0, last_active: 1, created_at: 1,
  };
}

function clusterState() {
  return {
    seedBanned: async () => {},
    getSessionSnapshots: async () => new Map(),
    getSessionSnapshot: async () => null,
  };
}

after(closeDb);

test('failed visitor or bot persistence leaves session memory unchanged', async () => {
  for (const from of ['user', 'bot']) {
    const session = { sessionId: SID, messages: [], lastActive: 10 };
    const message = { from, text: 'hello', ts: 20, lang: 'en' };
    await assert.rejects(
      persistSessionMessage({ insertMessage: { run: async () => { throw new Error('disk full'); } } }, session, message),
      /disk full/
    );
    assert.deepEqual(session.messages, []);
    assert.equal(session.lastActive, 10);
  }
});

test('successful message persistence mutates memory only after SQLite resolves', async () => {
  const session = { sessionId: SID, messages: [], lastActive: 10 };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const write = persistSessionMessage({ insertMessage: { run: () => pending } }, session, {
    from: 'bot', text: 'welcome', ts: 20, lang: 'en',
  });
  assert.deepEqual(session.messages, []);
  release({ lastID: 7 });
  const message = await write;
  assert.equal(message.id, 7);
  assert.deepEqual(session.messages, [message]);
});

test('admin reply failure does not mutate, synchronize, queue, or emit', async () => {
  const events = [];
  const session = { sessionId: SID, lang: 'en', messages: [], lastActive: 10 };
  const service = createAdminChatService({
    io: { in: () => ({ fetchSockets: async () => [{}] }), to: () => ({ emit: (...args) => events.push(args) }) },
    adminIo: { emit: (...args) => events.push(args) }, sessions: new Map(),
    stmts: { insertMessage: { run: async () => { throw new Error('disk full'); } } },
    logger: { error() {} }, clusterState: { setPendingReply: async () => events.push(['pending']) },
    adminId: 1, adminLanguage: 'en', sessionRoom: id => id,
    syncSharedSession: async () => events.push(['sync']), serializeSession: value => value,
    serializeMessageForAdmin: async value => value, translate: async value => value,
  });
  const result = await service.sendAdminReplyToSession(session, 'answer');
  assert.equal(result.ok, false);
  assert.deepEqual(session.messages, []);
  assert.equal(session.lastActive, 10);
  assert.deepEqual(events, []);
});

test('session startup batches messages and attachments independently of session count', async () => {
  const calls = { messages: 0, attachments: 0 };
  const rows = [sessionRow('s1'), sessionRow('s2')];
  const service = createSessionService({
    sessions: new Map(), clusterState: clusterState(), logger: { info() {} },
    adminLanguage: 'en', translate: async value => value,
    stmts: {
      getAllBanned: { all: async () => [] }, getRecentSessions: { all: async () => rows },
      getMessagesBySessions: { all: async ids => {
        calls.messages++;
        assert.deepEqual(JSON.parse(ids), ['s1', 's2']);
        return [{ id: 1, session_id: 's1', from_role: 'user', text: 'one', ts: 1, lang: 'en' }];
      } },
    },
    attachmentService: { attachFilesToMessages: async messages => { calls.attachments++; return messages; } },
  });
  await service.loadFromDB();
  assert.deepEqual(calls, { messages: 1, attachments: 1 });
});

test('empty startup retrieval issues no message or attachment query', async () => {
  let queried = false;
  const service = createSessionService({
    sessions: new Map(), clusterState: clusterState(), logger: { info() {} },
    adminLanguage: 'en', translate: async value => value,
    stmts: {
      getAllBanned: { all: async () => [] }, getRecentSessions: { all: async () => [] },
      getMessagesBySessions: { all: async () => { queried = true; return []; } },
    },
    attachmentService: { attachFilesToMessages: async () => { queried = true; return []; } },
  });
  await service.loadFromDB();
  assert.equal(queried, false);
});

test('concurrent greeting claims persist one row and every caller reloads the winner', async () => {
  await stmts.upsertSession.run(sessionRow(SID));
  const greeting = { session_id: SID, from_role: 'bot', text: 'Welcome', ts: 2, lang: 'en' };
  const [first, second] = await Promise.all([
    stmts.insertInitialGreeting.run(greeting),
    stmts.insertInitialGreeting.run({ ...greeting, ts: 3 }),
  ]);
  assert.equal((await stmts.getMessages.all(SID)).length, 1);
  assert.deepEqual(first, second);
  assert.equal(first[0].text, 'Welcome');
});

test('concurrent socket joins publish the single durable greeting history', async () => {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const sessions = new Map();
  let connect;
  const io = {
    on: (_event, handler) => { connect = handler; },
    to: () => ({ emit() {} }),
  };
  const adminIo = { use() {}, on() {}, emit() {} };
  const service = createSessionService({
    sessions, stmts, clusterState: clusterState(), logger: { info() {} },
    adminLanguage: 'en', translate: async value => value,
  });
  let upsertCalls = 0;
  let releaseUpserts;
  const bothUpsertsStarted = new Promise(resolve => { releaseUpserts = resolve; });
  const delayedStmts = {
    ...stmts,
    upsertSession: { run: async row => {
      upsertCalls++;
      if (upsertCalls === 2) releaseUpserts();
      await bothUpsertsStarted;
      return stmts.upsertSession.run(row);
    } },
  };
  setupSockets(io, adminIo, {
    WIDGET_API_KEY: '', sessions, stmts: delayedStmts, features: { geoLocation: false },
    clusterState: {
      isBanned: async () => false, incrementPresence: async () => 1,
    },
    logger: { error() {} }, widgetCfg: { welcomeMessage: 'Welcome', primaryColor: '#000' },
    ADMIN_ID: 1, ADMIN_LANGUAGE: 'en', ADMIN_PANEL_PASSWORD: '', ADMIN_COOKIE_NAME: 'admin',
    parseCookies: () => ({ lchat_sid: sessionId }), sessionRoom: id => id,
    loadSessionFromDB: service.loadSessionFromDB, sessionToDBRow: service.sessionToDBRow,
    syncSharedSession: async value => value, broadcastAdminSessionUpdate() {}, broadcastAdminMessage: async () => {},
    getWidgetMessage: () => 'Welcome', translateForAdmin: async value => value,
    translate: async value => value, detectLang: async () => 'en', analyzeSentiment: () => ({}),
    sendToAdmin: async () => {}, sessionCard: () => '', createMsgRateLimiter: () => () => true,
    verifyAdminToken: () => false, listSessionsForAdmin: async () => [], getBot: () => null,
    aiBot: null,
  });
  const makeSocket = id => {
    const emitted = [];
    const handlers = new Map();
    return {
      id, emitted, handlers, data: {}, handshake: { auth: { lang: 'en' }, headers: {} },
      join() {}, on(event, handler) { handlers.set(event, handler); }, disconnect() {}, emit(event, payload) { emitted.push([event, payload]); },
    };
  };
  const sockets = [makeSocket('one'), makeSocket('two')];
  await Promise.all(sockets.map(connect));
  const durable = await stmts.getMessages.all(sessionId);
  assert.equal(durable.length, 1);
  for (const socket of sockets) {
    const publication = socket.emitted.find(([event]) => event === 'session');
    assert.equal(publication[1].history.length, 1);
    assert.equal(publication[1].history[0].id, durable[0].id);
  }
  await sockets[1].handlers.get('page')('/canonical');
  assert.equal(sessions.get(sessionId).currentPage, '/canonical');
});

test('failed first-session persistence reports the error and disconnects', async () => {
  let connect;
  const io = { on: (_event, handler) => { connect = handler; }, to: () => ({ emit() {} }) };
  const adminIo = { use() {}, on() {}, emit() {} };
  setupSockets(io, adminIo, {
    WIDGET_API_KEY: '', sessions: new Map(), features: { geoLocation: false },
    stmts: { upsertSession: { run: async () => { throw new Error('disk full'); } } },
    clusterState: { isBanned: async () => false }, logger: { error() {} },
    widgetCfg: {}, ADMIN_ID: 1, ADMIN_LANGUAGE: 'en', ADMIN_PANEL_PASSWORD: '', ADMIN_COOKIE_NAME: 'admin',
    parseCookies: () => ({}), sessionRoom: id => id, loadSessionFromDB: async () => null,
    sessionToDBRow: value => value, createMsgRateLimiter: () => () => true,
    verifyAdminToken: () => false, listSessionsForAdmin: async () => [],
  });
  const events = [];
  let disconnected = false;
  await connect({
    id: 'failed', data: {}, handshake: { auth: { lang: 'en' }, headers: {} }, join() {}, on() {},
    emit: (...args) => events.push(args), disconnect: () => { disconnected = true; },
  });
  assert.deepEqual(events, [['error', { code: 'SESSION_INIT_FAILED', message: 'Unable to initialize chat session.' }]]);
  assert.equal(disconnected, true);
});
