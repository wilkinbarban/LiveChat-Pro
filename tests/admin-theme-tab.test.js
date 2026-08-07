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

test('admin.html renders preset cards dynamically from the theme payload', () => {
  // String-content renderer contract (no DOM): the Appearance tab MUST render
  // one card per preset from the GET /api/admin/settings/theme payload via a
  // render function over the name-keyed presets map — never static markup.
  assert.ok(
    adminHtmlContent.includes('function renderPresetCards(') || adminHtmlContent.includes('const renderPresetCards'),
    'admin.html missing renderPresetCards renderer function'
  );
  assert.ok(
    adminHtmlContent.includes('Object.entries(presets'),
    'admin.html renderPresetCards must iterate the name-keyed presets payload'
  );
  assert.ok(
    adminHtmlContent.includes("radio.name = 'theme-preset'"),
    'admin.html renderPresetCards must build one radio named theme-preset per preset'
  );
  assert.ok(
    adminHtmlContent.includes('radio.value = name'),
    'admin.html renderPresetCards must set each radio value to the preset name'
  );
  assert.ok(
    adminHtmlContent.includes("setProperty('--lcp-"),
    'admin.html thumbnails must apply preset vars as --lcp-* inline custom properties'
  );
  assert.ok(
    adminHtmlContent.includes('theme-preview--auto'),
    'admin.html must render a neutral placeholder preview for the auto preset'
  );
  assert.ok(
    adminHtmlContent.includes('preset.label'),
    'admin.html label fallback must use preset.label when the i18n key is missing'
  );
});

test('admin.html no longer ships static preset card markup', () => {
  const staticPresets = ['auto', 'classic', 'light-aurora', 'light-mint', 'dark-midnight', 'dark-ember'];
  for (const preset of staticPresets) {
    assert.ok(
      !adminHtmlContent.includes(`data-theme="${preset}"`),
      `admin.html still contains static data-theme card markup for: ${preset}`
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
