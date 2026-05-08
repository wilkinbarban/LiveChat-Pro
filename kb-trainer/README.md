# LiveChat Pro KB Trainer

`kb-trainer` builds or updates `data/knowledge-base.json` from URLs and local files. It works without AI using structured extraction, or with OpenRouter, OpenAI, Ollama and other providers for richer questions and keyword variants.

## Requirements

- Node.js 18+ (`fetch` is native). LiveChat Pro recommends Node.js 24+.
- No extra npm packages.
- Optional: OpenRouter/OpenAI API key, or Ollama running locally.

## Basic usage without AI

```bash
node kb-trainer/index.js --provider none --urls "README.md,docs/manual.md" --mode append --lang es
```

## Interactive mode

Use the guided assistant if you prefer the same option flow shown by `setup.js`:

```bash
node kb-trainer/index.js --interactive
```

The assistant asks for the AI provider, API key when needed, model, language, write mode, output file, source URLs/files and dry-run preference. The classic flag-based usage remains available.

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

- `--interactive`, `-i` starts the guided assistant
- `--provider openrouter|groq|gemini|openai|xai|anthropic|mistral|cohere|ollama|custom|none` default `none`
- `--key` API key for providers that need one
- `--model` model name; defaults per provider
- `--base-url` custom base URL for `custom`, optional for `ollama`
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
