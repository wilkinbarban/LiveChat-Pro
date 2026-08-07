'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminHtmlPath = path.join(__dirname, '..', 'public', 'admin.html');
const adminHtmlContent = fs.readFileSync(adminHtmlPath, 'utf8');

test('admin.html includes Theme/Appearance tab button and panel container', () => {
  assert.ok(adminHtmlContent.includes('data-tab="theme"'), 'admin.html missing theme tab button');
  assert.ok(adminHtmlContent.includes('id="tab-theme"'), 'admin.html missing tab-theme pane section');
  assert.ok(adminHtmlContent.includes('data-i18n="nav.theme"'), 'admin.html missing nav.theme i18n key on tab button');
});

test('admin.html includes preview cards and theme controls for preset catalog', () => {
  const presets = ['auto', 'classic', 'light-aurora', 'light-mint', 'dark-midnight', 'dark-ember'];

  for (const preset of presets) {
    assert.ok(
      adminHtmlContent.includes(`data-theme="${preset}"`) || adminHtmlContent.includes(`value="${preset}"`),
      `admin.html missing option or card for theme preset: ${preset}`
    );
  }
});

test('admin.html i18n dictionaries include all theme strings across 5 languages', () => {
  const languages = ['es', 'en', 'pt', 'fr', 'de'];
  const requiredKeys = ['nav.theme', 'theme.title', 'theme.save'];

  for (const lang of languages) {
    const langDictMatch = adminHtmlContent.match(new RegExp(`${lang}:\\s*\\{([\\s\\S]*?)\\}(?:,|\\n|\\r)`));
    assert.ok(langDictMatch, `Missing dictionary for language: ${lang}`);
    const dictText = langDictMatch[1];

    for (const key of requiredKeys) {
      assert.ok(
        dictText.includes(`'${key}'`) || dictText.includes(`"${key}"`) || dictText.includes(`${key}:`),
        `Language '${lang}' missing dictionary key: '${key}'`
      );
    }
  }
});
