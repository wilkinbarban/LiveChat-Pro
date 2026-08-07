'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  createSettingsService,
  encryptSecret,
  decryptSecret,
  maskSecret,
  resolveSettingsKey,
} = require('../src/services/settings');

describe('Settings Service & AES-256-GCM Crypto', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('set/get/getJSON/setJSON/delete round-trip with mock DB', async () => {
    const store = new Map();
    const mockDb = {
      get: async (sql, params) => {
        const key = Array.isArray(params) ? params[0] : params['@key'];
        const row = store.get(key);
        return row ? { key, value: row.value, updated_at: row.updated_at } : null;
      },
      run: async (sql, params) => {
        let key, value;
        if (Array.isArray(params)) {
          key = params[0];
          value = params[1];
        } else {
          key = params['@key'];
          value = params['@value'];
        }
        if (sql.includes('DELETE')) {
          store.delete(key);
        } else {
          store.set(key, { value, updated_at: Date.now() });
        }
      },
      all: async () => {
        return Array.from(store.entries()).map(([key, v]) => ({ key, value: v.value, updated_at: v.updated_at }));
      },
    };

    const service = createSettingsService({ db: mockDb });

    await service.set('test_key', 'hello_world');
    const val = await service.get('test_key');
    assert.equal(val, 'hello_world');

    const defaultVal = await service.get('non_existent', 'fallback');
    assert.equal(defaultVal, 'fallback');

    await service.setJSON('json_key', { enabled: true, count: 42 });
    const jsonVal = await service.getJSON('json_key');
    assert.deepEqual(jsonVal, { enabled: true, count: 42 });

    const jsonFallback = await service.getJSON('missing_json', { default: true });
    assert.deepEqual(jsonFallback, { default: true });

    await service.delete('test_key');
    const deletedVal = await service.get('test_key');
    assert.equal(deletedVal, null);
  });

  it('AES-256-GCM encrypt and decrypt round-trip with v1 format', () => {
    const key = Buffer.alloc(32, 0x42);
    const plaintext = 'sk-proj-secret-api-key-12345';

    const encrypted = encryptSecret(plaintext, key);
    assert.match(encrypted, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);

    const decrypted = decryptSecret(encrypted, key);
    assert.equal(decrypted, plaintext);

    assert.equal(encryptSecret(''), '');
    assert.equal(decryptSecret(''), '');
  });

  it('decryptSecret throws error when using wrong key or invalid format', () => {
    const key1 = Buffer.alloc(32, 0x01);
    const key2 = Buffer.alloc(32, 0x02);
    const plaintext = 'top-secret-password';

    const encrypted = encryptSecret(plaintext, key1);
    assert.throws(() => {
      decryptSecret(encrypted, key2);
    });

    assert.throws(() => {
      decryptSecret('invalid_format_without_v1');
    }, /Formato de secreto cifrado inválido/);

    assert.throws(() => {
      decryptSecret('v2.bad.format.data');
    }, /Formato de secreto cifrado inválido/);
  });

  it('resolveSettingsKey uses SETTINGS_KEY env if present, else creates data/.settings-key with 0600 permissions', () => {
    const customHexKey = 'a'.repeat(64);
    const resolved = resolveSettingsKey({ envKey: customHexKey });
    assert.equal(resolved.toString('hex'), customHexKey);

    const nonHexEnvKey = 'my-custom-passphrase';
    const derivedFromNonHex = resolveSettingsKey({ envKey: nonHexEnvKey });
    assert.equal(derivedFromNonHex.length, 32);

    const keyFilePath = path.join(tempDir, '.settings-key');
    const fileKey = resolveSettingsKey({ envKey: '', keyFilePath });
    assert.equal(fileKey.length, 32);
    assert.ok(fs.existsSync(keyFilePath));

    const stats = fs.statSync(keyFilePath);
    const mode = stats.mode & 0o777;
    assert.equal(mode, 0o600);

    const fileKeyReread = resolveSettingsKey({ envKey: '', keyFilePath });
    assert.equal(fileKeyReread.toString('hex'), fileKey.toString('hex'));
  });

  it('maskSecret masks keys and returns last 4 chars', () => {
    assert.equal(maskSecret('sk-1234567890abcdef'), '…cdef');
    assert.equal(maskSecret('abcd'), '…abcd');
    assert.equal(maskSecret(''), '');
    assert.equal(maskSecret(null), '');
    assert.equal(maskSecret(123), '');
  });

  it('configure() produces atomic frozen snapshot and loadAll populates it', async () => {
    const store = new Map();
    store.set('ai.enabled', { value: 'true', updated_at: 100 });
    store.set('llm.default', { value: JSON.stringify('openai'), updated_at: 100 });

    const mockDb = {
      all: async () => Array.from(store.entries()).map(([k, v]) => ({ key: k, value: v.value, updated_at: v.updated_at })),
    };

    const service = createSettingsService({ db: mockDb });
    const loaded = await service.loadAll();

    assert.ok(Object.isFrozen(loaded));
    assert.equal(service.getConfig()['ai.enabled'], true);
    assert.equal(service.getConfig()['llm.default'], 'openai');

    service.configure({ 'llm.default': 'anthropic' });
    assert.equal(service.getConfig()['llm.default'], 'anthropic');
    assert.ok(Object.isFrozen(service.getConfig()));
  });
});
