// ============================================================
// KB trainer CLI tests — kb-trainer/index.js
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

test('trainer default trainable output keeps language-keyed format', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcp-kb-trainer-'));
  const source = path.join(dir, 'faq.md');
  const output = path.join(dir, 'kb-trainer', 'knowledge-base.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(source, '# Instalacion\n\nInstala el proyecto ejecutando node setup.js desde la raiz del repositorio.\n');
  await fs.writeFile(output, JSON.stringify({ en: [] }, null, 2));

  await execFileAsync(process.execPath, [
    'kb-trainer/index.js',
    '--provider', 'none',
    '--urls', source,
    '--mode', 'replace',
    '--output', output,
    '--lang', 'es',
  ], { cwd: path.join(__dirname, '..') });

  const parsed = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(Array.isArray(parsed.es), true);
  assert.equal(Array.isArray(parsed.en), true);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'entries'), false);
  assert.ok(parsed.es.length > 0);
});
