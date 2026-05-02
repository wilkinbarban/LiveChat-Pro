'use strict';

const { Router } = require('express');
const { languageFromHeader } = require('../config');
const { buildHealthPayload, renderHealthPage } = require('../services/health');

// /health serves JSON for automation and localized HTML for browser checks.
function createHealthRouter(deps) {
  const router = Router();

  router.get('/health', (req, res) => {
    const data = buildHealthPayload(deps);
    const accept = req.get('accept') || '';
    // Query format=json takes precedence so scripts can force machine-readable
    // output even when their Accept header includes text/html.
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
