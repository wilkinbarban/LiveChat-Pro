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

  it('resolveAdminSigningSecret returns token if present, else persists secret to data/.admin-secret with 0600 permissions', () => {
    const tokenSecret = resolveAdminSigningSecret({ telegramToken: 'bot123456:secret' });
    assert.equal(tokenSecret, 'bot123456:secret');

    const secretFilePath = path.join(tempDir, '.admin-secret');
    const fallbackSecret = resolveAdminSigningSecret({ telegramToken: '', secretFilePath });

    assert.equal(fallbackSecret.length, 64);
    assert.ok(fs.existsSync(secretFilePath));

    const stats = fs.statSync(secretFilePath);
    const mode = stats.mode & 0o777;
    assert.equal(mode, 0o600);

    const reReadSecret = resolveAdminSigningSecret({ telegramToken: '', secretFilePath });
    assert.equal(reReadSecret, fallbackSecret);
  });

  it('createAdminAuth issues and verifies admin tokens without TELEGRAM_TOKEN', () => {
    const secretFilePath = path.join(tempDir, '.admin-secret');

    const adminAuthNoToken = createAdminAuth({
      telegramToken: '',
      adminPanelPassword: 'super-secret-pass',
      adminSessionTtlMs: 3600000,
      adminCookieName: 'lcp_admin',
      csrfCookieName: 'lcp_csrf',
      cookieSameSite: 'lax',
      secretFilePath,
    });

    const token = adminAuthNoToken.createAdminToken();
    assert.ok(adminAuthNoToken.verifyAdminToken(token));

    // Adding a telegram token changes the signing secret and invalidates existing token
    const adminAuthWithToken = createAdminAuth({
      telegramToken: 'new-telegram-token',
      adminPanelPassword: 'super-secret-pass',
      adminSessionTtlMs: 3600000,
      adminCookieName: 'lcp_admin',
      csrfCookieName: 'lcp_csrf',
      cookieSameSite: 'lax',
      secretFilePath,
    });

    assert.equal(adminAuthWithToken.verifyAdminToken(token), false);
  });
});
