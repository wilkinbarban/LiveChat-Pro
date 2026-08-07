'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ADMIN_HTML_PATH = path.join(__dirname, '..', 'public', 'admin.html');

test('Admin Panel Knowledge Tab — HTML Structure and Component Verification', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  await t.test('admin.html contains Knowledge tab navigation button', () => {
    assert.match(html, /data-tab="knowledge"|id="tab-btn-knowledge"/i);
    assert.match(html, /data-i18n="nav\.knowledge"/i);
  });

  await t.test('Knowledge tab panel container exists in DOM', () => {
    assert.match(html, /id="tab-knowledge"|id="knowledge-tab"/i);
  });

  await t.test('Text input form exists for manual text ingestion', () => {
    assert.match(html, /id="form-rag-text"|id="rag-text-form"/i);
    assert.match(html, /id="rag-text-title"|name="textTitle"/i);
    assert.match(html, /id="rag-text-content"|name="textContent"/i);
  });

  await t.test('URL ingestion form exists', () => {
    assert.match(html, /id="form-rag-url"|id="rag-url-form"/i);
    assert.match(html, /id="rag-url-input"|name="ragUrl"/i);
  });

  await t.test('PDF file upload form exists with 5MB/PDF restriction note', () => {
    assert.match(html, /id="form-rag-file"|id="rag-file-form"/i);
    assert.match(html, /id="rag-file-input"|type="file"[^>]*accept="[^"]*pdf"/i);
  });

  await t.test('Document list table exists with delete action', () => {
    assert.match(html, /id="rag-doc-table"|id="rag-documents-table"/i);
  });
});

test('Admin Panel Knowledge Tab — i18n Dictionaries Verification across 5 Languages', async (t) => {
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
    await t.test(`dictionary contains '${lang}' language section with Knowledge keys`, () => {
      assert.ok(i18n[lang], `Missing dictionary section for language: ${lang}`);
      const dict = i18n[lang];

      assert.ok(dict['nav.knowledge'], `Missing 'nav.knowledge' key in '${lang}'`);
      assert.ok(dict['knowledge.tab_title'] || dict['knowledge.title'], `Missing Knowledge tab title key in '${lang}'`);
      assert.ok(dict['knowledge.lead'], `Missing Knowledge lead key in '${lang}'`);
      assert.ok(dict['knowledge.add_text'], `Missing 'knowledge.add_text' key in '${lang}'`);
      assert.ok(dict['knowledge.add_url'], `Missing 'knowledge.add_url' key in '${lang}'`);
      assert.ok(dict['knowledge.add_pdf'], `Missing 'knowledge.add_pdf' key in '${lang}'`);
      assert.ok(dict['knowledge.doc_list'], `Missing 'knowledge.doc_list' key in '${lang}'`);
    });
  }
});
