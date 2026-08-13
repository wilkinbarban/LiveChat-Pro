'use strict';

const { Router } = require('express');

const SETTINGS_ROUTES = [
  ['get', '/api/admin/llm', 'getLlm'], ['get', '/api/admin/settings/llm', 'getLlm'],
  ['post', '/api/admin/settings/llm/verify-key', 'verifyLlmKey', true],
  ['put', '/api/admin/llm/providers/:name', 'putLlmProvider', true],
  ['put', '/api/admin/settings/llm/providers/:name', 'putLlmProvider', true],
  ['put', '/api/admin/settings/llm', 'putLlm', true],
  ['put', '/api/admin/llm/default', 'putLlmDefault', true],
  ['put', '/api/admin/llm/enabled', 'putLlmEnabled', true],
  ['get', '/api/admin/master-prompt', 'getPrompt'], ['get', '/api/admin/settings/prompt', 'getPrompt'],
  ['put', '/api/admin/master-prompt', 'putPrompt', true], ['put', '/api/admin/settings/prompt', 'putPrompt', true],
  ['get', '/api/admin/telegram/status', 'getTelegram'], ['get', '/api/admin/settings/telegram', 'getTelegram'],
  ['post', '/api/admin/telegram/start', 'startTelegram', true], ['post', '/api/admin/telegram/stop', 'stopTelegram', true],
  ['put', '/api/admin/telegram/admin-id', 'putTelegram', true], ['put', '/api/admin/settings/telegram', 'putTelegram', true],
  ['get', '/api/admin/themes', 'getTheme'], ['get', '/api/admin/settings/theme', 'getTheme'],
  ['put', '/api/admin/themes/active', 'putTheme', true], ['put', '/api/admin/settings/theme', 'putTheme', true],
];

function createAdminSettingsRouter({ requireAdmin, requireCsrf, handlers } = {}) {
  const router = Router();
  if (!handlers) return router;
  for (const [method, path, name, csrf] of SETTINGS_ROUTES) {
    router[method](path, requireAdmin, ...(csrf ? [requireCsrf] : []), handlers[name]);
  }
  return router;
}

module.exports = { createAdminSettingsRouter };
