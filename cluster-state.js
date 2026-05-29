'use strict';

// ClusterState is the only module that knows whether the application is
// running as a single process or with Redis-backed shared state.
class ClusterState {
  constructor({ redisUrl = '', keyPrefix = 'lcp', logger = console } = {}) {
    this.redisUrl = redisUrl;
    this.keyPrefix = keyPrefix;
    this.logger = logger;
    this.mode = 'memory';

    this.pubClient = null;
    this.subClient = null;
    this.stateClient = null;

    // In-memory mirrors are always populated. When Redis is available they are
    // used as a fast local cache; without Redis they become the source of truth.
    this.pendingReply = new Map();
    this.bannedSessions = new Set();
    this.telegramMessageSessions = new Map();
    this.localPresence = new Map();
  }

  // Keep every Redis key namespaced so multiple deployments can share a Redis
  // instance without colliding.
  key(suffix) {
    return `${this.keyPrefix}:${suffix}`;
  }

  sessionKey(sessionId) {
    return this.key(`session:${sessionId}`);
  }

  presenceKey(sessionId) {
    return this.key(`presence:${sessionId}`);
  }

  telegramMessageKey(adminId, messageId) {
    return this.key(`tgmsg:${adminId}:${messageId}`);
  }

  // A snapshot intentionally excludes full message history. Socket presence and
  // admin overviews need lightweight session metadata; messages stay in SQLite.
  snapshotFromSession(session, overrides = {}) {
    return {
      sessionId: session.sessionId,
      name: session.name ?? null,
      lang: session.lang || 'es',
      ip: session.ip || '',
      geo: session.geo || { city: 'Desconocido', country: 'Desconocido', isp: 'Desconocido' },
      userAgent: session.userAgent || '',
      currentPage: session.currentPage || '/',
      banned: !!session.banned,
      priority: !!session.priority,
      botSilenced: !!session.botSilenced,
      adminLastSeenTs: session.adminLastSeenTs || 0,
      userLastSeenTs: session.userLastSeenTs || 0,
      awaitingName: !!session.awaitingName,
      lastActive: session.lastActive || Date.now(),
      createdAt: session.createdAt || Date.now(),
      connected: Object.prototype.hasOwnProperty.call(overrides, 'connected')
        ? !!overrides.connected
        : !!session.connected,
      socketCount: Object.prototype.hasOwnProperty.call(overrides, 'socketCount')
        ? Math.max(0, Number(overrides.socketCount) || 0)
        : Math.max(0, Number(session.socketCount) || 0),
    };
  }

  // Enables Socket.IO cross-node fanout and Redis-backed state. Failure is
  // non-fatal so local development and single-node deployments continue to work.
  async connect(io) {
    if (!this.redisUrl) return false;

    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pubClient = createClient({ url: this.redisUrl });
    const subClient = pubClient.duplicate();
    const stateClient = pubClient.duplicate();

    const errorHandler = (err) => {
      this.logger.debug({ err }, 'Error de conexión en cliente Redis (ignorado para usar modo local)');
    };

    pubClient.on('error', errorHandler);
    subClient.on('error', errorHandler);
    stateClient.on('error', errorHandler);

    try {
      await Promise.all([
        pubClient.connect(),
        subClient.connect(),
        stateClient.connect(),
      ]);

      io.adapter(createAdapter(pubClient, subClient));

      this.pubClient = pubClient;
      this.subClient = subClient;
      this.stateClient = stateClient;
      this.mode = 'redis';

      this.logger.info({ mode: this.mode }, 'Redis habilitado para estado compartido y Socket.IO');
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, 'No se pudo habilitar Redis. Se usará el modo local');
      await Promise.allSettled([
        pubClient.quit(),
        subClient.quit(),
        stateClient.quit(),
      ]);
      this.pubClient = null;
      this.subClient = null;
      this.stateClient = null;
      this.mode = 'memory';
      return false;
    }
  }

  async close() {
    await Promise.allSettled([
      this.pubClient?.quit?.(),
      this.subClient?.quit?.(),
      this.stateClient?.quit?.(),
    ]);
  }

  // Banned sessions are copied into Redis at startup so every node can reject a
  // blocked visitor before joining a Socket.IO room.
  async seedBanned(sessionIds) {
    for (const sessionId of sessionIds) this.bannedSessions.add(sessionId);
    if (!this.stateClient || !sessionIds.length) return;
    await this.stateClient.sAdd(this.key('banned'), sessionIds);
  }

  async isBanned(sessionId) {
    if (this.bannedSessions.has(sessionId)) return true;
    if (!this.stateClient) return false;
    return this.stateClient.sIsMember(this.key('banned'), sessionId);
  }

  async addBanned(sessionId) {
    this.bannedSessions.add(sessionId);
    if (!this.stateClient) return;
    await this.stateClient.sAdd(this.key('banned'), sessionId);
  }

  async removeBanned(sessionId) {
    this.bannedSessions.delete(sessionId);
    if (!this.stateClient) return;
    await this.stateClient.sRem(this.key('banned'), sessionId);
  }

  // Telegram replies without an explicit quoted message use the last session the
  // admin interacted with. The value is keyed by admin id for future multi-admin
  // compatibility even though the current product targets one admin.
  async setPendingReply(adminId, sessionId) {
    this.pendingReply.set(String(adminId), sessionId);
    if (!this.stateClient) return;
    await this.stateClient.hSet(this.key('pending_reply'), String(adminId), sessionId);
  }

  async getPendingReply(adminId) {
    const key = String(adminId);
    if (this.pendingReply.has(key)) return this.pendingReply.get(key);
    if (!this.stateClient) return null;
    const sessionId = await this.stateClient.hGet(this.key('pending_reply'), key);
    if (sessionId) this.pendingReply.set(key, sessionId);
    return sessionId || null;
  }

  // Maps Telegram message ids back to chat sessions so replying to a Telegram
  // notification targets the correct visitor even after process restarts.
  async setTelegramMessageSession(adminId, messageId, sessionId, ttlSeconds = 7 * 24 * 60 * 60) {
    const key = `${adminId}:${messageId}`;
    this.telegramMessageSessions.set(key, sessionId);
    if (!this.stateClient) return;
    await this.stateClient.set(this.telegramMessageKey(adminId, messageId), sessionId, { EX: ttlSeconds });
  }

  async getTelegramMessageSession(adminId, messageId) {
    const key = `${adminId}:${messageId}`;
    if (this.telegramMessageSessions.has(key)) return this.telegramMessageSessions.get(key);
    if (!this.stateClient) return null;

    const sessionId = await this.stateClient.get(this.telegramMessageKey(adminId, messageId));
    if (sessionId) this.telegramMessageSessions.set(key, sessionId);
    return sessionId || null;
  }

  // Presence is a reference count rather than a boolean because one visitor can
  // open the widget in multiple tabs or reconnect while an old socket is closing.
  async incrementPresence(sessionId) {
    if (!this.stateClient) {
      const count = (this.localPresence.get(sessionId) || 0) + 1;
      this.localPresence.set(sessionId, count);
      return count;
    }
    const presenceKey = this.presenceKey(sessionId);
    const count = await this.stateClient.incr(presenceKey);
    await this.stateClient.expire(presenceKey, 48 * 60 * 60);
    return count;
  }

  async decrementPresence(sessionId) {
    if (!this.stateClient) {
      const count = Math.max(0, (this.localPresence.get(sessionId) || 0) - 1);
      if (count > 0) this.localPresence.set(sessionId, count);
      else this.localPresence.delete(sessionId);
      return count;
    }
    const presenceKey = this.presenceKey(sessionId);
    const count = await this.stateClient.decr(presenceKey);
    if (count <= 0) {
      await this.stateClient.del(presenceKey);
      return 0;
    }
    await this.stateClient.expire(presenceKey, 48 * 60 * 60);
    return count;
  }

  async getPresence(sessionId) {
    if (!this.stateClient) return this.localPresence.get(sessionId) || 0;
    const value = await this.stateClient.get(this.presenceKey(sessionId));
    return Math.max(0, Number.parseInt(value || '0', 10) || 0);
  }

  // Persist the latest lightweight session view for admin lists and reconnects
  // across nodes. SQLite remains the durable store for messages.
  async syncSession(session, overrides = {}) {
    if (!this.stateClient) return this.snapshotFromSession(session, overrides);

    const snapshot = this.snapshotFromSession(session, overrides);
    await this.stateClient.multi()
      .set(this.sessionKey(session.sessionId), JSON.stringify(snapshot))
      .sAdd(this.key('sessions'), session.sessionId)
      .expire(this.sessionKey(session.sessionId), 48 * 60 * 60)
      .exec();
    return snapshot;
  }

  async deleteSession(sessionId) {
    this.localPresence.delete(sessionId);
    if (!this.stateClient) return;
    await this.stateClient.multi()
      .del(this.sessionKey(sessionId))
      .sRem(this.key('sessions'), sessionId)
      .del(this.presenceKey(sessionId))
      .exec();
  }

  async getSessionSnapshot(sessionId) {
    if (!this.stateClient) return null;
    const raw = await this.stateClient.get(this.sessionKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async getSessionSnapshots(sessionIds) {
    const snapshots = new Map();
    if (!this.stateClient || !sessionIds.length) return snapshots;

    const keys = sessionIds.map(sessionId => this.sessionKey(sessionId));
    const values = await this.stateClient.mGet(keys);

    values.forEach((raw, index) => {
      if (!raw) return;
      try {
        snapshots.set(sessionIds[index], JSON.parse(raw));
      } catch {}
    });

    return snapshots;
  }
}

module.exports = { ClusterState };
