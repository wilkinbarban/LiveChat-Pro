'use strict';

const { Router } = require('express');

const RAG_ROUTES = [
  ['get', '/api/admin/rag/documents', 'listDocuments'],
  ['get', '/api/admin/rag/status', 'getStatus'],
  ['post', '/api/admin/rag/index', 'indexDocuments', true],
  ['delete', '/api/admin/rag/documents/:id', 'deleteDocument', true],
  ['post', '/api/admin/rag/documents/text', 'ingestText', true], ['post', '/api/admin/rag/ingest-text', 'ingestText', true],
  ['post', '/api/admin/rag/documents/url', 'ingestUrl', true], ['post', '/api/admin/rag/ingest-url', 'ingestUrl', true],
  ['post', '/api/admin/rag/documents/file', 'ingestPdf', true], ['post', '/api/admin/rag/ingest-pdf', 'ingestPdf', true],
];

function createAdminRagRouter({ requireAdmin, requireCsrf, handlers, uploadPdf } = {}) {
  const router = Router();
  if (!handlers) return router;
  for (const [method, path, name, csrf] of RAG_ROUTES) {
    const upload = name === 'ingestPdf' ? [uploadPdf] : [];
    router[method](path, requireAdmin, ...(csrf ? [requireCsrf] : []), ...upload, handlers[name]);
  }
  return router;
}

module.exports = { createAdminRagRouter };
