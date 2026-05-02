const { Telegraf } = require('telegraf');
const { escapeTelegramHtml } = require('../utils/sanitizer');

// The bot module keeps a singleton Telegraf instance because Telegram long
// polling/webhook ownership is process-wide. setupTelegramBot wires runtime
// dependencies after server.js has created services and sockets.
let bot = null;
let _adminId = null;
let _logger = null;
let _clusterState = null;

function setupTelegramBot(deps) {
  const {
    token,
    adminId,
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
  } = deps;

  bot = new Telegraf(token);
  _adminId = adminId;
  _logger = logger;
  _clusterState = clusterState;

  // Lists only live sessions so the admin can choose where to reply from
  // Telegram without opening the web panel.
  bot.command('usuarios', async (ctx) => {
    if (ctx.from.id !== adminId) return;
    const active = (await listSessionsForAdmin()).filter(s => s.connected);
    if (!active.length) return ctx.reply('No hay usuarios activos ahora mismo.');
    const list = active.map(s =>
      `• <b>${escapeTelegramHtml(s.name || 'Sin nombre')}</b> <code>${escapeTelegramHtml(s.sessionId.slice(0,8))}</code> — ${escapeTelegramHtml(s.geo?.city || '?')}, ${escapeTelegramHtml(s.geo?.country || '?')}`
    ).join('\n');
    ctx.replyWithHTML(`👥 <b>Usuarios activos (${active.length})</b>\n\n${list}`);
  });

  // Telegram-side ban mirrors the web admin ban flow: persist, update shared
  // state, disconnect visitor sockets and remove local cache.
  bot.command('ban', async (ctx) => {
    if (ctx.from.id !== adminId) return;
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
    if (ctx.from.id !== adminId) return;
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
    if (ctx.from.id !== adminId) return;
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

  // A plain Telegram message is treated as an admin reply. If the admin replied
  // to a specific notification, that Telegram message id wins; otherwise the
  // latest pending session is used.
  bot.on('message', async (ctx) => {
    if (ctx.from.id !== adminId) return;
    if (ctx.message.text?.startsWith('/')) return;

    const replyText = ctx.message.text;
    if (!replyText) return;

    const repliedSessionId = await resolveTelegramReplySessionId(ctx.message);
    const sessionId = repliedSessionId || await clusterState.getPendingReply(adminId);
    if (!sessionId) return ctx.reply('❓ No hay sesión activa. Usa /usuarios para ver las activas.');

    const session = await ensureSessionLoaded(sessionId);
    if (!session) return ctx.reply('❓ Sesión no encontrada.');

    const result = await sendAdminReplyToSession(session, replyText);
    if (!result.ok) return ctx.reply(`⚠️ ${result.error}`);

    await clusterState.setPendingReply(adminId, sessionId);
    ctx.reply(`✅ Enviado a ${session.name || 'usuario'}`);
  });

  return bot;
}

function launchTelegramBot(timeoutMs) {
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
      fn(value);
    };

    bot.launch(() => settle(resolve))
      .then(() => settle(resolve))
      .catch(error => {
        if (settled) {
          _logger.error({ err: error }, 'El bot de Telegram se detuvo con error');
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
    _logger.error({ err: e }, 'Telegram send error');
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

module.exports = {
  setupTelegramBot,
  launchTelegramBot,
  sendToAdmin,
  sessionCard,
  resolveTelegramReplySessionId,
  getBot: () => bot
};
