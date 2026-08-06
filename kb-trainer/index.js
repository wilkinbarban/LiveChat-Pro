#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { fetchSource } = require('./fetcher');
const { parseWithoutAI } = require('./parser');
const { callAI, PROVIDERS } = require('./ai-client');
const { validateEntries, mergeKnowledgeBase } = require('./validator');

const SCRIPTED_INPUT = !process.stdin.isTTY && process.argv.includes('--interactive')
  ? fs.readFileSync(0, 'utf8').split(/\r?\n/)
  : null;
let rl = SCRIPTED_INPUT ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

const PROVIDER_OPTIONS = [
  { key: '1', code: 'none', name: 'No AI - extract structure from content only (free, no key)' },
  { key: '2', code: 'openrouter', name: 'OpenRouter - free models available' },
  { key: '3', code: 'groq', name: 'Groq - ultra-fast, free tier' },
  { key: '4', code: 'gemini', name: 'Google Gemini - free quota' },
  { key: '5', code: 'openai', name: 'OpenAI - GPT models' },
  { key: '6', code: 'xai', name: 'xAI - Grok models' },
  { key: '7', code: 'anthropic', name: 'Anthropic - Claude models' },
  { key: '8', code: 'mistral', name: 'Mistral AI - Mistral models' },
  { key: '9', code: 'cohere', name: 'Cohere - Command models' },
  { key: '10', code: 'ollama', name: 'Ollama - local models (no key)' },
  { key: '11', code: 'custom', name: 'Custom - any OpenAI-compatible endpoint' },
];

const LANGUAGE_OPTIONS = [
  { key: '1', code: 'es', name: 'Spanish' },
  { key: '2', code: 'en', name: 'English' },
  { key: '3', code: 'pt', name: 'Portuguese' },
  { key: '4', code: 'fr', name: 'French' },
  { key: '5', code: 'de', name: 'German' },
  { key: '6', code: 'it', name: 'Italian' },
];

function help() {
  const providerList = Object.entries(PROVIDERS)
    .map(([k, v]) => `    ${k.padEnd(12)} ${v.name}${v.noKeyRequired ? ' (no API key needed)' : ''}`)
    .join('\n');
  console.log(`LiveChat Pro Knowledge Base Trainer

Usage:
  node kb-trainer/index.js [options]

Options:
  --interactive Run a guided prompt flow
  --provider    AI provider to use (default: none)
  --key         API key for the chosen provider
  --model       Model override (each provider has a default)
  --base-url    Custom base URL (required for --provider custom, optional for ollama)
  --urls        Comma-separated URLs or local file paths
  --mode        append|replace  (default: append)
  --output      Path to trainable knowledge-base.json  (default: kb-trainer/knowledge-base.json)
  --lang        Target language for questions (default: es)
  --dry-run     Print result without writing to file
  --help        Show this help

Providers:
  none         No AI — extract structure from content (free, no key)
${providerList}

Free-tier highlights:
  openrouter  meta-llama/llama-3.1-8b-instruct:free, google/gemma-3-12b-it:free
  groq        llama-3.1-8b-instant, mixtral-8x7b-32768 (very fast)
  gemini      gemini-1.5-flash (generous free quota)
  ollama      any local model (llama3, deepseek-r1, qwen2, mistral...)

Examples:
  node kb-trainer/index.js --interactive
  node kb-trainer/index.js --provider none --urls "README.md,docs/faq.md"
  node kb-trainer/index.js --provider openrouter --key sk-or-xxx --urls "https://site.com/faq"
  node kb-trainer/index.js --provider groq --key gsk_xxx --model llama-3.1-8b-instant --urls "https://site.com"
  node kb-trainer/index.js --provider xai --key xai-xxx --model grok-beta --urls "docs/manual.md"
  node kb-trainer/index.js --provider anthropic --key sk-ant-xxx --model claude-3-haiku-20240307 --urls "https://site.com"
  node kb-trainer/index.js --provider gemini --key AIzaXXX --model gemini-1.5-flash --urls "https://site.com"
  node kb-trainer/index.js --provider mistral --key xxx --urls "https://site.com"
  node kb-trainer/index.js --provider cohere --key xxx --urls "docs/manual.md"
  node kb-trainer/index.js --provider ollama --model llama3 --urls "docs/manual.md"
  node kb-trainer/index.js --provider custom --base-url http://localhost:1234/v1 --model my-model --urls "README.md"
  node kb-trainer/index.js --provider openrouter --key sk-or-xxx --urls "https://a.com,https://b.com,docs/c.md" --mode append --lang pt`);
}

function parseArgs(argv) {
  const args = { provider: 'none', mode: 'append', output: 'kb-trainer/knowledge-base.json', lang: 'es', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') args.help = true;
    else if (arg === '--interactive' || arg === '-i') args.interactive = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--')) { const key = arg.slice(2); args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]; }
  }
  return args;
}

const ask = question => {
  if (SCRIPTED_INPUT) {
    process.stdout.write(question);
    return Promise.resolve((SCRIPTED_INPUT.shift() || '').trim());
  }
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
};

async function choose(label, options, currentValue) {
  console.log(`\n${label}`);
  for (const option of options) {
    const marker = option.code === currentValue || option.value === currentValue ? '  <- current' : '';
    const value = option.value ? ` (${option.value})` : option.code ? ` (${option.code})` : '';
    console.log(`   [${option.key}] ${option.name}${value}${marker}`);
  }
  const answer = await ask('   Choose an option: ');
  return options.find(option => option.key === answer)
    || options.find(option => option.code === currentValue || option.value === currentValue)
    || options[0];
}

async function askRequired(label, current, validator, helpText) {
  while (true) {
    const suffix = current ? ` [${current}]` : '';
    const value = await ask(`${label}${suffix}: `) || current || '';
    if (!validator || validator(value)) return value;
    console.log(`  Invalid value. ${helpText}`);
  }
}

async function chooseYesNo(label, defaultValue = true) {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${label} [${hint}]: `)).toLowerCase();
  if (!answer) return defaultValue;
  return ['s', 'si', 'sí', 'y', 'yes'].includes(answer);
}

function maskSecret(value) {
  if (!value) return '';
  return `${String(value).slice(0, 8)}...`;
}

async function askSecret(label, current, validator, helpText) {
  while (true) {
    const suffix = current ? ` [${maskSecret(current)}]` : '';
    const value = await ask(`${label}${suffix}: `) || current || '';
    if (!validator || validator(value)) return value;
    console.log(`  Invalid value. ${helpText}`);
  }
}

function closeReadline() {
  if (rl) rl.close();
  rl = null;
}

function isLanguageMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    LANGUAGE_OPTIONS.some(option => Array.isArray(value[option.code]));
}

function mergeTrainableKnowledgeBase(existing, entries, { mode = 'append', language = 'es' } = {}) {
  const output = isLanguageMap(existing) ? { ...existing } : {};
  const current = mode === 'append'
    ? validateEntries(output[language] || existing?.entries || [], { warn: () => {} })
    : [];
  const byId = new Map(current.map(entry => [entry.id, entry]));
  for (const entry of validateEntries(entries)) byId.set(entry.id, entry);
  output[language] = [...byId.values()];
  return output;
}

function shouldWriteTrainableFormat(outputPath, existing) {
  const normalized = path.normalize(outputPath);
  return isLanguageMap(existing) || normalized.endsWith(path.normalize('kb-trainer/knowledge-base.json'));
}

async function interactiveArgs() {
  console.log('LiveChat Pro Knowledge Base Trainer');
  console.log('This assistant creates or updates the trainable KB. It must never edit fixed-entries.js; use kb-trainer/build.js to merge protected fixed entries with trainable entries for production.');

  const providerOption = await choose('AI provider for training', PROVIDER_OPTIONS, 'none');
  const provider = providerOption.code;
  const providerDef = PROVIDERS[provider];
  const noKeyProviders = ['none', 'ollama', 'custom'];
  let key = '';
  let model = '';
  let baseUrl = '';

  if (!noKeyProviders.includes(provider)) {
    key = await askSecret(`${providerDef.name} API key`, '', value => String(value).length > 8, 'API key is required for this provider.');
  }
  if (provider === 'custom') {
    baseUrl = await askRequired('Base URL', 'http://localhost:1234/v1', value => /^https?:\/\//i.test(value), 'Use a URL such as http://localhost:1234/v1.');
  } else if (provider === 'ollama') {
    baseUrl = await ask('Base URL [http://localhost:11434]: ') || '';
  }
  if (provider !== 'none') {
    const defaultModel = providerDef.defaultModel || '';
    model = await ask(`Model [${defaultModel}]: `) || defaultModel;
  }

  const languageOption = await choose('Target language for generated questions', LANGUAGE_OPTIONS, 'es');
  const modeOption = await choose('Write mode', [
    { key: '1', value: 'append', name: 'Append to existing knowledge base' },
    { key: '2', value: 'replace', name: 'Replace the existing knowledge base' },
  ], 'replace');
  const output = await askRequired('Output file', 'kb-trainer/knowledge-base.json', value => !!String(value).trim(), 'Output path cannot be empty.');
  const urls = await askRequired('URLs or local file paths (comma-separated)', '', value => !!String(value).trim(), 'Provide at least one URL or file path.');
  const dryRun = await chooseYesNo('Dry run only, without writing the file?', false);

  return {
    provider,
    key,
    model,
    baseUrl,
    urls,
    mode: modeOption.value,
    output,
    lang: languageOption.code,
    dryRun,
  };
}

async function runTrainer(args) {
  if (args.provider !== 'none' && !PROVIDERS[args.provider]) throw new Error(`Proveedor inválido: "${args.provider}". Usa --help para ver la lista.`);
  if (!['append', 'replace'].includes(args.mode)) throw new Error('Invalid --mode');
  const sources = String(args.urls || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!sources.length) { help(); throw new Error('Missing --urls'); }

  const fetched = [];
  const errors = [];
  for (const source of sources) {
    try {
      console.log(`→ Reading ${source}`);
      const item = await fetchSource(source);
      if (!item.content) throw new Error('Empty content');
      fetched.push(item);
      console.log(`  ✓ ${item.type}, ${item.content.length} chars`);
    } catch (error) {
      errors.push({ source, error: error.message });
      console.warn(`  ⚠ Failed: ${error.message}`);
    }
  }
  if (!fetched.length) throw new Error('No usable sources were loaded');

  let entries = [];
  if (args.provider === 'none') {
    entries = parseWithoutAI(fetched, args.lang);
  } else {
    const provDef = PROVIDERS[args.provider];
    console.log(`→ Generating entries with ${args.provider} / ${args.model || provDef.defaultModel}`);
    for (const item of fetched) {
      try {
        const result = await callAI({ provider: args.provider, key: args.key, model: args.model, baseUrl: args.baseUrl, content: item.content, source: item.source, lang: args.lang });
        entries.push(...(result.entries || []));
      } catch (error) {
        errors.push({ source: item.source, error: error.message });
        console.warn(`  ⚠ AI failed for ${item.source}: ${error.message}`);
        console.log('  → Falling back to structured extraction for this source');
        entries.push(...parseWithoutAI([item], args.lang));
      }
    }
  }

  entries = validateEntries(entries);
  // Training writes only the trainable KB. Protected entries live in fixed-entries.js
  // and are merged into production by kb-trainer/build.js.
  const outputPath = path.resolve(process.cwd(), args.output);
  let existing = {};
  if (fs.existsSync(outputPath)) existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const writeTrainable = shouldWriteTrainableFormat(outputPath, existing);
  const kb = writeTrainable
    ? mergeTrainableKnowledgeBase(existing, entries, { mode: args.mode, language: args.lang })
    : mergeKnowledgeBase(args.mode === 'append' ? existing : {}, entries, { mode: args.mode, language: args.lang });

  if (args.dryRun) {
    console.log(JSON.stringify(kb, null, 2));
  } else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(kb, null, 2)}\n`);
    const count = writeTrainable ? (kb[args.lang] || []).length : kb.entries.length;
    console.log(`✓ Wrote ${count} entries to ${path.relative(process.cwd(), outputPath)}`);
  }

  if (errors.length) {
    console.log('\nWarnings:');
    errors.forEach(e => console.log(`- ${e.source}: ${e.error}`));
    process.exitCode = 2;
  }
}

async function main() {
  let args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (args.interactive) args = await interactiveArgs();
  return runTrainer(args);
}

main()
  .then(closeReadline)
  .catch(error => {
    closeReadline();
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
