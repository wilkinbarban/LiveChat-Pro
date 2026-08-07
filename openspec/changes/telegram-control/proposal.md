# Proposal: Telegram Control — Token & Admin Fields in the Admin UI, 404 Fix

## Intent

The user (Spanish request) wants to control the Telegram bot token, bot identity, and admin user from the admin panel, and wants the detected Telegram problems fixed. Exploration confirmed the bot never starts: `setup.js` JSON-quotes every `.env` value, and `src/config/index.js` L80 reads `TELEGRAM_TOKEN` raw, so Telegraf gets `"8609135566:AAEG…"` with literal quotes → Telegram API 404 → `/health` `telegramReady:false`. The token itself is valid (getMe: ChatVivo_Wilkin_bot / LiveChat Pro / id 8609135566); the admin user is @WilkinBR / 7051275102. Goal: full runtime control of these fields in the Telegram admin module plus the fixes below.

## Scope

**In scope** — fix 6 problems:
1. **404 on boot** — shared `stripEnvQuotes()` helper in `src/config/index.js`; strip quotes+trim on telegram token (mirror `ADMIN_PANEL_PASSWORD` L107).
2. **Token not UI-controllable** — settings-backed token, AES-256-GCM via `settingsService.encryptSecret` → `setJSON('telegram.token', {encKey, verifiedAt})` (mirror LLM key flow L389); verify via `getMe` before save; runtime reconfigure without restart; boot precedence **settings > env > none**, resolved in `start()` after `initDb`.
3. **Bot identity not surfaced** — lazy `getMe` with cache (never at boot — FakeTelegraf lacks `getMe`); surface `botUsername`/`botFirstName` in status. New fields MUST be named `maskedToken`/`tokenSource` — `token`/`botToken` are asserted `undefined` in `tests/telegram-admin.test.js` L207-208.
4. **Admin HMAC coupling** — decouple `resolveAdminSigningSecret`: always use persisted `data/.admin-secret` (create on first boot), so UI token rotation no longer invalidates admin sessions. Accept one-time re-login after deploy.
5. **Admin username** — add informational `adminUsername` (@WilkinBR) persisted as `telegram.admin_username`; keep numeric validation for the existing admin ID.
6. **Missing i18n key** — `telegram.saved` (used in admin.html L1336) missing from all 5 dictionaries; add it.

**Out of scope** — sibling quoted-env bugs (ALLOWED_ORIGINS, WIDGET_API_KEY, REDIS_URL, FEATURE_*, etc.) → separate follow-up using the same `stripEnvQuotes` helper; webhooks; multi-admin roles; message-history export; reply routing, Spanish translation, or the stable bot contract. FakeTelegraf integration tests stay green (identity lazy).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- **telegram-admin** (main): token becomes UI-managed (encrypted, settings-backed) instead of env-only; status gains bot identity + masked token fields; admin username added.
- **admin-settings**: runtime-reconfigure requirement now extends to the Telegram token; i18n convention fix (`telegram.saved`).

## Approach

Per problem: (1) `stripEnvQuotes()` in config, reuse for token; (2) new `verifyTelegramToken()` + `reconfigureTelegramBot()` in `src/telegram/bot.js`, PUT dispatches token vs adminId (aliased `/api/admin/settings/telegram`), token resolution moves into `server.js start()` after `initDb`; (3) lazy getMe identity cache + `maskedToken`/`tokenSource`/`botUsername`/`botFirstName` in `getTelegramStatus()`; (4) `resolveAdminSigningSecret` ignores `telegramToken`, always `data/.admin-secret`; (5) `adminUsername` persisted + returned in status; (6) add `telegram.saved` to 5 dictionaries.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/config/index.js` | Modified | `stripEnvQuotes()` helper; token L80 quote-stripped |
| `src/telegram/bot.js` | Modified | `verifyTelegramToken`, `reconfigureTelegramBot`, lazy identity cache, status fields |
| `src/routes/admin.js` | Modified | Token PUT (verify→encrypt→save→reconfigure), `adminUsername`, status enrichment |
| `src/security/admin-auth.js` | Modified | `resolveAdminSigningSecret` decoupled from telegram token |
| `server.js` | Modified | Token precedence resolution in `start()`; `createAdminAuth` no telegram token; wiring |
| `public/admin.html` | Modified | Token input + identity display; `telegram.saved` + new i18n keys (5 dicts) |
| `tests/boot-without-token.test.js` | Modified | Rewrite HMAC-decoupling assertions |
| `tests/telegram-admin.test.js` | Modified | Token-save + identity assertions (keep `token`/`botToken` undefined) |
| `.env.example`, READMEs | Modified | Token now optional if set in admin UI |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| One-time admin re-login after HMAC decouple | Med | Documented; only affects sessions created with the old telegram-token secret |
| FakeTelegraf lacks `getMe` → integration breakage | Low | Identity strictly lazy; `verifyTelegramToken` only invoked on explicit admin save |
| `telegramReady` closure in server.js goes stale after reconfigure | Med | Update via `getTelegramStatus()` getter or document health reflects boot state |
| Stored-token decrypt failure (SETTINGS_KEY rotated) | Low | Fall back to env token + warn; never crash boot |

## Rollback Plan

Revert the stacked commits. Env-token fallback is preserved (precedence keeps `TELEGRAM_TOKEN` working), so existing installs keep functioning without UI changes. `data/.admin-secret` already exists on running installs → no secret regeneration. To remove a UI-saved token: delete `telegram.token` row from settings (or revert to env-only behavior by reverting the token-save commit).

## Dependencies

None external. Uses existing `settingsService.encryptSecret`/`decryptSecret`/`maskSecret` (AES-256-GCM) and Telegraf `getMe`.

## Success Criteria

- [ ] `/health` shows `telegramReady:true` with the JSON-quoted env token — no manual `.env` edit
- [ ] Token saved via UI: getMe-verified, encrypted in settings, bot reconfigured and running without restart
- [ ] Status returns `maskedToken`/`tokenSource`/`botUsername`/`botFirstName`; never `token`/`botToken`
- [ ] Admin session survives a token rotation (no re-login forced by rotation)
- [ ] `adminUsername` (@WilkinBR) persisted and displayed; numeric admin ID still validated
- [ ] `telegram.saved` renders in es/en/pt/fr/de
- [ ] `npm test` green (incl. rewritten boot-without-token + FakeTelegraf suites)

## Decision Notes

No product-level decisions pending user confirmation — this is a direct fix + UI-control change with the approach fully determined by exploration. All choices (encrypted settings storage, precedence, lazy identity, HMAC decoupling) are technical, mirroring proven in-repo patterns.
