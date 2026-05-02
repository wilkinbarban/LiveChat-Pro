# Contributing

This is an educational project. Contributions should keep the documentation clear, avoid committing secrets, and preserve the self-hosted deployment flow.

## Local Workflow

```bash
npm install
npm test
```

Before opening a pull request:

- Do not commit `.env`, databases, uploaded files or generated logs.
- Keep changes focused and documented.
- Update the relevant README files when behavior, setup or public configuration changes.
- Run `npm test` and include any relevant notes in the pull request.

## Pull Requests

Use the pull request template in `.github/pull_request_template.md`. Describe what changed, how it was tested and whether deployment variables or Docker/Nginx configuration changed.
