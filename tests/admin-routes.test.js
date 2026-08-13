'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHarness, request } = require('./admin-router-harness');
const { createAdminSessionsRouter } = require('../src/routes/admin-sessions');
const { createAdminSettingsRouter } = require('../src/routes/admin-settings');
const { createAdminRagRouter } = require('../src/routes/admin-rag');

test('canonical admin session routes preserve auth and response contracts after splitting', async () => {
  const { app } = createHarness();
  const allowed = await request(app, '/api/admin/sessions/session-1');
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body, { session: { id: 'session-1' }, messages: [{ id: 7, text: 'hello' }] });
  const denied = await request(app, '/api/admin/sessions/session-1', false);
  assert.equal(denied.status, 401);
  assert.deepEqual(denied.body, { error: 'Unauthorized' });
});

test('family routers register canonical routes with injected authentication and handlers', async () => {
  const requireAdmin = (req, res, next) => req.get('authorization') ? next() : res.status(401).json({ error: 'Unauthorized' });
  const requireCsrf = (_req, _res, next) => next();
  const handlers = new Proxy({}, { get: (_target, name) => (_req, res) => res.json({ family: name }) });
  const app = express();
  app.use(createAdminSessionsRouter({ requireAdmin, requireCsrf, handlers, logger: {} }));
  app.use(createAdminSettingsRouter({ requireAdmin, requireCsrf, handlers }));
  app.use(createAdminRagRouter({ requireAdmin, requireCsrf, handlers, uploadPdf: (_req, _res, next) => next() }));
  assert.deepEqual((await request(app, '/api/admin/sessions/1')).body, { family: 'getSession' });
  assert.deepEqual((await request(app, '/api/admin/llm')).body, { family: 'getLlm' });
  assert.deepEqual((await request(app, '/api/admin/rag/documents')).body, { family: 'listDocuments' });
  assert.equal((await request(app, '/api/admin/sessions/1', false)).status, 401);
});
