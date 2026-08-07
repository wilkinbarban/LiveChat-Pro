'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ADMIN_HTML_PATH = path.join(__dirname, '..', 'public', 'admin.html');

test('Admin Panel Telegram Tab — HTML Structure and Component Verification', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  await t.test('admin.html contains Telegram tab navigation button', () => {
    assert.match(html, /data-tab="telegram"|id="tab-btn-telegram"/i);
    assert.match(html, /data-i18n="nav\.telegram"/i);
  });

  await t.test('Telegram tab panel container exists in DOM', () => {
    assert.match(html, /id="tab-telegram"|id="tab-view-telegram"/i);
  });

  await t.test('Admin ID input field exists', () => {
    assert.match(html, /id="telegram-admin-id-input"/i);
  });

  await t.test('Start, Stop, and Refresh buttons exist', () => {
    assert.match(html, /id="btn-telegram-start"/i);
    assert.match(html, /id="btn-telegram-stop"/i);
    assert.match(html, /id="btn-telegram-refresh"/i);
  });

  await t.test('Save Admin ID button exists', () => {
    assert.match(html, /id="btn-save-telegram-admin-id"/i);
  });

  await t.test('Token control UI exists (password input + save/verify button)', () => {
    assert.match(html, /id="telegram-token-input"/i);
    assert.match(html, /id="telegram-token-input"[^>]*type="password"/i);
    assert.match(html, /id="btn-save-telegram-token"/i);
    assert.match(html, /data-i18n="telegram\.token"/i);
    assert.match(html, /data-i18n="telegram\.save_token"/i);
  });

  await t.test('Bot identity and masked token display elements exist', () => {
    assert.match(html, /id="telegram-bot-username"/i);
    assert.match(html, /id="telegram-bot-name"/i);
    assert.match(html, /id="telegram-masked-token"/i);
    assert.match(html, /id="telegram-token-source"/i);
    assert.match(html, /data-i18n="telegram\.bot_identity"/i);
  });

  await t.test('Admin username field and save button exist', () => {
    assert.match(html, /id="telegram-admin-username-input"/i);
    assert.match(html, /id="btn-save-telegram-admin-username"/i);
    assert.match(html, /data-i18n="telegram\.admin_username"/i);
  });
});

test('Admin Panel Telegram Tab — i18n Dictionaries Verification across 5 Languages', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  const dictMatch = html.match(/const\s+i18n\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(dictMatch, 'Translation dictionary object (const i18n = {...}) not found in admin.html');

  let i18n;
  try {
    // biome-ignore lint/security/noGlobalEval: test helper parses embedded dictionary object
    i18n = eval(`(${dictMatch[1]})`);
  } catch (err) {
    assert.fail(`Failed to parse i18n object from admin.html: ${err.message}`);
  }

  const requiredLangs = ['es', 'en', 'pt', 'fr', 'de'];
  for (const lang of requiredLangs) {
    await t.test(`dictionary contains '${lang}' language section with Telegram keys`, () => {
      assert.ok(i18n[lang], `Missing dictionary section for language: ${lang}`);
      const dict = i18n[lang];

      // The 12 pre-existing telegram.* keys MUST stay intact (regression guard).
      const existingKeys = [
        'nav.telegram', 'telegram.tab_title', 'telegram.lead', 'telegram.bot_status',
        'telegram.status_loading', 'telegram.start', 'telegram.stop', 'telegram.refresh',
        'telegram.admin_id', 'telegram.admin_id_placeholder', 'telegram.admin_id_help',
        'telegram.save_admin_id',
      ];
      for (const key of existingKeys) {
        assert.ok(dict[key], `Missing '${key}' key in '${lang}'`);
      }

      // New slice-6 keys: token UI, identity display, admin username, saved confirmation.
      const newKeys = [
        'telegram.saved',
        'telegram.token', 'telegram.token_placeholder', 'telegram.token_help',
        'telegram.save_token', 'telegram.masked_token', 'telegram.token_source',
        'telegram.bot_identity', 'telegram.bot_username', 'telegram.bot_name',
        'telegram.admin_username', 'telegram.admin_username_placeholder',
        'telegram.save_admin_username',
      ];
      for (const key of newKeys) {
        assert.ok(dict[key], `Missing '${key}' key in '${lang}'`);
      }
    });
  }
});
