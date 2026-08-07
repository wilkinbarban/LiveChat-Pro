'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

const { createConfig, stripEnvQuotes } = require('../src/config');

describe('stripEnvQuotes', () => {
  it('strips literal double quotes from both ends', () => {
    assert.equal(stripEnvQuotes('"8609135566:AAEGdouble"'), '8609135566:AAEGdouble');
  });

  it('strips literal single quotes from both ends', () => {
    assert.equal(stripEnvQuotes("'8609135566:AAEGsingle'"), '8609135566:AAEGsingle');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(stripEnvQuotes('   8609135566:AAEGpad   '), '8609135566:AAEGpad');
  });

  it('strips quotes AND trims inner whitespace together', () => {
    assert.equal(stripEnvQuotes('"  8609135566:AAEGboth  "'), '8609135566:AAEGboth');
  });

  it('leaves unquoted values untouched', () => {
    assert.equal(stripEnvQuotes('8609135566:AAEGplain'), '8609135566:AAEGplain');
  });

  it('returns empty string for undefined input', () => {
    assert.equal(stripEnvQuotes(undefined), '');
  });

  it('returns empty string for null input', () => {
    assert.equal(stripEnvQuotes(null), '');
  });
});

describe('createConfig telegram token read', () => {
  const originalToken = process.env.TELEGRAM_TOKEN;
  const originalPassword = process.env.ADMIN_PANEL_PASSWORD;

  after(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_TOKEN;
    } else {
      process.env.TELEGRAM_TOKEN = originalToken;
    }
    if (originalPassword === undefined) {
      delete process.env.ADMIN_PANEL_PASSWORD;
    } else {
      process.env.ADMIN_PANEL_PASSWORD = originalPassword;
    }
  });

  it('strips JSON-style quotes from a quoted TELEGRAM_TOKEN env value', () => {
    process.env.TELEGRAM_TOKEN = '"8609135566:AAEGenvquoted"';
    const config = createConfig();
    assert.equal(config.telegram.token, '8609135566:AAEGenvquoted');
  });

  it('resolves to empty string when TELEGRAM_TOKEN is missing', () => {
    delete process.env.TELEGRAM_TOKEN;
    const config = createConfig();
    assert.equal(config.telegram.token, '');
  });

  it('reuses stripEnvQuotes semantics for ADMIN_PANEL_PASSWORD (approval)', () => {
    process.env.ADMIN_PANEL_PASSWORD = '"super-secret-pass"';
    const config = createConfig();
    assert.equal(config.admin.password, 'super-secret-pass');
  });
});
