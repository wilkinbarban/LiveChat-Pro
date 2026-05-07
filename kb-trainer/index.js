#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { fetchSource } = require('./fetcher');
const { parseWithoutAI } = require('./parser');
const { callAI, PROVIDERS } = require('./ai-client');
const { validateEntries, mergeKnowledgeBase } = require('./validator');

function help() {
  const providerList = Object.entries(PROVIDERS)
    .map(([k, v]) => `    ${k.padEnd(12)} ${v.name}${v.noKeyRequired ? ' (no API key needed)' : ''}`)
    .join('\n');
  console.log(`LiveChat Pro Knowledge Base Trainer

Usage:
  node kb-trainer/index.js [options]

Options:
  --provider    AI provider to use (default: none)
  --key         API key for the chosen provider
  --model       Model override (each provider has a default)
  --base-url    Custom base URL (required for --provider custom, optional for ollama)
  --urls        Comma-separated URLs or local file paths
  --mode        append|replace  (default: append)
  --output      Path to knowledge-base.json  (default: data/knowledge-base.json)
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
  const args = { provider: 'none', mode: 'append', output: 'data/knowledge-base.json', lang: 'es', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--')) { const key = arg.slice(2); args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
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
  const outputPath = path.resolve(process.cwd(), args.output);
  let existing = {};
  if (args.mode === 'append' && fs.existsSync(outputPath)) existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const kb = mergeKnowledgeBase(existing, entries, { mode: args.mode, language: args.lang });

  if (args.dryRun) {
    console.log(JSON.stringify(kb, null, 2));
  } else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(kb, null, 2)}\n`);
    console.log(`✓ Wrote ${kb.entries.length} entries to ${path.relative(process.cwd(), outputPath)}`);
  }

  if (errors.length) {
    console.log('\nWarnings:');
    errors.forEach(e => console.log(`- ${e.source}: ${e.error}`));
    process.exitCode = 2;
  }
}

main().catch(error => { console.error(`Error: ${error.message}`); process.exit(1); });
