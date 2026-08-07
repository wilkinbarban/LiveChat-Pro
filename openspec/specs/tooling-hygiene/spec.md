# Spec for tooling-hygiene

Test coverage completeness, Node version alignment, lint/format tooling, installer minimization, and dead-code removal. This capability lands FIRST to de-risk the rest of the change.

## Requirements

### Requirement: Complete Test Suite in npm test

`npm test` MUST run all 11 test files, including `tests/telegram-routing.test.js` and `tests/translation-cache.test.js` (currently omitted).

#### Scenario: Full suite green

- GIVEN a clean checkout on a supported Node version
- WHEN `npm test` runs
- THEN all 11 test files SHALL execute
- AND the run MUST fail if any file is dropped from the script

### Requirement: Consistent Node Version Story

`package.json` engines MUST declare `node >=22`; CI MUST test the matrix `[22, 24]`; the Dockerfile MUST use `node:24`. These three MUST NOT contradict each other.

#### Scenario: Engine check passes on Node 22

- GIVEN Node v22.x installed
- WHEN `npm install` runs
- THEN no EBADENGINE error SHALL occur
- AND `npm test` SHALL pass (including `node:sqlite` usage)

### Requirement: Biome Lint and Format

The project MUST use Biome as the single linter/formatter, with `lint` and `format` npm scripts and a committed configuration compatible with the CommonJS/no-build codebase.

#### Scenario: Lint gate

- GIVEN a source file with a lint violation
- WHEN the lint script runs
- THEN it MUST report the violation and exit non-zero
- AND `format` SHALL auto-fix formatting without changing semantics

### Requirement: Installer Minimization

`setup.js` and `.env.example` MUST remove obsolete env keys (`OPENAI_*`, `BOT_*`, `WIDGET_*` moved to admin settings) while keeping bootstrap secrets (Telegram token/admin ID, admin password, server/security/Redis keys). Re-running the installer on an old `.env` MUST remain safe.

#### Scenario: Re-run on legacy .env

- GIVEN an existing `.env` containing obsolete `OPENAI_API_KEY` and `BOT_MODE`
- WHEN `setup.js` re-runs
- THEN it SHALL complete without error
- AND MUST NOT resurrect obsolete keys as required questions
- AND MUST preserve still-valid existing values

### Requirement: Dead-Code Removal

The change MUST remove: `kb-trainer/` (after KB migration), `scratch/`, `HELP_TOPICS` personal content, the duplicated `resolveTelegramReplySessionId` resolver (one canonical implementation), and the dead `knowledge-base.json.example` reference in `setup.js`.

#### Scenario: No references to removed code

- GIVEN the removal is complete
- WHEN the test suite and server boot run
- THEN no import/require of `kb-trainer`, `scratch/`, or the duplicate resolver SHALL remain
- AND all tests MUST pass

### Requirement: Docker Rebuild as Final Task

The Dockerfile and docker-compose MUST be rebuilt to reflect the final state (no `kb-trainer` COPY, node:24, minimized env). This task SHALL be executed LAST, after all other tasks complete.

#### Scenario: Image builds clean

- GIVEN all other tasks done
- WHEN the Docker image is built
- THEN the build SHALL succeed without kb-trainer references
- AND the container SHALL boot with only bootstrap env secrets
