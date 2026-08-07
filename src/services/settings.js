'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_KEY_FILE = path.join(__dirname, '..', '..', 'data', '.settings-key');

function resolveSettingsKey(opts = {}) {
  const envKey = opts.envKey !== undefined ? opts.envKey : process.env.SETTINGS_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim() !== '') {
    const trimmed = envKey.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    return crypto.createHash('sha256').update(trimmed).digest();
  }

  const keyFilePath = opts.keyFilePath || DEFAULT_KEY_FILE;

  if (fs.existsSync(keyFilePath)) {
    const fileContent = fs.readFileSync(keyFilePath, 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(fileContent)) {
      return Buffer.from(fileContent, 'hex');
    }
  }

  const dir = path.dirname(keyFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const newKeyHex = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFilePath, newKeyHex, { mode: 0o600 });
  return Buffer.from(newKeyHex, 'hex');
}

function encryptSecret(plaintext, key) {
  if (!plaintext) return '';
  const keyBuf = key ? (Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex')) : resolveSettingsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

function decryptSecret(ciphertext, key) {
  if (!ciphertext) return '';
  const parts = String(ciphertext).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Formato de secreto cifrado inválido');
  }
  const keyBuf = key ? (Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex')) : resolveSettingsKey();
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '';
  if (secret.length <= 4) return `…${secret}`;
  return `…${secret.slice(-4)}`;
}

function createSettingsService(deps = {}) {
  const db = deps.db;
  const stmts = deps.stmts;
  let configSnapshot = Object.freeze({});

  async function get(key, defaultValue = null) {
    if (!db && !stmts?.getSetting) return defaultValue;
    let row;
    if (stmts?.getSetting) {
      row = await stmts.getSetting.get(key);
    } else if (typeof db.get === 'function') {
      row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    }
    return row && row.value !== undefined ? row.value : defaultValue;
  }

  async function set(key, value) {
    if (!db && !stmts?.setSetting) return;
    const strVal = String(value);
    const now = Date.now();
    if (stmts?.setSetting) {
      await stmts.setSetting.run({ key, value: strVal, updated_at: now });
    } else if (typeof db.run === 'function') {
      await db.run(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [key, strVal, now]
      );
    }
  }

  async function getJSON(key, defaultValue = null) {
    const raw = await get(key, null);
    if (raw === null || raw === undefined) return defaultValue;
    try {
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  }

  async function setJSON(key, value) {
    await set(key, JSON.stringify(value));
  }

  async function remove(key) {
    if (!db && !stmts?.deleteSetting) return;
    if (stmts?.deleteSetting) {
      await stmts.deleteSetting.run(key);
    } else if (typeof db.run === 'function') {
      await db.run('DELETE FROM settings WHERE key = ?', [key]);
    }
  }

  function configure(nextConfig = {}) {
    configSnapshot = Object.freeze({ ...configSnapshot, ...nextConfig });
    return configSnapshot;
  }

  function getConfig() {
    return configSnapshot;
  }

  async function loadAll() {
    if (!db && !stmts?.getAllSettings) return configSnapshot;
    let rows = [];
    if (stmts?.getAllSettings) {
      rows = await stmts.getAllSettings.all();
    } else if (typeof db.all === 'function') {
      rows = await db.all('SELECT key, value FROM settings');
    }
    const loaded = {};
    for (const row of rows) {
      try {
        loaded[row.key] = JSON.parse(row.value);
      } catch {
        loaded[row.key] = row.value;
      }
    }
    return configure(loaded);
  }

  return {
    get,
    set,
    getJSON,
    setJSON,
    delete: remove,
    configure,
    getConfig,
    loadAll,
    encryptSecret,
    decryptSecret,
    maskSecret,
  };
}

module.exports = {
  createSettingsService,
  resolveSettingsKey,
  encryptSecret,
  decryptSecret,
  maskSecret,
};
