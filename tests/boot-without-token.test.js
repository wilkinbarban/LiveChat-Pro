'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { validateConfig, createConfig } = require('../src/config');
const { createAdminAuth, resolveAdminSigningSecret } = require('../src/security/admin-auth');

describe('Boot without TELEGRAM_TOKEN & Admin Signing Secret Fallback', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('validateConfig warns instead of failing when TELEGRAM_TOKEN is missing', () => {
    const warnings = [];
    const mockLogger = {
      warn: msg => warnings.push(msg),
    };

    const config = createConfig({ logger: mockLogger });
    config.telegram.token = '';
    config.telegram.adminId = NaN;

    const errors = validateConfig(config, { logger: mockLogger });
    assert.deepEqual(errors, []);
    assert.ok(warnings.some(w => String(w).includes('TELEGRAM_TOKEN')));
  });

  it('validateConfig validates TELEGRAM_ADMIN_ID numeric requirement only when token is present', () => {
    const config = createConfig();
    config.telegram.token = '123456:TEST_TOKEN';
    config.telegram.adminId = NaN;

    const errors = validateConfig(config);
    assert.deepEqual(errors, ['TELEGRAM_ADMIN_ID debe ser numérico']);
  });

  it('resolveAdminSigningSecret always returns the persisted data/.admin-secret secret, never the telegram token', () => {
    const secretFilePath = path.join(tempDir, '.admin-secret');

    // A telegram token is passed on purpose: HMAC decoupling means it MUST be
    // ignored and the persisted file secret returned instead.
    const secret = resolveAdminSigningSecret({ telegramToken: 'bot123456:secret', secretFilePath });

    assert.equal(secret.length, 64);
    assert.notEqual(secret, 'bot123456:secret');
    assert.ok(fs.existsSync(secretFilePath));

    // First boot without any secret file creates one with 0600 permissions.
    const stats = fs.statSync(secretFilePath);
    assert.equal(stats.mode & 0o777, 0o600);

    // The file content IS the returned secret.
    assert.equal(fs.readFileSync(secretFilePath, 'utf8').trim(), secret);

    // Re-resolving (with or without a token) returns the same persisted secret.
    const reReadWithoutToken = resolveAdminSigningSecret({ telegramToken: '', secretFilePath });
    const reReadWithToken = resolveAdminSigningSecret({ telegramToken: 'another-token', secretFilePath });
    assert.equal(reReadWithoutToken, secret);
    assert.equal(reReadWithToken, secret);
  });

  it('createAdminAuth signs cookies with the file secret so they survive telegram token addition and rotation', () => {
    const secretFilePath = path.join(tempDir, '.admin-secret');

    const makeAuth = () =>
      createAdminAuth({
        adminPanelPassword: 'super-secret-pass',
        adminSessionTtlMs: 3600000,
        adminCookieName: 'lcp_admin',
        csrfCookieName: 'lcp_csrf',
        cookieSameSite: 'lax',
        secretFilePath,
      });

    const adminAuthFirst = makeAuth();
    const token = adminAuthFirst.createAdminToken();
    assert.ok(adminAuthFirst.verifyAdminToken(token));

    // A second instance booted without a token verifies the same cookie.
    assert.ok(makeAuth().verifyAdminToken(token));

    // Adding a telegram token (as server.js used to pass) must NOT change the
    // signing secret — the token is no longer part of the HMAC key.
    const adminAuthWithToken = createAdminAuth({
      telegramToken: 'new-telegram-token',
      adminPanelPassword: 'super-secret-pass',
      adminSessionTtlMs: 3600000,
      adminCookieName: 'lcp_admin',
      csrfCookieName: 'lcp_csrf',
      cookieSameSite: 'lax',
      secretFilePath,
    });
    assert.ok(adminAuthWithToken.verifyAdminToken(token));

    // Rotating the token again keeps the same cookie valid.
    const adminAuthRotated = createAdminAuth({
      telegramToken: 'rotated-token-2',
      adminPanelPassword: 'super-secret-pass',
      adminSessionTtlMs: 3600000,
      adminCookieName: 'lcp_admin',
      csrfCookieName: 'lcp_csrf',
      cookieSameSite: 'lax',
      secretFilePath,
    });
    assert.ok(adminAuthRotated.verifyAdminToken(token));
  });
});
