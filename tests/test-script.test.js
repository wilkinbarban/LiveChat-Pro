// ============================================================
// Tooling hygiene tests — package.json scripts, engines, Docker base
// Guards the npm test script against silently dropping test files.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function testFilesOnDisk() {
  return fs
    .readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => f.endsWith('.test.js'))
    .sort();
}

describe('script npm test', () => {
  it('enumera todos los archivos tests/*.test.js presentes en disco', () => {
    const script = pkg.scripts.test;
    assert.equal(typeof script, 'string', 'package.json debe definir scripts.test');
    for (const file of testFilesOnDisk()) {
      assert.ok(
        script.includes(`tests/${file}`),
        `npm test omite tests/${file} — agréguelo al script test`,
      );
    }
  });

  it('falla si un archivo de test desaparece del script (guardia contra regresión)', () => {
    // The enumeration above is the real guard; here we only pin down that the
    // script is an explicit node --test invocation (not a glob that could
    // silently change meaning).
    assert.match(pkg.scripts.test, /^node --test /, 'el script test debe invocar node --test');
  });
});
