'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
  translate,
  detectLang,
  clearTranslationCache,
  closeTranslationCache,
} = require('../src/services/translator');

const originalGet = axios.get;
const originalPost = axios.post;
const originalProvider = process.env.TRANSLATION_PROVIDER;
const originalApiKey = process.env.TRANSLATION_API_KEY;
const originalDeepLApiUrl = process.env.DEEPL_API_URL;

test.afterEach(() => {
  axios.get = originalGet;
  axios.post = originalPost;
  process.env.TRANSLATION_PROVIDER = originalProvider || '';
  process.env.TRANSLATION_API_KEY = originalApiKey || '';
  process.env.DEEPL_API_URL = originalDeepLApiUrl || '';
  clearTranslationCache();
});

test.after(() => {
  closeTranslationCache();
});

test('google_free usa el endpoint gratuito como proveedor por defecto', async () => {
  process.env.TRANSLATION_PROVIDER = 'google_free';
  delete process.env.TRANSLATION_API_KEY;

  let requestedUrl = '';
  axios.get = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.timeout, 4000);
    return { data: [[['hola', 'hello', null, null]]] };
  };

  const translated = await translate('hello', 'es');

  assert.equal(translated, 'hola');
  assert.match(requestedUrl, /translate\.googleapis\.com\/translate_a\/single/);
  assert.match(requestedUrl, /client=gtx/);
  assert.match(requestedUrl, /tl=es/);
});

test('deepl usa POST oficial con API key y form-urlencoded', async () => {
  process.env.TRANSLATION_PROVIDER = 'deepl';
  process.env.TRANSLATION_API_KEY = 'deepl-key';
  process.env.DEEPL_API_URL = 'https://example.test/deepl';

  axios.post = async (url, params, options) => {
    assert.equal(url, 'https://example.test/deepl');
    assert.equal(params.get('text'), 'hello');
    assert.equal(params.get('target_lang'), 'ES');
    assert.equal(options.headers.Authorization, 'DeepL-Auth-Key deepl-key');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    return { data: { translations: [{ text: 'hola deepl' }] } };
  };

  assert.equal(await translate('hello', 'es'), 'hola deepl');
});

test('google_cloud usa Translation API v2 con API key', async () => {
  process.env.TRANSLATION_PROVIDER = 'google_cloud';
  process.env.TRANSLATION_API_KEY = 'cloud-key';

  axios.post = async (url, payload, options) => {
    assert.match(url, /translation\.googleapis\.com\/language\/translate\/v2\?key=cloud-key/);
    assert.deepEqual(payload, { q: 'hello', target: 'es', format: 'text' });
    assert.equal(options.timeout, 6000);
    return { data: { data: { translations: [{ translatedText: 'hola cloud' }] } } };
  };

  assert.equal(await translate('hello', 'es'), 'hola cloud');
});

test('proveedor oficial falla y cae a google_free', async () => {
  process.env.TRANSLATION_PROVIDER = 'deepl';
  process.env.TRANSLATION_API_KEY = 'deepl-key';

  axios.post = async () => {
    throw new Error('deepl down');
  };
  axios.get = async () => ({ data: [[['hola fallback', 'hello', null, null]]] });

  assert.equal(await translate('hello', 'es'), 'hola fallback');
});

test('detectLang usa Google Cloud cuando esta configurado', async () => {
  process.env.TRANSLATION_PROVIDER = 'google_cloud';
  process.env.TRANSLATION_API_KEY = 'cloud-key';

  axios.post = async (url, payload) => {
    assert.match(url, /translate\/v2\/detect\?key=cloud-key/);
    assert.deepEqual(payload, { q: 'bonjour' });
    return { data: { data: { detections: [[{ language: 'fr' }]] } } };
  };

  assert.equal(await detectLang('bonjour'), 'fr');
});
