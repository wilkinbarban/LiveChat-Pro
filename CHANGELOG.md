# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.3] - 2026-05-28

### Added
- **`Install.sh`**: Native dependency installer script for Linux (supporting Debian/Ubuntu, CentOS/RHEL/Rocky/AlmaLinux, Fedora, Arch, and Alpine). It runs package installation silently in the background, writing to `install.log`, with a clean colored text spinner animation.
- **`Install.ps1`**: Native dependency installer script for Windows PowerShell. It verifies Node.js >= 24, downloads and installs Node MSI silently if needed, runs `npm install` in the background with a visual text spinner, and launches the configuration wizard.

### Changed
- **`setup.js`**: Refactored the configuration wizard to focus exclusively on `.env` variables setup and server launching.
  - Added support to query and configure all 43 parameters detailed in `.env.example`.
  - Added multi-language support (English/Spanish) for the setup prompts.
  - Implemented non-TTY/scripted input compatibility for automated setups (tests/CI pipelines).
  - Dynamically detects the host OS at completion to offer starting with Docker Compose (Linux) or Node.js (Windows).
  - Removed all system checks, npm updates, package installations, and firewall updates.
- **Documentation**: Updated the installation guides in `README.md`, `README_ES.md`, and `README_BR.md` to recommend the new `Install.sh` and `Install.ps1` native entrypoints.
- Bumped version in `package.json` to `1.0.3`.

---

## [1.0.2] - 2026-05-06

### Added
- **`kb-trainer/`**: A standalone CLI tool to build `data/knowledge-base.json` from URLs and local files (e.g. Markdown).
- Supported 10 AI providers plus `none` for knowledge-base training: OpenRouter, Groq, Gemini, OpenAI, xAI, Anthropic, Mistral, Cohere, Ollama, and OpenAI-compatible custom endpoints.
- Multilingual self-knowledge entries for all 6 supported languages in the knowledge base.
- Setup integration to execute `kb-trainer` dynamically when configuring the `knowledge-base` bot mode.

### Changed
- Improved fuzzy matching for the smart bot utilizing the Dice coefficient and Spanish stemming.
- Added typewriter typing effect and role emojis to widget messages.
- Protected proper nouns from translation using placeholder injection.
- Rewrote `.env.example` in English with complete inline documentation for every variable.

### Fixed
- Sanitizer fallbacks and bot session context persistence bugs.
- Node.js package conflicts on Fedora.
- Sockets and cluster presence snapshots.

---

## [1.0.1] - 2026-04-18

### Changed
- Improved the local installer flow in `setup.js`.
- Automated npm upgrades during setup.
- Separated local background server startup scripts.

### Fixed
- Docker setup and Telegram typing indicators.
- Local background shell launcher paths.

---

## [1.0.0] - 2026-04-01

### Added
- Initial release of LiveChat Pro.
- Self-hosted live chat widget with persistent visitor sessions.
- Two-way Telegram bot integration for administrators to chat.
- Single admin panel interface at `/admin`.
- SQLite backend for database persistence and optional Redis cache for multi-node deployments.
- Message translation cache and sentiment analysis.
