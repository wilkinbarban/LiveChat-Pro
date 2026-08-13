'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('importing and constructing admin auth performs no secret-file writes', () => {
  const authPath = require.resolve('../src/security/admin-auth');
  delete require.cache[authPath];
  const originalWrite = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...args) => { writes += 1; return originalWrite(...args); };
  try {
    const { createAdminAuth } = require(authPath);
    createAdminAuth({ adminPanelPassword: 'password', adminSessionTtlMs: 1000 });
    assert.equal(writes, 0);
  } finally {
    fs.writeFileSync = originalWrite;
  }
});

test('token APIs fail before explicit initialization without creating a secret', () => {
  const { createAdminAuth } = require('../src/security/admin-auth');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-uninitialized-'));
  const secretFilePath = path.join(dir, 'secret');
  const auth = createAdminAuth({
    adminPanelPassword: 'password', adminSessionTtlMs: 1000,
    adminCookieName: 'admin', csrfCookieName: 'csrf', cookieSameSite: 'lax', secretFilePath,
  });

  assert.throws(() => auth.createAdminToken(), /not initialized/i);
  assert.throws(() => auth.verifyAdminToken('1.signature'), /not initialized/i);
  assert.equal(fs.existsSync(secretFilePath), false);
});

test('explicit authentication initialization persists and reuses its secret', () => {
  const { createAdminAuth } = require('../src/security/admin-auth');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-secret-'));
  const secretFilePath = path.join(dir, 'secret');
  const auth = createAdminAuth({
    adminPanelPassword: 'password', adminSessionTtlMs: 1000,
    adminCookieName: 'admin', csrfCookieName: 'csrf', cookieSameSite: 'lax', secretFilePath,
  });

  auth.initialize();
  const first = fs.readFileSync(secretFilePath, 'utf8');
  auth.initialize();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(secretFilePath, 'utf8'), first);
});
