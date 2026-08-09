'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cookieParser = require('cookie-parser');
const {
  createAdminRouter,
  fetchGithubRepository,
  isUsefulGithubPath,
  normalizeGithubSelection,
  parseGithubRepositoryUrl,
} = require('../src/routes/admin');

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
    async stageText({ sourceType, source, title, text }) {
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
        status: 'pending',
        pending_text: text,
        created_at: Date.now(),
      };
      docsStore.set(id, doc);
      return { documentId: id, chunkCount: 0, status: 'pending' };
    },
    async promotePending() {
      let indexed = 0;
      for (const doc of docsStore.values()) {
        if (doc.status === 'pending') { doc.status = 'indexed'; doc.pending_text = null; indexed++; }
      }
      return { indexed, pending: 0 };
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

test('GitHub repository selection enforces security, snapshot, quantity, and concurrency limits', async () => {
  assert.equal(isUsefulGithubPath('.env.production', 10), false);
  assert.equal(isUsefulGithubPath('vendor/library/index.js', 10), false);
  assert.equal(isUsefulGithubPath('package-lock.json', 10), false);
  assert.equal(isUsefulGithubPath('src/private-key.pem', 10), false);
  assert.equal(isUsefulGithubPath('src/app.js', 128 * 1024 + 1), false);
  assert.equal(isUsefulGithubPath('docs/guide.md', 100), true);
  assert.equal(parseGithubRepositoryUrl('https://github.com/example/.git'), null);

  const repository = parseGithubRepositoryUrl('https://github.com/example/project');
  let active = 0;
  let peak = 0;
  const rawUrls = [];
  assert.deepEqual(normalizeGithubSelection(undefined, undefined), { mode: 'repository', includePaths: [] });
  assert.deepEqual(normalizeGithubSelection('docs', ['docs', './README.md']), { mode: 'docs', includePaths: ['docs', 'README.md'] });
  assert.throws(() => normalizeGithubSelection('all', []), /Modo/);
  assert.throws(() => normalizeGithubSelection('repository', ['../secret']), /inválida/);

  const treeEntries = Array.from({ length: 200 }, (_, index) => ({
    type: 'blob', path: `src/file-${String(index).padStart(2, '0')}.js`, size: 20,
  }));
  const fetchUrl = async (url) => {
    if (url === repository.apiUrl) return Response.json({ full_name: 'example/project', default_branch: 'main' });
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'fixed-commit', commit: { tree: { sha: 'fixed-tree' } } });
    if (url.includes('/git/trees/fixed-tree')) return Response.json({ tree: treeEntries, truncated: false });
    rawUrls.push(url);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    return new Response('export const useful = true;', { status: 200 });
  };

  const content = await fetchGithubRepository({ repository, fetchUrl, signal: new AbortController().signal });
  assert.equal(rawUrls.length, 200);
  assert.ok(peak <= 5);
  assert.ok(rawUrls.every(url => url.includes('/fixed-commit/')));
  assert.match(content, /--- FILE: src\/file-00\.js ---/);
  assert.doesNotMatch(content, /file-200\.js/);

  let attemptedRaw = false;
  const oversizedSelectionFetch = async (url) => {
    if (url === repository.apiUrl) return Response.json({ default_branch: 'main' });
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'commit', commit: { tree: { sha: 'tree' } } });
    if (url.includes('/git/trees/tree')) {
      return Response.json({ tree: Array.from({ length: 201 }, (_, index) => ({ type: 'blob', path: `src/${index}.js`, size: 10 })) });
    }
    attemptedRaw = true;
    return new Response('content');
  };
  await assert.rejects(
    fetchGithubRepository({ repository, fetchUrl: oversizedSelectionFetch, signal: new AbortController().signal }),
    /límite de archivos/
  );
  assert.equal(attemptedRaw, false);

  const selectedRawPaths = [];
  const selectionFetch = async (url) => {
    if (url === repository.apiUrl) return Response.json({ default_branch: 'main' });
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'selection-commit', commit: { tree: { sha: 'selection-tree' } } });
    if (url.includes('/git/trees/selection-tree')) return Response.json({ tree: [
      { type: 'blob', path: 'README.md', size: 10 },
      { type: 'blob', path: 'docs/guide.md', size: 10 },
      { type: 'blob', path: 'src/app.js', size: 10 },
    ] });
    selectedRawPaths.push(decodeURIComponent(new URL(url).pathname.split('/selection-commit/')[1]));
    return new Response('useful text');
  };
  await fetchGithubRepository({
    repository,
    fetchUrl: selectionFetch,
    signal: new AbortController().signal,
    selection: normalizeGithubSelection('readme'),
  });
  assert.deepEqual(selectedRawPaths, ['README.md']);
  selectedRawPaths.length = 0;
  await fetchGithubRepository({
    repository,
    fetchUrl: selectionFetch,
    signal: new AbortController().signal,
    selection: normalizeGithubSelection('docs', ['docs']),
  });
  assert.deepEqual(selectedRawPaths, ['docs/guide.md']);

  const truncatedFetch = async (url) => {
    if (url === repository.apiUrl) return Response.json({ default_branch: 'main' });
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'commit', commit: { tree: { sha: 'tree' } } });
    return Response.json({ tree: [], truncated: true });
  };
  await assert.rejects(
    fetchGithubRepository({ repository, fetchUrl: truncatedFetch, signal: new AbortController().signal }),
    /excede el límite/
  );
});

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

test('RAG Admin Routes — indexing requires an enabled and operational default model', async () => {
  const settings = {
    enabled: false,
    async getJSON(key) {
      if (key === 'ai.enabled') return this.enabled;
      if (key === 'llm.provider.openai') return { encKey: 'encrypted', model: 'gpt-test' };
      return null;
    },
    async get(key) { return key === 'llm.default_provider' ? 'openai' : null; },
    decryptSecret() { return 'secret'; },
  };
  let verified = 0;
  const { app, mockRagService } = setupTestApp({
    settingsService: settings,
    llmService: { async verifyConnection() { verified++; return { ok: true }; } },
  });
  await mockRagService.stageText({ sourceType: 'text', source: 'manual', title: 'Manual', text: 'Pending content' });
  const server = app.listen(0);
  try {
    const headers = { Cookie: 'admin_token=valid-admin-token', 'x-csrf-token': 'valid-csrf' };
    const blocked = await makeRequest(server, '/api/admin/rag/index', { method: 'POST', headers });
    assert.equal(blocked.status, 409);
    assert.equal(verified, 0);

    settings.enabled = true;
    const ready = await makeRequest(server, '/api/admin/rag/status', { headers: { Cookie: headers.Cookie } });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.pendingCount, 1);

    const indexed = await makeRequest(server, '/api/admin/rag/index', { method: 'POST', headers });
    assert.equal(indexed.status, 200);
    assert.equal(indexed.body.indexed, 1);
    assert.equal(verified, 1, 'readiness verification should be reused briefly by the index request');
  } finally { server.close(); }
});

test('RAG Admin Routes — readiness uses the active boot model when ai.enabled was never persisted', async () => {
  const settings = {
    async getJSON(key) {
      if (key === 'ai.enabled') return null;
      if (key === 'llm.provider.deepseek') return { encKey: 'encrypted', model: 'deepseek-chat' };
      return null;
    },
    async get(key) { return key === 'llm.default_provider' ? 'deepseek' : null; },
    decryptSecret() { return 'secret'; },
  };
  const { app, mockRagService } = setupTestApp({
    settingsService: settings,
    aiBot: { isEnabled: () => true },
    llmService: { async verifyConnection() { return { ok: true }; } },
  });
  await mockRagService.stageText({ sourceType: 'pdf', source: 'new.pdf', title: 'New PDF', text: 'Pending content' });
  const server = app.listen(0);
  try {
    const ready = await makeRequest(server, '/api/admin/rag/status', {
      headers: { Cookie: 'admin_token=valid-admin-token' },
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.pendingCount, 1);
  } finally { server.close(); }
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
    assert.equal(validRes.body.chunkCount, 0);
    assert.equal(validRes.body.status, 'pending');
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

test('RAG Admin Routes — GitHub repository ingests one filtered source-aware document', async () => {
  const calls = [];
  let ingested = null;
  const files = {
    'README.md': '# AI Workspace Manager\n\nCreates isolated AI workspaces for multiple agents.',
    'src/app.js': 'export function createWorkspace() { return "isolated"; }',
  };
  const { app } = setupTestApp({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === 'https://api.github.com/repos/example/AI-Workspace-Manager') {
        return Response.json({ full_name: 'example/AI-Workspace-Manager', default_branch: 'main', description: 'Workspace manager' });
      }
      if (url.endsWith('/commits/main')) {
        return Response.json({ sha: 'commit-abc123', commit: { tree: { sha: 'tree-def456' } } });
      }
      if (url.includes('/git/trees/tree-def456')) {
        return Response.json({ tree: [
          { type: 'blob', path: 'README.md', size: Buffer.byteLength(files['README.md']) },
          { type: 'blob', path: 'src/app.js', size: Buffer.byteLength(files['src/app.js']) },
          { type: 'blob', path: 'node_modules/pkg/index.js', size: 20 },
          { type: 'blob', path: 'package-lock.json', size: 20 },
          { type: 'blob', path: '.env', size: 20 },
          { type: 'blob', path: 'logo.png', size: 20 },
        ] });
      }
      const path = decodeURIComponent(new URL(url).pathname.split('/commit-abc123/')[1]);
      return new Response(files[path], { status: 200, headers: { 'content-type': 'text/plain' } });
    },
    ragService: {
      async ingestText(input) {
        ingested = input;
        return { documentId: 42, chunkCount: 1 };
      },
      async listDocuments() { return []; },
      async deleteDocument() {},
    },
  });
  const server = app.listen(0);

  try {
    const invalidSelection = await makeRequest(server, '/api/admin/rag/documents/url', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
      body: { url: 'https://github.com/example/AI-Workspace-Manager', mode: 'everything' },
    });
    assert.equal(invalidSelection.status, 400);
    assert.equal(calls.length, 0);

    const result = await makeRequest(server, '/api/admin/rag/documents/url', {
      method: 'POST',
      headers: {
        Cookie: 'admin_token=valid-admin-token',
        'x-csrf-token': 'valid-csrf',
      },
      body: {
        url: 'https://github.com/example/AI-Workspace-Manager.git',
        title: 'AI Workspace Manager',
        mode: 'repository',
        includePaths: ['README.md', 'src'],
      },
    });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 5);
    assert.equal(calls[0].url, 'https://api.github.com/repos/example/AI-Workspace-Manager');
    assert.match(calls[1].url, /\/commits\/main$/);
    assert.match(calls[2].url, /\/git\/trees\/tree-def456\?recursive=1$/);
    assert.ok(calls.slice(3).every(call => call.url.includes('/commit-abc123/')));
    assert.equal(ingested.source, 'https://github.com/example/ai-workspace-manager');
    assert.equal(ingested.sourceKey, 'https://github.com/example/ai-workspace-manager');
    assert.match(ingested.text, /--- FILE: README\.md ---/);
    assert.match(ingested.text, /--- FILE: src\/app\.js ---/);
    assert.doesNotMatch(ingested.text, /node_modules|package-lock|\.env|logo\.png/);
  } finally {
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
