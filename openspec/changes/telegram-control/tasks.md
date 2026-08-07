# Tasks: Telegram Control — Token & Admin Fields in Admin UI, 404 Fix

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650–750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → … → PR 7 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test cmd | Harness | Rollback |
|------|------|----|------------------|---------|----------|
| 1 | stripEnvQuotes 404 fix | 1 | `node --test tests/boot-without-token.test.js` | unit | config |
| 2 | HMAC decoupling | 2 | `node --test tests/boot-without-token.test.js` | unit | admin-auth+server |
| 3 | bot exports+lazy id | 3 | `node --test tests/telegram-bot.test.js tests/telegram-routing.test.js` | api boot | bot.js |
| 4 | start() resolve+health | 4 | `node --test tests/api.test.js` | real boot | server.js |
| 5 | PUT dispatch+status | 5 | `node --test tests/telegram-admin.test.js` | router | routes |
| 6 | admin.html UI+i18n | 6 | `node --test tests/admin-telegram-tab.test.js` | panel | html |
| 7 | docs+verify | 7 | `npm test && npx biome check .` | full | docs only |

## Phase 1: Config Foundation (PR 1)

- [x] 1.1 [RED] stripEnvQuotes unit tests + quoted-token read — tests/config.test.js V: wu1
- [x] 1.2 [GREEN] Add/export stripEnvQuotes() src/config/index.js; apply L80 token read; refactor L107 password V: same
- [x] 1.3 [REFACTOR] parseInteger keeps own strip V: `npm test`

## Phase 2: HMAC Decoupling (PR 2)

- [ ] 2.1 [RED] Rewrite boot-without-token.test.js L49-95: secret always data/.admin-secret 0600; token param ignored; rotation keeps cookies V: wu2
- [ ] 2.2 [GREEN] admin-auth.js: drop telegramToken branch (L18-21) + createAdminAuth param (L44-53); remove arg server.js:246 V: same
- [ ] 2.3 [REFACTOR] one-time re-login note V: `npm test`

## Phase 3: Bot Module Core (PR 3)

- [ ] 3.1 [RED] New tests/telegram-bot.test.js: verifyTelegramToken ok/fail; resolveTelegramToken precedence+decrypt-fail; reconfigureTelegramBot stop→setup→launch V: wu3
- [ ] 3.2 [GREEN] bot.js: add verifyTelegramToken/reconfigureTelegramBot/resolveTelegramToken/refreshTelegramIdentity (cache 5min); startTelegramBot always re-setup (L283) V: same
- [ ] 3.3 [GREEN] getTelegramStatus +botUsername/botFirstName/maskedToken/tokenSource; setup accepts tokenSource V: wu3
- [ ] 3.4 [REFACTOR] no getMe at boot/launch (FakeTelegraf-safe) V: `npm test`

## Phase 4: Server Wiring (PR 4)

- [ ] 4.1 [RED] api.test.js: FakeTelegraf boot without getMe; /health reflects reconfigure V: wu4
- [ ] 4.2 [GREEN] server.js start(): resolveTelegramToken after initDb; pass token+source; reconcile L491 vs start() V: same
- [ ] 4.3 [GREEN] drop telegramReady var (L271/550/553/562); health getter getTelegramStatus().status==='running' (L489) V: wu4
- [ ] 4.4 [REFACTOR] createAdminAuth call clean V: `npm test`

## Phase 5: Admin Routes (PR 5)

- [ ] 5.1 [RED] telegram-admin.test.js: token save valid/invalid/empty; status identity+masked+source; token/botToken undefined (L207-8); adminUsername PUT V: wu5
- [ ] 5.2 [GREEN] admin.js: handlePutTelegram dispatcher token/adminId/adminUsername both aliases (L593-4); flow mirrors LLM L384-394 verify→encryptSecret→setJSON telegram.token→reconfigure launch:true V: same
- [ ] 5.3 [GREEN] handleGetTelegramStatus: refreshTelegramIdentity; merge maskedToken/tokenSource/adminUsername; never token V: wu5
- [ ] 5.4 [REFACTOR] empty-save → env|none source V: `npm test`

## Phase 6: Admin UI + i18n (PR 6)

- [ ] 6.1 [RED] admin-telegram-tab.test.js: token input/identity/adminUsername/telegram.saved in 5 dicts; old DOM ids kept V: wu6
- [ ] 6.2 [GREEN] admin.html tab L340-364: token input+save/verify+masked/identity display+adminUsername; JS L1246-1348 V: same
- [ ] 6.3 [GREEN] add telegram.saved+token keys to 5 dicts L441-445 V: wu6
- [ ] 6.4 [REFACTOR] keep 12 telegram.* keys+DOM ids V: `npm test`

## Phase 7: Docs + Verification (PR 7)

- [ ] 7.1 [GREEN] .env.example optional token note; README precedence+re-login V: `git diff --stat`
- [ ] 7.2 [VERIFY] wu7 full suite green
- [ ] 7.3 [REFACTOR] remove dead telegramReady code V: wu7
