'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, request } = require('./admin-router-harness');

for (const aliasPath of [
  '/api/admin/chats/session-1/messages',
  '/api/admin/conversations/session-1/messages',
]) {
  test(`${aliasPath} remains telemetry-only and records the final response status`, async () => {
    const { app, events } = createHarness();
    const response = await request(app, aliasPath);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      session: { id: 'session-1' },
      messages: [{ id: 7, text: 'hello' }],
    });
    assert.equal(response.headers.get('deprecation'), null);
    assert.equal(response.headers.get('link'), null);
    assert.equal(response.headers.get('warning'), null);
    assert.deepEqual(events, [{
      fields: {
        event: 'admin_alias_used',
        method: 'GET',
        aliasPath: aliasPath.replace('session-1', ':sessionId'),
        canonicalMethod: 'GET',
        canonicalPath: '/api/admin/sessions/:sessionId',
        compatibilityStatus: 'telemetry-only',
        consumerAction: 'Migrate to the canonical admin session route.',
        status: 200,
        requestId: 'request-7',
      },
      message: 'Admin API compatibility alias used',
    }]);
  });
}

test('alias telemetry uses authenticated 404 status and excludes unauthorized requests', async () => {
  const { app, events } = createHarness();
  const missing = await request(app, '/api/admin/chats/missing/messages');
  assert.equal(missing.status, 404);
  assert.equal(events[0].fields.status, 404);
  const denied = await request(app, '/api/admin/chats/session-1/messages', false);
  assert.equal(denied.status, 401);
  assert.equal(events.length, 1);
});
