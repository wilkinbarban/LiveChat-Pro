'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createSafeFetch, isGlobalAddress } = require('../src/utils/fetch');

function reply(statusCode = 200, headers = {}, chunks = ['ok']) {
  const body = Readable.from(chunks);
  body.statusCode = statusCode;
  body.headers = headers;
  return body;
}

function harness({ answers = {}, responses = [] } = {}) {
  const lookups = [];
  const requests = [];
  const lookup = async hostname => {
    lookups.push(hostname);
    const value = answers[hostname];
    if (value instanceof Promise) return value;
    return value || [{ address: '8.8.8.8', family: 4 }];
  };
  const request = async options => {
    requests.push(options);
    return responses.shift() || reply();
  };
  return { fetch: createSafeFetch({ lookup, request }), lookups, requests };
}

test('registry-aligned address policy handles IPv4, IPv6, mapped, and URL literals', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '100:0:0:1::1', '2001:100::1', '::ffff:127.0.0.1']) {
    assert.equal(isGlobalAddress(address), false, address);
  }
  for (const address of ['192.0.0.9', '192.0.0.10', '8.8.8.8', '2001:1::1', '2001:1::2', '2001:3::1', '2001:4:112::1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isGlobalAddress(address), true, address);
  }
});

test('pins validated DNS results and revalidates every redirect destination', async () => {
  const h = harness({
    answers: {
      'public.example': [{ address: '8.8.8.8', family: 4 }],
      'next.example': [{ address: '1.1.1.1', family: 4 }],
    },
    responses: [reply(302, { location: 'https://next.example/final' }), reply(200, {}, ['safe'])],
  });
  const response = await h.fetch('https://public.example/start');
  assert.equal(await response.text(), 'safe');
  assert.deepEqual(h.lookups, ['public.example', 'next.example']);
  assert.deepEqual(h.requests.map(item => item.address), ['8.8.8.8', '1.1.1.1']);

  const rebound = harness({ answers: { 'mixed.example': [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] } });
  await assert.rejects(rebound.fetch('https://mixed.example'), /destination/i);
  assert.equal(rebound.requests.length, 0);

  const unsafeRedirect = harness({ responses: [reply(302, { location: 'http://127.0.0.1/private' })] });
  await assert.rejects(unsafeRedirect.fetch('https://public.example'), /destination/i);
  assert.equal(unsafeRedirect.requests.length, 1);
});

test('accepts bracketed global IPv6 literals without DNS and pins the normalized address', async () => {
  const h = harness();
  const response = await h.fetch('https://[2606:4700:4700::1111]/dns-query');
  assert.equal(await response.text(), 'ok');
  assert.deepEqual(h.lookups, []);
  assert.equal(h.requests[0].address, '2606:4700:4700::1111');

  await assert.rejects(h.fetch('http://[::ffff:127.0.0.1]/'), /destination/i);
  assert.equal(h.requests.length, 1);
});

test('enforces declared, streamed, redirect, and total unresolved-DNS bounds', async () => {
  const declared = harness({ responses: [reply(200, { 'content-length': '6' }, ['123456'])] });
  await assert.rejects(declared.fetch('https://public.example', { maxBytes: 5 }), /size/i);

  const streamed = harness({ responses: [reply(200, { 'content-length': '2' }, ['123', '456'])] });
  await assert.rejects(streamed.fetch('https://public.example', { maxBytes: 5 }), /size/i);

  const redirects = harness({ responses: [reply(302, { location: '/1' }), reply(302, { location: '/2' })] });
  await assert.rejects(redirects.fetch('https://public.example', { maxRedirects: 1 }), /redirect/i);

  const unresolved = harness({ answers: { 'slow.example': new Promise(() => {}) } });
  const started = Date.now();
  await assert.rejects(unresolved.fetch('https://slow.example', { timeoutMs: 25 }), /timeout/i);
  assert.ok(Date.now() - started < 250, 'timeout must include unresolved DNS');
  assert.equal(unresolved.requests.length, 0);
});

test('destroys the active response body on total timeout and caller cancellation', async () => {
  for (const cancel of ['timeout', 'caller']) {
    const body = new Readable({ read() {} });
    let destroyedWith;
    body.destroy = error => {
      destroyedWith = error;
      return Readable.prototype.destroy.call(body, error);
    };
    const h = harness({ responses: [body] });
    const controller = new AbortController();
    const pending = h.fetch('https://public.example', {
      timeoutMs: cancel === 'timeout' ? 20 : 1000,
      signal: controller.signal,
    });
    if (cancel === 'caller') setTimeout(() => controller.abort(new Error('caller stopped')), 10);
    await assert.rejects(pending, cancel === 'timeout' ? /timeout/i : /caller stopped/i);
    assert.equal(body.destroyed, true, `${cancel} must destroy the active body`);
    assert.match(destroyedWith.message, cancel === 'timeout' ? /timeout/i : /caller stopped/i);
  }
});
