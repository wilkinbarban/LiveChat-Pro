'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ADMIN_HTML_PATH = path.join(__dirname, '..', 'public', 'admin.html');

test('Admin Panel Prompt Tab — HTML Structure and Component Verification', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  await t.test('admin.html contains Prompt tab navigation button', () => {
    assert.match(html, /data-tab="prompt"|id="tab-btn-prompt"/i);
    assert.match(html, /data-i18n="nav\.prompt"/i);
  });

  await t.test('Prompt tab panel container exists in DOM', () => {
    assert.match(html, /id="tab-prompt"|id="tab-view-prompt"/i);
  });

  await t.test('System prompt textarea exists', () => {
    assert.match(html, /id="master-prompt-input"|id="prompt-textarea"/i);
  });

  await t.test('Save prompt button exists', () => {
    assert.match(html, /id="btn-save-prompt"|id="btn-save-master-prompt"/i);
  });

  await t.test('Variables guide / reference panel exists in DOM', () => {
    assert.match(html, /\{visitor_name\}|\{site_title\}|\{current_language\}|\{rag_context\}/i);
  });
});

test('Admin Panel Prompt Tab — i18n Dictionaries Verification across 5 Languages', async (t) => {
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
    await t.test(`dictionary contains '${lang}' language section with Prompt keys`, () => {
      assert.ok(i18n[lang], `Missing dictionary section for language: ${lang}`);
      const dict = i18n[lang];

      assert.ok(dict['nav.prompt'], `Missing 'nav.prompt' key in '${lang}'`);
      assert.ok(dict['prompt.tab_title'] || dict['prompt.title'], `Missing Prompt tab title key in '${lang}'`);
      assert.ok(dict['prompt.lead'], `Missing Prompt lead key in '${lang}'`);
      assert.ok(dict['prompt.save'], `Missing 'prompt.save' key in '${lang}'`);
    });
  }
});
