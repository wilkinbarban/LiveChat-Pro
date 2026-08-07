const { Telegraf } = require('telegraf');
const { escapeTelegramHtml } = require('../utils/sanitizer');
const { maskSecret } = require('../services/settings');

// The bot module keeps a singleton Telegraf instance because Telegram long
// polling/webhook ownership is process-wide. setupTelegramBot wires runtime
// dependencies after server.js has created services and sockets.
let bot = null;
let _token = null;
let _adminId = null;
let _tokenSource = null;
let _logger = null;
let _clusterState = null;
let _status = 'stopped';
let _deps = null;

// Lazy bot identity (ADR-9): populated only by refreshTelegramIdentity(), never
// at setup/launch, so FakeTelegraf-based integration tests boot without getMe.
const TELEGRAM_IDENTITY_CACHE_MS = 5 * 60 * 1000;
let _identity = { username: null, firstName: null, fetchedAt: 0 };

function setupTelegramBot(deps) {
  _deps = deps;
  const {
    token,
    adminId,
    tokenSource,
    logger,
    sessions,
    clusterState,
    stmts,
    io,
    sessionRoom,
    ensureSessionLoaded,
    listSessionsForAdmin,
    sendAdminReplyToSession,
    findSessionIdByPrefix,
    aiBot,
  } = deps;

  _token = token || null;
  _adminId = adminId || null;
  _tokenSource = _token ? (tokenSource || 'env') : null;
  _logger = logger || null;
  _clusterState = clusterState || null;
  // Identity belongs to the current instance: rebuilds (reconfigure/start)
  // invalidate the cache so the next status refresh fetches the NEW bot.
  _identity = { username: null, firstName: null, fetchedAt: 0 };

  if (!_token) {
    bot = null;
    _status = 'not-configured';
    return null;
  }

  bot = new Telegraf(_token);
  _status = 'stopped';

  // Lists only live sessions so the admin can choose where to reply from
  // Telegram without opening the web panel.
  bot.command('usuarios', async (ctx) => {
    if (String(ctx.from.id) !== String(_adminId)) return;
    const active = (await listSessionsForAdmin()).filter(s => s.connected);
    if (!active.length) return ctx.reply('No hay usuarios activos ahora mismo.');
    const list = active.map(s =>
      `• <b>${escapeTelegramHtml(s.name || 'Sin nombre')}</b> <code>${escapeTelegramHtml(s.sessionId.slice(0,8))}</code> — ${escapeTelegramHtml(s.geo?.city || '?')} ${escapeTelegramHtml(s.geo?.country || '?')}`
    ).join('\n');
    ctx.replyWithHTML(`👥 <b>Usuarios activos (${active.length})</b>\n\n${list}`);
  });

  // Telegram-side ban mirrors the web admin ban flow: persist, update shared
  // state, disconnect visitor sockets and remove local cache.
  bot.command('ban', async (ctx) => {
    if (String(ctx.from.id) !== String(_adminId)) return;
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Uso: /ban [sessionId]');
    const sid = await findSessionIdByPrefix(id);
    if (!sid) return ctx.reply('Sesión no encontrada.');
    const session = await ensureSessionLoaded(sid);
    if (!session) return ctx.reply('Sesión no encontrada.');
    session.banned = true;
    session.connected = false;
    session.socketCount = 0;
    try {
      await stmts.banSession.run(sid);
    } catch (dbError) {
      logger.error({ err: dbError, sessionId: sid }, 'Error BD en banSession (/ban)');
    }
    await clusterState.addBanned(sid);
    const sockets = await io.in(sessionRoom(sid)).fetchSockets();
    for (const activeSocket of sockets) {
      activeSocket.emit('banned');
      activeSocket.disconnect(true);
    }
    await clusterState.deleteSession(sid);
    sessions.delete(sid);
    ctx.reply(`✅ Usuario ${session.name || sid.slice(0,8)} baneado.`);
  });

  // Diagnostic session detail for support work directly from Telegram.
  bot.command('info', async (ctx) => {
    if (String(ctx.from.id) !== String(_adminId)) return;
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Uso: /info [sessionId]');
    const sid = await findSessionIdByPrefix(id);
    if (!sid) return ctx.reply('Sesión no encontrada.');
    const s = await ensureSessionLoaded(sid);
    if (!s) return ctx.reply('Sesión no encontrada.');
    ctx.replyWithHTML(
      `ℹ️ <b>Info de sesión</b>\n\n` +
      `👤 Nombre: ${escapeTelegramHtml(s.name || 'N/A')}\n` +
      `🆔 ID: <code>${escapeTelegramHtml(s.sessionId)}</code>\n` +
      `🌐 IP: <code>${escapeTelegramHtml(s.ip)}</code>\n` +
      `🌍 Ubicación: ${escapeTelegramHtml(s.geo?.city)}, ${escapeTelegramHtml(s.geo?.country)}\n` +
      `📡 ISP: ${escapeTelegramHtml(s.geo?.isp)}\n` +
      `📱 UA: <i>${escapeTelegramHtml((s.userAgent || '').slice(0,120))}</i>\n` +
      `🔗 Página: ${escapeTelegramHtml(s.currentPage)}\n` +
      `🗣 Idioma: ${escapeTelegramHtml(s.lang)}\n` +
      `⚡ Prioridad: ${s.priority ? '🔴 Alta' : '🟢 Normal'}\n` +
      `💬 Mensajes: ${s.messages.length}`
    );
  });

  // Manual cleanup trims stale in-memory sessions and empty old database rows.
  bot.command('clean', async (ctx) => {
    if (String(ctx.from.id) !== String(_adminId)) return;
    const threshold = Date.now() - 3600000;
    let memCount = 0;
    for (const [id, s] of sessions) {
      if (!s.connected && s.lastActive < threshold) {
        sessions.delete(id);
        await clusterState.deleteSession(id);
        memCount++;
      }
    }
    let dbCount = 0;
    try {
      const result = await stmts.deleteEmptyInactive.run(Date.now() - 24 * 3600000);
      dbCount = result.changes;
    } catch (dbError) {
      logger.error({ err: dbError }, 'Error BD en deleteEmptyInactive');
    }
    ctx.reply(`🧹 ${memCount} sesiones eliminadas de memoria, ${dbCount} de la base de datos.`);
  });

  bot.command('bot', async (ctx) => {
    if (String(ctx.from.id) !== String(_adminId)) return;
    const parts = ctx.message.text.split(' ');
    const action = parts[1];
    const prefix = parts[2];

    if (!action || !['on', 'off'].includes(action)) {
      return ctx.reply('Uso: /bot on [sessionId] | /bot off [sessionId]\n/bot on → reactiva el bot\n/bot off → silencia el bot');
    }

    const sid = prefix
      ? await findSessionIdByPrefix(prefix)
      : await clusterState.getPendingReply(_adminId);
    if (!sid) return ctx.reply('❓ Sesión no encontrada. Usa /usuarios para ver las activas.');

    const session = await ensureSessionLoaded(sid);
    if (!session) return ctx.reply('❓ Sesión no encontrada.');

    session.botSilenced = (action === 'off');
    try {
      await stmts.updateBotSilenced?.run(action === 'off' ? 1 : 0, sid);
    } catch (e) {
      logger.error({ err: e, sessionId: sid }, 'Error updating bot_silenced via /bot command');
    }
    ctx.reply(`🤖 Bot ${action === 'on' ? 'activado ✅' : 'desactivado 🔇'} para sesión de <b>${escapeTelegramHtml(session.name || sid.slice(0,8))}</b>`, { parse_mode: 'HTML' });
  });

  // A plain Telegram message is treated as an admin reply. If the admin replied
  // to a specific notification, that Telegram message id wins; otherwise the
  // latest pending session is used.
  bot.on('message', async (ctx) => {
    if (String(ctx.from.id) !== String(_adminId)) return;
    if (ctx.message.text?.startsWith('/')) return;

    const replyText = ctx.message.text;
    if (!replyText) return;

    const repliedSessionId = await resolveTelegramReplySessionId(ctx.message);
    const sessionId = repliedSessionId || await clusterState.getPendingReply(_adminId);
    if (!sessionId) return ctx.reply('❓ No hay sesión activa. Usa /usuarios para ver las activas.');

    const session = await ensureSessionLoaded(sessionId);
    if (!session) return ctx.reply('❓ Sesión no encontrada.');

    const result = await sendAdminReplyToSession(session, replyText);
    if (!result.ok) return ctx.reply(`⚠️ ${result.error}`);

    await clusterState.setPendingReply(_adminId, sessionId);

    // Silence AI bot for this session when human takes over
    if (aiBot?.isEnabled?.()) {
      session.botSilenced = true;
      try {
        await stmts.updateBotSilenced?.run(1, sessionId);
      } catch (e) {
        logger.error({ err: e, sessionId }, 'Error updating bot_silenced');
      }
    }

    ctx.reply(`✅ Enviado a ${session.name || 'usuario'}`);
  });

  return bot;
}

// Throwaway token verification used by the admin save flow (ADR-3): builds a
// fresh Telegraf client, calls getMe, and discards it. Never polls, never
// throws — errors resolve as { ok: false, error }.
async function verifyTelegramToken(token) {
  try {
    const me = await new Telegraf(token).telegram.getMe();
    return {
      ok: true,
      id: me.id ?? null,
      username: me.username ?? null,
      first_name: me.first_name ?? null,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

// Boot-time token resolution (ADR-2): settings-backed (decrypted) wins over
// env; a decrypt failure warns and falls back to env; neither yields none.
async function resolveTelegramToken({ settingsService, envToken = null, logger = null } = {}) {
  if (settingsService) {
    try {
      const stored = await settingsService.getJSON('telegram.token', null);
      if (stored?.encKey) {
        const decrypted = await settingsService.decryptSecret(stored.encKey);
        if (decrypted) {
          return { token: decrypted, tokenSource: 'settings' };
        }
      }
    } catch (error) {
      logger?.warn?.({ err: error }, 'No se pudo descifrar el token de Telegram; usando variable de entorno');
    }
  }
  if (envToken) {
    return { token: envToken, tokenSource: 'env' };
  }
  return { token: null, tokenSource: 'none' };
}

// Lazy identity fetch (ADR-9): the only getMe call besides verifyTelegramToken.
// Runs on explicit status refresh only, caches ~5 minutes, and fails safe to
// null when getMe is unavailable or errors (FakeTelegraf boot safety).
async function refreshTelegramIdentity() {
  if (!_token || !bot) return null;
  const now = Date.now();
  if (_identity.fetchedAt && now - _identity.fetchedAt < TELEGRAM_IDENTITY_CACHE_MS) {
    return _identity;
  }
  try {
    const me = await bot.telegram.getMe();
    _identity = {
      username: me.username ?? null,
      firstName: me.first_name ?? null,
      fetchedAt: now,
    };
  } catch {
    _identity = { username: null, firstName: null, fetchedAt: 0 };
  }
  return _identity;
}

function launchTelegramBot(timeoutMs = 10000) {
  if (!_token || !bot) {
    _status = 'not-configured';
    return Promise.resolve();
  }
  // Telegraf launch can hang on network issues. The timeout lets the HTTP server
  // start and exposes Telegram readiness through /health.
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Telegram launch timeout'));
    }, timeoutMs);
    timer.unref?.();

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fn === resolve) _status = 'running';
      fn(value);
    };

    bot.launch(() => settle(resolve))
      .then(() => settle(resolve))
      .catch(error => {
        if (settled) {
          _logger?.error({ err: error }, 'El bot de Telegram se detuvo con error');
          return;
        }
        settle(reject, error);
      });
  });
}

async function sendToAdmin(text, extra = {}, sessionId = null) {
  if (!bot || !_adminId) return;
  try {
    const message = await bot.telegram.sendMessage(_adminId, text, { parse_mode: 'HTML', ...extra });
    if (sessionId && message?.message_id) {
      // Store reverse mapping so replying to this Telegram message targets the
      // originating chat session.
      await _clusterState.setTelegramMessageSession(_adminId, message.message_id, sessionId);
    }
    return message;
  } catch (e) {
    _logger?.error({ err: e }, 'Telegram send error');
  }
}

// Compact HTML card used by Telegram notifications. All user-controlled fields
// must be escaped before passing parse_mode=HTML.
function sessionCard(s) {
  return [
    `👤 <b>${escapeTelegramHtml(s.name || 'Sin nombre')}</b> · <code>${escapeTelegramHtml(s.sessionId.slice(0,8))}</code>`,
    `🌍 ${escapeTelegramHtml(s.geo?.city || '?')}, ${escapeTelegramHtml(s.geo?.country || '?')} · ISP: ${escapeTelegramHtml(s.geo?.isp || '?')}`,
    `📱 <i>${escapeTelegramHtml((s.userAgent || '').slice(0, 80))}</i>`,
    `🔗 ${escapeTelegramHtml(s.currentPage || '/')}`,
    `⏱ ${new Date().toLocaleTimeString('es-ES')}`,
    `\n💬 Responde a este mensaje en Telegram para contestar a esta sesión.`
  ].join('\n');
}

async function resolveTelegramReplySessionId(message) {
  const replyToMessageId = message?.reply_to_message?.message_id;
  if (!replyToMessageId) return null;
  return _clusterState.getTelegramMessageSession(_adminId, replyToMessageId);
}

function getTelegramStatus() {
  const base = { adminId: _adminId || null };
  if (!_token) {
    return {
      ...base,
      status: 'not-configured',
      configured: false,
      maskedToken: null,
      tokenSource: null,
      botUsername: null,
      botFirstName: null,
    };
  }
  return {
    ...base,
    status: _status,
    configured: true,
    maskedToken: maskSecret(_token),
    tokenSource: _tokenSource || 'env',
    botUsername: _identity.username,
    botFirstName: _identity.firstName,
  };
}

async function startTelegramBot(timeoutMs = 10000) {
  if (!_token) {
    throw new Error('Telegram bot token is not configured');
  }
  if (_status === 'running') {
    return { status: 'running' };
  }
  // Always rebuild from _deps (ADR-4): a token/adminId changed while stopped
  // (reconfigureTelegramBot) must reach the launched instance. Recreating the
  // Telegraf instance is harmless when no polling is active.
  if (_deps) {
    setupTelegramBot(_deps);
  }
  await launchTelegramBot(timeoutMs);
  _status = 'running';
  return { status: 'running' };
}

async function stopTelegramBot() {
  if (!_token) {
    _status = 'not-configured';
    return { status: 'not-configured' };
  }
  if (bot && typeof bot.stop === 'function') {
    try {
      await bot.stop();
    } catch (_err) {
      // ignore if already stopped
    }
  }
  _status = 'stopped';
  return { status: 'stopped' };
}

function setTelegramAdminId(adminId) {
  _adminId = adminId ? String(adminId) : null;
}

// Runtime reconfigure (ADR-3 / admin-settings spec): stops a running bot,
// swaps the given credentials in _deps, rebuilds the Telegraf instance and
// optionally relaunches. launch:true is the live-apply path for token saves;
// launch:false swaps credentials while stopped (clear/empty-save path).
async function reconfigureTelegramBot({ token, adminId, launch = false, tokenSource } = {}) {
  if (_status === 'running') {
    await stopTelegramBot();
  }
  const nextDeps = {
    ...(_deps || {}),
    ...(token !== undefined ? { token } : {}),
    ...(tokenSource !== undefined ? { tokenSource } : {}),
    ...(adminId !== undefined ? { adminId } : {}),
  };
  _deps = nextDeps;
  setupTelegramBot(_deps);
  if (launch && token) {
    await launchTelegramBot();
  }
  return { status: _status };
}

module.exports = {
  setupTelegramBot,
  launchTelegramBot,
  sendToAdmin,
  sessionCard,
  resolveTelegramReplySessionId,
  getBot: () => bot,
  getTelegramStatus,
  startTelegramBot,
  stopTelegramBot,
  setTelegramAdminId,
  verifyTelegramToken,
  reconfigureTelegramBot,
  resolveTelegramToken,
  refreshTelegramIdentity,
};
