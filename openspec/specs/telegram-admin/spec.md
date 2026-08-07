# Spec for telegram-admin

Admin panel module to manage the Telegram bot (status, start/stop, admin ID) at runtime. The bot token stays env-bootstrap and is NOT managed in the UI.

## Requirements

### Requirement: Telegram Status and Control Module

The system MUST provide an admin UI module showing Telegram bot status (running/stopped/not-configured) and controls to start and stop the bot at runtime. The admin ID SHALL be viewable and editable via the module. The token MUST remain env-configured and MUST NOT be displayed or editable in the UI.

#### Scenario: View status and stop the bot

- GIVEN an authenticated admin and a running Telegram bot
- WHEN the admin opens the Telegram module and clicks "Stop"
- THEN the bot SHALL stop polling within the module's reported status
- AND visitor chat, sockets, and the admin panel MUST keep working

#### Scenario: Start a stopped bot

- GIVEN the Telegram bot stopped and a valid `TELEGRAM_TOKEN` in env
- WHEN the admin clicks "Start"
- THEN the bot SHALL launch and report running status

#### Scenario: Update admin ID

- GIVEN an authenticated admin
- WHEN the admin saves a new numeric Telegram admin ID
- THEN subsequent admin-only Telegram commands SHALL authorize against the new ID
- AND an invalid (non-numeric) ID MUST be rejected with a validation error

### Requirement: Boot Without Telegram Token

The application MUST boot successfully when `TELEGRAM_TOKEN` is absent, with the Telegram bot disabled and reported as not-configured. Boot MUST NOT hard-fail on the missing token.

#### Scenario: Boot with no token

- GIVEN an environment without `TELEGRAM_TOKEN`
- WHEN the server starts
- THEN the server SHALL listen and serve chat/admin normally
- AND the Telegram module SHALL report "not configured"

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
