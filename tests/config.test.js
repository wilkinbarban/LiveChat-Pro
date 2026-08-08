'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createConfig, stripEnvQuotes, parseEnvBoolean } = require('../src/config');

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

const QUOTED_ENV_KEYS = [
  'COOKIE_SAME_SITE',
  'ADMIN_LANGUAGE',
  'WIDGET_BUTTON_STYLE',
  'WIDGET_PRIMARY_COLOR',
  'WIDGET_WELCOME_MESSAGE',
  'WIDGET_API_KEY',
  'REDIS_URL',
  'REDIS_KEY_PREFIX',
  'REDIS_ENABLED',
  'UPLOAD_DIR',
  'ALLOWED_ORIGINS',
  'ALLOWED_IMAGE_TYPES',
  'FEATURE_TRANSLATION',
  'FEATURE_SENTIMENT',
  'FEATURE_GHOST_TYPING',
  'FEATURE_GEOLOCATION',
  'BOT_NOTIFY_ADMIN',
  'BOT_MODE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_MAX_TOKENS',
  'BOT_SYSTEM_PROMPT',
  'BOT_CONFIDENCE_THRESHOLD',
  'BOT_CONTEXT_MESSAGES',
];

function snapshotEnv(keys) {
  const snapshot = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('parseEnvBoolean', () => {
  it('parses quoted "false" as false, not inverted to enabled', () => {
    assert.equal(parseEnvBoolean('"false"', true), false);
  });

  it('parses quoted "true" as true', () => {
    assert.equal(parseEnvBoolean('"true"', false), true);
  });

  it('parses "1" as true', () => {
    assert.equal(parseEnvBoolean('1', false), true);
  });

  it('parses "yes" as true', () => {
    assert.equal(parseEnvBoolean('yes', false), true);
  });

  it('parses "0" as false', () => {
    assert.equal(parseEnvBoolean('0', true), false);
  });

  it('parses "no" as false', () => {
    assert.equal(parseEnvBoolean('no', true), false);
  });

  it('falls back when the value is empty', () => {
    assert.equal(parseEnvBoolean('', true), true);
    assert.equal(parseEnvBoolean(undefined, false), false);
  });

  it('falls back when the value is unknown', () => {
    assert.equal(parseEnvBoolean('bogus', true), true);
  });
});

describe('createConfig quoted env normalization', () => {
  let original;

  before(() => {
    original = snapshotEnv(QUOTED_ENV_KEYS);
  });

  after(() => {
    restoreEnv(original);
  });

  it('normalizes quoted COOKIE_SAME_SITE to strict instead of lax', () => {
    process.env.COOKIE_SAME_SITE = '"strict"';
    const config = createConfig();
    assert.equal(config.admin.cookieSameSite, 'strict');
  });

  it('normalizes quoted ADMIN_LANGUAGE to a valid locale', () => {
    process.env.ADMIN_LANGUAGE = '"en"';
    const config = createConfig();
    assert.equal(config.admin.language, 'en');
  });

  it('strips quotes from WIDGET_* visual values', () => {
    process.env.WIDGET_BUTTON_STYLE = '"hidden"';
    process.env.WIDGET_PRIMARY_COLOR = '"#112233"';
    process.env.WIDGET_WELCOME_MESSAGE = '"Hola, qué tal!"';
    const config = createConfig();
    assert.equal(config.widget.buttonStyle, 'hidden');
    assert.equal(config.widget.primaryColor, '#112233');
    assert.equal(config.widget.welcomeMessage, 'Hola, qué tal!');
  });

  it('normalizes quoted WIDGET_API_KEY for embed auth', () => {
    process.env.WIDGET_API_KEY = '"lcp_widget_key_123"';
    const config = createConfig();
    assert.equal(config.widget.apiKey, 'lcp_widget_key_123');
  });

  it('normalizes quoted REDIS_URL and REDIS_KEY_PREFIX', () => {
    process.env.REDIS_URL = '"redis://localhost:6379"';
    process.env.REDIS_KEY_PREFIX = '"lcp"';
    const config = createConfig();
    assert.equal(config.redis.url, 'redis://localhost:6379');
    assert.equal(config.redis.keyPrefix, 'lcp');
  });

  it('normalizes quoted UPLOAD_DIR', () => {
    process.env.UPLOAD_DIR = '"/data/uploads"';
    const config = createConfig();
    assert.equal(config.uploads.dir, '/data/uploads');
  });

  it('per-item strips JSON-array encoded ALLOWED_ORIGINS (restores CORS)', () => {
    process.env.ALLOWED_ORIGINS = '["https://chat.example.com"]';
    const config = createConfig();
    assert.deepEqual(config.server.corsOptions.origin, ['https://chat.example.com']);
  });

  it('per-item strips whole-list quoted ALLOWED_ORIGINS (CSV form)', () => {
    process.env.ALLOWED_ORIGINS = '"https://a.example.com,https://b.example.com"';
    const config = createConfig();
    assert.deepEqual(config.server.corsOptions.origin, ['https://a.example.com', 'https://b.example.com']);
  });

  it('per-item strips quoted ALLOWED_IMAGE_TYPES so uploads are accepted (no 415)', () => {
    process.env.ALLOWED_IMAGE_TYPES = '["image/jpeg","image/png"]';
    const config = createConfig();
    assert.deepEqual(config.uploads.allowedImageTypes, ['image/jpeg', 'image/png']);
  });

  it('parses quoted REDIS_ENABLED "false" as disabled on non-Windows', () => {
    process.env.REDIS_ENABLED = '"false"';
    const config = createConfig();
    assert.equal(config.redis.enabled, false);
  });

  it('keeps the platform default when REDIS_ENABLED is unset (not flattened)', () => {
    delete process.env.REDIS_ENABLED;
    const config = createConfig();
    assert.equal(config.redis.enabled, process.platform !== 'win32');
  });

  it('keeps quoted FEATURE_* "false" off (no forced-on inversion)', () => {
    process.env.FEATURE_TRANSLATION = '"false"';
    process.env.FEATURE_SENTIMENT = '"false"';
    const config = createConfig();
    assert.equal(config.features.translation, false);
    assert.equal(config.features.sentiment, false);
  });

  it('parses quoted BOT_NOTIFY_ADMIN "true" as enabled (inversion fixed)', () => {
    process.env.BOT_NOTIFY_ADMIN = '"true"';
    const config = createConfig();
    assert.equal(config.features.botNotifyAdmin, true);
  });

  it('parses quoted aiBot numeric vars into config.aiBot', () => {
    process.env.OPENAI_MAX_TOKENS = '"300"';
    process.env.BOT_CONFIDENCE_THRESHOLD = '"0.6"';
    const config = createConfig();
    assert.equal(config.aiBot.maxTokens, 300);
    assert.equal(config.aiBot.confidenceThreshold, 0.6);
  });

  it('keeps BOT_MODE unset falling back to "disabled"', () => {
    delete process.env.BOT_MODE;
    const config = createConfig();
    assert.equal(config.aiBot.mode, 'disabled');
  });
});
