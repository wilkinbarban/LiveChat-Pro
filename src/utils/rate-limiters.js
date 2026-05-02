'use strict';

const rateLimit = require('express-rate-limit');

const rateLimitMessage = { error: 'Demasiadas peticiones. Inténtalo más tarde.' };

// Convert minute-based env config into milliseconds while enforcing a minimum
// non-zero window for express-rate-limit.
function rateLimitWindowMs(windowMinutes) {
  return Math.max(1, windowMinutes) * 60 * 1000;
}

// Creates all HTTP limiters in one place so env settings and admin exemptions
// stay consistent across public, login, admin and upload routes.
function createHttpRateLimiters({ rateLimitConfig, adminCookieName, verifyAdminToken }) {
  const windowMs = rateLimitWindowMs(rateLimitConfig.windowMinutes);

  const publicApiLimiter = rateLimit({
    windowMs,
    max: Math.max(1, rateLimitConfig.publicMax),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
  });

  const loginLimiter = rateLimit({
    windowMs,
    max: Math.max(1, rateLimitConfig.loginMax),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
  });

  const adminLimiter = rateLimit({
    windowMs,
    max: Math.max(1, rateLimitConfig.adminMax),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
    // Authenticated admin calls are trusted operator activity and should not
    // consume the unauthenticated admin-probing quota.
    skip: req => verifyAdminToken(req.cookies?.[adminCookieName]),
  });

  const uploadLimiter = rateLimit({
    windowMs: rateLimitWindowMs(rateLimitConfig.uploadWindowMinutes || 1),
    max: Math.max(1, rateLimitConfig.uploadMax || 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas imágenes. Inténtalo más tarde.' },
    // Uploads are limited per IP and chat session to avoid one noisy visitor
    // blocking uploads for every other visitor behind the same proxy.
    keyGenerator: req => `${req.ip}:${req.params?.sessionId || req.body?.sessionId || 'unknown'}`,
    skip: req => verifyAdminToken(req.cookies?.[adminCookieName]),
  });

  return {
    publicApiLimiter,
    loginLimiter,
    adminLimiter,
    uploadLimiter,
  };
}

// Lightweight per-socket limiter for realtime visitor messages. It is scoped to
// one connection and complements the HTTP route limiters.
function createMsgRateLimiter(maxMsgs = 20, windowMs = 60000) {
  let count = 0;
  let resetAt = Date.now() + windowMs;
  return function isAllowed() {
    const now = Date.now();
    if (now > resetAt) {
      count = 0;
      resetAt = now + windowMs;
    }
    if (count >= maxMsgs) return false;
    count++;
    return true;
  };
}

module.exports = {
  createHttpRateLimiters,
  createMsgRateLimiter,
  rateLimitWindowMs,
};
