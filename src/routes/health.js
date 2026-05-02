'use strict';

const { Router } = require('express');
const { languageFromHeader } = require('../config');
const { buildHealthPayload, renderHealthPage } = require('../services/health');

function createHealthRouter(deps) {
  const router = Router();

  router.get('/health', (req, res) => {
    const data = buildHealthPayload(deps);
    const accept = req.get('accept') || '';
    const wantsHtml = req.query.format !== 'json' && accept.includes('text/html');
    if (wantsHtml) {
      return res.type('html').send(renderHealthPage(data, languageFromHeader(req.get('accept-language'))));
    }
    return res.json(data);
  });

  return router;
}

module.exports = {
  createHealthRouter,
};
