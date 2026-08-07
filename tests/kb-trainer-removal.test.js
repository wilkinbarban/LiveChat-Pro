// ============================================================
// KB trainer removal validation tests — tests/kb-trainer-removal.test.js
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('kb-trainer removal validation', async t => {
  await t.test('asserts kb-trainer directory is deleted from repo root', () => {
    const kbTrainerPath = path.join(ROOT, 'kb-trainer');
    assert.equal(
      fs.existsSync(kbTrainerPath),
      false,
      'kb-trainer/ directory should be completely deleted from repository root'
    );
  });

  await t.test('asserts setup.js has zero kb-trainer references or dead KB copy blocks', () => {
    const setupContent = fs.readFileSync(path.join(ROOT, 'setup.js'), 'utf8');
    assert.equal(
      /kb-trainer/i.test(setupContent),
      false,
      'setup.js must not contain any kb-trainer references'
    );
  });

  await t.test('asserts Dockerfile does not copy kb-trainer', () => {
    const dockerfileContent = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert.equal(
      /COPY.*kb-trainer/i.test(dockerfileContent),
      false,
      'Dockerfile must not contain COPY instructions for kb-trainer'
    );
  });

  await t.test('asserts package.json test script does not reference legacy kb-trainer.test.js', () => {
    const pkgContent = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    assert.equal(
      pkgContent.includes('tests/kb-trainer.test.js'),
      false,
      'package.json must not reference tests/kb-trainer.test.js'
    );
  });

  await t.test('asserts zero broken imports or references to kb-trainer across remaining source code', () => {
    const checkFile = filePath => {
      if (fs.statSync(filePath).isDirectory()) {
        for (const file of fs.readdirSync(filePath)) {
          if (file === 'node_modules' || file === '.git' || file === '.codegraph') continue;
          checkFile(path.join(filePath, file));
        }
      } else if (filePath.endsWith('.js') || filePath.endsWith('.json')) {
        const content = fs.readFileSync(filePath, 'utf8');
        assert.equal(
          content.includes("require('./kb-trainer'") || content.includes('require("../kb-trainer"'),
          false,
          `File ${path.relative(ROOT, filePath)} must not require kb-trainer`
        );
      }
    };
    checkFile(path.join(ROOT, 'src'));
    checkFile(path.join(ROOT, 'server.js'));
  });
});
