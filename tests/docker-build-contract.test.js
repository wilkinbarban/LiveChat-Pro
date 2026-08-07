// ============================================================
// Docker build and CI contract validation tests
// tests/docker-build-contract.test.js
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('Docker build and CI contract validation', async t => {
  await t.test('asserts Dockerfile uses node:24-slim base image', () => {
    const dockerfileContent = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const fromLines = dockerfileContent.split('\n').filter(line => line.trim().startsWith('FROM '));
    assert.ok(fromLines.length > 0, 'Dockerfile must contain at least one FROM instruction');
    for (const line of fromLines) {
      assert.ok(
        line.includes('node:24-slim'),
        `Each stage in Dockerfile must use node:24-slim base image. Found: "${line}"`
      );
    }
  });

  await t.test('asserts Dockerfile contains NO COPY ... kb-trainer line', () => {
    const dockerfileContent = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert.equal(
      /COPY.*kb-trainer/i.test(dockerfileContent),
      false,
      'Dockerfile must not contain COPY instructions referencing kb-trainer'
    );
  });

  await t.test('asserts Dockerfile configures WORKDIR /app, EXPOSE 3000, CMD ["node", "server.js"]', () => {
    const dockerfileContent = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert.ok(
      dockerfileContent.includes('WORKDIR /app'),
      'Dockerfile must set WORKDIR /app'
    );
    assert.ok(
      dockerfileContent.includes('EXPOSE 3000'),
      'Dockerfile must expose port 3000'
    );
    assert.ok(
      dockerfileContent.includes('CMD ["node", "server.js"]'),
      'Dockerfile must define CMD ["node", "server.js"]'
    );
  });

  await t.test('asserts CI workflow .github/workflows/ci.yml validates node-version: [22, 24]', () => {
    const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), '.github/workflows/ci.yml file must exist');
    const ciContent = fs.readFileSync(ciPath, 'utf8');
    assert.ok(
      ciContent.includes('[22, 24]') || ciContent.includes('node: [22, 24]'),
      'CI workflow must validate matrix node-version [22, 24]'
    );
  });

  await t.test('documents Docker daemon local status (unavailable locally, validated in CI)', () => {
    // Local Docker daemon is unavailable in this environment;
    // full image build validation is contracted to run in GitHub Actions CI docker-build job.
    const ciContent = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.ok(
      ciContent.includes('docker build') || ciContent.includes('docker-build'),
      'CI workflow must include docker build step for validation'
    );
  });
});
