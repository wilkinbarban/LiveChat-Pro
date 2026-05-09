// ============================================================
// Cluster state tests — cluster-state.js
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ClusterState } = require('../cluster-state');

test('memory presence counts multiple local connections', async () => {
  const state = new ClusterState();
  const sessionId = 'presence-session';

  assert.equal(await state.incrementPresence(sessionId), 1);
  assert.equal(await state.incrementPresence(sessionId), 2);
  assert.equal(await state.getPresence(sessionId), 2);
  assert.equal(await state.decrementPresence(sessionId), 1);
  assert.equal(await state.getPresence(sessionId), 1);
  assert.equal(await state.decrementPresence(sessionId), 0);
  assert.equal(await state.getPresence(sessionId), 0);
});

test('shared session snapshot includes bot silence state', () => {
  const state = new ClusterState();
  const snapshot = state.snapshotFromSession({
    sessionId: 'snapshot-session',
    lang: 'es',
    botSilenced: true,
    lastActive: 1,
    createdAt: 1,
  });

  assert.equal(snapshot.botSilenced, true);
});
