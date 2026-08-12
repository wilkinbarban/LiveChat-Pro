'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { redactUrl, createRequestLoggerMiddleware } = require('../src/utils/logger');

function runRequestLogger(originalUrl) {
  const entries = [];
  const response = new EventEmitter();
  response.statusCode = 204;
  response.setHeader = () => {};
  const reads = [];
  const originalRead = fs.readFileSync;
  fs.readFileSync = (...args) => {
    reads.push(String(args[0]));
    return originalRead(...args);
  };
  try {
    const middleware = createRequestLoggerMiddleware({
      logger: { info: entry => entries.push(entry) },
      now: () => 100,
      randomUUID: () => 'request-id',
    });
    middleware({ headers: {}, method: 'GET', originalUrl, ip: '127.0.0.1' }, response, () => {});
    response.emit('finish');
  } finally {
    fs.readFileSync = originalRead;
  }
  return { entry: entries[0], reads };
}

test('redactUrl removes case-insensitive sensitive query values while retaining diagnostics', () => {
  const output = redactUrl('/download?Token=secret&access_token=bearer&API_KEY=abc&key=k&signature=sig&page=2');
  assert.equal(output, '/download?Token=%5BREDACTED%5D&access_token=%5BREDACTED%5D&API_KEY=%5BREDACTED%5D&key=%5BREDACTED%5D&signature=%5BREDACTED%5D&page=2');
  assert.doesNotMatch(output, /secret|bearer|abc|sig(?:&|$)/);
});

test('redactUrl handles absolute URLs and leaves ordinary query parameters intact', () => {
  assert.equal(redactUrl('https://example.test/path?q=docs&lang=en'), 'https://example.test/path?q=docs&lang=en');
});

test('server request logger seam emits a redacted request URL without reading the admin secret', () => {
  const { entry, reads } = runRequestLogger('/attachment?Token=secret&page=2');
  assert.equal(entry.path, '/attachment?Token=%5BREDACTED%5D&page=2');
  assert.equal(entry.method, 'GET');
  assert.equal(entry.statusCode, 204);
  assert.equal(reads.some(file => file.endsWith('/data/.admin-secret')), false);
});

test('server request logger seam redacts every occurrence while retaining ordinary diagnostics', () => {
  const { entry } = runRequestLogger('/search?api_key=first&q=docs&API_KEY=second');
  assert.equal(entry.path, '/search?api_key=%5BREDACTED%5D&q=docs&API_KEY=%5BREDACTED%5D');
  assert.doesNotMatch(JSON.stringify(entry), /first|second/);
});
