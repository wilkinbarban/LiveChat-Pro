'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const inventory = spawnSync('git', ['ls-files', '-z', '--', 'tests'], {
  encoding: 'buffer',
});
if (inventory.status !== 0) {
  process.stderr.write(inventory.stderr);
  process.exit(inventory.status || 1);
}

const files = inventory.stdout.toString('utf8').split('\0')
  .filter(file => /^tests\/.+\.test\.js$/.test(file))
  .sort();
if (!files.length) fail('No tracked tests/**/*.test.js files were found.');
if (new Set(files).size !== files.length) fail('Tracked test inventory contains duplicate entries.');
const missing = files.filter(file => !fs.existsSync(file));
if (missing.length) fail(`Tracked test files are missing: ${missing.join(', ')}`);
if (process.exitCode) process.exit(process.exitCode);

const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const child = spawnSync(process.execPath, ['--test', ...files], { encoding: 'buffer', env: childEnv });
process.stdout.write(child.stdout || '');
process.stderr.write(child.stderr || '');
if (child.error) throw child.error;
process.exit(child.status ?? 1);
