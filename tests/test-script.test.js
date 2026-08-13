// ============================================================
// Tooling hygiene tests — package.json scripts, engines, Docker base
// Guards the npm test script against silently dropping test files.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

async function createTrackedFixture(files) {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'lcp-test-runner-'));
  await fsPromises.mkdir(path.join(root, 'tests'), { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    await fsPromises.writeFile(path.join(root, 'tests', name), source);
  }
  assert.equal(run('git', ['init', '-q'], root).status, 0);
  assert.equal(run('git', ['add', '-f', 'tests'], root).status, 0);
  return root;
}

describe('script npm test', () => {
  it('uses the tracked-test launcher as the only npm test command', () => {
    assert.equal(pkg.scripts.test, 'node scripts/run-tests.js');
  });

  it('discovers and executes every tracked nested test from a real git fixture', async (t) => {
    const root = await createTrackedFixture({
      'first.test.js': "require('node:test')('first', () => require('node:fs').writeFileSync('first.marker', 'ran'));",
      'second.test.js': "require('node:test')('second', () => require('node:fs').writeFileSync('second.marker', 'ran'));",
    });
    t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
    const result = run(process.execPath, [path.join(ROOT, 'scripts/run-tests.js')], root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fsPromises.readFile(path.join(root, 'first.marker'), 'utf8'), 'ran');
    assert.equal(await fsPromises.readFile(path.join(root, 'second.marker'), 'utf8'), 'ran');
  });

  it('preserves a tracked test filename containing spaces', async (t) => {
    const root = await createTrackedFixture({
      'name with spaces.test.js': "require('node:test')('spaced', () => require('node:fs').writeFileSync('spaced.marker', 'ran'));",
    });
    t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
    const result = run(process.execPath, [path.join(ROOT, 'scripts/run-tests.js')], root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fsPromises.readFile(path.join(root, 'spaced.marker'), 'utf8'), 'ran');
  });

  it('propagates a tracked child test failure', async (t) => {
    const root = await createTrackedFixture({
      'passing.test.js': "require('node:test')('passing', () => {});",
      'failing.test.js': "require('node:test')('failing', () => { throw new Error('fixture failure'); });",
    });
    t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
    const result = run(process.execPath, [path.join(ROOT, 'scripts/run-tests.js')], root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /fixture failure/);
  });
});

describe('historia de versiones de Node', () => {
  it('engines declara node >=22', () => {
    assert.equal(pkg.engines.node, '>=22', 'package.json engines.node debe ser >=22');
  });

  it('el Dockerfile usa una imagen base node:24', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const fromLines = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));
    assert.ok(fromLines.length > 0, 'el Dockerfile debe tener al menos una línea FROM');
    for (const line of fromLines) {
      assert.match(line, /^FROM node:24/, `base image inválida: ${line}`);
    }
  });
});
