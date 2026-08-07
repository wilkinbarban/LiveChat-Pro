'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAdminRouter } = require('../src/routes/admin');

function setupTestApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const docsStore = new Map();
  let docIdCounter = 1;

  const mockRagService = overrides.ragService || {
    async listDocuments() {
      return Array.from(docsStore.values());
    },
    async deleteDocument(id) {
      docsStore.delete(Number(id));
    },
    async ingestText({ sourceType, source, title, text }) {
      if (!text || typeof text !== 'string' || !text.trim()) {
        throw new Error('El contenido de texto es requerido');
      }
      const id = docIdCounter++;
      const doc = {
        id,
        source_type: sourceType,
        source,
        title: title || source,
        content_hash: 'hash_' + id,
        created_at: Date.now(),
      };
      docsStore.set(id, doc);
      return { documentId: id, chunkCount: 2 };
    },
  };

  const verifyAdminToken = (token) => token === 'valid-admin-token';
  const requireAdmin = (req, res, next) => {
    if (!verifyAdminToken(req.cookies?.admin_token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
  const requireCsrf = (req, res, next) => {
    if (req.headers['x-csrf-token'] !== 'valid-csrf') {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
    next();
  };

  const adminRouter = createAdminRouter({
    rootDir: __dirname,
    adminCookieName: 'admin_token',
    verifyAdminToken,
    requireAdmin,
    requireCsrf,
    loginLimiter: (_req, _res, next) => next(),
    ensureCsrfCookie: () => {},
    ragService: mockRagService,
    logger: { error: () => {}, info: () => {} },
    ...overrides,
  });

  app.use('/', adminRouter);
  return { app, docsStore, mockRagService };
}

async function makeRequest(server, path, options = {}) {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}${path}`;
  const method = options.method || 'GET';
  const headers = options.headers || {};
  let body = options.body;

  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !headers['Content-Type']?.includes('multipart')) {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function createMultipartBody(filename, fileBuffer, boundary, contentType = 'application/pdf') {
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([
    Buffer.from(header, 'utf8'),
    fileBuffer,
    Buffer.from(footer, 'utf8'),
  ]);
}

test('RAG Admin Routes — GET /api/admin/rag/documents authentication', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  try {
    const unauth = await makeRequest(server, '/api/admin/rag/documents');
    assert.equal(unauth.status, 401);

    const auth = await makeRequest(server, '/api/admin/rag/documents', {
      headers: { Cookie: 'admin_token=valid-admin-token' },
    });
    assert.equal(auth.status, 200);
    assert.equal(auth.body.ok, true);
    assert.ok(Array.isArray(auth.body.documents));
  } finally {
    server.close();
  }
});

test('RAG Admin Routes — DELETE /api/admin/rag/documents/:id', async () => {
  const { app, docsStore } = setupTestApp();
  docsStore.set(10, { id: 10, title: 'Doc to delete' });
  const server = app.listen(0);
  try {
    const noCsrf = await makeRequest(server, '/api/admin/rag/documents/10', {
      method: 'DELETE',
      headers: { Cookie: 'admin_token=valid-admin-token' },
    });
    assert.equal(noCsrf.status, 403);

    const ok = await makeRequest(server, '/api/admin/rag/documents/10', {
      method: 'DELETE',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(docsStore.has(10), false);
  } finally {
    server.close();
  }
});

test('RAG Admin Routes — POST /api/admin/rag/documents/text', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  try {
    const emptyRes = await makeRequest(server, '/api/admin/rag/documents/text', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
      body: { title: 'Empty', text: '   ' },
    });
    assert.equal(emptyRes.status, 400);

    const validRes = await makeRequest(server, '/api/admin/rag/documents/text', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
      body: { title: 'FAQ Politica', text: 'Nuestra política de reembolsos permite devoluciones en 30 días.' },
    });
    assert.equal(validRes.status, 200);
    assert.equal(validRes.body.ok, true);
    assert.ok(validRes.body.documentId);
    assert.equal(validRes.body.chunkCount, 2);
  } finally {
    server.close();
  }
});

test('RAG Admin Routes — POST /api/admin/rag/documents/url', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);

  // Setup local target HTTP server to mock URL response
  const targetServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>FAQ Page</h1><p>Informacion sobre envios y entregas.</p></body></html>');
  }).listen(0);

  const targetAddr = targetServer.address();
  const targetUrl = `http://127.0.0.1:${targetAddr.port}/faq`;

  try {
    const invalidUrl = await makeRequest(server, '/api/admin/rag/documents/url', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
      body: { url: 'invalid-url-format' },
    });
    assert.equal(invalidUrl.status, 400);

    const validUrl = await makeRequest(server, '/api/admin/rag/documents/url', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
      body: { url: targetUrl, title: 'FAQ Sitio Web' },
    });
    assert.equal(validUrl.status, 200);
    assert.equal(validUrl.body.ok, true);
    assert.ok(validUrl.body.documentId);
  } finally {
    targetServer.close();
    server.close();
  }
});

test('RAG Admin Routes — POST /api/admin/rag/documents/file validation and size limit', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const boundary = '----WebKitFormBoundaryTest123';

  try {
    // 1. Non-PDF magic bytes -> 415 Unsupported Media Type
    const fakeText = Buffer.from('Hello world this is not a PDF');
    const bodyNonPdf = createMultipartBody('sample.pdf', fakeText, boundary, 'application/pdf');
    const resNonPdf = await makeRequest(server, '/api/admin/rag/documents/file', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyNonPdf,
    });
    assert.equal(resNonPdf.status, 415);

    // 2. Over 5MB file -> 413 Payload Too Large
    const largeBuffer = Buffer.alloc(5.5 * 1024 * 1024);
    largeBuffer.write('%PDF-1.4 header text', 0);
    const bodyLarge = createMultipartBody('large.pdf', largeBuffer, boundary, 'application/pdf');
    const resLarge = await makeRequest(server, '/api/admin/rag/documents/file', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyLarge,
    });
    assert.equal(resLarge.status, 413);
  } finally {
    server.close();
  }
});
