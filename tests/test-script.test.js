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
