'use strict';

const express = require('express');
const { createAdminRouter } = require('../src/routes/admin');

function createHarness(overrides = {}) {
  const events = [];
  const session = { sessionId: 'session-1', messages: [{ id: 7, text: 'hello' }] };
  const requireAdmin = (req, res, next) => req.get('authorization') === 'Bearer admin'
    ? next()
    : res.status(401).json({ error: 'Unauthorized' });
  const app = express();
  app.use(express.json());
  app.use(createAdminRouter({
    rootDir: __dirname,
    requireAdmin,
    requireCsrf: (_req, _res, next) => next(),
    loginLimiter: (_req, _res, next) => next(),
    ensureCsrfCookie: () => {},
    ensureSessionLoaded: async id => id === session.sessionId ? session : null,
    serializeSession: value => ({ id: value.sessionId }),
    serializeMessageForAdmin: async message => message,
    listSessionsForAdmin: async () => [session],
    getGeneralAdminMetrics: async () => ({}),
    logger: { error() {}, info(fields, message) { events.push({ fields, message }); } },
    ...overrides,
  }));
  return { app, events };
}

async function request(app, path, authorized = true) {
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: authorized ? { authorization: 'Bearer admin', 'x-request-id': 'request-7' } : {},
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { createHarness, request };
