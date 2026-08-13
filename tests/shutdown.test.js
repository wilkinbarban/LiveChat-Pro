'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('shutdown runs all three stages in order and only once', async () => {
  const { createShutdownCoordinator } = require('../src/services/shutdown');
  const events = [];
  const shutdown = createShutdownCoordinator({
    stopAcceptance: async () => events.push('acceptance'),
    closeTransports: async () => events.push('transports'),
    closeDatabase: async () => events.push('database'),
  });

  await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
  assert.deepEqual(events, ['acceptance', 'transports', 'database']);
});

test('server composition owns admin initialization and resilient transport cleanup', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /const adminAuth = createAdminAuth\(/);
  assert.match(server, /async function start\(\)[\s\S]*?adminAuth\.initialize\(\)/);
  assert.doesNotMatch(server, /initialize:\s*initializeAdminAuth[\s\S]*?src\/telegram\/bot/);
  assert.match(server, /closeTransports:\s*\[[\s\S]*?clusterState\.close\(\)[\s\S]*?io\.close/);
});

test('shutdown reports a failed close and continues safe cleanup', async () => {
  const { createShutdownCoordinator } = require('../src/services/shutdown');
  const events = [];
  const failures = [];
  const shutdown = createShutdownCoordinator({
    stopAcceptance: async () => { throw new Error('acceptance failed'); },
    closeTransports: [
      () => { events.push('telegram'); throw new Error('telegram failed'); },
      async () => { events.push('redis'); throw new Error('redis failed'); },
      () => events.push('sockets'),
    ],
    closeDatabase: async () => events.push('database'),
    logger: { error: ({ err, stage }) => failures.push(`${stage}:${err.message}`) },
  });

  await shutdown('SIGTERM');
  assert.deepEqual(events, ['telegram', 'redis', 'sockets', 'database']);
  assert.deepEqual(failures, [
    'stop-acceptance:acceptance failed',
    'close-transports:telegram failed',
    'close-transports:redis failed',
  ]);
});
