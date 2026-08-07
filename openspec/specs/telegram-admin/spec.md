# Spec for telegram-admin

Admin panel module to manage the Telegram bot (status, start/stop, admin ID, token) at runtime. The bot token is settings-backed (UI-managed, encrypted) with env bootstrap/fallback.

## Requirements

### Requirement: Telegram Status and Control Module

The system MUST provide an admin UI module showing Telegram bot status (running/stopped/not-configured) with start/stop controls. The admin ID SHALL be viewable and editable; the admin username SHALL be stored as metadata. The bot token SHALL be UI-managed (settings-backed, encrypted). Status MUST surface `botUsername`, `botFirstName`, `maskedToken`, `tokenSource`, `adminUsername`; `token`/`botToken` MUST NOT be used.
(Previously: token env-only.)

#### Scenario: View status and stop the bot

- GIVEN an authenticated admin and a running bot
- WHEN the admin opens the Telegram module and clicks "Stop"
- THEN the bot SHALL stop polling within the module's status
- AND visitor chat, sockets, and the admin panel MUST keep working

#### Scenario: Start a stopped bot

- GIVEN the bot stopped and a valid token (settings-backed or env)
- WHEN the admin clicks "Start"
- THEN the bot SHALL launch and report running status

#### Scenario: Update admin ID

- GIVEN an authenticated admin
- WHEN the admin saves a new admin ID
- THEN admin-only commands SHALL authorize against the new ID
- AND a non-numeric ID MUST be rejected with a validation error

#### Scenario: Identity surfaced

- GIVEN a configured bot, authenticated admin
- WHEN the admin opens the module status
- THEN the module SHALL display `botUsername`, `botFirstName`, `maskedToken`, `tokenSource`, `adminUsername`
- AND the token SHALL NOT appear in full (`token`/`botToken` undefined)

### Requirement: Boot Without Telegram Token

The application MUST boot without a token, reporting the bot as not-configured. The effective token MUST resolve settings-backed (decrypted), then env `TELEGRAM_TOKEN`, then none, after DB init. Boot MUST NOT hard-fail on a missing or undecryptable token; decryption failure SHALL fall back to env, warning.
(Previously: env-only token used raw.)

#### Scenario: Boot with no token

- GIVEN no `TELEGRAM_TOKEN` and no settings-backed token
- WHEN the server starts
- THEN the server SHALL listen and serve chat/admin normally
- AND the Telegram module SHALL report "not configured"

#### Scenario: Boot with quoted token

- GIVEN `.env` sets a quoted `TELEGRAM_TOKEN`
- WHEN the server starts
- THEN the token SHALL be stripped and trimmed
- AND the bot SHALL start, no Telegram API 404, `telegramReady: true`

#### Scenario: Boot with undecryptable stored token

- GIVEN a stored token failing decryption and a valid `TELEGRAM_TOKEN`
- WHEN the server starts
- THEN the bot SHALL launch with the env token, warning, NOT crash

#### Scenario: Boot without live identity check

- GIVEN a Telegram client lacking `getMe` (FakeTelegraf)
- WHEN the server launches the bot
- THEN boot SHALL succeed without `getMe`
- AND identity fields SHALL populate via lazy lookup

### Requirement: Reply Routing and Translation Preserved

Telegram reply routing (message_id ↔ session mapping, pending-reply fallback) and the Spanish translation pipeline (visitor text translated to admin language; admin replies translated to visitor language) MUST behave exactly as before this change.

#### Scenario: Admin reply reaches the visitor translated

- GIVEN a visitor writing in Spanish and `ADMIN_LANGUAGE=en`
- WHEN the admin replies from Telegram
- THEN the reply SHALL be routed to the correct session via the existing mapping
- AND SHALL be delivered to the visitor translated into Spanish, as today

#### Scenario: Auto-silence on human reply preserved

- GIVEN a session with the bot active
- WHEN a human admin replies from Telegram
- THEN the session bot SHALL be auto-silenced exactly as the current behavior

### Requirement: Settings-Backed Token Storage and Verification

An authenticated admin MUST be able to save the bot token from the UI. The token SHALL be verified via live `getMe` BEFORE persisting; invalid (401/404) tokens MUST be rejected, NOT stored. A valid token SHALL be stored AES-256-GCM encrypted, never plaintext or in full (masked `…last4`). An empty save SHALL clear the stored token (env fallback). A saved token SHALL apply at runtime without restart. Token mutations MUST require an authenticated session and CSRF.

#### Scenario: Valid token saves live

- GIVEN the bot on the env token
- WHEN the admin saves a valid token
- THEN the token SHALL pass live `getMe` and store encrypted
- AND the bot SHALL use the new token, no restart

#### Scenario: Invalid token rejected

- GIVEN an authenticated admin
- WHEN the admin saves a token failing `getMe`
- THEN the save SHALL be rejected with an error
- AND the active token SHALL remain

#### Scenario: Empty token clears storage

- GIVEN a settings-backed token active
- WHEN the admin saves an empty token
- THEN the stored token SHALL be removed
- AND the bot SHALL fall back to env or stop if none
