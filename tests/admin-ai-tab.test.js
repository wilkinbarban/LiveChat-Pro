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

  await t.test('default model selection input is a disabled select dropdown initially (spec requirement)', () => {
    assert.match(html, /<select[^>]*id="llm-model"[^>]*disabled/i);
  });

  await t.test('admin.html JS updates provider fields with dynamic select options and enables dropdown before key verification', () => {
    assert.match(html, /function\s+populateModelDropdown/);
    assert.match(html, /updateProviderFields/);
    assert.match(html, /llmModelInput\.disabled\s*=\s*\(?models\.length\s*===\s*0\)?/);
    assert.match(html, /verify-key/);
    assert.match(html, /populateModelDropdown\(verifyRes\.models/);
  });

  await t.test('admin.html JS btnVerifyLlm resolves empty model selection to catalog default prior to verify-key payload', () => {
    assert.match(html, /btnVerifyLlm/);
    assert.match(html, /verifyPayload/);
    assert.match(html, /catalogModels|models\[0\]/);
  });

  await t.test('AI Management Dashboard containers and CSS classes exist in admin.html (ADR / Design)', () => {
    assert.match(html, /\.ai-summary-card/, 'Missing .ai-summary-card CSS class');
    assert.match(html, /\.provider-grid/, 'Missing .provider-grid CSS class');
    assert.match(html, /\.provider-card/, 'Missing .provider-card CSS class');
    assert.match(html, /\.badge-status/, 'Missing .badge-status CSS class');
    assert.match(html, /\.badge-default/, 'Missing .badge-default CSS class');
    assert.match(html, /\.modal-overlay/, 'Missing .modal-overlay CSS class');

    assert.match(html, /id="ai-summary-header"|class="[^"]*ai-summary-card[^"]*"/, 'Missing AI summary header container');
    assert.match(html, /id="ai-provider-grid"|class="[^"]*provider-grid[^"]*"/, 'Missing AI provider cards grid container');
    assert.match(html, /id="ai-modal-overlay"|class="[^"]*modal-overlay[^"]*"/, 'Missing AI provider editor modal drawer');
    assert.match(html, /id="btn-save-model-only"|id="btn-modal-save-model"/, 'Missing Guardar Modelo button in editor modal');
  });

  await t.test('admin.html JS controller manages llmState, renders 6 provider cards, and handles 1-click default switch', () => {
    assert.match(html, /let\s+llmState|const\s+llmState/, 'Missing llmState object');
    assert.match(html, /function\s+renderProviderCards|const\s+renderProviderCards\s*=/, 'Missing renderProviderCards function');
    assert.match(html, /function\s+setDefaultProvider|function\s+setAsDefault|api\(['"]\/api\/admin\/llm\/default['"]/, 'Missing 1-click setDefaultProvider handler');
    assert.match(html, /renderSummaryHeader/, 'Missing renderSummaryHeader function');
  });

  await t.test('admin.html JS controller handles provider modal editor, masked API keys, verify-key, and save-model without verification', () => {
    assert.match(html, /function\s+openProviderModal|const\s+openProviderModal\s*=/, 'Missing openProviderModal function');
    assert.match(html, /btnModalSaveModel\.addEventListener\(['"]click['"]|function\s+handleSaveModel/, 'Missing Save Model click handler binding');
    assert.match(html, /\/api\/admin\/settings\/llm\/providers\//, 'Missing PUT /providers/:name API call');
    assert.match(html, /closeProviderModal/, 'Missing closeProviderModal helper');
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

      // 5-Language AI Dashboard Keys (specs / design)
      assert.ok(dict['ai.header.title'], `Missing 'ai.header.title' in '${lang}'`);
      assert.ok(dict['ai.header.status_on'], `Missing 'ai.header.status_on' in '${lang}'`);
      assert.ok(dict['ai.header.status_off'], `Missing 'ai.header.status_off' in '${lang}'`);
      assert.ok(dict['ai.header.active_badge'], `Missing 'ai.header.active_badge' in '${lang}'`);
      assert.ok(dict['ai.card.configured'], `Missing 'ai.card.configured' in '${lang}'`);
      assert.ok(dict['ai.card.unconfigured'], `Missing 'ai.card.unconfigured' in '${lang}'`);
      assert.ok(dict['ai.card.principal'], `Missing 'ai.card.principal' in '${lang}'`);
      assert.ok(dict['ai.card.set_default'], `Missing 'ai.card.set_default' in '${lang}'`);
      assert.ok(dict['ai.card.edit'], `Missing 'ai.card.edit' in '${lang}'`);
      assert.ok(dict['ai.modal.title'], `Missing 'ai.modal.title' in '${lang}'`);
      assert.ok(dict['ai.modal.api_key'], `Missing 'ai.modal.api_key' in '${lang}'`);
      assert.ok(dict['ai.modal.model'], `Missing 'ai.modal.model' in '${lang}'`);
      assert.ok(dict['ai.modal.verify_connection'], `Missing 'ai.modal.verify_connection' in '${lang}'`);
      assert.ok(dict['ai.modal.save_and_close'], `Missing 'ai.modal.save_and_close' in '${lang}'`);
      assert.ok(dict['ai.modal.model_list_title'], `Missing 'ai.modal.model_list_title' in '${lang}'`);
      assert.ok(dict['ai.modal.no_models'], `Missing 'ai.modal.no_models' in '${lang}'`);
      assert.ok(dict['ai.modal.save_model'], `Missing 'ai.modal.save_model' in '${lang}'`);
      assert.ok(dict['ai.modal.close'], `Missing 'ai.modal.close' in '${lang}'`);

      // French entries must follow the U+2019 apostrophe convention (no straight quotes)
      if (lang === 'fr') {
        for (const key of ['ai.modal.verify_connection', 'ai.modal.save_and_close', 'ai.modal.model_list_title', 'ai.modal.no_models']) {
          assert.doesNotMatch(dict[key], /'/, `fr '${key}' must use U+2019 apostrophe, not ASCII`);
        }
      }
    });
  }
});

test('Admin Panel AI Tab — Two-step Modal UX (verify-only, save-close, gating)', async (t) => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  await t.test('modal exposes Guardar y Cerrar button id #btn-modal-save-close', () => {
    assert.match(html, /id="btn-modal-save-close"/, 'Missing Guardar y Cerrar button');
  });

  await t.test('verify-only handler lists models without persisting or closing (two-step modal)', () => {
    const verifyBlock = html.match(/if \(btnVerifyLlm\) \{([\s\S]*?)hideLoading\(\);\n\s*\}\s*\}\);\s*\}/);
    assert.ok(verifyBlock, 'verify handler block not found');
    const verifyBody = verifyBlock[1];
    assert.match(verifyBody, /verify-key/, 'verify handler must POST /verify-key');
    assert.match(verifyBody, /method:\s*'POST'/, 'verify handler must use POST');
    assert.match(verifyBody, /populateModelDropdown\(verifyRes\.models/, 'verify handler must populate #llm-model from response');
    assert.doesNotMatch(verifyBody, /\/api\/admin\/settings\/llm\/providers\//, 'verify-only handler MUST NOT persist via PUT');
    assert.doesNotMatch(verifyBody, /closeProviderModal/, 'verify-only handler MUST NOT close the modal');
  });

  await t.test('save-close handler persists provider, closes modal, and reloads grid', () => {
    const saveCloseBlock = html.match(/handleSaveAndClose\s*=\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/);
    assert.ok(saveCloseBlock, 'save-close handler block not found');
    const body = saveCloseBlock[1];
    assert.match(body, /\/api\/admin\/settings\/llm\/providers\//, 'save-close must PUT /providers/:name');
    assert.match(body, /method:\s*'PUT'/, 'save-close must use PUT');
    assert.match(body, /closeProviderModal\(\)/, 'save-close must close the modal');
    assert.match(body, /loadLlmSettings\(\)/, 'save-close must reload the provider grid');
  });

  await t.test('modalVerified flag gates Guardar y Cerrar and resets on open and key change', () => {
    assert.match(html, /modalVerified/, 'Missing modalVerified session flag');
    assert.match(html, /modalVerified\s*=\s*true/, 'verify success must set modalVerified');
    assert.match(html, /btnModalSaveClose\.disabled/, 'save-close gating must toggle disabled');
  });

  await t.test('populateModelDropdown sorts and caps OpenRouter list to ~50', () => {
    assert.match(html, /localeCompare/, 'model list must sort locale-aware');
    assert.match(html, /\.slice\(0,\s*50\)/, 'OpenRouter list must cap at 50');
    assert.match(html, /openrouter/, 'cap must apply to openrouter provider');
  });
});
