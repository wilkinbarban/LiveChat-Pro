'use strict';

const { Router } = require('express');

const SESSION_ALIASES = Object.freeze([
  {
    method: 'GET',
    aliasPath: '/api/admin/chats/:sessionId/messages',
    canonicalMethod: 'GET',
    canonicalPath: '/api/admin/sessions/:sessionId',
    compatibilityStatus: 'telemetry-only',
    consumerAction: 'Migrate to the canonical admin session route.',
  },
  {
    method: 'GET',
    aliasPath: '/api/admin/conversations/:sessionId/messages',
    canonicalMethod: 'GET',
    canonicalPath: '/api/admin/sessions/:sessionId',
    compatibilityStatus: 'telemetry-only',
    consumerAction: 'Migrate to the canonical admin session route.',
  },
]);

function createAliasMiddleware(alias, logger) {
  return (req, res, next) => {
    res.once('finish', () => logger.info?.({
      event: 'admin_alias_used',
      ...alias,
      status: res.statusCode,
      requestId: req.get('x-request-id') || null,
    }, 'Admin API compatibility alias used'));
    next();
  };
}

const SESSION_ROUTES = [
  ['get', '/api/admin/sessions', 'listSessions'],
  ['get', '/api/admin/metrics/general', 'getMetrics'],
  ['get', '/api/admin/sessions/:sessionId', 'getSession'],
  ['post', '/api/admin/sessions/:sessionId/message', 'sendMessage', true],
  ['post', '/api/admin/sessions/:sessionId/read', 'markRead', true],
  ['post', '/api/admin/sessions/:sessionId/bot', 'toggleBot', true],
  ['post', '/api/admin/sessions/:sessionId/typing', 'sendTyping', true],
  ['post', '/api/admin/sessions/:sessionId/clear', 'clearChat', true],
  ['delete', '/api/admin/sessions/:sessionId', 'deleteSession', true],
  ['post', '/api/admin/sessions/:sessionId/ban', 'banSession', true],
  ['post', '/api/admin/sessions/:sessionId/block', 'blockSession', true],
];

function createAdminSessionsRouter({ requireAdmin, requireCsrf, handlers, logger } = {}) {
  const router = Router();
  if (!handlers) return router;
  for (const [method, routePath, name, csrf] of SESSION_ROUTES) {
    router[method](routePath, requireAdmin, ...(csrf ? [requireCsrf] : []), handlers[name]);
  }
  registerSessionAliases(router, { requireAdmin, logger, getSession: handlers.getSession });
  return router;
}

function registerSessionAliases(router, { requireAdmin, logger, getSession }) {
  for (const alias of SESSION_ALIASES) {
    router.get(alias.aliasPath, requireAdmin, createAliasMiddleware(alias, logger), getSession);
  }
}

module.exports = { createAdminSessionsRouter, registerSessionAliases, SESSION_ALIASES };
