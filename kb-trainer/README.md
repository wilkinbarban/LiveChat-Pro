# LiveChat Pro KB Trainer

`kb-trainer` builds or updates `data/knowledge-base.json` from URLs and local files. It works without AI using structured extraction, or with OpenRouter, OpenAI, or Ollama for richer questions and keyword variants.

## Requirements

- Node.js 18+ (`fetch` is native). LiveChat Pro recommends Node.js 24+.
- No extra npm packages.
- Optional: OpenRouter/OpenAI API key, or Ollama running locally.

## Basic usage without AI

```bash
node kb-trainer/index.js --provider none --urls "README.md,docs/manual.md" --mode append --lang es
```

## With OpenRouter

```bash
node kb-trainer/index.js --provider openrouter --key sk-or-xxx --model meta-llama/llama-3.1-8b-instruct:free --urls "https://example.com/faq,README.md"
```

## With OpenAI

```bash
node kb-trainer/index.js --provider openai --key sk-xxx --model gpt-4o-mini --urls "docs/faq.md" --mode replace
```

## With Ollama

```bash
ollama serve
ollama pull llama3
node kb-trainer/index.js --provider ollama --model llama3 --urls "docs/manual.md"
```

## CLI options

- `--provider openrouter|openai|ollama|none` default `none`
- `--key` API key for OpenRouter/OpenAI
- `--model` model name; defaults per provider
- `--urls` comma-separated URLs or file paths
- `--mode append|replace` default `append`
- `--output` default `data/knowledge-base.json`
- `--lang` target language for questions/keywords, default `es`
- `--dry-run` prints JSON without writing
- `--help` shows help

## Knowledge base format

The trainer preserves the LiveChat Pro format:

```json
{
  "version": "2.0",
  "language": "es",
  "fallback": "...",
  "entries": [
    {
      "id": "unique-id",
      "keywords": ["precio", "plan"],
      "question": "¿Cuánto cuesta?",
      "answer": "Respuesta breve.",
      "source": "README.md",
      "category": "precios y pagos"
    }
  ]
}
```

## Learned categories

Business info, hours, contact, products/services, technology, prices/payments, support issues, security/privacy, installation, natural human questions, documentation, commercial value, AI/training, question variations, and project-specific details.

## Tips

Use clean docs with headings, include pricing/contact/setup pages, prefer `replace` for first training and `append` for updates, and run `--dry-run` before overwriting important data.
