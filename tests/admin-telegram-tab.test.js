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

      assert.ok(dict['nav.telegram'], `Missing 'nav.telegram' key in '${lang}'`);
      assert.ok(dict['telegram.tab_title'], `Missing 'telegram.tab_title' key in '${lang}'`);
      assert.ok(dict['telegram.lead'], `Missing 'telegram.lead' key in '${lang}'`);
      assert.ok(dict['telegram.bot_status'], `Missing 'telegram.bot_status' key in '${lang}'`);
      assert.ok(dict['telegram.start'], `Missing 'telegram.start' key in '${lang}'`);
      assert.ok(dict['telegram.stop'], `Missing 'telegram.stop' key in '${lang}'`);
      assert.ok(dict['telegram.refresh'], `Missing 'telegram.refresh' key in '${lang}'`);
      assert.ok(dict['telegram.admin_id'], `Missing 'telegram.admin_id' key in '${lang}'`);
      assert.ok(dict['telegram.save_admin_id'], `Missing 'telegram.save_admin_id' key in '${lang}'`);
    });
  }
});
