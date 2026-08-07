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
  const requiredKeys = [
    'nav.theme',
    'theme.title',
    'theme.save',
    // All 16 catalog presets (6 original + 10 expanded)
    'theme.auto',
    'theme.classic',
    'theme.light_aurora',
    'theme.light_mint',
    'theme.dark_midnight',
    'theme.dark_ember',
    'theme.light_sunrise',
    'theme.light_sky',
    'theme.dark_ocean',
    'theme.dark_forest',
    'theme.mono_light',
    'theme.mono_dark',
    'theme.green_chat',
    'theme.sky_chat',
    'theme.gradient_vibrant',
    'theme.ink',
    // Thumbnail caption label
    'theme.preview',
  ];

  // Extract the translation dictionary object from admin.html
  const dictMatch = adminHtmlContent.match(/const\s+i18n\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(dictMatch, 'Translation dictionary object (const i18n = {...}) not found in admin.html');

  let i18n;
  try {
    // Evaluate dictionary object safely
    // biome-ignore lint/security/noGlobalEval: test helper parses embedded dictionary object
    i18n = eval(`(${dictMatch[1]})`);
  } catch (err) {
    assert.fail(`Failed to parse i18n object from admin.html: ${err.message}`);
  }

  for (const lang of languages) {
    assert.ok(i18n[lang], `Missing dictionary section for language: ${lang}`);
    const dict = i18n[lang];

    for (const key of requiredKeys) {
      assert.ok(dict[key], `Language '${lang}' missing dictionary key: '${key}'`);

      // French entries must follow the U+2019 apostrophe convention (no straight quotes)
      if (lang === 'fr') {
        assert.doesNotMatch(dict[key], /'/, `fr '${key}' must use U+2019 apostrophe, not ASCII`);
      }
    }
  }
});
