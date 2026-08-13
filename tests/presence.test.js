'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ClusterState } = require('../cluster-state');

function redisHarness() {
  const hashes = new Map();
  const expiries = new Map();
  let now = 0;
  let failDelete = false;
  return {
    expiries,
    async hIncrBy(key, field, amount) {
      const hash = hashes.get(key) || new Map();
      const value = (Number(hash.get(field)) || 0) + amount;
      hash.set(field, String(value)); hashes.set(key, hash); return value;
    },
    async hSet(key, values) { hashes.set(key, new Map(Object.entries(values).map(([k, v]) => [k, String(v)]))); },
    async hGet(key, field) { return hashes.get(key)?.get(field) || null; },
    async hDel(key, field) { if (failDelete) { failDelete = false; throw new Error('transient'); } hashes.get(key)?.delete(field); },
    async del(key) { hashes.delete(key); expiries.delete(key); },
    async expire(key, ttl) { expiries.set(key, now + ttl); },
    async *scanIterator() { for (const key of hashes.keys()) if ((expiries.get(key) || 0) > now) yield key; },
    advance(seconds) { now += seconds; },
    failNextDelete() { failDelete = true; },
  };
}

test('presence uses renewable per-node 60-second leases and reconciles after a crash', async () => {
  const redis = redisHarness();
  const timers = [];
  const stateA = new ClusterState({ nodeId: 'a', setIntervalFn: (fn, ms) => { timers.push([fn, ms]); return 1; } });
  const stateB = new ClusterState({ nodeId: 'b', setIntervalFn: () => 2 });
  stateA.attachPresenceClient(redis); stateB.attachPresenceClient(redis);

  await stateA.incrementPresence('session');
  await stateB.incrementPresence('session');
  assert.equal(await stateA.getPresence('session'), 2);
  assert.equal(timers[0][1], 20_000);
  await timers[0][0]();
  assert.equal(redis.expiries.get(stateA.nodePresenceKey()), 60);
  redis.advance(61);
  await stateB.renewPresence();
  assert.equal(await stateB.getPresence('session'), 1);
});

test('renewal reconciles a stale contribution after transient deletion failure', async () => {
  const redis = redisHarness();
  const state = new ClusterState({ nodeId: 'node', setIntervalFn: () => 1 });
  state.attachPresenceClient(redis);
  await state.incrementPresence('session');
  redis.failNextDelete();
  await assert.rejects(state.decrementPresence('session'), /transient/);
  await state.renewPresence();
  assert.equal(await state.getPresence('session'), 0);
});

test('compose healthcheck normalizes a double-quoted PORT', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  const script = compose.match(/ {10}const h[\s\S]*?\.on\('error',[^\n]+/)[0].trim();
  let requested;
  const response = { on() {} };
  vm.runInNewContext(script, {
    require: () => ({ get: (url, callback) => { requested = url; callback({ statusCode: 200 }); return response; } }),
    process: { env: { PORT: '"3000"' }, exit() {} },
  });
  assert.equal(requested, 'http://localhost:3000/health');
});

test('compose healthcheck rejects an invalid normalized PORT without probing', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  const script = compose.match(/ {10}const h[\s\S]*?\.on\('error',[^\n]+/)[0].trim();
  let requested = false;
  let exitCode;
  assert.throws(() => vm.runInNewContext(script, {
    require: () => ({ get: () => { requested = true; } }),
    process: { env: { PORT: '"invalid"' }, exit(code) { exitCode = code; throw new Error('exit'); } },
  }), /exit/);
  assert.equal(requested, false);
  assert.equal(exitCode, 1);
});
