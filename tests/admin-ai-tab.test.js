'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ADMIN_HTML_PATH = path.join(__dirname, '..', 'public', 'admin.html');

test('Admin Panel AI Tab — HTML Structure and Component Verification', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  await t.test('admin.html contains tabbed navigation structure (ADR-8)', () => {
    assert.match(html, /class="[^"]*nav-tabs[^"]*"|class="[^"]*tab-bar[^"]*"|data-tab=/i);
    assert.match(html, /data-tab="ai"|id="tab-ai"|href="#ai"/i);
  });

  await t.test('AI tab panel exists in DOM', () => {
    assert.match(html, /id="tab-ai"|id="ai-tab"|class="[^"]*tab-pane[^"]*"[^>]*id="ai"/i);
  });

  await t.test('provider select dropdown includes all 6 supported providers', () => {
    const providers = ['openai', 'anthropic', 'openrouter', 'deepseek', 'kimi', 'qwen'];
    for (const provider of providers) {
      assert.match(
        html,
        new RegExp(`<option[^>]*value="${provider}"`, 'i'),
        `Missing provider option: ${provider}`
      );
    }
  });

  await t.test('API key field and connection test button exist', () => {
    assert.match(html, /id="llm-api-key"|name="apiKey"|id="ai-api-key"/i);
    assert.match(html, /id="btn-verify-llm"|id="btn-test-llm"|onclick="[^"]*verifyKey/i);
  });

  await t.test('global bot on/off toggle exists', () => {
    assert.match(html, /id="ai-global-toggle"|id="llm-enabled"|name="aiEnabled"/i);
  });

  await t.test('default model selection input exists', () => {
    assert.match(html, /id="llm-model"|id="ai-model"|name="model"/i);
  });
});

test('Admin Panel AI Tab — i18n Dictionaries Verification across 5 Languages', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  // Extract translation dictionary script from HTML
  const dictMatch = html.match(/const\s+i18n\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(dictMatch, 'Translation dictionary object (const i18n = {...}) not found in admin.html');

  let i18n;
  try {
    // Evaluate dictionary object safely
    // biome-ignore lint/security/noGlobalEval: test helper parses embedded dictionary object
    i18n = eval(`(${dictMatch[1]})`);
  } catch (err) {
    assert.fail(`Failed to parse i18n object from admin.html: ${err.message}`);
  }

  const requiredLangs = ['es', 'en', 'pt', 'fr', 'de'];
  for (const lang of requiredLangs) {
    await t.test(`dictionary contains '${lang}' language section with AI keys`, () => {
      assert.ok(i18n[lang], `Missing dictionary section for language: ${lang}`);
      const dict = i18n[lang];

      // Essential AI keys
      assert.ok(dict['ai.tab_title'] || dict['ai.title'] || dict['nav.ai'], `Missing AI tab title key in '${lang}'`);
      assert.ok(dict['ai.provider'] || dict['llm.provider'], `Missing AI provider key in '${lang}'`);
      assert.ok(dict['ai.api_key'] || dict['llm.api_key'], `Missing AI API key label in '${lang}'`);
      assert.ok(dict['ai.verify_key'] || dict['llm.test_connection'] || dict['ai.test_connection'], `Missing test/verify key button text in '${lang}'`);
      assert.ok(dict['ai.enable_bot'] || dict['llm.global_enable'] || dict['ai.global_toggle'], `Missing global enable toggle key in '${lang}'`);
    });
  }
});
