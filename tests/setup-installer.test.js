// ============================================================
// Installer minimization tests — setup.js + .env.example (ADR-10)
// Runs the real setup.js non-interactively (piped stdin) against a
// legacy .env in a temp dir via the LIVECHAT_ENV_PATH override.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const LEGACY_ENV = [
  'TELEGRAM_TOKEN="123456789:ABCDEFGHIJ1234567890abcdef"',
  'TELEGRAM_ADMIN_ID="123456789"',
  'ADMIN_PANEL_PASSWORD="legacy-secret-password"',
  'ALLOWED_ORIGINS="https://chat.example.com"',
  'WIDGET_API_KEY="lcp_legacy_widget_key"',
  'WIDGET_PRIMARY_COLOR="#112233"',
  'WIDGET_BUTTON_STYLE="hidden"',
  'WIDGET_WELCOME_MESSAGE="Hola"',
  'BOT_MODE="knowledge-base"',
  'OPENAI_API_KEY="sk-legacy"',
  'OPENAI_MODEL="gpt-4o-mini"',
  'OPENAI_MAX_TOKENS="300"',
  'BOT_NOTIFY_ADMIN="true"',
].join('\n');

// PATH is emptied so commandExists('docker') fails and the interactive
// docker-launch prompt (default: yes) is never reached. LIVECHAT_PUBLIC_IP
// avoids the outbound IP-detection call. Every prompt then falls back to
// its default (existing value / basic mode / confirm overwrite) on ''.
function runSetup(envPath) {
  return spawnSync(process.execPath, [path.join(ROOT, 'setup.js')], {
    env: {
      ...process.env,
      PATH: '',
      LIVECHAT_ENV_PATH: envPath,
      LIVECHAT_PUBLIC_IP: '203.0.113.10',
      TERM: 'dumb',
    },
    input: '\n',
    encoding: 'utf8',
    timeout: 30000,
  });
}

function withLegacyEnv(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcp-setup-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, LEGACY_ENV, 'utf8');
  try {
    return fn(envPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('setup.js sobre un .env legacy', () => {
  it('completa sin error y no resucita claves obsoletas', () => {
    withLegacyEnv((envPath) => {
      const result = runSetup(envPath);
      assert.equal(result.status, 0, `setup.js falló: ${result.stderr}\n${result.stdout}`);
      assert.ok(fs.existsSync(envPath), 'el instalador debe reescribir el .env');

      const generated = fs.readFileSync(envPath, 'utf8');
      for (const obsolete of [
        'BOT_MODE',
        'OPENAI_API_KEY',
        'OPENAI_MODEL',
        'OPENAI_MAX_TOKENS',
        'BOT_SYSTEM_PROMPT',
        'BOT_CONFIDENCE_THRESHOLD',
        'BOT_CONTEXT_MESSAGES',
        'BOT_NOTIFY_ADMIN',
        'WIDGET_PRIMARY_COLOR',
        'WIDGET_BUTTON_STYLE',
        'WIDGET_WELCOME_MESSAGE',
      ]) {
        assert.ok(!generated.includes(obsolete), `el .env generado no debe contener ${obsolete}`);
      }
      // Obsolete keys must not be re-asked interactively either.
      assert.ok(!result.stdout.includes('OpenAI'), 'no debe preguntar por OpenAI');
    });
  });

  it('preserva los valores válidos existentes', () => {
    withLegacyEnv((envPath) => {
      const result = runSetup(envPath);
      assert.equal(result.status, 0, `setup.js falló: ${result.stderr}\n${result.stdout}`);

      const generated = fs.readFileSync(envPath, 'utf8');
      assert.match(generated, /TELEGRAM_TOKEN="?123456789:ABCDEFGHIJ1234567890abcdef"?/);
      assert.match(generated, /TELEGRAM_ADMIN_ID="?123456789"?/);
      assert.match(generated, /ADMIN_PANEL_PASSWORD="?legacy-secret-password"?/);
      assert.match(generated, /ALLOWED_ORIGINS="?https:\/\/chat\.example\.com"?/);
      // WIDGET_API_KEY stays: it is the bootstrap embed credential (ADR-10).
      assert.match(generated, /WIDGET_API_KEY="?lcp_legacy_widget_key"?/);
    });
  });

  it('documenta SETTINGS_KEY opcional en el .env generado', () => {
    withLegacyEnv((envPath) => {
      const result = runSetup(envPath);
      assert.equal(result.status, 0, `setup.js falló: ${result.stderr}\n${result.stdout}`);
      const generated = fs.readFileSync(envPath, 'utf8');
      assert.match(generated, /^SETTINGS_KEY=/m, 'el .env generado debe incluir SETTINGS_KEY');
    });
  });
});

describe('.env.example minimizado', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

  it('elimina las secciones Smart-Bot, kb-trainer y visuales del widget', () => {
    for (const obsolete of [
      'BOT_MODE',
      'OPENAI_',
      'BOT_SYSTEM_PROMPT',
      'BOT_CONFIDENCE_THRESHOLD',
      'BOT_CONTEXT_MESSAGES',
      'BOT_NOTIFY_ADMIN',
      'WIDGET_PRIMARY_COLOR',
      'WIDGET_BUTTON_STYLE',
      'WIDGET_WELCOME_MESSAGE',
      'kb-trainer',
      'knowledge-base.json',
    ]) {
      assert.ok(!example.includes(obsolete), `.env.example no debe mencionar ${obsolete}`);
    }
  });

  it('mantiene las claves bootstrap y documenta SETTINGS_KEY', () => {
    for (const kept of ['TELEGRAM_TOKEN', 'TELEGRAM_ADMIN_ID', 'ADMIN_PANEL_PASSWORD', 'WIDGET_API_KEY']) {
      assert.ok(example.includes(kept), `.env.example debe mantener ${kept}`);
    }
    assert.match(example, /^SETTINGS_KEY=/m, '.env.example debe documentar SETTINGS_KEY');
  });
});
